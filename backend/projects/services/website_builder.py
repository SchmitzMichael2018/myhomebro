from __future__ import annotations

from dataclasses import dataclass
from datetime import timedelta
from typing import Any

from django.conf import settings
from django.utils import timezone

from projects.models import (
    Contractor,
    ContractorGalleryItem,
    ContractorPublicProfile,
    ContractorReview,
    ContractorWebsite,
    ContractorWebsitePage,
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

MINIMUM_PUBLISH_READINESS_SCORE = 60
DEFAULT_WEBSITE_TRIAL_DAYS = 14

ACCESS_FREE_PROFILE = "free_profile"
ACCESS_TRIAL_ACTIVE = "website_trial_active"
ACCESS_TRIAL_EXPIRED = "website_trial_expired"
ACCESS_PRO_ACTIVE = "website_pro_active"
ACCESS_GROWTH_ACTIVE = "website_growth_active"

WEBSITE_AI_ACTIONS = {
    "suggest_palette",
    "suggest_font_theme",
    "generate_tagline",
    "generate_hero_headline",
    "generate_hero_subheadline",
    "rewrite_hero_copy",
    "friendly_hero_copy",
    "premium_hero_copy",
    "commercial_hero_copy",
    "generate_service_descriptions",
    "improve_service_description",
    "suggest_missing_services",
    "generate_photo_caption",
    "suggest_featured_reviews",
    "generate_trust_summary",
    "improve_contact_cta",
    "generate_contact_intro",
    "generate_seo_title",
    "generate_seo_description",
}

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


def _safe_dict(value: Any) -> dict:
    return value if isinstance(value, dict) else {}


def _merge_dict(base: dict, updates: dict, allowed: set[str] | None = None) -> dict:
    out = dict(base or {})
    for key, value in (updates or {}).items():
        if allowed is not None and key not in allowed:
            continue
        if isinstance(value, dict) and isinstance(out.get(key), dict):
            out[key] = _merge_dict(out.get(key) or {}, value)
        else:
            out[key] = value
    return out


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


TEMPLATE_PRESETS = {
    ContractorWebsite.TEMPLATE_STARTER: {
        "label": "Starter",
        "layout_style": "balanced",
        "typography_style": "clean_sans",
        "card_style": "soft",
        "section_order": ["hero", "services", "trust", "portfolio", "reviews", "contact"],
    },
    ContractorWebsite.TEMPLATE_MODERN_TRADE: {
        "label": "Modern Trade",
        "layout_style": "bold_trade",
        "typography_style": "modern_sans",
        "card_style": "crisp",
        "section_order": ["hero", "trust", "services", "portfolio", "reviews", "contact"],
    },
    ContractorWebsite.TEMPLATE_PREMIUM_HOME: {
        "label": "Premium Home",
        "layout_style": "editorial_home",
        "typography_style": "warm_serif",
        "card_style": "premium",
        "section_order": ["hero", "portfolio", "services", "reviews", "trust", "contact"],
    },
    ContractorWebsite.TEMPLATE_COMMERCIAL: {
        "label": "Commercial",
        "layout_style": "structured_commercial",
        "typography_style": "compact_sans",
        "card_style": "structured",
        "section_order": ["hero", "services", "trust", "reviews", "portfolio", "contact"],
    },
    "luxury_remodel": {
        "label": "Luxury Remodel",
        "layout_style": "editorial_luxury",
        "typography_style": "warm_serif",
        "card_style": "premium",
        "section_order": ["hero", "portfolio", "reviews", "services", "trust", "contact"],
    },
    "bold_contractor": {
        "label": "Bold Contractor",
        "layout_style": "bold_trade",
        "typography_style": "bold_sans",
        "card_style": "crisp",
        "section_order": ["hero", "trust", "services", "contact", "portfolio", "reviews"],
    },
    "clean_local_service": {
        "label": "Clean Local Service",
        "layout_style": "local_service",
        "typography_style": "clean_sans",
        "card_style": "soft",
        "section_order": ["hero", "services", "trust", "contact", "reviews", "portfolio"],
    },
}

SECTION_KEYS = ["hero", "services", "portfolio", "reviews", "trust", "contact"]


def _default_homepage_layout(profile_payload: dict[str, Any], template_key: str = ContractorWebsite.TEMPLATE_STARTER) -> dict[str, Any]:
    preset = TEMPLATE_PRESETS.get(template_key, TEMPLATE_PRESETS[ContractorWebsite.TEMPLATE_STARTER])
    branding = _safe_dict(profile_payload.get("branding"))
    return {
        "template": preset,
        "branding": {
            "primary_color": branding.get("brand_primary_color") or "#0f172a",
            "accent_color": branding.get("brand_accent_color") or "#2563eb",
            "font_theme": branding.get("brand_font_theme") or preset["typography_style"],
            "profile_theme": branding.get("profile_theme") or template_key,
            "logo_url": branding.get("logo_url") or "",
            "hero_image_url": branding.get("hero_image_url") or "",
            "cover_image_url": branding.get("cover_image_url") or "",
        },
        "sections": {
            "hero": True,
            "services": True,
            "portfolio": True,
            "reviews": True,
            "trust": True,
            "contact": True,
        },
        "section_order": list(preset["section_order"]),
    }


def _default_page_blocks(page_type: str, profile_payload: dict[str, Any]) -> dict[str, Any]:
    identity = _safe_dict(profile_payload.get("identity"))
    services = _safe_dict(profile_payload.get("services"))
    service_area = _safe_dict(profile_payload.get("service_area"))
    business_name = identity.get("business_name") or "Your Business"
    service_names = services.get("specialties") or services.get("work_types") or services.get("skills") or []
    service_text = ", ".join(service_names[:4]) if service_names else "home improvement and project services"
    area = service_area.get("service_area_text") or ", ".join(part for part in [service_area.get("city"), service_area.get("state")] if part)
    if page_type == ContractorWebsitePage.PAGE_HOME:
        return {
            "hero": {
                "headline": f"{business_name} builds projects homeowners can trust.",
                "subheadline": identity.get("tagline") or identity.get("bio") or f"Professional {service_text} for {area or 'your service area'}.",
                "cta_text": "Request a Quote",
            },
            "about": {
                "body": identity.get("bio") or f"{business_name} helps customers plan, price, and complete work with clear communication.",
            },
        }
    if page_type == ContractorWebsitePage.PAGE_SERVICES:
        return {
            "services": {
                "heading": "Services",
                "intro": f"Focused support for {service_text}.",
                "items": [
                    {"title": name, "description": f"Professional {name.lower()} with clear scope, milestones, and communication."}
                    for name in service_names[:6]
                ],
            },
        }
    if page_type == ContractorWebsitePage.PAGE_GALLERY:
        return {"portfolio": {"heading": "Project Portfolio", "intro": "A look at public project photos and featured work."}}
    if page_type == ContractorWebsitePage.PAGE_REVIEWS:
        return {"reviews": {"heading": "Customer Reviews", "intro": "Feedback from homeowners and clients."}}
    return {
        "contact": {
            "heading": "Contact",
            "body": "Share a few project details and we will follow up with next steps.",
            "cta_text": "Start Your Project",
            "intake_intro": "Tell us what you want done, where the project is, and how soon you would like to start.",
            "lead_form_enabled": True,
        },
    }


def _default_pages(profile_payload: dict[str, Any]) -> list[dict[str, Any]]:
    return [
        {
            "page_type": ContractorWebsitePage.PAGE_HOME,
            "slug": "home",
            "title": "Home",
            "seo_title": profile_payload.get("seo", {}).get("title") or profile_payload.get("identity", {}).get("business_name") or "Home",
            "seo_description": profile_payload.get("seo", {}).get("description") or "",
            "content_blocks": _default_page_blocks(ContractorWebsitePage.PAGE_HOME, profile_payload),
            "sort_order": 0,
        },
        {
            "page_type": ContractorWebsitePage.PAGE_SERVICES,
            "slug": "services",
            "title": "Services",
            "seo_title": "Services",
            "seo_description": "",
            "content_blocks": _default_page_blocks(ContractorWebsitePage.PAGE_SERVICES, profile_payload),
            "sort_order": 1,
        },
        {
            "page_type": ContractorWebsitePage.PAGE_GALLERY,
            "slug": "gallery",
            "title": "Gallery",
            "seo_title": "Gallery",
            "seo_description": "",
            "content_blocks": _default_page_blocks(ContractorWebsitePage.PAGE_GALLERY, profile_payload),
            "sort_order": 2,
        },
        {
            "page_type": ContractorWebsitePage.PAGE_REVIEWS,
            "slug": "reviews",
            "title": "Reviews",
            "seo_title": "Reviews",
            "seo_description": "",
            "content_blocks": _default_page_blocks(ContractorWebsitePage.PAGE_REVIEWS, profile_payload),
            "sort_order": 3,
        },
        {
            "page_type": ContractorWebsitePage.PAGE_CONTACT,
            "slug": "contact",
            "title": "Contact",
            "seo_title": "Contact",
            "seo_description": "",
            "content_blocks": _default_page_blocks(ContractorWebsitePage.PAGE_CONTACT, profile_payload),
            "sort_order": 4,
        },
    ]


def _setting_enabled(key: str) -> bool:
    flags = getattr(settings, "CONTRACTOR_WEBSITE_FEATURE_DEFAULTS", {}) or {}
    return bool(flags.get(key, False))


def _website_access_state(contractor: Contractor | None = None) -> dict[str, Any]:
    if contractor is not None and getattr(contractor, "pk", None):
        contractor = Contractor.objects.select_related("user").only("id", "created_at", "user__date_joined").get(pk=contractor.pk)
    configured = _safe_text(getattr(settings, "CONTRACTOR_WEBSITE_ACCESS_STATE", ""))
    if configured:
        access_state = configured
    else:
        access_state = ACCESS_TRIAL_ACTIVE
        days = int(getattr(settings, "CONTRACTOR_WEBSITE_TRIAL_DAYS", DEFAULT_WEBSITE_TRIAL_DAYS) or DEFAULT_WEBSITE_TRIAL_DAYS)
        started_at = getattr(contractor, "created_at", None) or getattr(getattr(contractor, "user", None), "date_joined", None) or timezone.now()
        if timezone.now() > started_at + timedelta(days=days):
            access_state = ACCESS_TRIAL_EXPIRED

    days = int(getattr(settings, "CONTRACTOR_WEBSITE_TRIAL_DAYS", DEFAULT_WEBSITE_TRIAL_DAYS) or DEFAULT_WEBSITE_TRIAL_DAYS)
    started_at = getattr(contractor, "created_at", None) or getattr(getattr(contractor, "user", None), "date_joined", None) if contractor else timezone.now()
    started_at = started_at or timezone.now()
    ends_at = started_at + timedelta(days=days)
    remaining = max(0, (ends_at.date() - timezone.now().date()).days)
    return {
        "access_state": access_state,
        "trial_started_at": started_at.isoformat() if started_at else None,
        "trial_ends_at": ends_at.isoformat() if ends_at else None,
        "days_remaining": remaining if access_state == ACCESS_TRIAL_ACTIVE else 0,
        "post_trial_behavior": "Website draft content remains saved. Publishing can be paused until an active plan is connected.",
    }


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

    access = _website_access_state(contractor)
    access_state = access["access_state"]
    can_customize = access_state in {ACCESS_TRIAL_ACTIVE, ACCESS_PRO_ACTIVE, ACCESS_GROWTH_ACTIVE} or _setting_enabled(FEATURE_WEBSITE_BUILDER)
    can_publish = access_state in {ACCESS_PRO_ACTIVE, ACCESS_GROWTH_ACTIVE} or _setting_enabled(FEATURE_WEBSITE_PUBLISH)
    can_use_ai_limited = access_state == ACCESS_TRIAL_ACTIVE or _setting_enabled(FEATURE_WEBSITE_AI_COPY)
    can_use_ai_full = access_state in {ACCESS_PRO_ACTIVE, ACCESS_GROWTH_ACTIVE} and _setting_enabled(FEATURE_WEBSITE_AI_COPY)

    features = {
        FEATURE_PUBLIC_PROFILE: WebsiteFeature(
            FEATURE_PUBLIC_PROFILE,
            True,
            "free",
            "Free public profile",
        ),
        FEATURE_WEBSITE_BUILDER: WebsiteFeature(
            FEATURE_WEBSITE_BUILDER,
            can_customize,
            "pro",
            "Website Builder",
            "" if can_customize else "Your website is saved but paused. Choose a plan to reactivate customization.",
        ),
        FEATURE_WEBSITE_PUBLISH: WebsiteFeature(
            FEATURE_WEBSITE_PUBLISH,
            can_publish,
            "pro",
            "Publish website",
            "" if can_publish else "Publishing is available during an active Website Builder plan.",
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
            can_use_ai_limited or can_use_ai_full,
            "trial" if can_use_ai_limited and not can_use_ai_full else "growth",
            "AI website copy",
            "" if can_use_ai_limited or can_use_ai_full else "AI website assistance is available with trial or paid Website Builder access.",
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
        "plan": "trial" if access_state == ACCESS_TRIAL_ACTIVE else "free",
        **access,
        "can_customize": can_customize,
        "can_publish": can_publish,
        "can_use_ai_limited": can_use_ai_limited,
        "can_use_ai_full": can_use_ai_full,
        "features": {key: features[key].as_dict() for key in WEBSITE_FEATURE_KEYS},
    }


def build_website_ai_assist_response(contractor: Contractor, payload: dict[str, Any], *, request=None) -> dict[str, Any]:
    action = _safe_text(payload.get("action"))
    if action not in WEBSITE_AI_ACTIONS:
        return {"ok": False, "status": 400, "detail": "Unsupported Website Builder AI action."}
    entitlements = get_contractor_website_entitlements(contractor)
    if not (entitlements.get("can_use_ai_limited") or entitlements.get("can_use_ai_full")):
        return {"ok": False, "status": 403, "detail": "Website AI assistance is not available for this access state."}
    if not bool(getattr(settings, "CONTRACTOR_WEBSITE_AI_ASSIST_ENABLED", False)):
        return {
            "ok": False,
            "status": 503,
            "detail": "Website AI assistance is not configured yet.",
            "action": action,
            "entitlements": {
                "access_state": entitlements.get("access_state"),
                "can_use_ai_limited": entitlements.get("can_use_ai_limited"),
                "can_use_ai_full": entitlements.get("can_use_ai_full"),
            },
        }
    return {
        "ok": False,
        "status": 501,
        "detail": "Website AI provider integration is pending.",
        "action": action,
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


def _serialize_page(page: ContractorWebsitePage) -> dict[str, Any]:
    return {
        "id": page.id,
        "page_type": page.page_type,
        "slug": page.slug,
        "title": page.title,
        "seo_title": page.seo_title,
        "seo_description": page.seo_description,
        "content_blocks": page.content_blocks or {},
        "is_published": page.is_published,
        "sort_order": page.sort_order,
        "created_at": page.created_at.isoformat() if page.created_at else None,
        "updated_at": page.updated_at.isoformat() if page.updated_at else None,
    }


def _serialize_website(website: ContractorWebsite) -> dict[str, Any]:
    return {
        "id": website.id,
        "status": website.status,
        "template_key": website.template_key,
        "homepage_layout": website.homepage_layout or {},
        "published_at": website.published_at.isoformat() if website.published_at else None,
        "public_url": f"/websites/{website.public_profile.slug}",
        "created_at": website.created_at.isoformat() if website.created_at else None,
        "updated_at": website.updated_at.isoformat() if website.updated_at else None,
    }


def ensure_contractor_website(contractor: Contractor, *, request=None) -> ContractorWebsite:
    profile_payload = build_website_profile_payload(contractor, request=request, public_safe=False)
    profile = ContractorPublicProfile.objects.get(pk=profile_payload["profile_id"])
    website, created = ContractorWebsite.objects.get_or_create(
        contractor=contractor,
        defaults={
            "public_profile": profile,
            "template_key": ContractorWebsite.TEMPLATE_STARTER,
            "homepage_layout": _default_homepage_layout(profile_payload, ContractorWebsite.TEMPLATE_STARTER),
        },
    )
    changed = []
    if website.public_profile_id != profile.id:
        website.public_profile = profile
        changed.append("public_profile")
    if not website.homepage_layout:
        website.homepage_layout = _default_homepage_layout(profile_payload, website.template_key)
        changed.append("homepage_layout")
    if changed:
        website.save(update_fields=[*changed, "updated_at"])
    ensure_default_website_pages(website, profile_payload=profile_payload)
    return website


def ensure_default_website_pages(website: ContractorWebsite, *, profile_payload: dict[str, Any] | None = None) -> None:
    if profile_payload is None:
        profile_payload = build_website_profile_payload(website.contractor, public_safe=False)
    existing = set(website.pages.values_list("page_type", flat=True))
    for page_data in _default_pages(profile_payload):
        if page_data["page_type"] in existing:
            continue
        ContractorWebsitePage.objects.create(website=website, **page_data)


def list_website_pages(website: ContractorWebsite) -> list[dict[str, Any]]:
    return [_serialize_page(page) for page in website.pages.all()]


def update_contractor_website(
    website: ContractorWebsite,
    payload: dict[str, Any],
    *,
    entitlements: dict[str, Any] | None = None,
) -> ContractorWebsite:
    entitlements = entitlements or get_contractor_website_entitlements(website.contractor)
    if not entitlements["features"][FEATURE_WEBSITE_BUILDER]["enabled"]:
        raise PermissionError(entitlements["features"][FEATURE_WEBSITE_BUILDER]["reason"])

    template_key = _safe_text(payload.get("template_key"))
    if template_key and template_key in TEMPLATE_PRESETS:
        website.template_key = template_key
        website.homepage_layout = _merge_dict(
            _default_homepage_layout(build_website_profile_payload(website.contractor), template_key),
            website.homepage_layout or {},
        )
        website.homepage_layout["template"] = TEMPLATE_PRESETS[template_key]

    layout_updates = _safe_dict(payload.get("homepage_layout"))
    if layout_updates:
        allowed = {"branding", "sections", "section_order"}
        website.homepage_layout = _merge_dict(website.homepage_layout or {}, layout_updates, allowed)
        order = [item for item in website.homepage_layout.get("section_order", []) if item in SECTION_KEYS]
        website.homepage_layout["section_order"] = order or TEMPLATE_PRESETS.get(website.template_key, TEMPLATE_PRESETS["starter"])["section_order"]

    if website.status == ContractorWebsite.STATUS_PUBLISHED:
        website.status = ContractorWebsite.STATUS_DRAFT
    website.save(update_fields=["template_key", "homepage_layout", "status", "updated_at"])
    return website


def update_website_page(page: ContractorWebsitePage, payload: dict[str, Any]) -> ContractorWebsitePage:
    for field in ("title", "seo_title", "seo_description", "slug"):
        if field in payload:
            setattr(page, field, _safe_text(payload.get(field)))
    if "is_published" in payload:
        page.is_published = bool(payload.get("is_published"))
    if "sort_order" in payload:
        try:
            page.sort_order = int(payload.get("sort_order"))
        except (TypeError, ValueError):
            pass
    if isinstance(payload.get("content_blocks"), dict):
        page.content_blocks = _merge_dict(page.content_blocks or {}, payload["content_blocks"])
    page.save()
    website = page.website
    if website.status == ContractorWebsite.STATUS_PUBLISHED:
        website.status = ContractorWebsite.STATUS_DRAFT
        website.save(update_fields=["status", "updated_at"])
    return page


def _snapshot_payload(website: ContractorWebsite, *, request=None) -> dict[str, Any]:
    profile_payload = build_website_profile_payload(website.contractor, request=request, public_safe=True)
    pages = list_website_pages(website)
    return {
        "version": 1,
        "website": _serialize_website(website),
        "profile": profile_payload,
        "pages": [page for page in pages if page["is_published"]],
        "homepage_layout": website.homepage_layout or {},
        "template_key": website.template_key,
        "published_at": timezone.now().isoformat(),
    }


def validate_website_publish(website: ContractorWebsite, *, entitlements: dict[str, Any] | None = None) -> list[str]:
    entitlements = entitlements or get_contractor_website_entitlements(website.contractor)
    blockers = []
    if not entitlements["features"][FEATURE_WEBSITE_PUBLISH]["enabled"]:
        blockers.append(entitlements["features"][FEATURE_WEBSITE_PUBLISH]["reason"] or "Publishing requires Pro.")
    profile_payload = build_website_profile_payload(website.contractor, public_safe=True)
    readiness = profile_payload["readiness"]
    if readiness.get("missing_required_fields"):
        blockers.append(f"Complete required fields: {', '.join(readiness['missing_required_fields'])}.")
    if int(readiness.get("score") or 0) < MINIMUM_PUBLISH_READINESS_SCORE:
        blockers.append(f"Website readiness must be at least {MINIMUM_PUBLISH_READINESS_SCORE}%.")
    if not website.pages.filter(page_type=ContractorWebsitePage.PAGE_HOME).exists():
        blockers.append("Home page is required.")
    return blockers


def publish_contractor_website(website: ContractorWebsite, *, request=None, entitlements: dict[str, Any] | None = None) -> dict[str, Any]:
    blockers = validate_website_publish(website, entitlements=entitlements)
    if blockers:
        return {"ok": False, "blockers": blockers, "website": _serialize_website(website)}
    snapshot = _snapshot_payload(website, request=request)
    website.published_snapshot = snapshot
    website.status = ContractorWebsite.STATUS_PUBLISHED
    website.published_at = timezone.now()
    website.save(update_fields=["published_snapshot", "status", "published_at", "updated_at"])
    return {"ok": True, "blockers": [], "website": _serialize_website(website), "snapshot": snapshot}


def pause_contractor_website(website: ContractorWebsite) -> dict[str, Any]:
    website.status = ContractorWebsite.STATUS_PAUSED
    website.save(update_fields=["status", "updated_at"])
    return {"ok": True, "website": _serialize_website(website)}


def public_website_snapshot(slug: str, page_slug: str | None = None) -> dict[str, Any] | None:
    website = (
        ContractorWebsite.objects.select_related("public_profile", "contractor")
        .filter(public_profile__slug=slug, status=ContractorWebsite.STATUS_PUBLISHED)
        .first()
    )
    if website is None or not website.published_snapshot:
        return None
    snapshot = dict(website.published_snapshot)
    pages = snapshot.get("pages") if isinstance(snapshot.get("pages"), list) else []
    if page_slug:
        match = next((page for page in pages if page.get("slug") == page_slug), None)
        if match is None:
            return None
        snapshot["current_page"] = match
    else:
        snapshot["current_page"] = next((page for page in pages if page.get("page_type") == ContractorWebsitePage.PAGE_HOME), pages[0] if pages else {})
    return snapshot


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
    website = ensure_contractor_website(contractor, request=request)
    profile_payload = build_website_profile_payload(contractor, request=request, public_safe=False)
    readiness = profile_payload["readiness"]
    return {
        "entitlements": entitlements,
        "website": _serialize_website(website),
        "profile": profile_payload,
        "readiness": readiness,
        "pages": list_website_pages(website),
        "draft": {"status": website.status, "template_key": website.template_key, "has_draft": True},
        "publish_blockers": validate_website_publish(website, entitlements=entitlements),
        "recommended_next_steps": get_website_recommended_next_steps(readiness, entitlements),
    }


def build_contractor_website_preview_payload(contractor: Contractor, *, request=None) -> dict[str, Any]:
    entitlements = get_contractor_website_entitlements(contractor)
    website = ensure_contractor_website(contractor, request=request)
    profile_payload = build_website_profile_payload(contractor, request=request, public_safe=True)
    return {
        "entitlements": entitlements,
        "preview": {
            "mode": "draft",
            "can_publish": not validate_website_publish(website, entitlements=entitlements),
            "publish_disabled_reason": entitlements["features"][FEATURE_WEBSITE_PUBLISH]["reason"],
            "public_safe": True,
        },
        "website": _serialize_website(website),
        "pages": list_website_pages(website),
        "homepage_layout": website.homepage_layout or {},
        "profile": profile_payload,
        "readiness": profile_payload["readiness"],
    }
