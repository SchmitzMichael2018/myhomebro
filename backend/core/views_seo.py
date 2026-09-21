from django.http import HttpResponse
from django.views.decorators.http import require_GET

from .seo import INDEXABLE_ROUTES, SITE_ORIGIN


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
    entries = "".join(f"<url><loc>{url}</loc></url>" for url in urls)
    xml = f'<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">{entries}</urlset>'
    return HttpResponse(xml, content_type="application/xml; charset=utf-8")
