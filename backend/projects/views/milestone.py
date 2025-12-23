# backend/projects/views/milestone.py
# v2025-12-16 — Invoice snapshot wiring: milestone data + completion notes + attachments

from __future__ import annotations

import logging
from django.db import transaction, IntegrityError
from django.db.models import Q, Max
from rest_framework import status, viewsets
from rest_framework.decorators import action
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response

from projects.models import (
    Milestone,
    MilestoneFile,
    MilestoneComment,
    Invoice,
    InvoiceStatus,
)
from projects.serializers.milestone import MilestoneSerializer
from projects.serializers.milestone_file import MilestoneFileSerializer
from projects.serializers.milestone_comment import MilestoneCommentSerializer
from projects.serializers.invoices import InvoiceSerializer

from projects.permissions_subaccounts import (
    IsContractorOrSubAccount,
    CanEditMilestones,
)
from projects.utils.accounts import get_contractor_for_user

logger = logging.getLogger(__name__)


class MilestoneViewSet(viewsets.ModelViewSet):
    """
    Main Milestone API:
      • Auto-assigns `order` on create()
      • CRUD with Contractor + SubAccount permissions
      • POST   /projects/milestones/check-overlap/
      • GET    /projects/milestones/{id}/files/
      • POST   /projects/milestones/{id}/files/
      • GET    /projects/milestones/{id}/comments/
      • POST   /projects/milestones/{id}/comments/

      ✅ CREATE INVOICE (IDEMPOTENT + SNAPSHOT)
      • POST   /projects/milestones/{id}/create-invoice/
        - Requires milestone.completed == True
        - Requires agreement.escrow_funded == True
        - Idempotent: returns existing invoice if already created
        - DB-safe: uses transaction + DB constraints
        - Snapshots milestone title/description + completion notes + attachments onto Invoice
    """

    permission_classes = [IsAuthenticated, IsContractorOrSubAccount, CanEditMilestones]
    queryset = Milestone.objects.select_related("agreement").all()
    serializer_class = MilestoneSerializer

    def get_queryset(self):
        contractor = get_contractor_for_user(self.request.user)
        if contractor is None:
            return Milestone.objects.none()

        return (
            Milestone.objects
            .select_related("agreement", "agreement__project")
            .filter(agreement__project__contractor=contractor)
            .order_by("order")
        )

    @transaction.atomic
    def create(self, request, *args, **kwargs):
        data = request.data.copy()

        agreement_id = data.get("agreement") or data.get("agreement_id")
        if agreement_id:
            incoming_order = data.get("order")
            if incoming_order in (None, "", [], {}):
                try:
                    ag_id = int(agreement_id)
                    max_order = (
                        Milestone.objects.filter(agreement_id=ag_id)
                        .aggregate(Max("order"))["order__max"]
                        or 0
                    )
                    data["order"] = max_order + 1
                except Exception:
                    data["order"] = 1

        serializer = self.get_serializer(data=data)
        serializer.is_valid(raise_exception=True)
        self.perform_create(serializer)

        headers = self.get_success_headers(serializer.data)
        return Response(serializer.data, status=status.HTTP_201_CREATED, headers=headers)

    @action(detail=False, methods=["post"], url_path="check-overlap")
    def check_overlap(self, request, *args, **kwargs):
        agreement = request.data.get("agreement")
        start = request.data.get("start_date")
        end = request.data.get("completion_date") or request.data.get("due_date")
        milestone_id = request.data.get("id")

        if not (agreement and start and end):
            return Response(
                {"detail": "agreement, start_date and completion_date/due_date are required."},
                status=status.HTTP_400_BAD_REQUEST,
            )

        qs = Milestone.objects.filter(agreement_id=agreement)
        if milestone_id:
            qs = qs.exclude(pk=milestone_id)

        conflicts = list(
            qs.filter(
                Q(start_date__lte=end)
                & (Q(completion_date__gte=start) | Q(due_date__gte=start))
            ).values("id", "title", "start_date", "completion_date", "due_date")
        )
        return Response({"overlaps": bool(conflicts), "conflicts": conflicts}, status=200)

    @action(detail=True, methods=["post"], url_path="create-invoice")
    def create_invoice(self, request, pk=None, *args, **kwargs):
        """
        Create (or return existing) invoice for a completed milestone.
        Snapshots milestone title/description + completion notes + attachments to the Invoice.
        """
        milestone = self.get_object()
        agreement = milestone.agreement

        if not milestone.completed:
            return Response(
                {"detail": "Milestone must be completed before invoicing."},
                status=status.HTTP_400_BAD_REQUEST,
            )

        if not getattr(agreement, "escrow_funded", False):
            return Response(
                {"detail": "Agreement escrow must be funded before invoicing milestones."},
                status=status.HTTP_400_BAD_REQUEST,
            )

        # Idempotent: if already linked, return it
        if getattr(milestone, "invoice_id", None):
            inv = Invoice.objects.filter(pk=milestone.invoice_id).first()
            if inv:
                return Response(
                    InvoiceSerializer(inv, context={"request": request}).data,
                    status=status.HTTP_200_OK
                )

        try:
            with transaction.atomic():
                milestone = Milestone.objects.select_for_update().get(pk=milestone.pk)

                # Re-check idempotency inside transaction
                if getattr(milestone, "invoice_id", None):
                    inv = Invoice.objects.filter(pk=milestone.invoice_id).first()
                    if inv:
                        return Response(
                            InvoiceSerializer(inv, context={"request": request}).data,
                            status=status.HTTP_200_OK,
                        )

                # ----------------------------
                # ✅ Snapshot completion notes
                # ----------------------------
                comments_qs = MilestoneComment.objects.filter(milestone=milestone).order_by("created_at")
                completion_notes_lines = []
                for c in comments_qs:
                    content = (getattr(c, "content", "") or "").strip()
                    if content:
                        completion_notes_lines.append(f"- {content}")
                completion_notes = "\n".join(completion_notes_lines).strip()

                # ----------------------------
                # ✅ Snapshot attachments
                # ----------------------------
                files_qs = MilestoneFile.objects.filter(milestone=milestone).order_by("-uploaded_at")
                attachments = []
                for f in files_qs:
                    if not getattr(f, "file", None):
                        continue
                    try:
                        url = request.build_absolute_uri(f.file.url)
                    except Exception:
                        url = f.file.url
                    attachments.append({
                        "id": f.id,
                        "name": os.path.basename(getattr(f.file, "name", "") or "") or f"file_{f.id}",
                        "url": url,
                        "uploaded_at": getattr(f, "uploaded_at", None).isoformat() if getattr(f, "uploaded_at", None) else None,
                    })

                # ----------------------------
                # ✅ Create invoice with snapshot fields
                # ----------------------------
                invoice = Invoice.objects.create(
                    agreement=agreement,
                    amount=milestone.amount,
                    status=InvoiceStatus.PENDING,

                    milestone_id_snapshot=milestone.id,
                    milestone_title_snapshot=milestone.title or "",
                    milestone_description_snapshot=milestone.description or "",
                    milestone_completion_notes=completion_notes or "",
                    milestone_attachments_snapshot=attachments or [],
                )

                milestone.is_invoiced = True
                milestone.invoice = invoice
                milestone.save(update_fields=["is_invoiced", "invoice"])

                return Response(
                    InvoiceSerializer(invoice, context={"request": request}).data,
                    status=status.HTTP_201_CREATED,
                )

        except IntegrityError as e:
            logger.error("IntegrityError creating invoice for milestone %s: %s", milestone.id, e)
            return Response(
                {"detail": "Unable to create invoice due to a data integrity rule. Please refresh and try again."},
                status=status.HTTP_400_BAD_REQUEST,
            )
        except Exception as e:
            logger.exception("Unexpected error creating invoice for milestone %s: %s", milestone.id, e)
            return Response(
                {"detail": "Unexpected error creating invoice."},
                status=status.HTTP_500_INTERNAL_SERVER_ERROR,
            )

    @action(detail=True, methods=["get", "post"], url_path="files")
    def files(self, request, pk=None, *args, **kwargs):
        milestone = self.get_object()

        if request.method.lower() == "get":
            qs = MilestoneFile.objects.filter(milestone=milestone).order_by("-uploaded_at")
            ser = MilestoneFileSerializer(qs, many=True, context={"request": request})
            return Response(ser.data, status=status.HTTP_200_OK)

        uploaded = request.FILES.get("file") or request.FILES.get("document")
        if not uploaded:
            return Response({"detail": "file is required."}, status=status.HTTP_400_BAD_REQUEST)

        payload = {"milestone": milestone.pk, "file": uploaded}
        serializer = MilestoneFileSerializer(data=payload, context={"request": request})
        serializer.is_valid(raise_exception=True)
        instance = serializer.save(uploaded_by=request.user)
        out = MilestoneFileSerializer(instance, context={"request": request}).data
        return Response(out, status=status.HTTP_201_CREATED)

    @action(detail=True, methods=["get", "post"], url_path="comments")
    def comments(self, request, pk=None, *args, **kwargs):
        milestone = self.get_object()

        if request.method.lower() == "get":
            qs = MilestoneComment.objects.filter(milestone=milestone).order_by("-created_at")
            ser = MilestoneCommentSerializer(qs, many=True)
            return Response(ser.data, status=status.HTTP_200_OK)

        content = ((request.data or {}).get("content") or (request.data or {}).get("text") or "").strip()
        if not content:
            return Response({"detail": "content is required."}, status=status.HTTP_400_BAD_REQUEST)

        serializer = MilestoneCommentSerializer(data={"milestone": milestone.pk, "content": content})
        serializer.is_valid(raise_exception=True)
        instance = serializer.save(author=request.user)
        out = MilestoneCommentSerializer(instance).data
        return Response(out, status=status.HTTP_201_CREATED)


# -------------------- Compatibility shims for legacy imports --------------------

import os  # used in snapshot filename formatting


class MilestoneFileViewSet(viewsets.ViewSet):
    permission_classes = [IsAuthenticated]

    def list(self, request, *args, **kwargs):
        qs = MilestoneFile.objects.all().order_by("-uploaded_at")
        ser = MilestoneFileSerializer(qs, many=True, context={"request": request})
        return Response(ser.data, status=status.HTTP_200_OK)

    def create(self, request, *args, **kwargs):
        milestone_id = request.data.get("milestone")
        uploaded = request.FILES.get("file") or request.FILES.get("document")
        if not (milestone_id and uploaded):
            return Response({"detail": "milestone and file are required."}, status=status.HTTP_400_BAD_REQUEST)
        try:
            milestone = Milestone.objects.get(pk=milestone_id)
        except Milestone.DoesNotExist:
            return Response({"detail": "Milestone not found."}, status=status.HTTP_404_NOT_FOUND)

        serializer = MilestoneFileSerializer(
            data={"milestone": milestone.pk, "file": uploaded},
            context={"request": request},
        )
        serializer.is_valid(raise_exception=True)
        instance = serializer.save(uploaded_by=request.user)
        out = MilestoneFileSerializer(instance, context={"request": request}).data
        return Response(out, status=status.HTTP_201_CREATED)


class MilestoneCommentViewSet(viewsets.ViewSet):
    permission_classes = [IsAuthenticated]

    def list(self, request, *args, **kwargs):
        qs = MilestoneComment.objects.all().order_by("-created_at")
        ser = MilestoneCommentSerializer(qs, many=True)
        return Response(ser.data, status=status.HTTP_200_OK)

    def create(self, request, *args, **kwargs):
        milestone_id = request.data.get("milestone")
        content = ((request.data or {}).get("content") or (request.data or {}).get("text") or "").strip()

        if not (milestone_id and content):
            return Response({"detail": "milestone and content are required."}, status=status.HTTP_400_BAD_REQUEST)

        try:
            milestone = Milestone.objects.get(pk=milestone_id)
        except Milestone.DoesNotExist:
            return Response({"detail": "Milestone not found."}, status=status.HTTP_404_NOT_FOUND)

        serializer = MilestoneCommentSerializer(data={"milestone": milestone.pk, "content": content})
        serializer.is_valid(raise_exception=True)
        instance = serializer.save(author=request.user)
        out = MilestoneCommentSerializer(instance).data
        return Response(out, status=status.HTTP_201_CREATED)
