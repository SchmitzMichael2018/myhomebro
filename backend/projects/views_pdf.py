# backend/projects/views_pdf.py
from __future__ import annotations

import logging
from typing import Any, Dict, Optional

from django.conf import settings
from django.http import HttpResponse, JsonResponse, HttpRequest
from django.utils import timezone
from django.core import signing
from django.shortcuts import get_object_or_404

from projects.models import Agreement
from projects.pdf_utils import build_preview_pdf  # must exist; returns bytes

logger = logging.getLogger(__name__)

# HMAC token config for public preview links
TOKEN_SALT = getattr(settings, "AGREEMENT_PREVIEW_TOKEN_SALT", "agreements.preview")
DEFAULT_MAX_AGE = getattr(settings, "AGREEMENT_PREVIEW_TOKEN_MAX_AGE", 60 * 30)  # 30 minutes


def _load_token(token: str, max_age: Optional[int] = None) -> Dict[str, Any]:
    """Decode & verify HMAC + timestamp token. Returns payload dict."""
    if max_age is None:
        max_age = DEFAULT_MAX_AGE
    payload = signing.loads(token, max_age=max_age, salt=TOKEN_SALT)
    if not isinstance(payload, dict):
        raise signing.BadSignature("Token payload is not a dict.")
    return payload


def _user_can_view_without_token(request: HttpRequest, agreement: Agreement) -> bool:
    """
    Session-auth bypass rule:
      - superuser/staff: always allowed
      - contractor assigned to this agreement: allowed
    NOTE: Homeowner access is expected via signed link (no login required).
    If you have a Homeowner <-> User link in your model, add a check here.
    """
    user = getattr(request, "user", None)
    if not user or not getattr(user, "is_authenticated", False):
        return False
    if getattr(user, "is_superuser", False) or getattr(user, "is_staff", False):
        return True

    contractor = getattr(agreement, "contractor", None)
    contractor_user = getattr(contractor, "user", None)
    if contractor_user and contractor_user == user:
        return True

    # If you later add homeowner.user, you can enable:
    # homeowner = getattr(agreement, "homeowner", None)
    # homeowner_user = getattr(homeowner, "user", None)
    # if homeowner_user and homeowner_user == user:
    #     return True

    return False


def preview_signed(request: HttpRequest) -> HttpResponse:
    """
    GET /api/projects/agreements/preview_signed/?t=<token>&download=0
    ALSO supports session-auth bypass for contractors/staff:

      - If the requester is logged in AND is staff/superuser or the
        assigned contractor, they may omit the token and pass:
          ?agreement_id=<id>
        (or ?id=<id> / ?agreementId=<id>)

      - Otherwise, a valid signed token (?t=...) is required. No login needed.

    This is a *preview*; the agreement does NOT need to be signed.
    If still a draft, the fallback generator places a "DRAFT — NOT SIGNED"
    watermark so reviewers can verify content prior to signing/funding.
    """
    token = request.GET.get("t", "").strip()

    # First, try session-auth bypass path if no token was provided.
    agreement: Optional[Agreement] = None
    if not token:
        # Allow passing an explicit id when logged in with permission.
        raw_id = (
            request.GET.get("agreement_id")
            or request.GET.get("id")
            or request.GET.get("agreementId")
            or ""
        )
        try:
            ag_id = int(raw_id) if raw_id else None
        except (TypeError, ValueError):
            ag_id = None

        if ag_id is not None:
            agreement = get_object_or_404(Agreement, id=ag_id)
            if not _user_can_view_without_token(request, agreement):
                agreement = None

    # If not resolved by session-auth bypass, we need a token.
    if agreement is None:
        if not token:
            return JsonResponse({"detail": "Missing token parameter 't' or agreement_id for authorized users."}, status=400)

        try:
            payload = _load_token(token)
        except signing.SignatureExpired:
            # Token is valid structure but expired
            return JsonResponse({"detail": "Preview link has expired."}, status=410)
        except signing.BadSignature:
            return JsonResponse({"detail": "Invalid preview token."}, status=401)
        except Exception as exc:
            logger.exception("Error decoding preview token: %s", exc)
            return JsonResponse({"detail": "Invalid preview token."}, status=401)

        agreement_id = (
            payload.get("agreement_id")
            or payload.get("id")
            or payload.get("agreementId")
        )
        if not agreement_id:
            return JsonResponse({"detail": "Token missing agreement_id."}, status=400)

        agreement = get_object_or_404(Agreement, id=agreement_id)

    # Build (or gracefully fall back to) preview bytes
    try:
        pdf_bytes = build_preview_pdf(agreement)  # guaranteed to return bytes
    except Exception as exc:
        logger.exception("Failed to build preview PDF for agreement %s: %s", getattr(agreement, "id", None), exc)
        return JsonResponse({"detail": "Failed to generate preview PDF."}, status=500)

    # Inline vs download
    download = request.GET.get("download") in ("1", "true", "yes")
    filename = f"agreement-{agreement.id}-preview.pdf"

    resp = HttpResponse(content_type="application/pdf")
    resp["Content-Disposition"] = f'{"attachment" if download else "inline"}; filename="{filename}"'
    resp["X-Preview-Generated-At"] = timezone.now().isoformat()
    # Security/cache hardening
    resp["Cache-Control"] = "no-store"
    resp["Pragma"] = "no-cache"
    resp["X-Content-Type-Options"] = "nosniff"
    resp.write(pdf_bytes)
    return resp
