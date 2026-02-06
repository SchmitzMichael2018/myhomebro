# backend/projects/services/agreements/public_sign.py
from __future__ import annotations

import sys
from typing import Optional, Dict, Any, Tuple

from django.conf import settings
from django.core import signing
from django.http import Http404
from django.shortcuts import get_object_or_404
from django.utils.timezone import now

from projects.models import Agreement
from projects.services.agreements.final_link import send_final_link_for_agreement


_PUBLIC_SIGN_SALT = "agreements.public.sign.v1"
_PUBLIC_SIGN_MAX_AGE = 60 * 60 * 24 * 7  # 7 days


def build_public_sign_url(ag: Agreement, *, mode: Optional[str] = None) -> str:
    signer = signing.TimestampSigner(salt=_PUBLIC_SIGN_SALT)
    token_payload = {"agreement_id": ag.id, "ts": float(now().timestamp())}
    token = signer.sign_object(token_payload)

    domain = (
        getattr(settings, "PUBLIC_APP_ORIGIN", None)
        or getattr(settings, "SITE_URL", None)
        or "https://www.myhomebro.com"
    ).rstrip("/")

    url = f"{domain}/public-sign/{token}"
    if mode:
        url = f"{url}?mode={mode}"
    return url


def unsign_public_token(token: str) -> Agreement:
    signer = signing.TimestampSigner(salt=_PUBLIC_SIGN_SALT)
    try:
        data = signer.unsign_object(token, max_age=_PUBLIC_SIGN_MAX_AGE)
        agreement_id = int(data.get("agreement_id"))
    except signing.SignatureExpired:
        raise Http404("Signing link expired.")
    except Exception:
        raise Http404("Invalid signing token.")

    return get_object_or_404(Agreement, pk=agreement_id)


def apply_homeowner_signature(
    ag: Agreement,
    *,
    typed_name: str,
    signature_file=None,
    signature_data_url: Optional[str] = None,
    signed_ip: Optional[str] = None,
) -> Tuple[Agreement, Dict[str, Any]]:
    """Apply homeowner signature details to an Agreement instance and save.

    Returns: (agreement, meta)
    meta includes:
      - was_homeowner_signed: bool
      - became_fully_signed: bool
    """
    was_homeowner_signed = bool(getattr(ag, "signed_by_homeowner", False))

    # Signature image handling is best-effort; caller may have already saved file
    try:
        if signature_file and hasattr(ag, "homeowner_signature"):
            ag.homeowner_signature.save(signature_file.name, signature_file, save=False)
        elif signature_data_url and hasattr(ag, "homeowner_signature"):
            header, b64 = signature_data_url.split(",", 1)
            if ";base64" not in header:
                raise ValueError("Invalid signature data URL.")
            import base64 as _b64
            from django.core.files.base import ContentFile
            ext = "png"
            if "image/jpeg" in header or "image/jpg" in header:
                ext = "jpg"
            content = ContentFile(
                _b64.b64decode(b64),
                name=f"homeowner_signature.{ext}",
            )
            ag.homeowner_signature.save(content.name, content, save=False)
    except Exception as e:
        raise ValueError("Could not process signature image.") from e

    ag.homeowner_signature_name = (typed_name or "").strip()
    ag.signed_by_homeowner = True
    ag.signed_at_homeowner = now()
    ag.homeowner_signed_ip = signed_ip or None
    ag.save()

    became_fully_signed = bool(
        getattr(ag, "signed_by_contractor", False) and getattr(ag, "signed_by_homeowner", False)
    )

    return ag, {"was_homeowner_signed": was_homeowner_signed, "became_fully_signed": became_fully_signed}


def maybe_send_final_copy_after_homeowner_sign(
    ag: Agreement,
    *,
    was_homeowner_signed: bool,
) -> None:
    """If agreement just became fully signed, send final link (guarded by pdf_version)."""
    try:
        if (
            bool(getattr(ag, "signed_by_contractor", False))
            and bool(getattr(ag, "signed_by_homeowner", False))
            and not was_homeowner_signed
        ):
            send_final_link_for_agreement(ag, force_send=False)
    except Exception as e:
        print("maybe_send_final_copy_after_homeowner_sign error:", repr(e), file=sys.stderr)
