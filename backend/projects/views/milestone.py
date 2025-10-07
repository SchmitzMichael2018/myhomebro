# backend/projects/views/milestone.py
from __future__ import annotations

from django.db.models import Q
from rest_framework import status, viewsets
from rest_framework.decorators import action
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response

from projects.models import Milestone
from projects.serializers.milestone import MilestoneSerializer


class MilestoneViewSet(viewsets.ModelViewSet):
    """
    Main Milestone API:
      • CRUD
      • POST   /projects/milestones/check-overlap/
      • POST   /projects/milestones/{id}/files/      (shim: 501 until wired)
      • POST   /projects/milestones/{id}/comments/   (shim: 501 until wired)
    """
    queryset = Milestone.objects.select_related("agreement").all()
    serializer_class = MilestoneSerializer
    permission_classes = [IsAuthenticated]

    @action(detail=False, methods=["post"], url_path="check-overlap")
    def check_overlap(self, request, *args, **kwargs):
        """
        Body:
          { agreement, start_date, completion_date|due_date, id? }
        Response:
          { overlaps: bool, conflicts: [{id,title,start_date,completion_date,due_date}] }
        """
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

    @action(detail=True, methods=["post"], url_path="files")
    def upload_file(self, request, pk=None, *args, **kwargs):
        """
        Shim so the frontend can POST /projects/milestones/{id}/files/
        Returns 501 until a file model/storage is wired.
        """
        return Response(
            {"detail": "Milestone file upload endpoint not configured."},
            status=status.HTTP_501_NOT_IMPLEMENTED,
        )

    @action(detail=True, methods=["post"], url_path="comments")
    def add_comment(self, request, pk=None, *args, **kwargs):
        """
        Shim so the frontend can POST /projects/milestones/{id}/comments/
        Returns 501 until a comment model is wired.
        """
        text = (request.data or {}).get("text", "")
        if not text:
            return Response({"detail": "text is required."}, status=status.HTTP_400_BAD_REQUEST)
        return Response(
            {"detail": "Milestone comments endpoint not configured."},
            status=status.HTTP_501_NOT_IMPLEMENTED,
        )


# -------------------- Compatibility shims for legacy imports --------------------

class MilestoneFileViewSet(viewsets.ViewSet):
    """
    Legacy/compat shim: some urlconfs import MilestoneFileViewSet.
    Keeping this avoids ImportError during Django checks/migrations.
    """
    permission_classes = [IsAuthenticated]

    def create(self, request, *args, **kwargs):
        # POST /projects/milestone-files/ (legacy)
        return Response(
            {"detail": "Milestone file upload endpoint not configured."},
            status=status.HTTP_501_NOT_IMPLEMENTED,
        )

    def list(self, request, *args, **kwargs):
        return Response([], status=200)


class MilestoneCommentViewSet(viewsets.ViewSet):
    """
    Legacy/compat shim: some urlconfs import MilestoneCommentViewSet.
    Keeping this avoids ImportError during Django checks/migrations.
    """
    permission_classes = [IsAuthenticated]

    def create(self, request, *args, **kwargs):
        # POST /projects/milestone-comments/ (legacy)
        text = (request.data or {}).get("text", "")
        if not text:
            return Response({"detail": "text is required."}, status=status.HTTP_400_BAD_REQUEST)
        return Response(
            {"detail": "Milestone comments endpoint not configured."},
            status=status.HTTP_501_NOT_IMPLEMENTED,
        )

    def list(self, request, *args, **kwargs):
        return Response([], status=200)
