from __future__ import annotations

import base64
from io import BytesIO

from django.utils.text import slugify
from rest_framework import serializers

from projects.models import (
    Invoice,
    ContractorGalleryItem,
    ContractorPublicProfile,
    ContractorReview,
    Milestone,
    PublicContractorLead,
)
from projects.models_project_intake import ProjectIntake
from projects.services.compliance import get_public_trust_indicators
from projects.services.contractor_capabilities import get_contractor_capability_flags
from projects.services.contractor_matching import (
    build_contractor_compatibility_profile,
    score_contractor_project_match,
)
from projects.services.contractor_profile_insights import get_contractor_profile_insights


def _abs_media_url(request, file_field) -> str:
    try:
        url = file_field.url if file_field else ""
    except Exception:
        url = ""
    return request.build_absolute_uri(url) if request and url else url


def _safe_text(value):
    return "" if value is None else str(value).strip()


def _safe_dict(value):
    return value if isinstance(value, dict) else {}


class ContractorPublicProfileSerializer(serializers.ModelSerializer):
    logo_url = serializers.SerializerMethodField()
    cover_image_url = serializers.SerializerMethodField()
    hero_image_url = serializers.SerializerMethodField()
    public_url = serializers.SerializerMethodField()
    public_trust_indicators = serializers.SerializerMethodField()
    contractor_profile_insights = serializers.SerializerMethodField()
    accepts_diy_assistance = serializers.SerializerMethodField()
    accepts_consultation_only = serializers.SerializerMethodField()
    accepts_inspection_only = serializers.SerializerMethodField()

    class Meta:
        model = ContractorPublicProfile
        fields = [
            "id",
            "slug",
            "business_name_public",
            "tagline",
            "bio",
            "proposal_tone",
            "preferred_signoff",
            "brand_primary_color",
            "brand_accent_color",
            "brand_font_theme",
            "profile_theme",
            "logo",
            "logo_url",
            "cover_image",
            "cover_image_url",
            "hero_image",
            "hero_image_url",
            "city",
            "state",
            "service_area_text",
            "years_in_business",
            "website_url",
            "phone_public",
            "email_public",
            "specialties",
            "work_types",
            "show_license_public",
            "show_phone_public",
            "show_email_public",
            "show_reviews",
            "show_gallery",
            "show_quote_cta",
            "allow_public_intake",
            "allow_public_reviews",
            "is_public",
            "public_trust_indicators",
            "contractor_profile_insights",
            "accepts_diy_assistance",
            "accepts_consultation_only",
            "accepts_inspection_only",
            "seo_title",
            "seo_description",
            "public_url",
            "created_at",
            "updated_at",
        ]
        read_only_fields = ["id", "created_at", "updated_at", "public_url"]

    def validate_slug(self, value):
        slug = slugify(value or "").strip("-")
        if not slug:
            raise serializers.ValidationError("Slug is required.")
        qs = ContractorPublicProfile.objects.filter(slug=slug)
        if self.instance is not None:
            qs = qs.exclude(pk=self.instance.pk)
        if qs.exists():
            raise serializers.ValidationError("This slug is already in use.")
        return slug

    def get_logo_url(self, obj):
        return _abs_media_url(self.context.get("request"), obj.logo)

    def get_cover_image_url(self, obj):
        return _abs_media_url(self.context.get("request"), obj.cover_image)

    def get_hero_image_url(self, obj):
        return _abs_media_url(self.context.get("request"), obj.hero_image)

    def get_public_url(self, obj):
        request = self.context.get("request")
        if request is None:
            return obj.public_url_path
        return request.build_absolute_uri(obj.public_url_path)

    def get_public_trust_indicators(self, obj):
        return get_public_trust_indicators(
            getattr(obj, "contractor", None),
            show_license_public=bool(getattr(obj, "show_license_public", False)),
        )

    def get_contractor_profile_insights(self, obj):
        contractor = getattr(obj, "contractor", None)
        contractor_id = getattr(contractor, "id", None)
        if not contractor_id:
            return []
        return get_contractor_profile_insights(contractor_id)

    def get_accepts_diy_assistance(self, obj):
        return bool(get_contractor_capability_flags(getattr(obj, "contractor", None))["accepts_diy_assistance"])

    def get_accepts_consultation_only(self, obj):
        contractor = getattr(obj, "contractor", None)
        return bool(getattr(contractor, "accepts_consultation_only", False))

    def get_accepts_inspection_only(self, obj):
        contractor = getattr(obj, "contractor", None)
        return bool(getattr(contractor, "accepts_inspection_only", False))


class PublicGalleryItemSerializer(serializers.ModelSerializer):
    image_url = serializers.SerializerMethodField()

    class Meta:
        model = ContractorGalleryItem
        fields = [
            "id",
            "title",
            "description",
            "category",
            "image_url",
            "is_featured",
            "sort_order",
            "project_city",
            "project_state",
            "created_at",
        ]

    def get_image_url(self, obj):
        return _abs_media_url(self.context.get("request"), obj.image)


class ContractorGalleryItemSerializer(serializers.ModelSerializer):
    image_url = serializers.SerializerMethodField()

    class Meta:
        model = ContractorGalleryItem
        fields = [
            "id",
            "title",
            "description",
            "category",
            "image",
            "image_url",
            "is_featured",
            "is_public",
            "sort_order",
            "project_city",
            "project_state",
            "created_at",
        ]
        read_only_fields = ["id", "created_at", "image_url"]

    def get_image_url(self, obj):
        return _abs_media_url(self.context.get("request"), obj.image)


class PublicContractorReviewSerializer(serializers.ModelSerializer):
    linked_invoice_id = serializers.IntegerField(read_only=True)
    linked_milestone_id = serializers.IntegerField(read_only=True)

    class Meta:
        model = ContractorReview
        fields = [
            "id",
            "customer_name",
            "rating",
            "title",
            "review_text",
            "is_verified",
            "published_at",
            "linked_invoice_id",
            "linked_milestone_id",
            "submitted_at",
        ]


class ContractorReviewSerializer(serializers.ModelSerializer):
    linked_invoice = serializers.PrimaryKeyRelatedField(
        queryset=Invoice.objects.select_related("agreement", "agreement__project"),
        required=False,
        allow_null=True,
    )
    linked_milestone = serializers.PrimaryKeyRelatedField(
        queryset=Milestone.objects.select_related("agreement", "agreement__project"),
        required=False,
        allow_null=True,
    )

    class Meta:
        model = ContractorReview
        fields = [
            "id",
            "agreement",
            "linked_invoice",
            "linked_milestone",
            "homeowner",
            "customer_email",
            "project_type",
            "project_subtype",
            "customer_name",
            "rating",
            "title",
            "review_text",
            "moderation_status",
            "moderation_notes",
            "published_at",
            "is_verified",
            "is_public",
            "submitted_at",
            "created_at",
            "updated_at",
        ]
        read_only_fields = ["id", "created_at", "updated_at", "is_verified", "published_at"]

    def validate_rating(self, value):
        if value < 1 or value > 5:
            raise serializers.ValidationError("Rating must be between 1 and 5.")
        return value


class PublicContractorReviewCreateSerializer(serializers.ModelSerializer):
    linked_invoice = serializers.PrimaryKeyRelatedField(
        queryset=Invoice.objects.select_related("agreement", "agreement__project"),
        required=False,
        allow_null=True,
    )
    linked_milestone = serializers.PrimaryKeyRelatedField(
        queryset=Milestone.objects.select_related("agreement", "agreement__project"),
        required=False,
        allow_null=True,
    )

    class Meta:
        model = ContractorReview
        fields = [
            "customer_name",
            "rating",
            "title",
            "review_text",
            "linked_invoice",
            "linked_milestone",
        ]

    def validate_rating(self, value):
        if value < 1 or value > 5:
            raise serializers.ValidationError("Rating must be between 1 and 5.")
        return value

    def validate(self, attrs):
        linked_invoice = attrs.get("linked_invoice")
        linked_milestone = attrs.get("linked_milestone")
        contractor = self.context.get("contractor")
        contractor_id = getattr(contractor, "id", None)
        if contractor_id and linked_invoice and linked_invoice.agreement.project.contractor_id != contractor_id:
            raise serializers.ValidationError({"linked_invoice": "Linked invoice must belong to this contractor."})
        if contractor_id and linked_milestone and linked_milestone.agreement.project.contractor_id != contractor_id:
            raise serializers.ValidationError({"linked_milestone": "Linked milestone must belong to this contractor."})
        if linked_invoice and linked_milestone:
            invoice_agreement_id = getattr(linked_invoice, "agreement_id", None)
            milestone_agreement_id = getattr(linked_milestone, "agreement_id", None)
            if invoice_agreement_id and milestone_agreement_id and invoice_agreement_id != milestone_agreement_id:
                raise serializers.ValidationError(
                    {"linked_milestone": "Linked invoice and milestone must belong to the same agreement."}
                )
        return attrs


class PublicContractorQuoteRequestSerializer(serializers.Serializer):
    full_name = serializers.CharField(max_length=255)
    email = serializers.EmailField()
    phone = serializers.CharField(max_length=40, required=False, allow_blank=True)
    preferred_contact_method = serializers.CharField(max_length=32, required=False, allow_blank=True)
    contact_consent = serializers.BooleanField(required=False, default=False)
    project_class = serializers.ChoiceField(choices=ProjectIntake.PROJECT_CLASS_CHOICES, required=False)
    project_mode = serializers.ChoiceField(choices=ProjectIntake.PROJECT_MODE_CHOICES, required=False)
    payment_preference = serializers.ChoiceField(choices=ProjectIntake.PAYMENT_PREFERENCE_CHOICES, required=False)
    property_type = serializers.CharField(max_length=120, required=False, allow_blank=True)
    desired_timing_text = serializers.CharField(max_length=120, required=False, allow_blank=True)
    project_type = serializers.CharField(max_length=120, required=False, allow_blank=True)
    project_subtype = serializers.CharField(max_length=120, required=False, allow_blank=True)
    raw_description = serializers.CharField(required=False, allow_blank=True)
    refined_description = serializers.CharField(required=False, allow_blank=True)
    ai_project_timeline_days = serializers.IntegerField(required=False, allow_null=True)
    budget_range_text = serializers.CharField(max_length=120, required=False, allow_blank=True)
    ai_project_budget = serializers.DecimalField(max_digits=12, decimal_places=2, required=False, allow_null=True)
    homeowner_participation_notes = serializers.CharField(required=False, allow_blank=True)
    homeowner_started_work = serializers.BooleanField(required=False, default=False)
    project_address_line1 = serializers.CharField(max_length=255, required=False, allow_blank=True)
    project_address_line2 = serializers.CharField(max_length=255, required=False, allow_blank=True)
    project_city = serializers.CharField(max_length=120, required=False, allow_blank=True)
    project_state = serializers.CharField(max_length=50, required=False, allow_blank=True)
    project_postal_code = serializers.CharField(max_length=20, required=False, allow_blank=True)
    ai_clarification_questions = serializers.JSONField(required=False)
    ai_clarification_answers = serializers.JSONField(required=False)
    ai_analysis_payload = serializers.JSONField(required=False)

    def validate(self, attrs):
        if not (attrs.get("email") or attrs.get("phone")):
            raise serializers.ValidationError({"email": "Email or phone is required."})
        if not bool(attrs.get("contact_consent", False)):
            raise serializers.ValidationError(
                {"contact_consent": "Please confirm that the contractor may contact you about this request."}
            )
        return attrs


class PublicContractorLeadCreateSerializer(serializers.ModelSerializer):
    class Meta:
        model = PublicContractorLead
        fields = [
            "source",
            "full_name",
            "email",
            "phone",
            "project_address",
            "city",
            "state",
            "zip_code",
            "project_type",
            "project_description",
            "preferred_timeline",
            "budget_text",
        ]

    def validate_source(self, value):
        mapping = {
            "website": PublicContractorLead.SOURCE_WEBSITE,
            "website_contact": PublicContractorLead.SOURCE_WEBSITE,
            "website_quote": PublicContractorLead.SOURCE_WEBSITE,
            "website_quote_cta": PublicContractorLead.SOURCE_WEBSITE,
            "profile": PublicContractorLead.SOURCE_PUBLIC_PROFILE,
            PublicContractorLead.SOURCE_PUBLIC_PROFILE: PublicContractorLead.SOURCE_PUBLIC_PROFILE,
            PublicContractorLead.SOURCE_WEBSITE: PublicContractorLead.SOURCE_WEBSITE,
            PublicContractorLead.SOURCE_QUOTE_REQUEST: PublicContractorLead.SOURCE_QUOTE_REQUEST,
            PublicContractorLead.SOURCE_LANDING_PAGE: PublicContractorLead.SOURCE_LANDING_PAGE,
            PublicContractorLead.SOURCE_MANUAL: PublicContractorLead.SOURCE_MANUAL,
            PublicContractorLead.SOURCE_QR: PublicContractorLead.SOURCE_QR,
            PublicContractorLead.SOURCE_CONTRACTOR_SENT_FORM: PublicContractorLead.SOURCE_CONTRACTOR_SENT_FORM,
            PublicContractorLead.SOURCE_DIRECT: PublicContractorLead.SOURCE_DIRECT,
        }
        normalized = mapping.get(value)
        if normalized is None:
            raise serializers.ValidationError("Invalid source.")
        return normalized

    def validate(self, attrs):
        if not (attrs.get("email") or attrs.get("phone")):
            raise serializers.ValidationError("Email or phone is required.")
        return attrs


class ContractorManualLeadCreateSerializer(serializers.ModelSerializer):
    notes = serializers.CharField(write_only=True, required=False, allow_blank=True)

    class Meta:
        model = PublicContractorLead
        fields = [
            "full_name",
            "email",
            "phone",
            "project_address",
            "city",
            "state",
            "zip_code",
            "notes",
        ]

    def validate(self, attrs):
        if not (attrs.get("email") or attrs.get("phone")):
            raise serializers.ValidationError("Email or phone is required.")
        if not (attrs.get("full_name") or "").strip():
            raise serializers.ValidationError({"full_name": "Name is required."})
        return attrs

    def create(self, validated_data):
        notes = (validated_data.pop("notes", "") or "").strip()
        return PublicContractorLead.objects.create(
            source=PublicContractorLead.SOURCE_MANUAL,
            status=PublicContractorLead.STATUS_QUALIFIED,
            project_description=notes,
            **validated_data,
        )


class ContractorPublicLeadSerializer(serializers.ModelSerializer):
    converted_homeowner_id = serializers.PrimaryKeyRelatedField(
        source="converted_homeowner",
        read_only=True,
    )
    converted_homeowner_name = serializers.SerializerMethodField()
    source_intake_id = serializers.SerializerMethodField()
    matching = serializers.SerializerMethodField()

    class Meta:
        model = PublicContractorLead
        fields = [
            "id",
            "source",
            "full_name",
            "email",
            "phone",
            "project_address",
            "city",
            "state",
            "zip_code",
            "project_type",
            "project_description",
            "preferred_timeline",
            "budget_text",
            "status",
            "internal_notes",
            "accepted_at",
            "accepted_email_sent_at",
            "rejected_at",
            "rejected_email_sent_at",
            "ai_analysis",
            "matching",
            "source_intake_id",
            "converted_homeowner_id",
            "converted_homeowner_name",
            "converted_agreement",
            "converted_at",
            "created_at",
            "updated_at",
        ]
        read_only_fields = [
            "id",
            "created_at",
            "updated_at",
            "accepted_at",
            "accepted_email_sent_at",
            "rejected_at",
            "rejected_email_sent_at",
            "ai_analysis",
            "converted_homeowner_id",
            "converted_homeowner_name",
            "converted_agreement",
            "converted_at",
        ]

    def get_converted_homeowner_name(self, obj):
        homeowner = getattr(obj, "converted_homeowner", None)
        return homeowner.full_name if homeowner else ""

    def get_source_intake_id(self, obj):
        source_intake = getattr(obj, "source_intake", None)
        return getattr(source_intake, "id", None)

    def get_matching(self, obj):
        contractor = getattr(obj, "contractor", None)
        if contractor is None:
            return {}
        analysis = _safe_dict(getattr(obj, "ai_analysis", {}))
        project_payload = {
            "project_title": _safe_text(analysis.get("project_title") or obj.project_type),
            "project_type": _safe_text(analysis.get("project_type") or obj.project_type),
            "project_subtype": _safe_text(analysis.get("project_subtype", "")),
            "description": _safe_text(analysis.get("project_scope_summary") or obj.project_description),
            "project_scope_summary": _safe_text(analysis.get("project_scope_summary") or obj.project_description),
            "project_mode": _safe_text(analysis.get("project_mode") or getattr(obj, "project_mode", "")),
            "payment_preference": _safe_text(analysis.get("payment_preference") or "escrow"),
            "project_city": _safe_text(getattr(obj, "city", "")),
            "project_state": _safe_text(getattr(obj, "state", "")),
            "homeowner_participation_notes": _safe_text(analysis.get("homeowner_participation_notes")),
            "homeowner_started_work": bool(analysis.get("homeowner_started_work", False)),
            "homeowner_task_summary": _safe_text(analysis.get("homeowner_task_summary")),
            "homeowner_assistance_summary": _safe_text(analysis.get("homeowner_assistance_summary")),
            "milestones": analysis.get("milestones") if isinstance(analysis.get("milestones"), list) else [],
        }
        return score_contractor_project_match(
            contractor,
            project_payload,
            profile=getattr(contractor, "public_profile", None),
        )


class PublicContractorProfileSerializer(serializers.ModelSerializer):
    logo_url = serializers.SerializerMethodField()
    cover_image_url = serializers.SerializerMethodField()
    hero_image_url = serializers.SerializerMethodField()
    gallery = serializers.SerializerMethodField()
    reviews = serializers.SerializerMethodField()
    average_rating = serializers.SerializerMethodField()
    review_count = serializers.SerializerMethodField()
    public_trust_indicators = serializers.SerializerMethodField()
    contractor_profile_insights = serializers.SerializerMethodField()
    compatibility_profile = serializers.SerializerMethodField()
    compatibility_badges = serializers.SerializerMethodField()
    ways_i_work = serializers.SerializerMethodField()
    compatibility_summary = serializers.SerializerMethodField()
    accepts_diy_assistance = serializers.SerializerMethodField()
    accepts_consultation_only = serializers.SerializerMethodField()
    accepts_inspection_only = serializers.SerializerMethodField()

    class Meta:
        model = ContractorPublicProfile
        fields = [
            "slug",
            "business_name_public",
            "tagline",
            "bio",
            "proposal_tone",
            "preferred_signoff",
            "brand_primary_color",
            "brand_accent_color",
            "brand_font_theme",
            "profile_theme",
            "logo_url",
            "cover_image_url",
            "hero_image_url",
            "city",
            "state",
            "service_area_text",
            "years_in_business",
            "website_url",
            "phone_public",
            "email_public",
            "specialties",
            "work_types",
            "show_license_public",
            "show_phone_public",
            "show_email_public",
            "show_reviews",
            "show_gallery",
            "show_quote_cta",
            "allow_public_intake",
            "allow_public_reviews",
            "seo_title",
            "seo_description",
            "gallery",
            "reviews",
            "average_rating",
            "review_count",
            "public_trust_indicators",
            "contractor_profile_insights",
            "compatibility_profile",
            "compatibility_badges",
            "ways_i_work",
            "compatibility_summary",
            "accepts_diy_assistance",
            "accepts_consultation_only",
            "accepts_inspection_only",
        ]

    def get_logo_url(self, obj):
        return _abs_media_url(self.context.get("request"), obj.logo)

    def get_cover_image_url(self, obj):
        return _abs_media_url(self.context.get("request"), obj.cover_image)

    def get_hero_image_url(self, obj):
        return _abs_media_url(self.context.get("request"), obj.hero_image)

    def get_gallery(self, obj):
        items = obj.gallery_items.filter(is_public=True).order_by("-is_featured", "sort_order", "-created_at")
        return PublicGalleryItemSerializer(items, many=True, context=self.context).data

    def get_reviews(self, obj):
        if not obj.allow_public_reviews:
            return []
        items = obj.reviews.filter(is_public=True).order_by("-is_verified", "-submitted_at", "-created_at")
        return PublicContractorReviewSerializer(items, many=True).data

    def get_average_rating(self, obj):
        contractor = getattr(obj, "contractor", None)
        if contractor is None:
            return None
        count = int(getattr(contractor, "review_count", 0) or 0)
        if count <= 0:
            ratings = list(obj.reviews.filter(is_verified=True, is_public=True).values_list("rating", flat=True))
            if not ratings:
                return None
            return round(sum(ratings) / len(ratings), 2)
        return round(float(getattr(contractor, "average_rating", 0) or 0), 2)

    def get_review_count(self, obj):
        contractor = getattr(obj, "contractor", None)
        if contractor is None:
            return 0
        count = int(getattr(contractor, "review_count", 0) or 0)
        if count <= 0:
            return obj.reviews.filter(is_verified=True, is_public=True).count()
        return count

    def get_accepts_diy_assistance(self, obj):
        return bool(get_contractor_capability_flags(getattr(obj, "contractor", None))["accepts_diy_assistance"])

    def get_accepts_consultation_only(self, obj):
        contractor = getattr(obj, "contractor", None)
        return bool(getattr(contractor, "accepts_consultation_only", False))

    def get_accepts_inspection_only(self, obj):
        contractor = getattr(obj, "contractor", None)
        return bool(getattr(contractor, "accepts_inspection_only", False))

    def get_public_trust_indicators(self, obj):
        return get_public_trust_indicators(
            getattr(obj, "contractor", None),
            show_license_public=bool(getattr(obj, "show_license_public", False)),
        )

    def get_contractor_profile_insights(self, obj):
        contractor = getattr(obj, "contractor", None)
        contractor_id = getattr(contractor, "id", None)
        if not contractor_id:
            return []
        return get_contractor_profile_insights(contractor_id)

    def get_compatibility_profile(self, obj):
        contractor = getattr(obj, "contractor", None)
        if contractor is None:
            return {}
        return build_contractor_compatibility_profile(contractor, profile=obj)

    def get_compatibility_badges(self, obj):
        profile = self.get_compatibility_profile(obj)
        return list(profile.get("badges") or [])

    def get_ways_i_work(self, obj):
        profile = self.get_compatibility_profile(obj)
        return list(profile.get("ways_i_work") or [])

    def get_compatibility_summary(self, obj):
        profile = self.get_compatibility_profile(obj)
        return _safe_text(profile.get("summary"))


def make_qr_svg_data(url: str) -> str:
    import qrcode
    import qrcode.image.svg

    image = qrcode.make(url, image_factory=qrcode.image.svg.SvgImage, box_size=8)
    buffer = BytesIO()
    image.save(buffer)
    encoded = base64.b64encode(buffer.getvalue()).decode("ascii")
    return f"data:image/svg+xml;base64,{encoded}"
