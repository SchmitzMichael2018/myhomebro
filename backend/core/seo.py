"""Canonical public-site metadata and crawler policy."""

from urllib.parse import quote

from django.conf import settings


SITE_ORIGIN = "https://www.myhomebro.com"
DEFAULT_TITLE = "MyHomeBro | Plan, Hire & Manage Home Projects"
DEFAULT_DESCRIPTION = (
    "Plan DIY projects, connect with contractors, manage agreements, track "
    "milestones, make project payments, and keep your home improvements organized "
    "with MyHomeBro."
)
SOCIAL_DESCRIPTION = (
    "DIY or hiring a pro? Plan projects, connect with contractors, manage the work, "
    "and keep your home improvements organized in one place."
)
DEFAULT_SOCIAL_IMAGE = f"{SITE_ORIGIN}/static/social/myhomebro-default-1200x630.png"

INDEXABLE_ROUTES = {
    "/": {"title": DEFAULT_TITLE, "description": DEFAULT_DESCRIPTION},
    "/faq": {
        "title": "Frequently Asked Questions | MyHomeBro",
        "description": (
            "Clear answers about MyHomeBro projects, contractors, payments, refunds, "
            "disputes, AI assistance, privacy, and records."
        ),
    },
}


def canonical_path(path):
    """Return the one public canonical path for a request path."""
    if path == "/":
        return "/"
    return "/" + quote(path.strip("/"), safe="/-._~")


def metadata_for_path(path):
    normalized = canonical_path(path)
    route = INDEXABLE_ROUTES.get(normalized)
    indexable = route is not None
    title = route["title"] if route else DEFAULT_TITLE
    description = route["description"] if route else DEFAULT_DESCRIPTION
    canonical_url = f"{SITE_ORIGIN}{normalized}"
    return {
        "seo_title": title,
        "seo_description": description,
        "seo_social_description": SOCIAL_DESCRIPTION if normalized == "/" else description,
        "seo_canonical_url": canonical_url,
        "seo_social_image": DEFAULT_SOCIAL_IMAGE,
        "seo_robots": "index, follow" if indexable else "noindex, nofollow",
        "seo_indexable": indexable,
        "search_verification": getattr(settings, "GOOGLE_SITE_VERIFICATION", ""),
    }


def improvement_metadata(template):
    canonical_url = (
        f"{SITE_ORIGIN}/improvements/{template.public_category_slug}/{template.public_slug}/"
    )
    image_path = template.social_image or "/static/social/myhomebro-default-1200x630.png"
    return {
        "seo_title": template.seo_title or f"{template.name}: DIY & Project Guide | MyHomeBro",
        "seo_description": template.seo_description or template.public_summary,
        "seo_social_description": template.seo_description or template.public_summary,
        "seo_canonical_url": canonical_url,
        "seo_social_image": f"{SITE_ORIGIN}{image_path}",
        "seo_robots": "index, follow",
        "seo_indexable": True,
        "search_verification": getattr(settings, "GOOGLE_SITE_VERIFICATION", ""),
    }
