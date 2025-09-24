# backend/projects/services/pdf.py
import io
import os
from datetime import datetime
from typing import List

from django.conf import settings
from django.core.files.base import ContentFile

from projects.models import Agreement

DEFAULT_LOGO = os.path.join(getattr(settings, "STATIC_ROOT", ""), "assets", "myhomebro_logo.png")


def _draw_wrapped_text(c, text, x, y, width, line_height=14, max_lines=None, font="Helvetica", size=10):
    if not text:
        return y
    c.setFont(font, size)
    words = str(text).split()
    line = ""
    lines = []
    for w in words:
        test = (line + " " + w).strip()
        if c.stringWidth(test, font, size) <= width:
            line = test
        else:
            lines.append(line)
            line = w
    if line:
        lines.append(line)
    if max_lines:
        lines = lines[:max_lines]
    for ln in lines:
        c.drawString(x, y, ln)
        y -= line_height
    return y


def _timestamp_footer(c, page_num=1, total_pages=1):
    ts = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    footer = f"MyHomeBro • Generated {ts} • Page {page_num}/{total_pages}"
    c.setFont("Helvetica", 8)
    c.drawCentredString(612 / 2, 0.5 * 72, footer)  # LETTER width=612pt, 1in=72pt


def _safe_text(val):
    return "" if val is None else str(val)


def _watermark_preview(c, text="PREVIEW – NOT SIGNED"):
    c.saveState()
    c.setFont("Helvetica-Bold", 48)
    c.setFillGray(0.85)
    c.translate(612 / 2, 792 / 2)  # LETTER height=792pt
    c.rotate(30)
    c.drawCentredString(0, 0, text)
    c.restoreState()


def build_agreement_pdf_bytes(
    agreement: Agreement,
    *,
    version_label: str,
    signer_name: str = "",
    signer_role: str = "",
    signer_ip: str = "",
    user_agent: str = "",
    is_preview: bool = False,
    warranty_type: str = "default",
    warranty_text: str = "",
) -> bytes:
    """
    Returns PDF bytes for an Agreement, used by preview and final.
    Uses lazy imports for reportlab so this module doesn't crash on import.
    """
    # Lazy import reportlab
    try:
        from reportlab.lib.pagesizes import LETTER
        from reportlab.lib.units import inch
        from reportlab.pdfgen import canvas
        from reportlab.lib.utils import ImageReader
    except Exception as e:
        raise ImportError(
            "reportlab is required to generate Agreement PDFs. "
            "Install it with: pip install reportlab"
        ) from e

    buf = io.BytesIO()
    c = canvas.Canvas(buf, pagesize=LETTER)
    width, height = LETTER
    left = 0.75 * inch
    right = width - 0.75 * inch
    usable = right - left
    y = height - 0.75 * inch

    if is_preview:
        _watermark_preview(c)

    # Header with logo
    if os.path.exists(DEFAULT_LOGO):
        try:
            c.drawImage(ImageReader(DEFAULT_LOGO), left, y - 0.5 * inch, width=1.4 * inch, preserveAspectRatio=True, mask="auto")
        except Exception:
            pass
    c.setFont("Helvetica-Bold", 16)
    c.drawRightString(right, y, "Agreement")
    y -= 0.35 * inch

    # Title + IDs
    c.setFont("Helvetica-Bold", 12)
    title = getattr(agreement, "title", getattr(agreement, "project_title", f"Agreement #{agreement.id}"))
    c.drawString(left, y, _safe_text(title))
    c.setFont("Helvetica", 10)
    c.drawRightString(right, y, f"ID: {agreement.id}  •  {version_label or ('preview' if is_preview else 'v1')}")
    y -= 0.25 * inch

    # Parties
    c.setFont("Helvetica-Bold", 11)
    c.drawString(left, y, "Parties")
    y -= 0.18 * inch
    c.setFont("Helvetica", 10)
    contractor = getattr(agreement, "contractor", None)
    contractor_name = f"{getattr(contractor, 'business_name', '')}"
    y = _draw_wrapped_text(c, f"Contractor: {contractor_name}", left, y, usable)
    y = _draw_wrapped_text(
        c,
        f"Homeowner: {getattr(agreement, 'homeowner_name', '')} | {getattr(agreement, 'homeowner_email', '')} | {getattr(agreement, 'homeowner_phone', '')}",
        left,
        y,
        usable,
    )
    y -= 0.1 * inch

    # Scope
    c.setFont("Helvetica-Bold", 11)
    c.drawString(left, y, "Scope Summary")
    y -= 0.18 * inch
    y = _draw_wrapped_text(c, _safe_text(getattr(agreement, "scope_summary", "")), left, y, usable, line_height=12)

    # Totals
    y -= 0.12 * inch
    c.setFont("Helvetica-Bold", 11)
    c.drawString(left, y, "Totals")
    y -= 0.18 * inch
    c.setFont("Helvetica", 10)
    y = _draw_wrapped_text(c, f"Total: ${_safe_text(getattr(agreement, 'total_cost', '0.00'))}", left, y, usable, line_height=12)

    # Warranty
    y -= 0.12 * inch
    c.setFont("Helvetica-Bold", 11)
    c.drawString(left, y, "Warranty")
    y -= 0.18 * inch
    final_warranty_text = (warranty_text or getattr(agreement, "warranty_text_snapshot", "") or "").strip()
    if not final_warranty_text:
        final_warranty_text = (
            "Contractor warrants workmanship for one (1) year from substantial completion. "
            "Materials are covered by manufacturer warranties where applicable. "
            "Warranty excludes damage caused by misuse, neglect, unauthorized modifications, or normal wear. "
            "Remedy is limited to repair or replacement at Contractor’s discretion."
        )
    y = _draw_wrapped_text(c, final_warranty_text, left, y, usable, line_height=12)

    # Terms/Privacy (snapshots if you record them)
    y -= 0.12 * inch
    c.setFont("Helvetica-Bold", 11)
    c.drawString(left, y, "Terms (Snapshot)")
    y -= 0.18 * inch
    y = _draw_wrapped_text(c, _safe_text(getattr(agreement, "terms_of_service_snapshot", ""))[:2000], left, y, usable, line_height=12)

    y -= 0.12 * inch
    c.setFont("Helvetica-Bold", 11)
    c.drawString(left, y, "Privacy (Snapshot)")
    y -= 0.18 * inch
    y = _draw_wrapped_text(c, _safe_text(getattr(agreement, "privacy_policy_snapshot", ""))[:1500], left, y, usable, line_height=12)

    # Signature block (only on final PDFs)
    if not is_preview:
        y -= 0.18 * inch
        c.setFont("Helvetica-Bold", 11)
        c.drawString(left, y, "Signature")
        y -= 0.18 * inch
        c.setFont("Helvetica", 10)
        now = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
        y = _draw_wrapped_text(c, f"Signed by: {''} ({''}) at {now}", left, y, usable)

    _timestamp_footer(c)
    c.showPage()
    c.save()
    pdf_bytes = buf.getvalue()
    buf.close()
    return pdf_bytes


def generate_full_agreement_pdf(agreement: Agreement, *, merge_attachments: bool = True) -> str:
    """
    Builds the base agreement PDF, optionally appends attached PDFs, and saves
    the final file to agreement.pdf_file. Returns the absolute file path.
    Uses lazy import for merging lib to avoid boot crashes if PyPDF2/pypdf is missing.
    """
    base_bytes = build_agreement_pdf_bytes(
        agreement,
        version_label=f"v{getattr(agreement, 'pdf_version', 1) or 1}",
        is_preview=False,
        warranty_type=getattr(agreement, "warranty_type", "default"),
        warranty_text=getattr(agreement, "warranty_text_snapshot", ""),
    )

    tmp_dir = os.path.join(getattr(settings, "MEDIA_ROOT", ""), "agreements", "tmp")
    os.makedirs(tmp_dir, exist_ok=True)
    base_path = os.path.join(tmp_dir, f"agreement_{agreement.id}_v{getattr(agreement,'pdf_version',1) or 1}.pdf")
    with open(base_path, "wb") as f:
        f.write(base_bytes)

    final_path = base_path
    if merge_attachments:
        try:
            # Lazy import merge helper (which imports PyPDF2/pypdf)
            from projects.pdf_utils import append_pdf_attachments
            from projects.models_attachments import AgreementAttachment

            pdf_paths: List[str] = []
            for att in AgreementAttachment.objects.filter(agreement=agreement).order_by("uploaded_at"):
                try:
                    p = att.file.path
                except Exception:
                    p = None
                if p and p.lower().endswith(".pdf") and os.path.exists(p):
                    pdf_paths.append(p)

            merged = append_pdf_attachments(base_path, pdf_paths)
            if merged and os.path.exists(merged):
                final_path = merged
        except Exception as e:
            # Don’t crash the site if merge libs are missing; just skip merge.
            # You can inspect server logs for the exact exception if needed.
            pass

    # persist to FileField agreement.pdf_file
    with open(final_path, "rb") as fh:
        content = ContentFile(fh.read())
        fname = f"agreement_{agreement.id}_v{getattr(agreement,'pdf_version',1) or 1}.pdf"
        agreement.pdf_file.save(fname, content, save=True)

    return agreement.pdf_file.path
