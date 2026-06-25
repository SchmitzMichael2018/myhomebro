from __future__ import annotations

from rest_framework.parsers import FormParser, JSONParser, MultiPartParser
from rest_framework.permissions import AllowAny, IsAuthenticated
from rest_framework import status
from rest_framework.response import Response
from rest_framework.views import APIView

from django.utils import timezone

from projects.models import ContractorWebsite, ContractorWebsitePage, PublicContractorLead
from projects.models_project_intake import ProjectIntake, ProjectIntakeClarificationPhoto
from projects.serializers.public_presence import PublicContractorQuoteRequestSerializer
from projects.services.agreements.project_create import resolve_contractor_for_user
from projects.services.public_lead_pipeline import sync_public_lead_from_project_intake
from projects.services.sms_service import ensure_sms_consent
from projects.services.website_builder import (
    build_website_ai_assist_response,
    build_contractor_website_payload,
    build_contractor_website_preview_payload,
    ensure_contractor_website,
    get_contractor_website_entitlements,
    list_website_pages,
    pause_contractor_website,
    public_website_snapshot,
    publish_contractor_website,
    update_contractor_website,
    update_website_page,
)
from projects.views.public_presence import (
    _deterministic_refine_quote_description,
    _parse_json_value,
    _quote_request_payload,
    _safe_text,
    _truthy,
)


class ContractorWebsiteView(APIView):
    permission_classes = [IsAuthenticated]

    def get(self, request):
        contractor = resolve_contractor_for_user(request.user)
        if contractor is None:
            return Response({"detail": "Only contractors can access Website Builder readiness."}, status=403)
        return Response(build_contractor_website_payload(contractor, request=request))

    def patch(self, request):
        contractor = resolve_contractor_for_user(request.user)
        if contractor is None:
            return Response({"detail": "Only contractors can edit Website Builder settings."}, status=403)
        website = ensure_contractor_website(contractor, request=request)
        try:
            update_contractor_website(
                website,
                request.data if isinstance(request.data, dict) else {},
                entitlements=get_contractor_website_entitlements(contractor),
            )
        except PermissionError as exc:
            return Response({"detail": str(exc)}, status=status.HTTP_403_FORBIDDEN)
        return Response(build_contractor_website_payload(contractor, request=request))


class ContractorWebsitePreviewView(APIView):
    permission_classes = [IsAuthenticated]

    def get(self, request):
        contractor = resolve_contractor_for_user(request.user)
        if contractor is None:
            return Response({"detail": "Only contractors can preview Website Builder data."}, status=403)
        return Response(build_contractor_website_preview_payload(contractor, request=request))


class ContractorWebsiteAiAssistView(APIView):
    permission_classes = [IsAuthenticated]

    def post(self, request):
        contractor = resolve_contractor_for_user(request.user)
        if contractor is None:
            return Response({"detail": "Only contractors can use Website Builder AI assistance."}, status=403)
        result = build_website_ai_assist_response(
            contractor,
            request.data if isinstance(request.data, dict) else {},
            request=request,
        )
        if not result.get("ok"):
            response_status = int(result.pop("status", status.HTTP_400_BAD_REQUEST))
            return Response(result, status=response_status)
        return Response(result)


class ContractorWebsitePublishView(APIView):
    permission_classes = [IsAuthenticated]

    def post(self, request):
        contractor = resolve_contractor_for_user(request.user)
        if contractor is None:
            return Response({"detail": "Only contractors can publish Website Builder data."}, status=403)
        website = ensure_contractor_website(contractor, request=request)
        result = publish_contractor_website(
            website,
            request=request,
            entitlements=get_contractor_website_entitlements(contractor),
        )
        if not result.get("ok"):
            return Response(result, status=status.HTTP_400_BAD_REQUEST)
        return Response(result)


class ContractorWebsitePauseView(APIView):
    permission_classes = [IsAuthenticated]

    def post(self, request):
        contractor = resolve_contractor_for_user(request.user)
        if contractor is None:
            return Response({"detail": "Only contractors can pause Website Builder data."}, status=403)
        website = ensure_contractor_website(contractor, request=request)
        return Response(pause_contractor_website(website))


class ContractorWebsitePagesView(APIView):
    permission_classes = [IsAuthenticated]

    def get(self, request):
        contractor = resolve_contractor_for_user(request.user)
        if contractor is None:
            return Response({"detail": "Only contractors can view Website Builder pages."}, status=403)
        website = ensure_contractor_website(contractor, request=request)
        return Response({"results": list_website_pages(website)})


class ContractorWebsitePageDetailView(APIView):
    permission_classes = [IsAuthenticated]

    def patch(self, request, page_id: int):
        contractor = resolve_contractor_for_user(request.user)
        if contractor is None:
            return Response({"detail": "Only contractors can edit Website Builder pages."}, status=403)
        entitlements = get_contractor_website_entitlements(contractor)
        if not entitlements["features"]["website_builder"]["enabled"]:
            return Response(
                {"detail": entitlements["features"]["website_builder"]["reason"]},
                status=status.HTTP_403_FORBIDDEN,
            )
        website = ensure_contractor_website(contractor, request=request)
        try:
            page = website.pages.get(pk=page_id)
        except ContractorWebsitePage.DoesNotExist:
            return Response({"detail": "Page not found."}, status=status.HTTP_404_NOT_FOUND)
        page = update_website_page(page, request.data if isinstance(request.data, dict) else {})
        pages = list_website_pages(website)
        return Response({
            "page": next((row for row in pages if row["id"] == page.id), None),
            "pages": pages,
        })


class PublicWebsiteView(APIView):
    authentication_classes = []
    permission_classes = []

    def get(self, request, slug: str, page_slug: str | None = None):
        snapshot = public_website_snapshot(slug, page_slug=page_slug)
        if snapshot is None:
            return Response({"detail": "Website not found."}, status=status.HTTP_404_NOT_FOUND)
        return Response(snapshot)


class PublicWebsiteIntakeView(APIView):
    authentication_classes = []
    permission_classes = [AllowAny]
    parser_classes = [MultiPartParser, FormParser, JSONParser]

    def post(self, request, slug: str):
        website = (
            ContractorWebsite.objects.select_related("contractor", "public_profile")
            .filter(public_profile__slug=slug, status=ContractorWebsite.STATUS_PUBLISHED)
            .first()
        )
        if website is None or not website.published_snapshot:
            return Response({"detail": "Website not found."}, status=status.HTTP_404_NOT_FOUND)

        profile = website.public_profile
        if not profile.allow_public_intake:
            return Response({"detail": "Website quote requests are not enabled for this contractor."}, status=status.HTTP_404_NOT_FOUND)

        contact_page = next(
            (
                page
                for page in (website.published_snapshot.get("pages") or [])
                if page.get("page_type") == ContractorWebsitePage.PAGE_CONTACT
            ),
            {},
        )
        contact_block = (contact_page.get("content_blocks") or {}).get("contact") or {}
        if contact_block.get("lead_form_enabled") is False:
            return Response({"detail": "Website quote requests are not enabled for this contractor."}, status=status.HTTP_404_NOT_FOUND)

        serializer = PublicContractorQuoteRequestSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        data = dict(serializer.validated_data)
        project_class = _safe_text(data.get("project_class")) or "residential"
        raw_description = _safe_text(data.get("raw_description"))
        refined_description = _safe_text(data.get("refined_description")) or _deterministic_refine_quote_description(raw_description)
        budget_range_text = _safe_text(data.get("budget_range_text"))
        ai_project_budget = data.get("ai_project_budget")
        if ai_project_budget in (None, "") and budget_range_text:
            ai_project_budget = None

        payload = {
            "contractor": profile.contractor,
            "public_profile": profile,
            "initiated_by": "homeowner",
            "status": "submitted",
            "lead_source": PublicContractorLead.SOURCE_WEBSITE,
            "customer_name": _safe_text(data.get("full_name")),
            "customer_email": _safe_text(data.get("email")),
            "customer_phone": _safe_text(data.get("phone")),
            "project_class": project_class,
            "project_mode": _safe_text(data.get("project_mode")) or "full_service",
            "property_type": _safe_text(data.get("property_type")),
            "desired_timing_text": _safe_text(data.get("desired_timing_text")),
            "budget_range_text": budget_range_text,
            "payment_preference": _safe_text(data.get("payment_preference")) or "discuss",
            "preferred_contact_method": _safe_text(data.get("preferred_contact_method")),
            "contact_consent": _truthy(data.get("contact_consent")),
            "project_address_line1": _safe_text(data.get("project_address_line1")),
            "project_address_line2": _safe_text(data.get("project_address_line2")),
            "project_city": _safe_text(data.get("project_city")),
            "project_state": _safe_text(data.get("project_state")),
            "project_postal_code": _safe_text(data.get("project_postal_code")),
            "accomplishment_text": raw_description,
            "ai_project_title": _safe_text(data.get("project_type")) or raw_description[:120] or "Website Quote Request",
            "ai_project_type": _safe_text(data.get("project_type")),
            "ai_project_subtype": _safe_text(data.get("project_subtype")),
            "ai_description": refined_description,
            "ai_project_timeline_days": data.get("ai_project_timeline_days"),
            "ai_project_budget": ai_project_budget,
            "measurement_handling": "",
            "ai_clarification_questions": _parse_json_value(data.get("ai_clarification_questions"), []),
            "ai_clarification_answers": _parse_json_value(data.get("ai_clarification_answers"), {}),
            "ai_analysis_payload": {
                **_quote_request_payload(data).get("ai_analysis_payload", {}),
                "source": PublicContractorLead.SOURCE_WEBSITE,
                "source_label": "Website",
                "request_path_label": "Start a Project",
            },
            "submitted_at": timezone.now(),
        }
        intake = ProjectIntake.objects.create(**payload)

        uploaded_files = request.FILES.getlist("files") or request.FILES.getlist("photos")
        single_file = request.FILES.get("file") or request.FILES.get("photo")
        if single_file is not None:
            uploaded_files.append(single_file)

        for file_obj in uploaded_files:
            ProjectIntakeClarificationPhoto.objects.create(
                project_intake=intake,
                image=file_obj,
                original_name=getattr(file_obj, "name", "") or "",
                caption="",
            )

        if _truthy(data.get("contact_consent")) and _safe_text(data.get("phone")):
            try:
                ensure_sms_consent(
                    phone_number=_safe_text(data.get("phone")),
                    contractor=profile.contractor,
                    source="agreement",
                    consent_text_snapshot="Customer consent captured during contractor website quote request.",
                    consent_source_page=request.build_absolute_uri(f"/websites/{profile.slug}"),
                )
            except Exception:
                pass

        lead = sync_public_lead_from_project_intake(intake, status_override=PublicContractorLead.STATUS_NEW)
        business_name = profile.business_name_public or profile.contractor.business_name or profile.contractor.name or "this contractor"
        return Response(
            {
                "ok": True,
                "message": f"Your request was sent to {business_name}.",
                "intake_id": intake.id,
                "lead_id": getattr(lead, "id", None),
                "status": getattr(lead, "status", "new"),
                "source": PublicContractorLead.SOURCE_WEBSITE,
                "source_label": "Website",
                "request_path_label": "Start a Project",
            },
            status=status.HTTP_201_CREATED,
        )
