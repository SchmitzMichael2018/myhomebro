# backend/projects/services/pdf_signature_overlay.py
# v2025-10-21 — Overlay signature metadata (timestamp, IP, UA) onto the preview/final PDF's last page.

from __future__ import annotations

import io
from datetime import datetime
from typing import Any

from reportlab.pdfgen import canvas
from reportlab.lib.pagesizes import letter
from reportlab.lib.units import inch

try:
    from PyPDF2 import PdfReader, PdfWriter
except Exception:
    from PyPDF2 import PdfFileReader as PdfReader, PdfFileWriter as PdfWriter  # type: ignore


def _safe(v: Any, default: str = "—") -> str:
    if v is None:
        return default
    s = str(v).strip()
    return s if s else default

def _fmt_dt(v: Any) -> str:
    if not v:
        return "—"
    if isinstance(v, datetime):
        return v.strftime("%Y-%m-%d %H:%M:%S")
    try:
        dt = datetime.fromisoformat(str(v).replace("Z", "+00:00"))
        return dt.strftime("%Y-%m-%d %H:%M:%S")
    except Exception:
        return _safe(v)

def _build_overlay_page(agreement) -> bytes:
    buf = io.BytesIO()
    c = canvas.Canvas(buf, pagesize=letter)
    width, height = letter

    c_name = _safe(getattr(agreement, "contractor_signature_name", None) or getattr(agreement, "contractor_name", None))
    c_at   = _fmt_dt(getattr(agreement, "contractor_signed_at", None) or getattr(agreement, "signed_at_contractor", None))
    c_ip   = _safe(getattr(agreement, "contractor_signature_ip", None) or getattr(agreement, "contractor_signed_ip", None))
    c_ua   = _safe(getattr(agreement, "contractor_signature_useragent", None) or getattr(agreement, "contractor_user_agent", None))

    h_name = _safe(getattr(agreement, "homeowner_signature_name", None) or getattr(agreement, "homeowner_name", None))
    h_at   = _fmt_dt(getattr(agreement, "homeowner_signed_at", None) or getattr(agreement, "signed_at_homeowner", None))
    h_ip   = _safe(getattr(agreement, "homeowner_signature_ip", None) or getattr(agreement, "homeowner_signed_ip", None))
    h_ua   = _safe(getattr(agreement, "homeowner_signature_useragent", None) or getattr(agreement, "homeowner_user_agent", None))

    margin = 0.5 * inch
    box_w = 6.5 * inch
    box_h = 1.6 * inch
    x = width - box_w - margin
    y = margin

    c.setStrokeGray(0.7)
    c.setFillGray(0.96)
    c.rect(x, y, box_w, box_h, fill=1, stroke=1)

    c.setFillGray(0.15)
    c.setFont("Helvetica-Bold", 10)
    c.drawString(x + 10, y + box_h - 14, "Signature Metadata")

    c.setFont("Helvetica", 8)
    line = y + box_h - 30
    c.drawString(x + 10, line, f"Contractor: {c_name}"); line -= 12
    c.drawString(x + 10, line, f"Signed At: {c_at}   IP: {c_ip}"); line -= 12
    c.drawString(x + 10, line, f"User-Agent: {c_ua}"); line -= 14

    c.drawString(x + 10, line, f"Homeowner: {h_name}"); line -= 12
    c.drawString(x + 10, line, f"Signed At: {h_at}   IP: {h_ip}"); line -= 12
    c.drawString(x + 10, line, f"User-Agent: {h_ua}")

    c.showPage(); c.save()
    return buf.getvalue()

def add_signature_overlay(pdf_bytes: bytes, agreement) -> bytes:
    try:
        reader = PdfReader(io.BytesIO(pdf_bytes))
        writer = PdfWriter()

        overlay_bytes = _build_overlay_page(agreement)
        overlay_reader = PdfReader(io.BytesIO(overlay_bytes))
        page_count = len(reader.pages)

        for i, page in enumerate(reader.pages):
            base_page = page
            if i == page_count - 1:
                try:
                    overlay_page = overlay_reader.pages[0]
                    merge_fn = getattr(base_page, "merge_page", None) or getattr(base_page, "mergePage", None)
                    if merge_fn:
                        merge_fn(overlay_page)
                except Exception:
                    pass
            writer.add_page(base_page)

        out = io.BytesIO()
        writer.write(out)
        return out.getvalue()
    except Exception:
        return pdf_bytes
