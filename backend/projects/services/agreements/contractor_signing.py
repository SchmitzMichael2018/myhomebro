# backend/projects/services/agreements/contractor_signing.py
from __future__ import annotations

import base64
from typing import Optional, Dict, Any

from django.core.files.base import ContentFile
from django.utils.timezone import now

from projects.models import Agreement
from projects.services.mailer import email_signing_invite
from projects.services.sms import sms_link_to_parties
from projects.services.agreements.public_sign import build_public_sign_url


def send_signature_request_to_homeowner(ag: Agreement) -> Dict[str, Any]:
    homeowner = getattr(ag, "homeowner", None)
    homeowner_email = getattr(homeowner, "email", None)
    if not homeowner_email:
        raise ValueError("Agreement has no homeowner email.")

    sign_url = build_public_sign_url(ag)

    try:
        email_signing_invite(ag, sign_url=sign_url)
    except Exception:
        # best-effort
        pass

    try:
        sms_link_to_parties(
            ag,
            link_url=sign_url,
            note="Please review and sign your agreement.",
        )
    except Exception:
        pass

    return {"ok": True, "sign_url": sign_url}


def apply_contractor_signature(
    ag: Agreement,
    *,
    typed_name: str,
    signature_file=None,
    signature_data_url: Optional[str] = None,
    signed_ip: Optional[str] = None,
) -> Agreement:
    name = (typed_name or "").strip()
    if not name:
        raise ValueError("Signature name is required.")

    try:
        if signature_file and hasattr(ag, "contractor_signature"):
            ag.contractor_signature.save(signature_file.name, signature_file, save=False)
        elif signature_data_url and hasattr(ag, "contractor_signature"):
            header, b64 = signature_data_url.split(",", 1)
            if ";base64" not in header:
                raise ValueError("Invalid signature data URL.")
            ext = "png"
            if "image/jpeg" in header or "image/jpg" in header:
                ext = "jpg"
            content = ContentFile(
                base64.b64decode(b64),
                name=f"contractor_signature.{ext}",
            )
            ag.contractor_signature.save(content.name, content, save=False)
    except Exception as e:
        raise ValueError("Could not process signature image.") from e

    ag.contractor_signature_name = name
    ag.signed_by_contractor = True
    ag.signed_at_contractor = now()
    ag.contractor_signed_ip = signed_ip or None
    ag.status = "draft"
    ag.save()
    return ag


def unsign_contractor(ag: Agreement) -> Agreement:
    # Only allowed if not fully signed; caller should enforce.
    ag.signed_by_contractor = False
    ag.signed_at_contractor = None
    if hasattr(ag, "contractor_signature_name"):
        ag.contractor_signature_name = ""
    if hasattr(ag, "contractor_signature"):
        ag.contractor_signature = None
    ag.status = "draft"
    ag.save()
    return ag
