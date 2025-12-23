# backend/projects/utils/pdf.py
# v2025-11-20 — Legacy shim around projects.services.pdf
#
# Public API (unchanged):
#   generate_full_agreement_pdf(agreement_id: int, preview: bool = False) -> str
#
# All real layout logic lives in projects.services.pdf.

from __future__ import annotations

import os

from django.conf import settings

from projects.models import Agreement
from projects.services.pdf import build_agreement_pdf_bytes


def _media_root() -> str:
    mr = getattr(settings, "MEDIA_ROOT", None)
    if not mr:
        raise RuntimeError("MEDIA_ROOT is not configured")
    return mr


def generate_full_agreement_pdf(agreement_id: int, preview: bool = False) -> str:
    """
    Legacy-compatible PDF generator that delegates to the new engine.

    Args:
        agreement_id: Agreement PK.
        preview: If True, watermark as preview and do NOT bump pdf_version.

    Returns:
        Relative path under MEDIA_ROOT to the generated PDF.
    """
    ag = Agreement.objects.select_related("contractor", "homeowner", "project").get(
        pk=agreement_id
    )

    media_root = _media_root()
    subdir = "agreements/preview" if preview else "agreements/final"
    out_dir = os.path.join(media_root, subdir)
    os.makedirs(out_dir, exist_ok=True)

    filename = f"agreement_{agreement_id}.pdf"
    out_path = os.path.join(out_dir, filename)

    pdf_bytes = build_agreement_pdf_bytes(ag, is_preview=preview)
    with open(out_path, "wb") as fh:
        fh.write(pdf_bytes)

    return os.path.relpath(out_path, media_root)
