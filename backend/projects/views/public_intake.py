# backend/projects/views/public_intake.py

from __future__ import annotations

from django.utils import timezone
from rest_framework import status
from rest_framework.response import Response
from rest_framework.views import APIView

from projects.models_project_intake import ProjectIntake
from projects.services.intake_analysis import analyze_project_intake


class PublicIntakeView(APIView):
    """
    Token-based public intake endpoint.

    GET   /api/projects/public-intake/?token=...
    PATCH /api/projects/public-intake/?token=...

    Used by homeowners to open and complete an intake form sent by email.
    """
    permission_classes = []

    SAFE_FIELDS = {
        "customer_name",
        "customer_email",
        "customer_phone",
        "customer_address_line1",
        "customer_address_line2",
        "customer_city",
        "customer_state",
        "customer_postal_code",
        "same_as_customer_address",
        "project_address_line1",
        "project_address_line2",
        "project_city",
        "project_state",
        "project_postal_code",
        "accomplishment_text",
    }

    def _get_intake(self, request):
        token = (request.query_params.get("token") or request.data.get("token") or "").strip()
        if not token:
            return None, Response(
                {"detail": "Missing intake token."},
                status=status.HTTP_400_BAD_REQUEST,
            )

        try:
            intake = ProjectIntake.objects.select_related("contractor", "homeowner").get(share_token=token)
        except ProjectIntake.DoesNotExist:
            return None, Response(
                {"detail": "Intake link not found."},
                status=status.HTTP_404_NOT_FOUND,
            )

        return intake, None

    def get(self, request, *args, **kwargs):
        intake, error_response = self._get_intake(request)
        if error_response:
            return error_response

        contractor_name = ""
        if intake.contractor:
            contractor_name = (
                getattr(intake.contractor, "business_name", "")
                or getattr(intake.contractor, "name", "")
                or getattr(intake.contractor, "email", "")
            )

        payload = {
            "id": intake.id,
            "token": intake.share_token,
            "status": intake.status,
            "initiated_by": intake.initiated_by,
            "contractor_name": contractor_name or "Your contractor",

            "customer_name": intake.customer_name,
            "customer_email": intake.customer_email,
            "customer_phone": intake.customer_phone,

            "customer_address_line1": intake.customer_address_line1,
            "customer_address_line2": intake.customer_address_line2,
            "customer_city": intake.customer_city,
            "customer_state": intake.customer_state,
            "customer_postal_code": intake.customer_postal_code,

            "same_as_customer_address": intake.same_as_customer_address,

            "project_address_line1": intake.project_address_line1,
            "project_address_line2": intake.project_address_line2,
            "project_city": intake.project_city,
            "project_state": intake.project_state,
            "project_postal_code": intake.project_postal_code,

            "accomplishment_text": intake.accomplishment_text,

            "submitted_at": intake.submitted_at.isoformat() if intake.submitted_at else None,
            "sent_at": intake.sent_at.isoformat() if intake.sent_at else None,
            "completed_at": intake.completed_at.isoformat() if intake.completed_at else None,
        }

        return Response(payload, status=status.HTTP_200_OK)

    def patch(self, request, *args, **kwargs):
        intake, error_response = self._get_intake(request)
        if error_response:
            return error_response

        changed = []

        for field in self.SAFE_FIELDS:
            if field in request.data:
                setattr(intake, field, request.data.get(field))
                changed.append(field)

        if not changed:
            return Response(
                {"detail": "No valid intake fields were provided."},
                status=status.HTTP_400_BAD_REQUEST,
            )

        accomplishment = (intake.accomplishment_text or "").strip()

        if accomplishment:
            intake.completed_at = timezone.now()
            changed.append("completed_at")

        # Keep status submitted for homeowner-completed but not yet analyzed
        if intake.status == "draft":
            intake.status = "submitted"
            changed.append("status")

        if accomplishment:
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
            intake.analyzed_at = timezone.now()
            changed.extend(
                [
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
                    "analyzed_at",
                ]
            )

        intake.save(update_fields=changed + ["updated_at"])

        return Response(
            {
                "detail": "Intake updated successfully.",
                "id": intake.id,
                "status": intake.status,
                "completed_at": intake.completed_at.isoformat() if intake.completed_at else None,
            },
            status=status.HTTP_200_OK,
        )
