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

# ✅ NEW: PDF auto-finalize hook (same behavior as contractor sign)
from projects.services.agreements.pdf_loader import load_pdf_services
from projects.services.agreements.pdf_actions import finalize_agreement_pdf


_PUBLIC_SIGN_SALT = "agreements.public.sign.v1"
_PUBLIC_SIGN_MAX_AGE = 60 * 60 * 24 * 7  # 7 days

_PDF_BUILD_FN = None
_PDF_GEN_FN = None


def _get_pdf_services():
    """
    Mirrors AgreementViewSet behavior: pdf_loader returns (build_bytes_fn, generate_full_fn)
    We only need the generate function here.
    """
    global _PDF_BUILD_FN, _PDF_GEN_FN
    if callable(_PDF_GEN_FN):
        return _PDF_BUILD_FN, _PDF_GEN_FN
    b, g = load_pdf_services()
    _PDF_BUILD_FN, _PDF_GEN_FN = b, g
    return _PDF_BUILD_FN, _PDF_GEN_FN


def _signature_satisfied(ag: Agreement) -> bool:
    """
    Waiver/policy aware signature satisfaction (property on Agreement model).
    """
    try:
        return bool(getattr(ag, "signature_is_satisfied", False))
    except Exception:
        return False


def _auto_finalize_if_satisfied_transition(ag: Agreement, *, satisfied_before: bool) -> None:
    """
    If signature satisfaction transitions False -> True, finalize PDF once.
    This creates AgreementPDFVersion rows + updates Agreement.pdf_file/pdf_version.
    """
    satisfied_after = _signature_satisfied(ag)
    if satisfied_before or not satisfied_after:
        return

    _build_fn, gen_fn = _get_pdf_services()
    if not callable(gen_fn):
        print("public_sign: auto-finalize skipped (pdf generator not loaded)", file=sys.stderr)
        return

    try:
        finalize_agreement_pdf(ag, generate_full_agreement_pdf=gen_fn)
        try:
            ag.refresh_from_db()
        except Exception:
            pass
    except Exception as e:
        # Don't block signing if PDF finalize fails
        print("public_sign: auto-finalize failed:", repr(e), file=sys.stderr)


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
      - became_signature_satisfied: bool   (waiver/policy aware)
      - satisfied_before: bool
      - satisfied_after: bool
    """
    was_homeowner_signed = bool(getattr(ag, "signed_by_homeowner", False))
    satisfied_before = _signature_satisfied(ag)

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

    # Apply signature fields
    ag.homeowner_signature_name = (typed_name or "").strip()
    ag.signed_by_homeowner = True
    ag.signed_at_homeowner = now()
    ag.homeowner_signed_ip = signed_ip or None

    # Save
    ag.save()

    # Refresh and re-check satisfaction (waiver/policy aware)
    try:
        ag.refresh_from_db()
    except Exception:
        pass

    satisfied_after = _signature_satisfied(ag)

    # ✅ Auto finalize on transition
    _auto_finalize_if_satisfied_transition(ag, satisfied_before=satisfied_before)

    return ag, {
        "was_homeowner_signed": was_homeowner_signed,
        "satisfied_before": bool(satisfied_before),
        "satisfied_after": bool(satisfied_after),
        "became_signature_satisfied": bool((not satisfied_before) and satisfied_after),
    }


def maybe_send_final_copy_after_homeowner_sign(
    ag: Agreement,
    *,
    was_homeowner_signed: bool,
) -> None:
    """
    If agreement just became signature-satisfied (waiver/policy aware), send final link.
    (Guarded by pdf_version inside send_final_link_for_agreement.)
    """
    try:
        # Only send when homeowner JUST signed in this request
        if was_homeowner_signed:
            return

        # Waiver/policy-aware satisfaction
        if bool(getattr(ag, "signature_is_satisfied", False)):
            send_final_link_for_agreement(ag, force_send=False)
    except Exception as e:
        print("maybe_send_final_copy_after_homeowner_sign error:", repr(e), file=sys.stderr)