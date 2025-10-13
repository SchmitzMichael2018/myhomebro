# backend/projects/pdf_utils.py
from __future__ import annotations

import io
import os
import logging
from typing import Iterable, Optional, Union

logger = logging.getLogger(__name__)

# Prefer PyPDF2 for merging (keeps your existing helper working)
try:
    from PyPDF2 import PdfReader, PdfWriter  # type: ignore
except Exception:
    try:
        from pypdf import PdfReader, PdfWriter  # type: ignore
    except Exception as e:
        PdfReader = None  # type: ignore
        PdfWriter = None  # type: ignore
        logger.warning("PyPDF2/pypdf not available; PDF merging disabled: %s", e)

# ---- SETTINGS HELPERS ----
def _media_root() -> str:
    from django.conf import settings
    mr = getattr(settings, "MEDIA_ROOT", None)
    if not mr:
        raise RuntimeError("MEDIA_ROOT is not configured")
    return mr

# =============================== PUBLIC API ==================================
def append_pdf_attachments(base_pdf_path: str, attachment_filepaths: Iterable[str]) -> Optional[str]:
    """
    Appends each PDF in `attachment_filepaths` to `base_pdf_path`.
    Returns the output pdf path (same directory, '-with-attachments.pdf' suffix).
    Silently skips non-PDF files and missing paths.
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
    except Exception:
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
        except Exception:
            continue

    out_path = base_pdf_path.replace(".pdf", "-with-attachments.pdf")
    with open(out_path, "wb") as out:
        writer.write(out)  # type: ignore
    return out_path


def build_preview_pdf(agreement) -> bytes:
    """
    Returns preview PDF bytes for ANY agreement status (draft or signed).
    Tries your generator first; if it fails or returns nothing, falls back.
    """
    try:
        data = _try_utils_generator(agreement)
        if data:
            return data
    except Exception:
        # Be *very* defensive — never let generator crashes bubble up
        logger.exception("Generator raised while building preview; using fallback.")

    return fallback_preview_pdf(agreement)


def fallback_preview_pdf(agreement) -> bytes:
    """
    Clean, minimal fallback PDF with a DRAFT watermark when not fully signed.
    This is exported so views can call it directly if needed.
    """
    try:
        from reportlab.lib.pagesizes import LETTER
        from reportlab.pdfgen import canvas
        from reportlab.lib.units import inch
        from reportlab.lib import colors
    except Exception as exc:
        logger.error("ReportLab not installed; cannot build fallback preview (%s)", exc)
        return b"%PDF-1.4\n% Fallback preview unavailable\n"

    ag_id = getattr(agreement, "id", None)
    title = (
        getattr(agreement, "project_title", None)
        or getattr(agreement, "title", None)
        or (f"Agreement #{ag_id}" if ag_id else "Agreement")
    )
    status = getattr(agreement, "status", "") or "draft"

    contractor_name = getattr(getattr(agreement, "contractor", None), "business_name", None) \
        or getattr(getattr(agreement, "contractor", None), "full_name", None) \
        or str(getattr(agreement, "contractor", "") or "")
    homeowner_name = getattr(getattr(agreement, "homeowner", None), "full_name", None) \
        or str(getattr(agreement, "homeowner", "") or "")

    start = getattr(agreement, "start", None)
    end = getattr(agreement, "end", None)
    total_cost = getattr(agreement, "total_cost", None)
    warranty_text = getattr(agreement, "warranty_text_snapshot", "") or ""

    signed_contractor = bool(getattr(agreement, "signed_by_contractor", False))
    signed_homeowner  = bool(getattr(agreement, "signed_by_homeowner", False))
    is_fully_signed   = signed_contractor and signed_homeowner

    buf = io.BytesIO()
    c = canvas.Canvas(buf, pagesize=LETTER)
    width, height = LETTER

    # Header
    c.setFont("Helvetica-Bold", 16)
    c.drawString(1 * inch, height - 1 * inch, "Agreement Preview")

    c.setFont("Helvetica", 11)
    y = height - 1.4 * inch
    lines = [
        f"Title: {title}",
        f"Agreement ID: {ag_id if ag_id is not None else '—'}",
        f"Status: {status.upper()}",
        f"Contractor: {contractor_name or '—'}",
        f"Homeowner: {homeowner_name or '—'}",
        f"Start: {start if start else '—'}",
        f"End: {end if end else '—'}",
        f"Total Cost: {total_cost if total_cost not in (None, '') else '—'}",
        "",
        "Warranty Summary:",
        (warranty_text[:600] + "…") if len(warranty_text) > 600 else (warranty_text or "—"),
        "",
        "Signatures (preview):",
        f"  Contractor signed: {'Yes' if signed_contractor else 'No'}",
        f"  Homeowner signed: {'Yes' if signed_homeowner else 'No'}",
    ]

    for line in lines:
        c.drawString(1 * inch, y, line)
        y -= 14
        if y < 1.2 * inch:
            c.showPage()
            y = height - 1 * inch
            c.setFont("Helvetica", 11)

    # Watermark if not fully signed
    if not is_fully_signed:
        c.saveState()
        c.setFont("Helvetica-Bold", 72)
        c.setFillColor(colors.lightgrey)
        c.translate(width / 2, height / 2)
        c.rotate(35)
        c.drawCentredString(0, 0, "DRAFT — NOT SIGNED")
        c.restoreState()

    # Footer
    c.setFont("Helvetica-Oblique", 9)
    c.drawString(1 * inch, 0.75 * inch, "Generated by MyHomeBro — Preview")
    c.showPage()
    c.save()

    return buf.getvalue()

# ============================== ADAPTER LAYER ================================
def _normalize_pdf_output(maybe: Union[bytes, bytearray, str, None]) -> Optional[bytes]:
    """Accept bytes or a file path (absolute or under MEDIA_ROOT); return bytes or None."""
    if maybe is None:
        return None
    if isinstance(maybe, (bytes, bytearray)):
        return bytes(maybe)
    if isinstance(maybe, str):
        path = maybe
        if not os.path.isabs(path):
            path = os.path.join(_media_root(), path)
        if not os.path.exists(path):
            logger.warning("Generated preview path does not exist: %s", path)
            return None
        try:
            with open(path, "rb") as fh:
                return fh.read()
        except Exception as exc:
            logger.exception("Could not read generated preview PDF: %s", exc)
            return None
    return None


def _try_utils_generator(agreement) -> Optional[bytes]:
    """
    Calls your utils generator and returns bytes.
    Your function may return BYTES or a (RELATIVE or ABSOLUTE) PATH.
    """
    try:
        from projects.utils.pdf import generate_full_agreement_pdf  # type: ignore
    except Exception as exc:
        logger.info("utils.pdf generator not importable: %s", exc)
        return None

    try:
        output = generate_full_agreement_pdf(int(agreement.id), preview=True)  # bytes or path
        return _normalize_pdf_output(output)
    except Exception as exc:
        logger.exception("utils.pdf.generate_full_agreement_pdf failed: %s", exc)
        return None
