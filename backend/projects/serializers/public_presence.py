from __future__ import annotations

import base64
from io import BytesIO

from django.utils.text import slugify
from rest_framework import serializers

from projects.models import (
    ContractorGalleryItem,
    ContractorPublicProfile,
    ContractorReview,
    PublicContractorLead,
)


def _abs_media_url(request, file_field) -> str:
    try:
        url = file_field.url if file_field else ""
    except Exception:
        url = ""
    return request.build_absolute_uri(url) if request and url else url


class ContractorPublicProfileSerializer(serializers.ModelSerializer):
    logo_url = serializers.SerializerMethodField()
    cover_image_url = serializers.SerializerMethodField()
    public_url = serializers.SerializerMethodField()

    class Meta:
        model = ContractorPublicProfile
        fields = [
            "id",
            "slug",
            "business_name_public",
            "tagline",
            "bio",
            "logo",
            "logo_url",
            "cover_image",
            "cover_image_url",
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
            "allow_public_intake",
            "allow_public_reviews",
            "is_public",
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

    def get_public_url(self, obj):
        request = self.context.get("request")
        if request is None:
            return obj.public_url_path
        return request.build_absolute_uri(obj.public_url_path)


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
    class Meta:
        model = ContractorReview
        fields = [
            "id",
            "customer_name",
            "rating",
            "title",
            "review_text",
            "is_verified",
            "submitted_at",
        ]


class ContractorReviewSerializer(serializers.ModelSerializer):
    class Meta:
        model = ContractorReview
        fields = [
            "id",
            "agreement",
            "customer_name",
            "rating",
            "title",
            "review_text",
            "is_verified",
            "is_public",
            "submitted_at",
            "created_at",
            "updated_at",
        ]
        read_only_fields = ["id", "created_at", "updated_at", "is_verified"]

    def validate_rating(self, value):
        if value < 1 or value > 5:
            raise serializers.ValidationError("Rating must be between 1 and 5.")
        return value


class PublicContractorReviewCreateSerializer(serializers.ModelSerializer):
    class Meta:
        model = ContractorReview
        fields = [
            "customer_name",
            "rating",
            "title",
            "review_text",
        ]

    def validate_rating(self, value):
        if value < 1 or value > 5:
            raise serializers.ValidationError("Rating must be between 1 and 5.")
        return value


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
            "profile": PublicContractorLead.SOURCE_PUBLIC_PROFILE,
            PublicContractorLead.SOURCE_PUBLIC_PROFILE: PublicContractorLead.SOURCE_PUBLIC_PROFILE,
            PublicContractorLead.SOURCE_LANDING_PAGE: PublicContractorLead.SOURCE_LANDING_PAGE,
            PublicContractorLead.SOURCE_QR: PublicContractorLead.SOURCE_QR,
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


class ContractorPublicLeadSerializer(serializers.ModelSerializer):
    converted_homeowner_id = serializers.PrimaryKeyRelatedField(
        source="converted_homeowner",
        read_only=True,
    )
    converted_homeowner_name = serializers.SerializerMethodField()

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


class PublicContractorProfileSerializer(serializers.ModelSerializer):
    logo_url = serializers.SerializerMethodField()
    cover_image_url = serializers.SerializerMethodField()
    gallery = serializers.SerializerMethodField()
    reviews = serializers.SerializerMethodField()
    average_rating = serializers.SerializerMethodField()
    review_count = serializers.SerializerMethodField()

    class Meta:
        model = ContractorPublicProfile
        fields = [
            "slug",
            "business_name_public",
            "tagline",
            "bio",
            "logo_url",
            "cover_image_url",
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
            "allow_public_intake",
            "allow_public_reviews",
            "seo_title",
            "seo_description",
            "gallery",
            "reviews",
            "average_rating",
            "review_count",
        ]

    def get_logo_url(self, obj):
        return _abs_media_url(self.context.get("request"), obj.logo)

    def get_cover_image_url(self, obj):
        return _abs_media_url(self.context.get("request"), obj.cover_image)

    def get_gallery(self, obj):
        items = obj.gallery_items.filter(is_public=True).order_by("-is_featured", "sort_order", "-created_at")
        return PublicGalleryItemSerializer(items, many=True, context=self.context).data

    def get_reviews(self, obj):
        if not obj.allow_public_reviews:
            return []
        items = obj.reviews.filter(is_public=True).order_by("-is_verified", "-submitted_at", "-created_at")
        return PublicContractorReviewSerializer(items, many=True).data

    def get_average_rating(self, obj):
        ratings = list(obj.reviews.filter(is_public=True).values_list("rating", flat=True))
        if not ratings:
            return None
        return round(sum(ratings) / len(ratings), 2)

    def get_review_count(self, obj):
        return obj.reviews.filter(is_public=True).count()


def make_qr_svg_data(url: str) -> str:
    import qrcode
    import qrcode.image.svg

    image = qrcode.make(url, image_factory=qrcode.image.svg.SvgImage, box_size=8)
    buffer = BytesIO()
    image.save(buffer)
    encoded = base64.b64encode(buffer.getvalue()).decode("ascii")
    return f"data:image/svg+xml;base64,{encoded}"
