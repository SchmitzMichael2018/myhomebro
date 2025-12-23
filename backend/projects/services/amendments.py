# backend/projects/services/amendments.py
# v2025-12-11 — Reset-only amendment helper:
# - Clears BOTH legacy and new signature fields:
#     contractor_signed / homeowner_signed
#     signed_by_contractor / signed_by_homeowner
#     signed_at_contractor / signed_at_homeowner
# - Clears names, IPs, metadata
# - Deletes contractor_signature & homeowner_signature files
# - Resets preview flags: reviewed, reviewed_at, has_previewed
# - DOES NOT touch amendment_number or pdf_version
#   (those are managed by the amendment endpoint and final PDF generator)

from __future__ import annotations

import logging
from django.utils import timezone

logger = logging.getLogger(__name__)


def mark_agreement_amended(agreement, *, actor=None, reason: str = "manual-amendment") -> None:
    """
    Reset an Agreement into an "amendment-ready" state:

      • Only runs if the Agreement appears signed.
      • Clears all signature-related fields (booleans, timestamps, names, IPs, metadata).
      • Deletes any existing signature image files.
      • Resets preview flags so a new preview is required.

    IMPORTANT: This helper does NOT modify amendment_number or pdf_version.
    Versioning is handled by the amendment API and final PDF generator.
    """

    if agreement is None:
        return

    try:
        # ─────────────────────────
        # 1) Determine if Agreement appears signed
        # ─────────────────────────
        was_signed = False

        # Computed property (read-only, just for detection)
        if hasattr(agreement, "is_fully_signed"):
            try:
                if bool(getattr(agreement, "is_fully_signed")):
                    was_signed = True
            except Exception:
                pass

        # Underlying booleans (legacy)
        for f in ("contractor_signed", "homeowner_signed"):
            if hasattr(agreement, f) and getattr(agreement, f, False):
                was_signed = True

        # Underlying booleans (new)
        for f in ("signed_by_contractor", "signed_by_homeowner"):
            if hasattr(agreement, f) and getattr(agreement, f, False):
                was_signed = True

        # Signed timestamps (legacy)
        for f in ("contractor_signed_at", "homeowner_signed_at"):
            if hasattr(agreement, f) and getattr(agreement, f, None):
                was_signed = True

        # Signed timestamps (new)
        for f in ("signed_at_contractor", "signed_at_homeowner"):
            if hasattr(agreement, f) and getattr(agreement, f, None):
                was_signed = True

        if not was_signed:
            return

        # ─────────────────────────
        # 2) Clear signature booleans (legacy + new)
        # ─────────────────────────
        for f in ("contractor_signed", "homeowner_signed", "signed_by_contractor", "signed_by_homeowner"):
            if hasattr(agreement, f):
                setattr(agreement, f, False)

        # ─────────────────────────
        # 3) Clear signature timestamps (legacy + new)
        # ─────────────────────────
        for f in (
            "contractor_signed_at",
            "homeowner_signed_at",
            "contractor_unsigned_at",
            "homeowner_unsigned_at",
            "signed_at_contractor",
            "signed_at_homeowner",
        ):
            if hasattr(agreement, f):
                setattr(agreement, f, None)

        # ─────────────────────────
        # 4) Clear signature names
        # ─────────────────────────
        for f in ("contractor_signature_name", "homeowner_signature_name"):
            if hasattr(agreement, f):
                setattr(agreement, f, "")

        # ─────────────────────────
        # 5) Clear IPs
        # ─────────────────────────
        for f in ("contractor_signed_ip", "homeowner_signed_ip"):
            if hasattr(agreement, f):
                setattr(agreement, f, None)

        # ─────────────────────────
        # 6) Clear e-sign metadata JSONs
        # ─────────────────────────
        for f in ("contractor_esign_metadata", "homeowner_esign_metadata"):
            if hasattr(agreement, f):
                setattr(agreement, f, None)

        # ─────────────────────────
        # 7) Delete signature image files
        # ─────────────────────────
        for f in ("contractor_signature", "homeowner_signature"):
            if hasattr(agreement, f):
                try:
                    file = getattr(agreement, f)
                    if file and hasattr(file, "delete"):
                        file.delete(save=False)
                except Exception:
                    logger.exception("Could not delete signature file %s", f)
                try:
                    setattr(agreement, f, None)
                except Exception:
                    pass

        # ─────────────────────────
        # 8) Reset preview flags (so a new preview is required)
        # ─────────────────────────
        for f in ("reviewed", "has_previewed"):
            if hasattr(agreement, f):
                try:
                    setattr(agreement, f, False)
                except Exception:
                    pass

        if hasattr(agreement, "reviewed_at"):
            agreement.reviewed_at = None

        # ─────────────────────────
        # 9) Optional: note amendment reset happened
        # ─────────────────────────
        if hasattr(agreement, "last_amend_reason"):
            try:
                agreement.last_amend_reason = reason or "manual-amendment"
            except Exception:
                pass

        if actor is not None:
            if hasattr(agreement, "last_amend_actor"):
                try:
                    agreement.last_amend_actor = actor
                except Exception:
                    pass
            if hasattr(agreement, "last_amend_actor_name"):
                try:
                    get_name = getattr(actor, "get_full_name", None)
                    if callable(get_name):
                        agreement.last_amend_actor_name = get_name()
                    else:
                        agreement.last_amend_actor_name = str(actor)
                except Exception:
                    agreement.last_amend_actor_name = str(actor)

        agreement.save()

    except Exception as e:
        logger.exception("mark_agreement_amended failed: %s", e)
        return
