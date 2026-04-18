# backend/projects/views/public_intake.py

from __future__ import annotations

from decimal import Decimal, InvalidOperation
import re

from django.utils import timezone
from rest_framework.parsers import FormParser, JSONParser, MultiPartParser
from rest_framework import status
from rest_framework.response import Response
from rest_framework.views import APIView

from projects.models_invite import ContractorInvite
from projects.models_project_intake import ProjectIntake, ProjectIntakeClarificationPhoto
from projects.models import PublicContractorLead
from projects.ai.agreement_description_writer import generate_or_improve_description
from projects.services.intake_analysis import analyze_project_intake
from projects.services.invites_delivery import build_invite_url
from projects.services.public_lead_pipeline import sync_public_lead_from_project_intake


def blank_to_none(value):
    if value is None:
        return None
    if isinstance(value, str) and not value.strip():
        return None
    return value


def _deterministic_refine_description(description: str) -> str:
    text = re.sub(r"\s+", " ", str(description or "")).strip()
    if not text:
        return ""

    leading_patterns = [
        r"^(?:i\s+)?(?:am\s+)?looking to\s+",
        r"^(?:i\s+)?(?:am\s+)?wanting to\s+",
        r"^(?:we\s+)?need to\s+",
        r"^(?:i\s+)?need to\s+",
        r"^(?:i\s+)?want to\s+",
        r"^(?:we\s+)?want to\s+",
        r"^(?:would\s+like\s+to)\s+",
        r"^(?:hoping to)\s+",
        r"^(?:looking for)\s+",
        r"^(?:help with)\s+",
        r"^(?:project is)\s+",
    ]
    cleaned = text
    for pattern in leading_patterns:
        cleaned = re.sub(pattern, "", cleaned, flags=re.IGNORECASE)

    cleaned = cleaned.strip(" -:;,.")
    if not cleaned:
        cleaned = text

    if cleaned and cleaned[0].islower():
        cleaned = cleaned[0].upper() + cleaned[1:]

    if cleaned and cleaned[-1] not in ".!?":
        cleaned += "."

    return cleaned


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
        "ai_project_title",
        "ai_project_type",
        "ai_project_subtype",
        "ai_description",
        "ai_project_timeline_days",
        "ai_project_budget",
        "measurement_handling",
        "ai_milestones",
        "ai_clarification_questions",
        "ai_clarification_answers",
        "ai_analysis_payload",
    }

    def _serialize_photos(self, request, intake):
        out = []
        for photo in intake.clarification_photos.all().order_by("-uploaded_at", "-id"):
            image_url = ""
            try:
                if getattr(photo, "image", None):
                    image_url = request.build_absolute_uri(photo.image.url)
            except Exception:
                image_url = ""
            out.append(
                {
                    "id": photo.id,
                    "caption": photo.caption,
                    "original_name": photo.original_name,
                    "image_url": image_url,
                    "uploaded_at": photo.uploaded_at.isoformat() if photo.uploaded_at else None,
                }
            )
        return out

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
            "ai_project_title": intake.ai_project_title,
            "ai_project_type": intake.ai_project_type,
            "ai_project_subtype": intake.ai_project_subtype,
            "ai_description": intake.ai_description,
            "ai_project_timeline_days": intake.ai_project_timeline_days,
            "ai_project_budget": str(intake.ai_project_budget) if intake.ai_project_budget is not None else None,
            "measurement_handling": intake.measurement_handling,
            "ai_milestones": intake.ai_milestones,
            "ai_clarification_questions": intake.ai_clarification_questions,
            "ai_clarification_answers": intake.ai_clarification_answers,
            "ai_analysis_payload": intake.ai_analysis_payload,
            "clarification_photos": self._serialize_photos(request, intake),
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

        optional_numeric_errors = {}
        changed = []
        has_intake_field_updates = any(field in request.data for field in self.SAFE_FIELDS)
        has_ai_updates = any(
            field in request.data
            for field in {
                "ai_project_title",
                "ai_project_type",
                "ai_project_subtype",
                "ai_description",
                "ai_project_timeline_days",
                "ai_project_budget",
                "measurement_handling",
                "ai_milestones",
                "ai_clarification_questions",
                "ai_clarification_answers",
                "ai_analysis_payload",
            }
        )

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
                raw_value = request.data.get(field)
                if field == "ai_project_timeline_days":
                    normalized_value = blank_to_none(raw_value)
                    if normalized_value is None:
                        setattr(intake, field, None)
                    else:
                        try:
                            setattr(intake, field, int(normalized_value))
                        except (TypeError, ValueError):
                            optional_numeric_errors[field] = ["Enter a whole number."]
                            continue
                elif field == "ai_project_budget":
                    normalized_value = blank_to_none(raw_value)
                    if normalized_value is None:
                        setattr(intake, field, None)
                    else:
                        try:
                            setattr(intake, field, Decimal(str(normalized_value)))
                        except (InvalidOperation, TypeError, ValueError):
                            optional_numeric_errors[field] = ["Enter a valid amount."]
                            continue
                else:
                    setattr(intake, field, raw_value)
                changed.append(field)

        if optional_numeric_errors:
            return Response(optional_numeric_errors, status=status.HTTP_400_BAD_REQUEST)

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
                    "ai_project_title": intake.ai_project_title,
                    "ai_project_type": intake.ai_project_type,
                    "ai_project_subtype": intake.ai_project_subtype,
                    "ai_description": intake.ai_description,
                    "ai_project_timeline_days": intake.ai_project_timeline_days,
                    "ai_project_budget": str(intake.ai_project_budget) if intake.ai_project_budget is not None else None,
                    "measurement_handling": intake.measurement_handling,
                    "ai_milestones": intake.ai_milestones,
                    "ai_clarification_questions": intake.ai_clarification_questions,
                    "ai_clarification_answers": intake.ai_clarification_answers,
                    "ai_analysis_payload": intake.ai_analysis_payload,
                    "clarification_photos": self._serialize_photos(request, intake),
                },
                status=status.HTTP_200_OK,
            )

        accomplishment = (intake.accomplishment_text or "").strip()
        has_structured_output_edits = any(
            field in request.data
            for field in {
                "ai_project_title",
                "ai_project_type",
                "ai_project_subtype",
                "ai_description",
                "ai_project_timeline_days",
                "ai_project_budget",
                "ai_milestones",
            }
        )
        has_clarification_edits = any(field in request.data for field in {"measurement_handling", "ai_clarification_answers"})

        if accomplishment and not has_structured_output_edits and (has_clarification_edits or not has_ai_updates):
            intake.completed_at = timezone.now()
            changed.append("completed_at")

        # Keep status submitted for homeowner-completed but not yet analyzed
        if intake.status == "draft":
            intake.status = "submitted"
            changed.append("status")

        if accomplishment and not has_structured_output_edits and (has_clarification_edits or not has_ai_updates):
            result = analyze_project_intake(intake=intake)
            intake.ai_project_title = result.get("project_title", "")
            intake.ai_project_type = result.get("project_type", "")
            intake.ai_project_subtype = result.get("project_subtype", "")
            intake.ai_description = result.get("description", "")
            intake.ai_project_timeline_days = result.get("project_timeline_days")
            intake.ai_project_budget = result.get("project_budget")
            intake.measurement_handling = result.get("measurement_handling", intake.measurement_handling)
            intake.ai_recommended_template_id = result.get("template_id")
            intake.ai_recommendation_confidence = result.get("confidence", "none")
            intake.ai_recommendation_reason = result.get("reason", "")
            intake.ai_milestones = result.get("milestones", [])
            intake.ai_clarification_questions = result.get("clarification_questions", [])
            intake.ai_clarification_answers = result.get("clarification_answers", intake.ai_clarification_answers)
            intake.ai_analysis_payload = result
            intake.analyzed_at = timezone.now()
            changed.extend(
                [
                    "ai_project_title",
                    "ai_project_type",
                    "ai_project_subtype",
                    "ai_description",
                    "ai_project_timeline_days",
                    "ai_project_budget",
                    "measurement_handling",
                    "ai_recommended_template_id",
                    "ai_recommendation_confidence",
                    "ai_recommendation_reason",
                    "ai_milestones",
                    "ai_clarification_questions",
                    "ai_clarification_answers",
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
                "ai_project_title": intake.ai_project_title,
                "ai_project_type": intake.ai_project_type,
                "ai_project_subtype": intake.ai_project_subtype,
                "ai_description": intake.ai_description,
                "ai_project_timeline_days": intake.ai_project_timeline_days,
                "ai_project_budget": str(intake.ai_project_budget) if intake.ai_project_budget is not None else None,
                "measurement_handling": intake.measurement_handling,
                "ai_milestones": intake.ai_milestones,
                "ai_clarification_questions": intake.ai_clarification_questions,
                "ai_clarification_answers": intake.ai_clarification_answers,
                "ai_analysis_payload": intake.ai_analysis_payload,
                "clarification_photos": self._serialize_photos(request, intake),
            },
            status=status.HTTP_200_OK,
        )


class PublicIntakeClarificationPhotoUploadView(APIView):
    permission_classes = []
    parser_classes = [MultiPartParser, FormParser, JSONParser]

    def _get_intake(self, request):
        token = (request.query_params.get("token") or request.data.get("token") or "").strip()
        if not token:
            return None, Response({"detail": "Missing intake token."}, status=status.HTTP_400_BAD_REQUEST)
        try:
            intake = ProjectIntake.objects.get(share_token=token)
        except ProjectIntake.DoesNotExist:
            return None, Response({"detail": "Intake link not found."}, status=status.HTTP_404_NOT_FOUND)
        return intake, None


    def _serialize_photo(self, request, photo):
        image_url = ""
        try:
            if getattr(photo, "image", None):
                image_url = request.build_absolute_uri(photo.image.url)
        except Exception:
            image_url = ""
        return {
            "id": photo.id,
            "caption": photo.caption,
            "original_name": photo.original_name,
            "image_url": image_url,
            "uploaded_at": photo.uploaded_at.isoformat() if photo.uploaded_at else None,
        }

    def post(self, request, *args, **kwargs):
        intake, error_response = self._get_intake(request)
        if error_response:
            return error_response

        uploaded_files = request.FILES.getlist("files") or request.FILES.getlist("photos")
        single = request.FILES.get("file") or request.FILES.get("photo")
        if single is not None:
            uploaded_files.append(single)

        if not uploaded_files:
            return Response({"detail": "No image provided."}, status=status.HTTP_400_BAD_REQUEST)

        caption = (request.data.get("caption") or "").strip()
        created = []
        for file_obj in uploaded_files:
            created.append(
                ProjectIntakeClarificationPhoto.objects.create(
                    project_intake=intake,
                    image=file_obj,
                    original_name=getattr(file_obj, "name", "") or "",
                    caption=caption,
                )
            )

        return Response(
            {
                "detail": "Photo uploaded successfully.",
                "photos": [self._serialize_photo(request, photo) for photo in created],
            },
            status=status.HTTP_201_CREATED,
        )


class PublicIntakeDescriptionImproveView(APIView):
    permission_classes = []

    def _get_intake(self, request):
        token = (request.query_params.get("token") or request.data.get("token") or "").strip()
        if not token:
            return None, Response({"detail": "Missing intake token."}, status=status.HTTP_400_BAD_REQUEST)
        try:
            intake = ProjectIntake.objects.select_related("contractor", "homeowner").get(share_token=token)
        except ProjectIntake.DoesNotExist:
            return None, Response({"detail": "Intake link not found."}, status=status.HTTP_404_NOT_FOUND)
        return intake, None

    def post(self, request, *args, **kwargs):
        intake, error_response = self._get_intake(request)
        if error_response:
            return error_response

        current_description = (
            request.data.get("current_description")
            or request.data.get("accomplishment_text")
            or intake.accomplishment_text
            or ""
        ).strip()
        if not current_description:
            return Response(
                {"detail": "Add a project description first."},
                status=status.HTTP_400_BAD_REQUEST,
            )

        try:
            out = generate_or_improve_description(
                mode="improve",
                project_title=intake.ai_project_title or "",
                project_type=intake.ai_project_type or "",
                project_subtype=intake.ai_project_subtype or "",
                current_description=current_description,
            )
            description = (out.get("description") or "").strip()
            source = "ai"
        except Exception:
            description = _deterministic_refine_description(current_description)
            source = "fallback"

        if not description:
            description = _deterministic_refine_description(current_description)
            source = "fallback"

        return Response(
            {
                "detail": "Description improved.",
                "description": description,
                "source": source,
            },
            status=status.HTTP_200_OK,
        )
