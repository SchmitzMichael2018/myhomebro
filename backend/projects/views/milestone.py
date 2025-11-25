# backend/projects/views/milestone.py
# v2025-11-16 — Updated to support Contractor + Employee sub-account permissions

from __future__ import annotations

from django.db import transaction
from django.db.models import Q, Max
from rest_framework import status, viewsets
from rest_framework.decorators import action
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response

from projects.models import Milestone, MilestoneFile, MilestoneComment
from projects.serializers.milestone import MilestoneSerializer
from projects.serializers.milestone_file import MilestoneFileSerializer
from projects.serializers.milestone_comment import MilestoneCommentSerializer

# NEW — subaccount permission system
from projects.permissions_subaccounts import (
    IsContractorOrSubAccount,
    CanEditMilestones,
)
from projects.utils.accounts import get_contractor_for_user


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
    """

    # UPDATED permissions:
    # - Authenticated is required
    # - Must belong to contractor OR subaccount
    # - Writes only allowed if:
    #     * contractor OR
    #     * subaccount.role == employee_milestones
    permission_classes = [IsAuthenticated, IsContractorOrSubAccount, CanEditMilestones]

    queryset = Milestone.objects.select_related("agreement").all()
    serializer_class = MilestoneSerializer

    # ------------------------------------------------------------
    # Limit milestones to contractor's own projects
    # ------------------------------------------------------------
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

    # ------------------------------------------------------------
    # AUTO-ORDERED CREATE
    # ------------------------------------------------------------
    @transaction.atomic
    def create(self, request, *args, **kwargs):
        """
        Adds automatic `order` assignment:
        - Looks up max(current order) for this agreement.
        - If client did not provide `order`, assign next integer.
        """
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
        return Response(
            serializer.data, status=status.HTTP_201_CREATED, headers=headers
        )

    # ------------------------------------------------------------
    # CHECK OVERLAP ENDPOINT
    # ------------------------------------------------------------
    @action(detail=False, methods=["post"], url_path="check-overlap")
    def check_overlap(self, request, *args, **kwargs):
        agreement = request.data.get("agreement")
        start = request.data.get("start_date")
        end = request.data.get("completion_date") or request.data.get("due_date")
        milestone_id = request.data.get("id")

        if not (agreement and start and end):
            return Response(
                {
                    "detail": "agreement, start_date and completion_date/due_date are required."
                },
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
        return Response(
            {"overlaps": bool(conflicts), "conflicts": conflicts}, status=200
        )

    # ------------------------------------------------------------
    # FILES (per-milestone)
    # ------------------------------------------------------------
    @action(detail=True, methods=["get", "post"], url_path="files")
    def files(self, request, pk=None, *args, **kwargs):
        milestone = self.get_object()

        if request.method.lower() == "get":
            qs = MilestoneFile.objects.filter(milestone=milestone).order_by(
                "-uploaded_at"
            )
            ser = MilestoneFileSerializer(
                qs, many=True, context={"request": request}
            )
            return Response(ser.data, status=status.HTTP_200_OK)

        uploaded = request.FILES.get("file") or request.FILES.get("document")
        if not uploaded:
            return Response(
                {"detail": "file is required."},
                status=status.HTTP_400_BAD_REQUEST,
            )

        payload = {
            "milestone": milestone.pk,
            "file": uploaded,
        }
        serializer = MilestoneFileSerializer(
            data=payload, context={"request": request}
        )
        serializer.is_valid(raise_exception=True)
        instance = serializer.save(uploaded_by=request.user)
        out = MilestoneFileSerializer(instance, context={"request": request}).data
        return Response(out, status=status.HTTP_201_CREATED)

    # ------------------------------------------------------------
    # COMMENTS (per-milestone)
    # ------------------------------------------------------------
    @action(detail=True, methods=["get", "post"], url_path="comments")
    def comments(self, request, pk=None, *args, **kwargs):
        milestone = self.get_object()

        if request.method.lower() == "get":
            qs = MilestoneComment.objects.filter(milestone=milestone).order_by(
                "-created_at"
            )
            ser = MilestoneCommentSerializer(qs, many=True)
            return Response(ser.data, status=status.HTTP_200_OK)

        content = (
            (request.data or {}).get("content")
            or (request.data or {}).get("text")
            or ""
        ).strip()

        if not content:
            return Response(
                {"detail": "content is required."},
                status=status.HTTP_400_BAD_REQUEST,
            )

        serializer = MilestoneCommentSerializer(
            data={"milestone": milestone.pk, "content": content}
        )
        serializer.is_valid(raise_exception=True)
        instance = serializer.save(author=request.user)
        out = MilestoneCommentSerializer(instance).data
        return Response(out, status=status.HTTP_201_CREATED)


# -------------------- Compatibility shims for legacy imports --------------------


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
            return Response(
                {"detail": "milestone and file are required."},
                status=status.HTTP_400_BAD_REQUEST,
            )
        try:
            milestone = Milestone.objects.get(pk=milestone_id)
        except Milestone.DoesNotExist:
            return Response(
                {"detail": "Milestone not found."}, status=status.HTTP_404_NOT_FOUND
            )

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
        content = (
            (request.data or {}).get("content")
            or (request.data or {}).get("text")
            or ""
        ).strip()

        if not (milestone_id and content):
            return Response(
                {"detail": "milestone and content are required."},
                status=status.HTTP_400_BAD_REQUEST,
            )

        try:
            milestone = Milestone.objects.get(pk=milestone_id)
        except Milestone.DoesNotExist:
            return Response(
                {"detail": "Milestone not found."}, status=status.HTTP_404_NOT_FOUND
            )

        serializer = MilestoneCommentSerializer(
            data={"milestone": milestone.pk, "content": content}
        )
        serializer.is_valid(raise_exception=True)
        instance = serializer.save(author=request.user)
        out = MilestoneCommentSerializer(instance).data
        return Response(out, status=status.HTTP_201_CREATED)
