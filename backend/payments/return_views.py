# backend/payments/return_views.py
from __future__ import annotations

from urllib.parse import urlencode
from django.http import HttpResponseRedirect, HttpResponse
from django.conf import settings

def stripe_return(request):
    """
    Simple redirect target for Stripe AccountLink return_url / refresh_url.
    Sends the user back to your SPA with a small status indicator in the querystring.

    Example:
      /stripe/return/?status=return  -> /?stripe=return
      /stripe/return/?status=refresh -> /?stripe=refresh
    """
    status = request.GET.get("status", "return")
    # Prefer your configured FRONTEND_URL if present; else SITE_URL; else "/"
    target = getattr(settings, "FRONTEND_URL", "/") or "/"
    # Ensure it’s a bare origin or SPA root; your SPA will read the query
    if target.endswith("/"):
        base = target
    else:
        base = target + "/"

    qs = urlencode({"stripe": status})
    return HttpResponseRedirect(f"{base}?{qs}")

def ok(_request):
    return HttpResponse("ok", content_type="text/plain")
