from django.http import Http404, HttpResponse
from django.shortcuts import redirect
from django.views.decorators.http import require_GET

from .seo import INDEXABLE_ROUTES, SITE_ORIGIN, improvement_metadata, metadata_for_path
from .views_frontend import spa


@require_GET
def robots_txt(request):
    lines = [
        "User-agent: *",
        "Allow: /",
        "Allow: /faq",
        "Allow: /improvements/",
        "Disallow: /admin/",
        "Disallow: /api/",
        "Disallow: /app/",
        "Disallow: /account/",
        "Disallow: /portal/",
        "Disallow: /customer-portal/",
        "Disallow: /my-records/",
        "Disallow: /internal/",
        "Disallow: /debug/",
        "Disallow: /turnstile-diagnostic/",
        "Disallow: /stripe/",
        "Disallow: /agreements/sign/",
        "Disallow: /agreements/magic/",
        "Disallow: /invoices/magic/",
        "Disallow: /draws/magic/",
        "Disallow: /disputes/",
        "Disallow: /estimate-review/",
        "Disallow: /appointment-confirmation/",
        "Disallow: /activate-customer/",
        "Disallow: /maintenance-request/status/",
        "Disallow: /work-order-invitations/",
        "Disallow: /subcontractor-invitations/",
        f"Sitemap: {SITE_ORIGIN}/sitemap.xml",
    ]
    return HttpResponse("\n".join(lines) + "\n", content_type="text/plain; charset=utf-8")


@require_GET
def sitemap_xml(request):
    # Phase 1D can append authoritative category/template records here. Do not
    # invent last-modified values when no authoritative timestamp exists.
    urls = [f"{SITE_ORIGIN}{path}" for path in INDEXABLE_ROUTES]
    urls.extend(
        [
            f"{SITE_ORIGIN}/legal/terms-of-service/",
            f"{SITE_ORIGIN}/legal/privacy-policy/",
        ]
    )
    from projects.models_templates import ProjectTemplate

    published = ProjectTemplate.objects.filter(
        public_publication_status=ProjectTemplate.PublicPublicationStatus.PUBLISHED,
        is_active=True,
    ).order_by("public_category_slug", "public_slug")
    if published.exists():
        urls.append(f"{SITE_ORIGIN}/improvements/")
    category_dates = {}
    dynamic_entries = []
    for template in published:
        category_dates[template.public_category_slug] = max(
            category_dates.get(template.public_category_slug, template.updated_at),
            template.updated_at,
        )
        lastmod = template.public_reviewed_at or template.updated_at or template.public_published_at
        dynamic_entries.append(
            f"<url><loc>{SITE_ORIGIN}/improvements/{template.public_category_slug}/{template.public_slug}/</loc>"
            f"<lastmod>{lastmod.date().isoformat()}</lastmod></url>"
        )
    for category_slug, lastmod in category_dates.items():
        dynamic_entries.append(
            f"<url><loc>{SITE_ORIGIN}/improvements/{category_slug}/</loc>"
            f"<lastmod>{lastmod.date().isoformat()}</lastmod></url>"
        )
    entries = "".join(f"<url><loc>{url}</loc></url>" for url in urls) + "".join(dynamic_entries)
    xml = f'<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">{entries}</urlset>'
    return HttpResponse(xml, content_type="application/xml; charset=utf-8")


@require_GET
def public_improvement_shell(request, category_slug=None, improvement_slug=None):
    from projects.models_templates import ProjectTemplate, ProjectTemplatePublicSlug

    if not category_slug:
        has_published_content = ProjectTemplate.objects.filter(
            public_publication_status=ProjectTemplate.PublicPublicationStatus.PUBLISHED,
            is_active=True,
        ).exists()
        return spa(request, seo_override={
            **metadata_for_path("/improvements/"),
            "seo_title": "Home Improvement Projects & DIY Guides | MyHomeBro",
            "seo_description": "Explore home project guides, understand the work, and decide whether to DIY or get contractor help with MyHomeBro.",
            "seo_social_description": "Plan a home project, understand the work, and choose whether to DIY or get contractor help.",
            "seo_canonical_url": f"{SITE_ORIGIN}/improvements/",
            "seo_robots": "index, follow" if has_published_content else "noindex, follow",
            "seo_indexable": has_published_content,
        })
    published = ProjectTemplate.objects.filter(
        public_publication_status=ProjectTemplate.PublicPublicationStatus.PUBLISHED,
        is_active=True,
    )
    if not improvement_slug:
        if not published.filter(public_category_slug=category_slug).exists():
            raise Http404("Published improvement category not found.")
        label = category_slug.replace("-", " ").title()
        return spa(request, seo_override={
            **metadata_for_path(request.path),
            "seo_title": f"{label} Projects & DIY Guides | MyHomeBro",
            "seo_description": f"Explore published {label.lower()} project guides and decide whether to DIY or get contractor help.",
            "seo_social_description": f"Explore published {label.lower()} project guides from MyHomeBro.",
            "seo_canonical_url": f"{SITE_ORIGIN}/improvements/{category_slug}/",
            "seo_robots": "index, follow",
            "seo_indexable": True,
        })
    template = published.filter(public_category_slug=category_slug, public_slug=improvement_slug).first()
    if template:
        return spa(request, seo_override=improvement_metadata(template))
    history = ProjectTemplatePublicSlug.objects.select_related("template").filter(
        category_slug=category_slug,
        slug=improvement_slug,
        template__public_publication_status=ProjectTemplate.PublicPublicationStatus.PUBLISHED,
    ).first()
    if history:
        return redirect(
            f"/improvements/{history.template.public_category_slug}/{history.template.public_slug}/",
            permanent=True,
        )
    raise Http404("Published improvement not found.")
