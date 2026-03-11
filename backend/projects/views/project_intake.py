from __future__ import annotations

from django.utils import timezone
from rest_framework import status, viewsets
from rest_framework.decorators import action
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response

from projects.models_project_intake import ProjectIntake
from projects.serializers.project_intake import ProjectIntakeSerializer
from projects.services.intake_analysis import analyze_project_intake
from projects.services.intake_conversion import convert_intake_to_agreement
from projects.services.intake_public import send_intake_email


class ProjectIntakeViewSet(viewsets.ModelViewSet):
    serializer_class = ProjectIntakeSerializer
    permission_classes = [IsAuthenticated]

    def get_queryset(self):
        qs = ProjectIntake.objects.all().select_related("contractor", "homeowner", "agreement")

        user = self.request.user
        if user.is_staff:
            return qs

        contractor = getattr(user, "contractor", None)
        if contractor is not None:
            return qs.filter(contractor=contractor)

        return qs.none()

    def perform_create(self, serializer):
        contractor = getattr(self.request.user, "contractor", None)
        serializer.save(contractor=contractor)

    @action(detail=True, methods=["post"], url_path="analyze")
    def analyze(self, request, pk=None):
        intake = self.get_object()

        accomplishment = (intake.accomplishment_text or "").strip()
        if not accomplishment:
            return Response(
                {"detail": "Please provide what the customer wants to accomplish before analysis."},
                status=status.HTTP_400_BAD_REQUEST,
            )

        result = analyze_project_intake(intake=intake)

        intake.ai_project_title = result.get("project_title", "")
        intake.ai_project_type = result.get("project_type", "")
        intake.ai_project_subtype = result.get("project_subtype", "")
        intake.ai_description = result.get("description", "")
        intake.ai_recommended_template_id = result.get("template_id")
        intake.ai_recommendation_confidence = result.get("confidence", "none")
        intake.ai_recommendation_reason = result.get("reason", "")
        intake.ai_milestones = result.get("milestones", [])
        intake.ai_clarification_questions = result.get("clarification_questions", [])
        intake.ai_analysis_payload = result
        intake.status = "analyzed"
        intake.analyzed_at = timezone.now()
        intake.save(
            update_fields=[
                "ai_project_title",
                "ai_project_type",
                "ai_project_subtype",
                "ai_description",
                "ai_recommended_template_id",
                "ai_recommendation_confidence",
                "ai_recommendation_reason",
                "ai_milestones",
                "ai_clarification_questions",
                "ai_analysis_payload",
                "status",
                "analyzed_at",
                "updated_at",
            ]
        )

        serializer = self.get_serializer(intake)
        return Response(
            {
                "result": result,
                "intake": serializer.data,
            },
            status=status.HTTP_200_OK,
        )

    @action(detail=True, methods=["post"], url_path="mark-submitted")
    def mark_submitted(self, request, pk=None):
        intake = self.get_object()

        intake.status = "submitted"
        intake.submitted_at = timezone.now()
        intake.save(update_fields=["status", "submitted_at", "updated_at"])

        return Response(self.get_serializer(intake).data, status=status.HTTP_200_OK)

    @action(detail=True, methods=["post"], url_path="send-to-homeowner")
    def send_to_homeowner(self, request, pk=None):
        intake = self.get_object()

        try:
            result = send_intake_email(intake)
        except ValueError as exc:
            return Response(
                {"detail": str(exc)},
                status=status.HTTP_400_BAD_REQUEST,
            )
        except Exception:
            return Response(
                {"detail": "Failed to send intake email."},
                status=status.HTTP_500_INTERNAL_SERVER_ERROR,
            )

        return Response(result, status=status.HTTP_200_OK)

    @action(detail=True, methods=["post"], url_path="convert-to-agreement")
    def convert_to_agreement(self, request, pk=None):
        intake = self.get_object()

        if not (intake.ai_project_title or intake.ai_project_type or intake.ai_description):
            return Response(
                {"detail": "Please analyze the intake before converting it to an agreement."},
                status=status.HTTP_400_BAD_REQUEST,
            )

        agreement = convert_intake_to_agreement(intake=intake)

        return Response(
            {
                "agreement_id": agreement.id,
                "project_id": getattr(agreement.project, "id", None),
                "detail": "Agreement created successfully.",
            },
            status=status.HTTP_201_CREATED,
        )