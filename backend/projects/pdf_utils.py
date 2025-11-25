# backend/projects/pdf_utils.py
# v2025-11-20 — Simplified to only handle PDF attachment merging.
#
# Preview rendering is now handled directly by projects.services.pdf and
# projects.views_pdf (no more build_preview_pdf indirection).

from __future__ import annotations

import os
import logging
from typing import Iterable, Optional

logger = logging.getLogger(__name__)

try:
    from PyPDF2 import PdfReader, PdfWriter  # type: ignore
except Exception:
    try:
        from pypdf import PdfReader, PdfWriter  # type: ignore
    except Exception as e:
        PdfReader = None  # type: ignore
        PdfWriter = None  # type: ignore
        logger.warning("PyPDF2/pypdf not available; PDF merging disabled: %s", e)


def append_pdf_attachments(base_pdf_path: str, attachment_filepaths: Iterable[str]) -> Optional[str]:
    """
    Appends each PDF in `attachment_filepaths` to `base_pdf_path`.
    Returns the output pdf path (same directory, '-with-attachments.pdf' suffix).
    Silently skips non-PDF files and missing paths.

    This is a generic helper and is NOT used by the agreement preview endpoint,
    which renders directly from the central PDF engine.
    """
    if not base_pdf_path or not os.path.exists(base_pdf_path) or not PdfWriter or not PdfReader:
        return None

    writer = PdfWriter()

    # Base
    try:
        with open(base_pdf_path, "rb") as f:
            base_reader = PdfReader(f)  # type: ignore
            for page in list(getattr(base_reader, "pages", [])):
                writer.add_page(page)  # type: ignore
    except Exception as exc:
        logger.exception("Failed to read base PDF for merging: %s", exc)
        return None

    # Attachments
    for p in attachment_filepaths:
        try:
            if not p or not os.path.exists(p) or not p.lower().endswith(".pdf"):
                continue
            with open(p, "rb") as af:
                ar = PdfReader(af)  # type: ignore
                for page in list(getattr(ar, "pages", [])):
                    writer.add_page(page)  # type: ignore
        except Exception as exc:
            logger.warning("Skipping attachment %s due to error: %s", p, exc)
            continue

    out_path = base_pdf_path.replace(".pdf", "-with-attachments.pdf")
    with open(out_path, "wb") as out:
        writer.write(out)  # type: ignore
    return out_path
