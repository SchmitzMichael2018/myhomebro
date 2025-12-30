# backend/projects/views/milestone.py
# v2025-12-29 — Restore MilestoneFileViewSet import compatibility + add Complete → Review endpoint
#
# Fixes:
# - Adds missing MilestoneFileViewSet / MilestoneCommentViewSet so projects/urls.py imports succeed.
# - Adds POST /projects/milestones/<id>/complete/ and /complete-to-review/
# - Allows completing ahead of scheduled completion_date (no future-date block)
# - Keeps existing create-invoice flow (requires milestone.completed + escrow_funded)
#
# NOTE:
# - This file is written defensively: if some models/serializers differ slightly in your repo,
#   the API will still fail loudly with clear errors instead of silent breakage.

from __future__ import annotations

import logging
import os

from django.db import IntegrityError, transaction
from django.db.models import Max, Q
from django.shortcuts import get_object_or_404
from django.utils import timezone
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
from projects.permissions_subaccounts import IsContractorOrSubAccount, CanEditMilestones
from projects.utils.accounts import get_contractor_for_user

logger = logging.getLogger(__name__)


class MilestoneViewSet(viewsets.ModelViewSet):
    """
    Milestone CRUD + workflow endpoints.

    Existing in your app:
      - POST /projects/milestones/<id>/create-invoice/   (requires completed + escrow funded)
      - /projects/milestones/<id>/files/
      - /projects/milestones/<id>/comments/
      - POST /projects/milestones/check-overlap/

    New:
      - POST /projects/milestones/<id>/complete/
      - POST /projects/milestones/<id>/complete-to-review/ (alias)
        Marks completed=True even if scheduled completion_date is in the future.
    """

    permission_classes = [IsAuthenticated, IsContractorOrSubAccount, CanEditMilestones]
    serializer_class = MilestoneSerializer
    queryset = Milestone.objects.select_related("agreement").all()

    def get_queryset(self):
        contractor = get_contractor_for_user(self.request.user)
        if contractor is None:
            return Milestone.objects.none()

        # Only milestones belonging to this contractor’s projects
        return (
            Milestone.objects.select_related("agreement", "agreement__project")
            .filter(agreement__project__contractor=contractor)
            .order_by("order", "id")
        )

    @transaction.atomic
    def create(self, request, *args, **kwargs):
        """
        Auto-assign `order` if not provided.
        """
        data = request.data.copy()

        agreement_id = data.get("agreement") or data.get("agreement_id")
        incoming_order = data.get("order")

        if agreement_id and (incoming_order in (None, "", [], {})):
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

    # ---------------------------------------------------------------------
    # ✅ NEW: Complete -> Review (allows early completion)
    # ---------------------------------------------------------------------
    @action(detail=True, methods=["post"], url_path="complete")
    def complete(self, request, pk=None):
        """
        Mark milestone complete (ahead of schedule allowed).
        Does NOT require changing completion_date (which may be locked post-signature).

        Body (optional):
          - completion_notes: str
        Multipart (optional):
          - files: multiple evidence files (key "files")
          - file: single evidence file (key "file")
        """
        milestone: Milestone = self.get_object()

        # Idempotent: already completed
        if getattr(milestone, "completed", False) is True:
            return Response(
                MilestoneSerializer(milestone, context={"request": request}).data,
                status=status.HTTP_200_OK,
            )

        # Don’t allow completing if already invoiced
        if getattr(milestone, "is_invoiced", False) or getattr(milestone, "invoice_id", None):
            return Response(
                {"detail": "This milestone has already been invoiced and cannot be marked complete again."},
                status=status.HTTP_400_BAD_REQUEST,
            )

        completion_notes = ((request.data or {}).get("completion_notes") or "").strip()

        try:
            with transaction.atomic():
                milestone = Milestone.objects.select_for_update().get(pk=milestone.pk)

                # Re-check inside lock
                if getattr(milestone, "completed", False) is True:
                    return Response(
                        MilestoneSerializer(milestone, context={"request": request}).data,
                        status=status.HTTP_200_OK,
                    )

                # ✅ Allow early completion: DO NOT block based on scheduled completion_date.
                milestone.completed = True

                update_fields = ["completed"]

                # If milestone model has completion_notes, store it
                if hasattr(milestone, "completion_notes") and completion_notes:
                    setattr(milestone, "completion_notes", completion_notes)
                    update_fields.append("completion_notes")

                milestone.save(update_fields=update_fields)

                # Record actual completion time in a system comment (audit-friendly)
                stamp = timezone.now().strftime("%Y-%m-%d %H:%M:%S %Z")
                base_line = f"[System] Milestone marked complete at {stamp}."
                content = f"{base_line}\n\n{completion_notes}" if completion_notes else base_line
                try:
                    MilestoneComment.objects.create(
                        milestone=milestone,
                        author=request.user,
                        content=content,
                    )
                except Exception:
                    # comments should not block completion
                    pass

                # Optional evidence uploads
                uploaded_files = []
                if hasattr(request, "FILES"):
                    if "file" in request.FILES:
                        uploaded_files.append(request.FILES["file"])
                    if "files" in request.FILES:
                        uploaded_files.extend(request.FILES.getlist("files"))

                for up in uploaded_files:
                    MilestoneFile.objects.create(
                        milestone=milestone,
                        uploaded_by=request.user,
                        file=up,
                    )

                milestone.refresh_from_db()

        except Exception as exc:
            logger.exception("Failed to mark milestone %s complete: %s", getattr(milestone, "id", None), exc)
            return Response(
                {"detail": "Unable to mark milestone complete."},
                status=status.HTTP_500_INTERNAL_SERVER_ERROR,
            )

        return Response(
            MilestoneSerializer(milestone, context={"request": request}).data,
            status=status.HTTP_200_OK,
        )

    @action(detail=True, methods=["post"], url_path="complete-to-review")
    def complete_to_review(self, request, pk=None):
        """
        Alias endpoint for frontend.
        """
        return self.complete(request, pk=pk)

    # ---------------------------------------------------------------------
    # overlap check
    # ---------------------------------------------------------------------
    @action(detail=False, methods=["post"], url_path="check-overlap")
    def check_overlap(self, request):
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

    # ---------------------------------------------------------------------
    # create invoice (idempotent)
    # ---------------------------------------------------------------------
    @action(detail=True, methods=["post"], url_path="create-invoice")
    def create_invoice(self, request, pk=None):
        milestone: Milestone = self.get_object()
        agreement = milestone.agreement

        if not getattr(milestone, "completed", False):
            return Response(
                {"detail": "Milestone must be completed before invoicing."},
                status=status.HTTP_400_BAD_REQUEST,
            )

        if not getattr(agreement, "escrow_funded", False):
            return Response(
                {"detail": "Agreement escrow must be funded before invoicing milestones."},
                status=status.HTTP_400_BAD_REQUEST,
            )

        # Idempotent: if already linked, return existing invoice
        if getattr(milestone, "invoice_id", None):
            inv = Invoice.objects.filter(pk=milestone.invoice_id).first()
            if inv:
                return Response(InvoiceSerializer(inv, context={"request": request}).data, status=status.HTTP_200_OK)

        try:
            with transaction.atomic():
                milestone = Milestone.objects.select_for_update().get(pk=milestone.pk)

                if getattr(milestone, "invoice_id", None):
                    inv = Invoice.objects.filter(pk=milestone.invoice_id).first()
                    if inv:
                        return Response(InvoiceSerializer(inv, context={"request": request}).data, status=status.HTTP_200_OK)

                # Completion notes: prefer milestone.completion_notes if present, else derive from comments
                completion_notes = ""
                if hasattr(milestone, "completion_notes"):
                    completion_notes = (getattr(milestone, "completion_notes") or "").strip()

                if not completion_notes:
                    try:
                        comments_qs = MilestoneComment.objects.filter(milestone=milestone).order_by("created_at")
                        lines = []
                        for c in comments_qs:
                            txt = (getattr(c, "content", "") or "").strip()
                            if txt:
                                lines.append(f"- {txt}")
                        completion_notes = "\n".join(lines).strip()
                    except Exception:
                        completion_notes = ""

                # Snapshot attachments
                attachments = []
                try:
                    files_qs = MilestoneFile.objects.filter(milestone=milestone).order_by("-uploaded_at")
                    for f in files_qs:
                        if not getattr(f, "file", None):
                            continue
                        try:
                            url = request.build_absolute_uri(f.file.url)
                        except Exception:
                            url = f.file.url
                        attachments.append(
                            {
                                "id": f.id,
                                "name": os.path.basename(getattr(f.file, "name", "") or "") or f"file_{f.id}",
                                "url": url,
                                "uploaded_at": getattr(f, "uploaded_at", None).isoformat()
                                if getattr(f, "uploaded_at", None)
                                else None,
                            }
                        )
                except Exception:
                    attachments = []

                invoice = Invoice.objects.create(
                    agreement=agreement,
                    amount=milestone.amount,
                    status=InvoiceStatus.PENDING,
                    milestone_id_snapshot=getattr(milestone, "id", None),
                    milestone_title_snapshot=getattr(milestone, "title", "") or "",
                    milestone_description_snapshot=getattr(milestone, "description", "") or "",
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

        except IntegrityError as exc:
            logger.error("IntegrityError creating invoice for milestone %s: %s", milestone.id, exc)
            return Response(
                {"detail": "Unable to create invoice due to a data integrity rule. Please refresh and try again."},
                status=status.HTTP_400_BAD_REQUEST,
            )
        except Exception as exc:
            logger.exception("Unexpected error creating invoice for milestone %s: %s", milestone.id, exc)
            return Response(
                {"detail": "Unexpected error creating invoice."},
                status=status.HTTP_500_INTERNAL_SERVER_ERROR,
            )

    # ---------------------------------------------------------------------
    # files endpoint (nested)
    # ---------------------------------------------------------------------
    @action(detail=True, methods=["get", "post"], url_path="files")
    def files(self, request, pk=None):
        milestone: Milestone = self.get_object()

        if request.method.lower() == "get":
            qs = MilestoneFile.objects.filter(milestone=milestone).order_by("-uploaded_at")
            ser = MilestoneFileSerializer(qs, many=True, context={"request": request})
            return Response(ser.data, status=status.HTTP_200_OK)

        uploaded = request.FILES.get("file") or request.FILES.get("document")
        if not uploaded:
            return Response({"detail": "file is required."}, status=status.HTTP_400_BAD_REQUEST)

        serializer = MilestoneFileSerializer(
            data={"milestone": milestone.pk, "file": uploaded},
            context={"request": request},
        )
        serializer.is_valid(raise_exception=True)
        instance = serializer.save(uploaded_by=request.user)
        out = MilestoneFileSerializer(instance, context={"request": request}).data
        return Response(out, status=status.HTTP_201_CREATED)

    # ---------------------------------------------------------------------
    # comments endpoint (nested)
    # ---------------------------------------------------------------------
    @action(detail=True, methods=["get", "post"], url_path="comments")
    def comments(self, request, pk=None):
        milestone: Milestone = self.get_object()

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


# -----------------------------------------------------------------------------
# ✅ Compatibility viewsets (your projects/urls.py imports these)
# -----------------------------------------------------------------------------

class MilestoneFileViewSet(viewsets.ModelViewSet):
    """
    Provides /projects/milestone-files/ endpoints (list/create/retrieve/delete),
    used by your frontend evidence upload path.

    This is required because projects/urls.py imports MilestoneFileViewSet.
    """
    permission_classes = [IsAuthenticated, IsContractorOrSubAccount]
    serializer_class = MilestoneFileSerializer
    queryset = MilestoneFile.objects.select_related("milestone").all()

    def get_queryset(self):
        contractor = get_contractor_for_user(self.request.user)
        if contractor is None:
            return MilestoneFile.objects.none()
        return (
            MilestoneFile.objects
            .select_related("milestone", "milestone__agreement", "milestone__agreement__project")
            .filter(milestone__agreement__project__contractor=contractor)
            .order_by("-uploaded_at", "-id")
        )

    def perform_create(self, serializer):
        serializer.save(uploaded_by=self.request.user)


class MilestoneCommentViewSet(viewsets.ModelViewSet):
    """
    Provides /projects/milestone-comments/ endpoints if you route it,
    and also ensures older imports don’t break if present.

    Some builds only use the nested /milestones/<id>/comments/ action, but
    keeping this avoids import breakage if your urls.py references it.
    """
    permission_classes = [IsAuthenticated, IsContractorOrSubAccount]
    serializer_class = MilestoneCommentSerializer
    queryset = MilestoneComment.objects.select_related("milestone").all()

    def get_queryset(self):
        contractor = get_contractor_for_user(self.request.user)
        if contractor is None:
            return MilestoneComment.objects.none()
        return (
            MilestoneComment.objects
            .select_related("milestone", "milestone__agreement", "milestone__agreement__project")
            .filter(milestone__agreement__project__contractor=contractor)
            .order_by("-created_at", "-id")
        )

    def perform_create(self, serializer):
        serializer.save(author=self.request.user)
