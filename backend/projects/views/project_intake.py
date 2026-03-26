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
from projects.services.public_lead_pipeline import (
    ensure_public_profile_for_contractor,
    sync_public_lead_from_project_intake,
)
from projects.models import PublicContractorLead
from projects.services.agreements.project_create import resolve_contractor_for_user


class ProjectIntakeViewSet(viewsets.ModelViewSet):
    serializer_class = ProjectIntakeSerializer
    permission_classes = [IsAuthenticated]

    def get_queryset(self):
        qs = ProjectIntake.objects.all().select_related("contractor", "homeowner", "agreement")

        user = self.request.user
        if user.is_staff:
            return qs

        contractor = resolve_contractor_for_user(user)
        if contractor is not None:
            return qs.filter(contractor=contractor)

        return qs.none()

    def perform_create(self, serializer):
        contractor = resolve_contractor_for_user(self.request.user)
        profile = ensure_public_profile_for_contractor(contractor) if contractor is not None else None
        serializer.save(contractor=contractor, public_profile=profile, lead_source="direct")

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
        if intake.contractor_id:
            existing_lead_source = getattr(getattr(intake, "public_lead", None), "source", "")
            intake.lead_source = (
                existing_lead_source or PublicContractorLead.SOURCE_CONTRACTOR_SENT_FORM
            )
            intake.public_profile = intake.public_profile or ensure_public_profile_for_contractor(
                intake.contractor
            )
            intake.save(update_fields=["lead_source", "public_profile", "updated_at"])

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

        lead = sync_public_lead_from_project_intake(
            intake,
            status_override=PublicContractorLead.STATUS_PENDING_CUSTOMER_RESPONSE,
        )
        result["lead_id"] = getattr(lead, "id", None)
        result["lead_status"] = getattr(lead, "status", None)
        result["lead_source"] = getattr(lead, "source", None)
        return Response(result, status=status.HTTP_200_OK)

    @action(detail=True, methods=["post"], url_path="convert-to-agreement")
    def convert_to_agreement(self, request, pk=None):
        intake = self.get_object()

        if not (intake.ai_project_title or intake.ai_project_type or intake.ai_description):
            return Response(
                {"detail": "Please analyze the intake before converting it to an agreement."},
                status=status.HTTP_400_BAD_REQUEST,
            )

        use_recommended_template = request.data.get("use_recommended_template", True)
        if isinstance(use_recommended_template, str):
            use_recommended_template = use_recommended_template.strip().lower() not in {"false", "0", "no"}
        else:
            use_recommended_template = bool(use_recommended_template)

        template_id_override = request.data.get("template_id_override")
        try:
            template_id_override = int(template_id_override) if template_id_override not in (None, "", False) else None
        except Exception:
            template_id_override = None

        agreement = convert_intake_to_agreement(
            intake=intake,
            use_recommended_template=use_recommended_template,
            template_id_override=template_id_override,
        )

        return Response(
            {
                "agreement_id": agreement.id,
                "project_id": getattr(agreement.project, "id", None),
                "detail": "Agreement created successfully.",
            },
            status=status.HTTP_201_CREATED,
        )
