# backend/projects/views/public_intake.py

from __future__ import annotations

from django.utils import timezone
from rest_framework import status
from rest_framework.response import Response
from rest_framework.views import APIView

from projects.models_invite import ContractorInvite
from projects.models_project_intake import ProjectIntake
from projects.models import PublicContractorLead
from projects.services.intake_analysis import analyze_project_intake
from projects.services.invites_delivery import build_invite_url
from projects.services.public_lead_pipeline import sync_public_lead_from_project_intake


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
        "project_class",
        "project_address_line1",
        "project_address_line2",
        "project_city",
        "project_state",
        "project_postal_code",
        "accomplishment_text",
    }

    BRANCH_CHOICES = {"single_contractor", "multi_contractor"}

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
            "project_class": intake.project_class,

            "project_address_line1": intake.project_address_line1,
            "project_address_line2": intake.project_address_line2,
            "project_city": intake.project_city,
            "project_state": intake.project_state,
            "project_postal_code": intake.project_postal_code,

            "accomplishment_text": intake.accomplishment_text,
            "post_submit_flow": intake.post_submit_flow,
            "post_submit_flow_selected_at": intake.post_submit_flow_selected_at.isoformat()
            if intake.post_submit_flow_selected_at
            else None,

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
        has_intake_field_updates = any(field in request.data for field in self.SAFE_FIELDS)

        for field in self.SAFE_FIELDS:
            if field in request.data:
                if field == "project_class":
                    value = str(request.data.get(field) or "").strip().lower()
                    if value not in {"residential", "commercial"}:
                        return Response(
                            {"project_class": ["Choose residential or commercial."]},
                            status=status.HTTP_400_BAD_REQUEST,
                        )
                    setattr(intake, field, value)
                    changed.append(field)
                    continue
                setattr(intake, field, request.data.get(field))
                changed.append(field)

        branch_flow = (request.data.get("branch_flow") or "").strip().lower()

        if not changed and not branch_flow:
            return Response(
                {"detail": "No valid intake fields were provided."},
                status=status.HTTP_400_BAD_REQUEST,
            )

        branch_invites = []
        branch_error = None

        if branch_flow:
            if branch_flow not in self.BRANCH_CHOICES:
                return Response(
                    {"detail": "Choose either invite one contractor or invite multiple contractors."},
                    status=status.HTTP_400_BAD_REQUEST,
                )

            intake.post_submit_flow = branch_flow
            if intake.post_submit_flow_selected_at is None:
                intake.post_submit_flow_selected_at = timezone.now()
            changed.extend(["post_submit_flow", "post_submit_flow_selected_at"])

            contractor_rows = request.data.get("contractors") or []
            if isinstance(contractor_rows, str):
                try:
                    import json

                    contractor_rows = json.loads(contractor_rows)
                except Exception:
                    contractor_rows = []

            if branch_flow == "single_contractor":
                contractor_rows = [
                    {
                        "name": request.data.get("contractor_name", ""),
                        "email": request.data.get("contractor_email", ""),
                        "phone": request.data.get("contractor_phone", ""),
                        "message": request.data.get("contractor_message", ""),
                    }
                ]

            if not isinstance(contractor_rows, list) or not contractor_rows:
                return Response(
                    {"detail": "Add at least one contractor contact before continuing."},
                    status=status.HTTP_400_BAD_REQUEST,
                )

            homeowner_name = (intake.customer_name or "").strip()
            homeowner_email = (intake.customer_email or "").strip()
            homeowner_phone = (intake.customer_phone or "").strip()
            invite_message = (request.data.get("branch_message") or "").strip()

            for row in contractor_rows:
                if not isinstance(row, dict):
                    continue
                contractor_email = (row.get("email") or row.get("contractor_email") or "").strip().lower()
                contractor_phone = (row.get("phone") or row.get("contractor_phone") or "").strip()
                contractor_name = (row.get("name") or row.get("contractor_name") or "").strip()
                contractor_message = (row.get("message") or invite_message or "").strip()

                if not contractor_email and not contractor_phone:
                    continue

                invite = ContractorInvite.objects.create(
                    homeowner_name=homeowner_name or "Customer",
                    homeowner_email=homeowner_email,
                    homeowner_phone=homeowner_phone,
                    contractor_email=contractor_email,
                    contractor_phone=contractor_phone,
                    message="\n".join(
                        part for part in [
                            contractor_name and f"Contact: {contractor_name}",
                            contractor_message,
                        ]
                        if part
                    ),
                    source_intake=intake,
                )
                branch_invites.append(
                    {
                        "token": str(invite.token),
                        "contractor_email": invite.contractor_email,
                        "contractor_phone": invite.contractor_phone,
                        "invite_url": build_invite_url(request, invite.token),
                    }
                )

            if not branch_invites:
                branch_error = "Add at least one contractor contact before continuing."

        if branch_error:
            return Response({"detail": branch_error}, status=status.HTTP_400_BAD_REQUEST)

        branch_only_request = bool(branch_flow) and not has_intake_field_updates
        if branch_only_request:
            intake.save(update_fields=changed + ["updated_at"])
            return Response(
                {
                    "detail": "Intake updated successfully.",
                    "id": intake.id,
                    "status": intake.status,
                    "post_submit_flow": intake.post_submit_flow,
                    "branch_invites": branch_invites,
                    "completed_at": intake.completed_at.isoformat() if intake.completed_at else None,
                },
                status=status.HTTP_200_OK,
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
        status_override = None
        if intake.lead_source in {
            PublicContractorLead.SOURCE_CONTRACTOR_SENT_FORM,
            PublicContractorLead.SOURCE_MANUAL,
        }:
            status_override = PublicContractorLead.STATUS_READY_FOR_REVIEW
        lead = sync_public_lead_from_project_intake(intake, status_override=status_override)

        return Response(
            {
                "detail": "Intake updated successfully.",
                "id": intake.id,
                "status": intake.status,
                "lead_id": getattr(lead, "id", None),
                "post_submit_flow": intake.post_submit_flow,
                "branch_invites": branch_invites,
                "completed_at": intake.completed_at.isoformat() if intake.completed_at else None,
            },
            status=status.HTTP_200_OK,
        )
