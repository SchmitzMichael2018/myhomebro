from __future__ import annotations

from dataclasses import dataclass
from typing import Any

from django.conf import settings

from projects.models import (
    Contractor,
    ContractorGalleryItem,
    ContractorPublicProfile,
    ContractorReview,
    PublicContractorLead,
)
from projects.serializers.public_presence import (
    ContractorGalleryItemSerializer,
    ContractorPublicProfileSerializer,
    ContractorReviewSerializer,
)
from projects.services.compliance import get_public_trust_indicators


FEATURE_PUBLIC_PROFILE = "public_profile"
FEATURE_WEBSITE_BUILDER = "website_builder"
FEATURE_WEBSITE_PUBLISH = "website_publish"
FEATURE_WEBSITE_CUSTOM_DOMAIN = "website_custom_domain"
FEATURE_WEBSITE_AI_COPY = "website_ai_copy"
FEATURE_WEBSITE_ANALYTICS = "website_analytics"
FEATURE_WEBSITE_ADVANCED_SEO = "website_advanced_seo"

WEBSITE_FEATURE_KEYS = (
    FEATURE_PUBLIC_PROFILE,
    FEATURE_WEBSITE_BUILDER,
    FEATURE_WEBSITE_PUBLISH,
    FEATURE_WEBSITE_CUSTOM_DOMAIN,
    FEATURE_WEBSITE_AI_COPY,
    FEATURE_WEBSITE_ANALYTICS,
    FEATURE_WEBSITE_ADVANCED_SEO,
)


def _safe_text(value: Any) -> str:
    return "" if value is None else str(value).strip()


def _safe_list(value: Any) -> list:
    if isinstance(value, list):
        return value
    if isinstance(value, tuple):
        return list(value)
    return []


def _get_or_create_public_profile(contractor: Contractor) -> ContractorPublicProfile:
    profile = getattr(contractor, "public_profile", None)
    if profile is not None:
        return profile
    return ContractorPublicProfile.objects.create(
        contractor=contractor,
        business_name_public=_safe_text(getattr(contractor, "business_name", "")) or _safe_text(getattr(contractor, "name", "")),
        city=_safe_text(getattr(contractor, "city", "")),
        state=_safe_text(getattr(contractor, "state", "")),
        phone_public=_safe_text(getattr(contractor, "phone", "")),
        email_public=_safe_text(getattr(contractor, "email", "")),
        specialties=[skill.name for skill in contractor.skills.all()],
    )


def _setting_enabled(key: str) -> bool:
    flags = getattr(settings, "CONTRACTOR_WEBSITE_FEATURE_DEFAULTS", {}) or {}
    return bool(flags.get(key, False))


@dataclass(frozen=True)
class WebsiteFeature:
    key: str
    enabled: bool
    tier: str
    label: str
    reason: str = ""

    def as_dict(self) -> dict[str, Any]:
        return {
            "key": self.key,
            "enabled": self.enabled,
            "tier": self.tier,
            "label": self.label,
            "reason": self.reason,
        }


def get_contractor_website_entitlements(contractor: Contractor | None = None) -> dict[str, Any]:
    """Current Website Builder gate abstraction.

    This deliberately avoids deprecated billing/AI entitlement models. Future billing can
    replace the flag resolution here without changing API consumers.
    """

    features = {
        FEATURE_PUBLIC_PROFILE: WebsiteFeature(
            FEATURE_PUBLIC_PROFILE,
            True,
            "free",
            "Free public profile",
        ),
        FEATURE_WEBSITE_BUILDER: WebsiteFeature(
            FEATURE_WEBSITE_BUILDER,
            _setting_enabled(FEATURE_WEBSITE_BUILDER),
            "pro",
            "Website Builder",
            "" if _setting_enabled(FEATURE_WEBSITE_BUILDER) else "Upgrade to Pro to customize a multi-section website.",
        ),
        FEATURE_WEBSITE_PUBLISH: WebsiteFeature(
            FEATURE_WEBSITE_PUBLISH,
            _setting_enabled(FEATURE_WEBSITE_PUBLISH),
            "pro",
            "Publish website",
            "" if _setting_enabled(FEATURE_WEBSITE_PUBLISH) else "Publishing is part of the Pro Website Builder.",
        ),
        FEATURE_WEBSITE_CUSTOM_DOMAIN: WebsiteFeature(
            FEATURE_WEBSITE_CUSTOM_DOMAIN,
            _setting_enabled(FEATURE_WEBSITE_CUSTOM_DOMAIN),
            "growth",
            "Custom domain",
            "" if _setting_enabled(FEATURE_WEBSITE_CUSTOM_DOMAIN) else "Custom domains are planned for Growth.",
        ),
        FEATURE_WEBSITE_AI_COPY: WebsiteFeature(
            FEATURE_WEBSITE_AI_COPY,
            _setting_enabled(FEATURE_WEBSITE_AI_COPY),
            "growth",
            "AI website copy",
            "" if _setting_enabled(FEATURE_WEBSITE_AI_COPY) else "AI page copy is planned for Growth.",
        ),
        FEATURE_WEBSITE_ANALYTICS: WebsiteFeature(
            FEATURE_WEBSITE_ANALYTICS,
            _setting_enabled(FEATURE_WEBSITE_ANALYTICS),
            "growth",
            "Website analytics",
            "" if _setting_enabled(FEATURE_WEBSITE_ANALYTICS) else "Analytics are planned for Growth.",
        ),
        FEATURE_WEBSITE_ADVANCED_SEO: WebsiteFeature(
            FEATURE_WEBSITE_ADVANCED_SEO,
            _setting_enabled(FEATURE_WEBSITE_ADVANCED_SEO),
            "growth",
            "Advanced SEO",
            "" if _setting_enabled(FEATURE_WEBSITE_ADVANCED_SEO) else "Advanced SEO controls are planned for Growth.",
        ),
    }
    return {
        "plan": "free",
        "features": {key: features[key].as_dict() for key in WEBSITE_FEATURE_KEYS},
    }


def _checklist_item(key: str, label: str, complete: bool, action: str, required: bool = True) -> dict[str, Any]:
    return {
        "key": key,
        "label": label,
        "complete": bool(complete),
        "required": bool(required),
        "action": action,
    }


def _build_readiness_checklist(
    *,
    contractor: Contractor,
    profile: ContractorPublicProfile,
    gallery_count: int,
    review_count: int,
) -> dict[str, Any]:
    skills = list(contractor.skills.all())
    checklist = [
        _checklist_item(
            "business_name",
            "Add public business name",
            bool(_safe_text(profile.business_name_public) or _safe_text(contractor.business_name)),
            "Add the business name contractors will see publicly.",
        ),
        _checklist_item(
            "tagline",
            "Add a tagline",
            bool(_safe_text(profile.tagline)),
            "Summarize what you do in one short line.",
        ),
        _checklist_item(
            "bio",
            "Add company intro",
            bool(_safe_text(profile.bio)),
            "Tell homeowners what you do and how you work.",
        ),
        _checklist_item(
            "service_area",
            "Confirm service area",
            bool(_safe_text(profile.service_area_text) or _safe_text(profile.city) or _safe_text(contractor.city)),
            "Add a city, state, or service area.",
        ),
        _checklist_item(
            "services",
            "Add services or trades",
            bool(_safe_list(profile.specialties) or _safe_list(profile.work_types) or skills),
            "Add specialties, work types, or contractor skills.",
        ),
        _checklist_item(
            "contact",
            "Add public contact method",
            bool((profile.show_phone_public and _safe_text(profile.phone_public)) or (profile.show_email_public and _safe_text(profile.email_public))),
            "Choose whether phone or email should show publicly.",
            required=False,
        ),
        _checklist_item(
            "branding",
            "Add brand color or image",
            bool(_safe_text(profile.brand_primary_color) or profile.logo or profile.hero_image or profile.cover_image),
            "Add a logo, hero image, or brand color.",
            required=False,
        ),
        _checklist_item(
            "portfolio",
            "Add portfolio photos",
            gallery_count > 0,
            "Add at least one public gallery item.",
            required=False,
        ),
        _checklist_item(
            "reviews",
            "Collect a public review",
            review_count > 0,
            "Ask a past customer for a review.",
            required=False,
        ),
    ]
    complete_count = sum(1 for item in checklist if item["complete"])
    required_items = [item for item in checklist if item["required"]]
    missing_required = [item["key"] for item in required_items if not item["complete"]]
    return {
        "score": round((complete_count / len(checklist)) * 100) if checklist else 0,
        "complete_count": complete_count,
        "total_count": len(checklist),
        "checklist": checklist,
        "missing_required_fields": missing_required,
        "is_ready_for_preview": not missing_required,
    }


def _lead_summary(contractor: Contractor) -> dict[str, int]:
    qs = PublicContractorLead.objects.filter(contractor=contractor)
    return {
        "total": qs.count(),
        "new": qs.filter(status=PublicContractorLead.STATUS_NEW).count(),
        "ready_for_review": qs.filter(status=PublicContractorLead.STATUS_READY_FOR_REVIEW).count(),
        "follow_up": qs.filter(status=PublicContractorLead.STATUS_FOLLOW_UP).count(),
    }


def build_website_profile_payload(
    contractor: Contractor,
    *,
    request=None,
    public_safe: bool = False,
) -> dict[str, Any]:
    contractor = (
        Contractor.objects.select_related("user", "public_profile")
        .prefetch_related("skills")
        .get(pk=contractor.pk)
    )
    profile = _get_or_create_public_profile(contractor)
    profile_data = ContractorPublicProfileSerializer(profile, context={"request": request}).data

    gallery_qs = ContractorGalleryItem.objects.filter(contractor=contractor, public_profile=profile)
    reviews_qs = ContractorReview.objects.filter(
        contractor=contractor,
        public_profile=profile,
        is_public=True,
        moderation_status=ContractorReview.MODERATION_APPROVED,
    )
    if public_safe:
        gallery_qs = gallery_qs.filter(is_public=True)
    gallery_items = ContractorGalleryItemSerializer(gallery_qs[:12], many=True, context={"request": request}).data
    selected_reviews = ContractorReviewSerializer(reviews_qs[:6], many=True, context={"request": request}).data

    review_count = reviews_qs.count()
    average_rating = None
    if review_count:
        ratings = [int(row.rating) for row in reviews_qs if row.rating]
        average_rating = round(sum(ratings) / len(ratings), 2) if ratings else None
    gallery_count = gallery_qs.count()
    readiness = _build_readiness_checklist(
        contractor=contractor,
        profile=profile,
        gallery_count=gallery_count,
        review_count=review_count,
    )

    skills = [skill.name for skill in contractor.skills.all()]
    phone = profile.phone_public if profile.show_phone_public else ""
    email = profile.email_public if profile.show_email_public else ""
    trust_indicators = get_public_trust_indicators(
        contractor,
        show_license_public=bool(getattr(profile, "show_license_public", False)),
    )

    return {
        "contractor_id": contractor.id,
        "profile_id": profile.id,
        "slug": profile.slug,
        "public_url": profile_data.get("public_url", profile.public_url_path),
        "is_public": bool(profile.is_public),
        "identity": {
            "business_name": profile.business_name_public or contractor.business_name or contractor.name or "",
            "contractor_business_name": contractor.business_name or "",
            "tagline": profile.tagline or "",
            "bio": profile.bio or "",
        },
        "branding": {
            "logo_url": profile_data.get("logo_url", ""),
            "hero_image_url": profile_data.get("hero_image_url", ""),
            "cover_image_url": profile_data.get("cover_image_url", ""),
            "brand_primary_color": profile.brand_primary_color or "",
            "brand_accent_color": profile.brand_accent_color or "",
            "brand_font_theme": profile.brand_font_theme or "",
            "profile_theme": profile.profile_theme or "",
        },
        "service_area": {
            "city": profile.city or contractor.city or "",
            "state": profile.state or contractor.state or "",
            "service_area_text": profile.service_area_text or "",
            "service_radius_miles": getattr(contractor, "service_radius_miles", None),
        },
        "services": {
            "specialties": _safe_list(profile.specialties),
            "work_types": _safe_list(profile.work_types),
            "skills": skills,
        },
        "contact": {
            "phone_public": phone,
            "email_public": email,
            "show_phone_public": bool(profile.show_phone_public),
            "show_email_public": bool(profile.show_email_public),
            "allow_public_intake": bool(profile.allow_public_intake),
            "show_quote_cta": bool(profile.show_quote_cta),
            "website_url": profile.website_url or "",
        },
        "trust": {
            "show_license_public": bool(profile.show_license_public),
            "has_license_on_file": bool(getattr(contractor, "license_number", "") or getattr(contractor, "license_file", None)),
            "has_insurance_on_file": bool(getattr(contractor, "insurance_file", None)),
            "marketplace_verification_status": getattr(contractor, "marketplace_verification_status", ""),
            "indicators": trust_indicators,
        },
        "reviews": {
            "average_rating": average_rating,
            "count": review_count,
            "selected": selected_reviews,
        },
        "gallery": {
            "count": gallery_count,
            "items": gallery_items,
        },
        "lead_intake": _lead_summary(contractor),
        "seo": {
            "title": profile.seo_title or "",
            "description": profile.seo_description or "",
        },
        "readiness": readiness,
    }


def get_website_recommended_next_steps(readiness: dict[str, Any], entitlements: dict[str, Any]) -> list[dict[str, str]]:
    steps = []
    for item in readiness.get("checklist", []):
        if not item.get("complete"):
            steps.append({"key": item["key"], "label": item["label"], "action": item["action"]})
        if len(steps) >= 3:
            break
    builder = entitlements.get("features", {}).get(FEATURE_WEBSITE_BUILDER, {})
    if not builder.get("enabled"):
        steps.append(
            {
                "key": "upgrade_pro",
                "label": "Upgrade to unlock the Website Builder",
                "action": builder.get("reason") or "Website Builder customization is a Pro feature.",
            }
        )
    return steps


def build_contractor_website_payload(contractor: Contractor, *, request=None) -> dict[str, Any]:
    entitlements = get_contractor_website_entitlements(contractor)
    profile_payload = build_website_profile_payload(contractor, request=request, public_safe=False)
    readiness = profile_payload["readiness"]
    return {
        "entitlements": entitlements,
        "profile": profile_payload,
        "readiness": readiness,
        "draft": {
            "status": "placeholder",
            "template_key": "profile_foundation",
            "has_draft": False,
            "message": "Website Builder drafts are not enabled yet.",
        },
        "recommended_next_steps": get_website_recommended_next_steps(readiness, entitlements),
    }


def build_contractor_website_preview_payload(contractor: Contractor, *, request=None) -> dict[str, Any]:
    entitlements = get_contractor_website_entitlements(contractor)
    profile_payload = build_website_profile_payload(contractor, request=request, public_safe=True)
    return {
        "entitlements": entitlements,
        "preview": {
            "mode": "profile_foundation",
            "can_publish": False,
            "publish_disabled_reason": entitlements["features"][FEATURE_WEBSITE_PUBLISH]["reason"],
            "public_safe": True,
        },
        "profile": profile_payload,
        "readiness": profile_payload["readiness"],
    }
