from __future__ import annotations

from types import SimpleNamespace

from django.db import IntegrityError
from django.shortcuts import get_object_or_404
from django.utils import timezone
from rest_framework.exceptions import PermissionDenied
from rest_framework import status
from rest_framework.parsers import FormParser, JSONParser, MultiPartParser
from rest_framework.permissions import AllowAny, IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

from projects.models import Agreement, Contractor, ContractorPublicProfile, ContractorReview, Homeowner, Project, PublicContractorLead
from projects.models_project_intake import ProjectIntake
from projects.models_templates import ProjectTemplate
from projects.serializers.public_presence import (
    ContractorManualLeadCreateSerializer,
    ContractorGalleryItemSerializer,
    ContractorPublicLeadSerializer,
    ContractorPublicProfileSerializer,
    ContractorReviewSerializer,
    PublicContractorLeadCreateSerializer,
    PublicContractorReviewCreateSerializer,
    PublicContractorProfileSerializer,
    PublicContractorReviewSerializer,
    PublicGalleryItemSerializer,
    make_qr_svg_data,
)
from projects.services.intake_analysis import analyze_project_intake
from projects.services.bid_workflow import infer_project_class, promote_public_lead_to_agreement
from projects.services.public_lead_notifications import (
    send_public_lead_accept_email,
    send_public_lead_reject_email,
)
from projects.services.public_lead_pipeline import normalize_public_lead_source
from projects.services.agreements.project_create import resolve_contractor_for_user
from projects.services.intake_public import send_intake_email


def _resolve_contractor(user):
    contractor = resolve_contractor_for_user(user)
    if contractor is None:
        raise PermissionDenied("Only contractors can manage public presence.")
    return contractor


def _profile_defaults(contractor):
    return {
        "business_name_public": contractor.business_name or contractor.name or "",
        "city": contractor.city or "",
        "state": contractor.state or "",
        "phone_public": contractor.phone or "",
        "email_public": contractor.email or "",
        "specialties": [skill.name for skill in contractor.skills.all()],
    }


def _get_or_create_profile(contractor):
    profile = getattr(contractor, "public_profile", None)
    if profile is not None:
        return profile
    return ContractorPublicProfile.objects.create(
        contractor=contractor,
        **_profile_defaults(contractor),
    )


def _public_profile_qs():
    return ContractorPublicProfile.objects.select_related("contractor", "contractor__user")


def _public_profile_or_404(slug: str):
    profile = get_object_or_404(_public_profile_qs(), slug=slug, is_public=True)
    return profile


def _legacy_public_profile_or_404(contractor_id: int):
    return get_object_or_404(_public_profile_qs(), contractor_id=contractor_id, is_public=True)


def _public_profile_payload(request, profile):
    return PublicContractorProfileSerializer(profile, context={"request": request}).data


def _qr_payload(request, profile):
    public_url = request.build_absolute_uri(profile.public_url_path)
    qr_target_url = request.build_absolute_uri(f"{profile.public_url_path}?source=qr")
    return {
        "slug": profile.slug,
        "public_url": public_url,
        "qr_target_url": qr_target_url,
        "qr_svg": make_qr_svg_data(qr_target_url),
        "download_filename": f"{profile.slug}-public-profile-qr.svg",
    }


def _lead_scope_text(lead) -> str:
    analysis = getattr(lead, "ai_analysis", {}) or {}
    parts = [
        (analysis.get("project_scope_summary") or "").strip(),
        (lead.project_type or "").strip(),
        (lead.project_description or "").strip(),
        (lead.preferred_timeline or "").strip(),
        (lead.budget_text or "").strip(),
    ]
    return " ".join(part for part in parts if part).strip()


def _ensure_homeowner_for_lead(lead):
    homeowner = getattr(lead, "converted_homeowner", None)
    if homeowner is not None:
        return homeowner
    if not lead.email:
        return None

    homeowner = lead.contractor.homeowners.filter(email__iexact=lead.email).first()
    if homeowner is None:
        try:
            homeowner = Homeowner.objects.create(
                created_by=lead.contractor,
                full_name=lead.full_name,
                email=lead.email,
                phone_number=lead.phone or "",
                street_address=lead.project_address or "",
                city=lead.city or "",
                state=lead.state or "",
                zip_code=lead.zip_code or "",
            )
        except IntegrityError:
            homeowner = lead.contractor.homeowners.get(email__iexact=lead.email)
    return homeowner


def _build_lead_analysis_payload(lead):
    source_intake = getattr(lead, "source_intake", None)
    intake_like = SimpleNamespace(
        contractor=lead.contractor,
        accomplishment_text=_lead_scope_text(lead),
        ai_project_type="",
        ai_project_subtype="",
        measurement_handling=getattr(source_intake, "measurement_handling", ""),
        ai_clarification_answers=getattr(source_intake, "ai_clarification_answers", {}) or {},
    )
    result = analyze_project_intake(intake=intake_like)
    suggested_templates = list(result.get("template_matches") or [])
    primary_template_id = result.get("template_id")
    if primary_template_id and not any(str(item.get("id")) == str(primary_template_id) for item in suggested_templates):
        suggested_templates.insert(
            0,
            {
                "id": primary_template_id,
                "name": result.get("template_name", ""),
                "project_type": result.get("project_type", ""),
                "project_subtype": result.get("project_subtype", ""),
                "score": result.get("score"),
                "confidence": result.get("confidence", "none"),
                "reason": result.get("reason", ""),
            },
        )
    return {
        "project_type": result.get("project_type", ""),
        "project_subtype": result.get("project_subtype", ""),
        "suggested_title": result.get("project_title", ""),
        "suggested_description": result.get("description", ""),
        "project_scope_summary": result.get("project_scope_summary", ""),
        "project_family_key": result.get("project_family_key", ""),
        "project_family_label": result.get("project_family_label", ""),
        "project_timeline_days": result.get("project_timeline_days"),
        "project_budget": str(result.get("project_budget")) if result.get("project_budget") is not None else None,
        "clarifications_needed": result.get("clarification_questions", []),
        "milestone_outline": result.get("milestones", []),
        "recommended_templates": suggested_templates,
        "template_id": result.get("template_id"),
        "template_name": result.get("template_name", ""),
        "confidence": result.get("confidence", "none"),
        "reason": result.get("reason", ""),
        "raw_result": result,
    }


def _lead_skips_cold_acceptance(lead) -> bool:
    return lead.source in {
        PublicContractorLead.SOURCE_CONTRACTOR_SENT_FORM,
        PublicContractorLead.SOURCE_MANUAL,
    }


def _lead_ready_for_ai_and_agreement(lead) -> bool:
    if lead.status == PublicContractorLead.STATUS_ACCEPTED:
        return True
    return _lead_skips_cold_acceptance(lead) and lead.status in {
        PublicContractorLead.STATUS_READY_FOR_REVIEW,
        PublicContractorLead.STATUS_CONTACTED,
        PublicContractorLead.STATUS_QUALIFIED,
    }


class ContractorPublicProfileManageView(APIView):
    permission_classes = [IsAuthenticated]
    parser_classes = [MultiPartParser, FormParser, JSONParser]

    def get(self, request):
        contractor = _resolve_contractor(request.user)
        profile = _get_or_create_profile(contractor)
        return Response(ContractorPublicProfileSerializer(profile, context={"request": request}).data)

    def post(self, request):
        contractor = _resolve_contractor(request.user)
        profile = getattr(contractor, "public_profile", None)
        if profile is not None:
            serializer = ContractorPublicProfileSerializer(profile, data=request.data, partial=True, context={"request": request})
            serializer.is_valid(raise_exception=True)
            serializer.save()
            return Response(serializer.data, status=status.HTTP_200_OK)

        serializer = ContractorPublicProfileSerializer(data=request.data, context={"request": request})
        serializer.is_valid(raise_exception=True)
        create_data = dict(serializer.validated_data)
        for key, value in _profile_defaults(contractor).items():
            create_data.setdefault(key, value)
        profile = ContractorPublicProfile.objects.create(contractor=contractor, **create_data)
        return Response(
            ContractorPublicProfileSerializer(profile, context={"request": request}).data,
            status=status.HTTP_201_CREATED,
        )

    def patch(self, request):
        contractor = _resolve_contractor(request.user)
        profile = _get_or_create_profile(contractor)
        serializer = ContractorPublicProfileSerializer(profile, data=request.data, partial=True, context={"request": request})
        serializer.is_valid(raise_exception=True)
        serializer.save()
        return Response(serializer.data)


class ContractorGalleryListCreateView(APIView):
    permission_classes = [IsAuthenticated]
    parser_classes = [MultiPartParser, FormParser, JSONParser]

    def get(self, request):
        contractor = _resolve_contractor(request.user)
        rows = contractor.public_gallery_items.select_related("public_profile").order_by("-is_featured", "sort_order", "-created_at")
        return Response({"results": ContractorGalleryItemSerializer(rows, many=True, context={"request": request}).data})

    def post(self, request):
        contractor = _resolve_contractor(request.user)
        profile = _get_or_create_profile(contractor)
        serializer = ContractorGalleryItemSerializer(data=request.data, context={"request": request})
        serializer.is_valid(raise_exception=True)
        serializer.save(contractor=contractor, public_profile=profile)
        return Response(serializer.data, status=status.HTTP_201_CREATED)


class ContractorGalleryDetailView(APIView):
    permission_classes = [IsAuthenticated]
    parser_classes = [MultiPartParser, FormParser, JSONParser]

    def patch(self, request, item_id: int):
        contractor = _resolve_contractor(request.user)
        item = get_object_or_404(contractor.public_gallery_items.all(), pk=item_id)
        serializer = ContractorGalleryItemSerializer(item, data=request.data, partial=True, context={"request": request})
        serializer.is_valid(raise_exception=True)
        serializer.save()
        return Response(serializer.data)

    def delete(self, request, item_id: int):
        contractor = _resolve_contractor(request.user)
        item = get_object_or_404(contractor.public_gallery_items.all(), pk=item_id)
        item.delete()
        return Response(status=status.HTTP_204_NO_CONTENT)


class ContractorReviewListCreateView(APIView):
    permission_classes = [IsAuthenticated]
    parser_classes = [MultiPartParser, FormParser, JSONParser]

    def get(self, request):
        contractor = _resolve_contractor(request.user)
        rows = contractor.public_reviews.select_related("agreement").order_by("-is_verified", "-submitted_at", "-created_at")
        return Response({"results": ContractorReviewSerializer(rows, many=True).data})

    def post(self, request):
        contractor = _resolve_contractor(request.user)
        profile = _get_or_create_profile(contractor)
        serializer = ContractorReviewSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        agreement = serializer.validated_data.get("agreement")
        if agreement is not None and agreement.project.contractor_id != contractor.id:
            return Response({"agreement": ["Agreement must belong to your business."]}, status=status.HTTP_400_BAD_REQUEST)
        serializer.save(contractor=contractor, public_profile=profile)
        return Response(serializer.data, status=status.HTTP_201_CREATED)


class ContractorReviewDetailView(APIView):
    permission_classes = [IsAuthenticated]
    parser_classes = [MultiPartParser, FormParser, JSONParser]

    def patch(self, request, review_id: int):
        contractor = _resolve_contractor(request.user)
        review = get_object_or_404(contractor.public_reviews.all(), pk=review_id)
        serializer = ContractorReviewSerializer(review, data=request.data, partial=True)
        serializer.is_valid(raise_exception=True)
        agreement = serializer.validated_data.get("agreement")
        if agreement is not None and agreement.project.contractor_id != contractor.id:
            return Response({"agreement": ["Agreement must belong to your business."]}, status=status.HTTP_400_BAD_REQUEST)
        serializer.save()
        return Response(serializer.data)


class ContractorPublicLeadListView(APIView):
    permission_classes = [IsAuthenticated]

    def get(self, request):
        contractor = _resolve_contractor(request.user)
        rows = contractor.public_leads.select_related("public_profile").order_by("-created_at", "-id")
        return Response({"results": ContractorPublicLeadSerializer(rows, many=True).data})

    def post(self, request):
        contractor = _resolve_contractor(request.user)
        profile = _get_or_create_profile(contractor)
        serializer = ContractorManualLeadCreateSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        lead = serializer.save(contractor=contractor, public_profile=profile)
        return Response(ContractorPublicLeadSerializer(lead).data, status=status.HTTP_201_CREATED)


class ContractorPublicLeadDetailView(APIView):
    permission_classes = [IsAuthenticated]
    parser_classes = [MultiPartParser, FormParser, JSONParser]

    def get(self, request, lead_id: int):
        contractor = _resolve_contractor(request.user)
        lead = get_object_or_404(contractor.public_leads.all(), pk=lead_id)
        return Response(ContractorPublicLeadSerializer(lead).data)

    def patch(self, request, lead_id: int):
        contractor = _resolve_contractor(request.user)
        lead = get_object_or_404(contractor.public_leads.all(), pk=lead_id)
        serializer = ContractorPublicLeadSerializer(lead, data=request.data, partial=True)
        serializer.is_valid(raise_exception=True)
        serializer.save()
        return Response(serializer.data)


class ContractorPublicLeadAcceptView(APIView):
    permission_classes = [IsAuthenticated]

    def post(self, request, lead_id: int):
        contractor = _resolve_contractor(request.user)
        lead = get_object_or_404(contractor.public_leads.select_related("converted_homeowner").all(), pk=lead_id)
        if _lead_skips_cold_acceptance(lead):
            return Response(
                {"detail": "Warm leads do not need to be accepted. Review the lead details, send an intake if needed, and continue with analysis or agreement drafting."},
                status=status.HTTP_400_BAD_REQUEST,
            )
        homeowner = _ensure_homeowner_for_lead(lead)
        if homeowner is None:
            return Response(
                {"email": ["An email address is required to accept this lead and create or reuse a customer."]},
                status=status.HTTP_400_BAD_REQUEST,
            )

        lead.converted_homeowner = homeowner
        lead.status = PublicContractorLead.STATUS_ACCEPTED
        if lead.accepted_at is None:
            lead.accepted_at = timezone.now()
        if lead.converted_at is None:
            lead.converted_at = timezone.now()
        lead.save(update_fields=["converted_homeowner", "status", "accepted_at", "converted_at", "updated_at"])
        notification = send_public_lead_accept_email(lead)
        payload = ContractorPublicLeadSerializer(lead).data
        payload["customer_notified"] = notification["sent"]
        payload["notification_detail"] = notification["detail"]
        return Response(payload, status=status.HTTP_200_OK)


class ContractorPublicLeadRejectView(APIView):
    permission_classes = [IsAuthenticated]

    def post(self, request, lead_id: int):
        contractor = _resolve_contractor(request.user)
        lead = get_object_or_404(contractor.public_leads.all(), pk=lead_id)
        if _lead_skips_cold_acceptance(lead):
            return Response(
                {"detail": "Warm leads should be closed or archived instead of rejected."},
                status=status.HTTP_400_BAD_REQUEST,
            )
        if lead.converted_agreement_id:
            return Response(
                {"detail": "This lead already has a draft agreement and cannot be rejected from the lead inbox."},
                status=status.HTTP_400_BAD_REQUEST,
            )
        lead.status = PublicContractorLead.STATUS_REJECTED
        if lead.rejected_at is None:
            lead.rejected_at = timezone.now()
        lead.save(update_fields=["status", "rejected_at", "updated_at"])
        notification = send_public_lead_reject_email(lead)
        payload = ContractorPublicLeadSerializer(lead).data
        payload["customer_notified"] = notification["sent"]
        payload["notification_detail"] = notification["detail"]
        return Response(payload, status=status.HTTP_200_OK)


class ContractorPublicLeadAnalyzeView(APIView):
    permission_classes = [IsAuthenticated]

    def post(self, request, lead_id: int):
        contractor = _resolve_contractor(request.user)
        lead = get_object_or_404(contractor.public_leads.all(), pk=lead_id)
        if not _lead_ready_for_ai_and_agreement(lead):
            return Response(
                {"detail": "Only accepted cold leads or warm leads that are ready for review can be analyzed."},
                status=status.HTTP_400_BAD_REQUEST,
            )
        if not _lead_scope_text(lead):
            return Response(
                {"detail": "Add a few project details first, or send an intake form so the customer can complete the scope."},
                status=status.HTTP_400_BAD_REQUEST,
            )
        analysis = _build_lead_analysis_payload(lead)
        lead.ai_analysis = analysis
        lead.save(update_fields=["ai_analysis", "updated_at"])
        return Response({"lead_id": lead.id, "ai_analysis": analysis}, status=status.HTTP_200_OK)


class ContractorPublicLeadSendIntakeView(APIView):
    permission_classes = [IsAuthenticated]

    def post(self, request, lead_id: int):
        contractor = _resolve_contractor(request.user)
        lead = get_object_or_404(
            contractor.public_leads.select_related("public_profile", "source_intake").all(),
            pk=lead_id,
        )
        if lead.source == PublicContractorLead.SOURCE_CONTRACTOR_SENT_FORM:
            return Response(
                {"detail": "This lead already uses a contractor-sent intake form."},
                status=status.HTTP_400_BAD_REQUEST,
            )
        if not lead.email:
            return Response(
                {"email": ["An email address is required before you can send an intake form."]},
                status=status.HTTP_400_BAD_REQUEST,
            )

        intake = getattr(lead, "source_intake", None)
        if intake is None:
            intake = ProjectIntake.objects.create(
                contractor=contractor,
                public_profile=lead.public_profile or _get_or_create_profile(contractor),
                public_lead=lead,
                initiated_by="contractor",
                status="draft",
                lead_source=lead.source or PublicContractorLead.SOURCE_MANUAL,
                customer_name=lead.full_name or "",
                customer_email=lead.email or "",
                customer_phone=lead.phone or "",
                project_address_line1=lead.project_address or "",
                project_city=lead.city or "",
                project_state=lead.state or "",
                project_postal_code=lead.zip_code or "",
                accomplishment_text=lead.project_description or "",
            )
        else:
            intake.public_profile = intake.public_profile or lead.public_profile or _get_or_create_profile(contractor)
            intake.lead_source = lead.source or PublicContractorLead.SOURCE_MANUAL
            intake.customer_name = lead.full_name or intake.customer_name
            intake.customer_email = lead.email or intake.customer_email
            intake.customer_phone = lead.phone or intake.customer_phone
            intake.project_address_line1 = lead.project_address or intake.project_address_line1
            intake.project_city = lead.city or intake.project_city
            intake.project_state = lead.state or intake.project_state
            intake.project_postal_code = lead.zip_code or intake.project_postal_code
            intake.accomplishment_text = lead.project_description or intake.accomplishment_text
            intake.save(
                update_fields=[
                    "public_profile",
                    "lead_source",
                    "customer_name",
                    "customer_email",
                    "customer_phone",
                    "project_address_line1",
                    "project_city",
                    "project_state",
                    "project_postal_code",
                    "accomplishment_text",
                    "updated_at",
                ]
            )

        try:
            result = send_intake_email(intake)
        except ValueError as exc:
            return Response({"detail": str(exc)}, status=status.HTTP_400_BAD_REQUEST)
        except Exception:
            return Response(
                {"detail": "Failed to send intake email."},
                status=status.HTTP_500_INTERNAL_SERVER_ERROR,
            )

        lead.status = PublicContractorLead.STATUS_PENDING_CUSTOMER_RESPONSE
        lead.save(update_fields=["status", "updated_at"])
        result["lead_id"] = lead.id
        result["lead_status"] = lead.status
        result["lead_source"] = lead.source
        return Response(result, status=status.HTTP_200_OK)


class ContractorPublicLeadCreateAgreementView(APIView):
    permission_classes = [IsAuthenticated]

    def post(self, request, lead_id: int):
        contractor = _resolve_contractor(request.user)
        lead = get_object_or_404(
            contractor.public_leads.select_related("converted_homeowner", "converted_agreement").all(),
            pk=lead_id,
        )
        if not _lead_ready_for_ai_and_agreement(lead):
            return Response(
                {"detail": "Only accepted cold leads or warm leads that are ready for review can be converted into an agreement."},
                status=status.HTTP_400_BAD_REQUEST,
            )
        agreement, created = promote_public_lead_to_agreement(lead=lead)
        if agreement is None:
            return Response(
                {"email": ["An email address is required before creating an agreement from this lead."]},
                status=status.HTTP_400_BAD_REQUEST,
            )
        return Response(
            {
                "agreement_id": agreement.id,
                "detail_url": f"/app/agreements/{agreement.id}",
                "wizard_url": f"/app/agreements/{agreement.id}/wizard?step=1",
                "created": created,
            },
            status=status.HTTP_201_CREATED,
        )


class ContractorPublicLeadConvertHomeownerView(APIView):
    permission_classes = [IsAuthenticated]

    def post(self, request, lead_id: int):
        contractor = _resolve_contractor(request.user)
        lead = get_object_or_404(contractor.public_leads.select_related("converted_homeowner").all(), pk=lead_id)
        homeowner = _ensure_homeowner_for_lead(lead)
        if homeowner is None:
            return Response(
                {"email": ["An email address is required to convert this lead into a customer."]},
                status=status.HTTP_400_BAD_REQUEST,
            )
        lead.converted_homeowner = homeowner
        lead.converted_at = timezone.now()
        if lead.status == PublicContractorLead.STATUS_NEW:
            lead.status = PublicContractorLead.STATUS_QUALIFIED
        lead.save(update_fields=["converted_homeowner", "converted_at", "status", "updated_at"])
        return Response(ContractorPublicLeadSerializer(lead).data, status=status.HTTP_200_OK)


class ContractorPublicProfileQrView(APIView):
    permission_classes = [IsAuthenticated]

    def get(self, request):
        contractor = _resolve_contractor(request.user)
        profile = _get_or_create_profile(contractor)
        return Response(_qr_payload(request, profile))


class PublicContractorProfileView(APIView):
    permission_classes = [AllowAny]

    def get(self, request, slug: str):
        profile = _public_profile_or_404(slug)
        return Response(_public_profile_payload(request, profile))


class LegacyPublicContractorProfileByIdView(APIView):
    permission_classes = [AllowAny]

    def get(self, request, pk: int):
        profile = _legacy_public_profile_or_404(pk)
        return Response(_public_profile_payload(request, profile))


class PublicContractorGalleryView(APIView):
    permission_classes = [AllowAny]

    def get(self, request, slug: str):
        profile = _public_profile_or_404(slug)
        rows = profile.gallery_items.filter(is_public=True).order_by("-is_featured", "sort_order", "-created_at")
        return Response({"results": PublicGalleryItemSerializer(rows, many=True, context={"request": request}).data})


class PublicContractorReviewsView(APIView):
    permission_classes = [AllowAny]

    def get(self, request, slug: str):
        profile = _public_profile_or_404(slug)
        if not profile.allow_public_reviews:
            return Response({"results": []})
        rows = profile.reviews.filter(is_public=True).order_by("-is_verified", "-submitted_at", "-created_at")
        return Response({"results": PublicContractorReviewSerializer(rows, many=True).data})

    def post(self, request, slug: str):
        profile = _public_profile_or_404(slug)
        if not profile.allow_public_reviews:
            return Response({"detail": "Public reviews are not enabled for this contractor."}, status=status.HTTP_404_NOT_FOUND)
        serializer = PublicContractorReviewCreateSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        ContractorReview.objects.create(
            contractor=profile.contractor,
            public_profile=profile,
            customer_name=serializer.validated_data["customer_name"],
            rating=serializer.validated_data["rating"],
            title=serializer.validated_data.get("title", ""),
            review_text=serializer.validated_data.get("review_text", ""),
            is_verified=False,
            is_public=False,
        )
        return Response(
            {"ok": True, "message": "Thanks for your review. It will appear after moderation."},
            status=status.HTTP_201_CREATED,
        )


class PublicContractorIntakeView(APIView):
    permission_classes = [AllowAny]
    parser_classes = [MultiPartParser, FormParser, JSONParser]

    def post(self, request, slug: str):
        profile = _public_profile_or_404(slug)
        if not profile.allow_public_intake:
            return Response({"detail": "Public intake is not enabled for this contractor."}, status=status.HTTP_404_NOT_FOUND)
        payload = request.data.copy()
        payload["source"] = normalize_public_lead_source(
            request.data.get("source"),
            default=PublicContractorLead.SOURCE_PUBLIC_PROFILE,
        )
        serializer = PublicContractorLeadCreateSerializer(data=payload)
        serializer.is_valid(raise_exception=True)
        serializer.save(contractor=profile.contractor, public_profile=profile)
        return Response({"ok": True, "message": "Your project request was submitted."}, status=status.HTTP_201_CREATED)


class PublicContractorQrView(APIView):
    permission_classes = [AllowAny]

    def get(self, request, slug: str):
        profile = _public_profile_or_404(slug)
        return Response(_qr_payload(request, profile))
