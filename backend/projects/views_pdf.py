# backend/projects/views_pdf.py
# v2025-11-20 — Preview endpoint uses the central PDF engine directly.
#
# Layout/design is unchanged; we simply call
# projects.services.pdf.build_agreement_pdf_bytes(…, is_preview=True).

from __future__ import annotations

import logging
from typing import Any, Dict, Optional

from django.conf import settings
from django.http import HttpResponse, JsonResponse, HttpRequest
from django.utils import timezone
from django.core import signing
from django.shortcuts import get_object_or_404

from projects.models import Agreement
from projects.services.pdf import build_agreement_pdf_bytes

logger = logging.getLogger(__name__)

TOKEN_SALT = getattr(settings, "AGREEMENT_PREVIEW_TOKEN_SALT", "agreements.preview")
DEFAULT_MAX_AGE = getattr(settings, "AGREEMENT_PREVIEW_TOKEN_MAX_AGE", 60 * 30)  # 30 minutes


def _load_token(token: str, max_age: Optional[int] = None) -> Dict[str, Any]:
    if max_age is None:
        max_age = DEFAULT_MAX_AGE
    payload = signing.loads(token, max_age=max_age, salt=TOKEN_SALT)
    if not isinstance(payload, dict):
        raise signing.BadSignature("Token payload is not a dict.")
    return payload


def _user_can_view_without_token(request: HttpRequest, agreement: Agreement) -> bool:
    user = getattr(request, "user", None)
    if not user or not getattr(user, "is_authenticated", False):
        return False
    if getattr(user, "is_superuser", False) or getattr(user, "is_staff", False):
        return True

    contractor = getattr(agreement, "contractor", None)
    contractor_user = getattr(contractor, "user", None)
    if contractor_user and contractor_user == user:
        return True

    # If you later add homeowner.user, you can add a check here.
    return False


def preview_signed(request: HttpRequest) -> HttpResponse:
    """
    GET /api/projects/agreements/preview_signed/?t=<token>&download=0

    ALSO supports session-auth bypass for contractors/staff:

      - If the requester is logged in AND is staff/superuser or the
        assigned contractor, they may omit the token and pass:
          ?agreement_id=<id> (or ?id=<id> / ?agreementId=<id>)

      - Otherwise, a valid signed token (?t=...) is required. No login needed.

    This is a *preview*; the agreement does NOT need to be signed.
    The PDF layout is the SAME as the final agreement layout, with a
    "PREVIEW – NOT SIGNED" watermark whenever is_preview=True.
    """
    token = request.GET.get("t", "").strip()

    agreement: Optional[Agreement] = None

    # Session-auth bypass (contractor/staff)
    if not token:
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

    # Token-based access (homeowners / public preview)
    if agreement is None:
        if not token:
            return JsonResponse(
                {"detail": "Missing token parameter 't' or agreement_id for authorized users."},
                status=400,
            )

        try:
            payload = _load_token(token)
        except signing.SignatureExpired:
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

    # Build PREVIEW PDF bytes directly from the central engine
    try:
        pdf_bytes = build_agreement_pdf_bytes(agreement, is_preview=True)
    except Exception as exc:
        logger.exception(
            "Failed to build preview PDF for agreement %s: %s",
            getattr(agreement, "id", None),
            exc,
        )
        return JsonResponse({"detail": "Failed to generate preview PDF."}, status=500)

    download = request.GET.get("download") in ("1", "true", "yes")
    filename = f"agreement-{agreement.id}-preview.pdf"

    resp = HttpResponse(content_type="application/pdf")
    resp["Content-Disposition"] = f'{"attachment" if download else "inline"}; filename="{filename}"'
    resp["X-Preview-Generated-At"] = timezone.now().isoformat()
    resp["Cache-Control"] = "no-store"
    resp["Pragma"] = "no-cache"
    resp["X-Content-Type-Options"] = "nosniff"
    resp.write(pdf_bytes)
    return resp
