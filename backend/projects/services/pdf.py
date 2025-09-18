# backend/projects/services/pdf.py
import io
import os
from datetime import datetime
from django.conf import settings
from django.core.files.base import ContentFile
from reportlab.lib.pagesizes import LETTER
from reportlab.lib.units import inch
from reportlab.pdfgen import canvas
from reportlab.lib.utils import ImageReader

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
    c.drawCentredString(LETTER[0]/2, 0.5*inch, footer)

def _safe_text(val):
    return "" if val is None else str(val)

def _watermark_preview(c, text="PREVIEW – NOT SIGNED"):
    c.saveState()
    c.setFont("Helvetica-Bold", 48)
    c.setFillGray(0.85)
    c.translate(LETTER[0]/2, LETTER[1]/2)
    c.rotate(30)
    c.drawCentredString(0, 0, text)
    c.restoreState()

def build_agreement_pdf_bytes(
    agreement,
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
    Returns PDF bytes for an Agreement.

    If is_preview=True, places a big watermark and omits signature lines.
    Warranty is included from provided args (and/or agreement attrs if present).
    """
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
            c.drawImage(ImageReader(DEFAULT_LOGO), left, y - 0.5*inch, width=1.4*inch, preserveAspectRatio=True, mask='auto')
        except Exception:
            pass
    c.setFont("Helvetica-Bold", 16)
    c.drawRightString(right, y, "Agreement")
    y -= 0.35 * inch

    # Title + IDs
    c.setFont("Helvetica-Bold", 12)
    c.drawString(left, y, _safe_text(getattr(agreement, "title", getattr(agreement, "project_title", f"Agreement #{agreement.id}"))))
    c.setFont("Helvetica", 10)
    c.drawRightString(right, y, f"ID: {agreement.id}  •  {version_label or ('preview' if is_preview else 'v1')}")
    y -= 0.25 * inch

    # Parties
    c.setFont("Helvetica-Bold", 11)
    c.drawString(left, y, "Parties")
    y -= 0.18 * inch
    c.setFont("Helvetica", 10)
    contractor = getattr(agreement, "contractor", None)
    contractor_name = f"{getattr(contractor, 'business_name', '')} ({getattr(contractor, 'full_name', '')})" if contractor else ""
    y = _draw_wrapped_text(c, f"Contractor: {contractor_name}", left, y, usable)
    y = _draw_wrapped_text(c, f"Homeowner: {getattr(agreement, 'homeowner_name', '')} | {getattr(agreement, 'homeowner_email', '')} | {getattr(agreement, 'homeowner_phone', '')}", left, y, usable)
    y -= 0.1 * inch

    # Scope
    c.setFont("Helvetica-Bold", 11)
    c.drawString(left, y, "Scope Summary")
    y -= 0.18 * inch
    y = _draw_wrapped_text(c, _safe_text(getattr(agreement, "scope_summary", "")), left, y, usable, line_height=12)

    # Totals
    y -= 0.12 * inch
    c.setFont("Helvetica-Bold", 11)
    c.drawString(left, y, "Financial Summary")
    y -= 0.18 * inch
    c.setFont("Helvetica", 10)
    escrow_total = getattr(agreement, "escrow_total", getattr(agreement, "total_cost", None))
    c.drawString(left, y, f"Escrow/Total: ${escrow_total if escrow_total is not None else '—'}")
    c.drawRightString(right, y, f"Escrow Funded: {'Yes' if getattr(agreement, 'escrow_funded', False) else 'No'}")
    y -= 0.22 * inch

    # Milestones
    c.setFont("Helvetica-Bold", 11)
    c.drawString(left, y, "Milestones")
    y -= 0.18 * inch
    c.setFont("Helvetica", 10)
    milestones = getattr(agreement, "milestone_set", None)
    if milestones:
        for m in milestones.all().order_by("due_date", "id"):
            line = f"- {getattr(m, 'title', '')} | Due: {getattr(m, 'due_date', getattr(m, 'scheduled_date', ''))} | Amount: ${getattr(m, 'amount', '')} | Status: {getattr(m, 'status', '')}"
            y = _draw_wrapped_text(c, line, left, y, usable, line_height=12)
            if y < 1.7 * inch:
                _timestamp_footer(c)
                c.showPage()
                if is_preview:
                    _watermark_preview(c)
                y = height - 0.75 * inch

    # Warranty
    y -= 0.12 * inch
    c.setFont("Helvetica-Bold", 11)
    c.drawString(left, y, "Warranty")
    y -= 0.18 * inch
    c.setFont("Helvetica", 10)

    # Resolve warranty text (prefer provided args, then model attrs)
    provided_text = (warranty_text or "").strip()
    model_text = (getattr(agreement, "warranty_text_snapshot", "") or "").strip()
    final_warranty_text = provided_text or model_text

    if not final_warranty_text:
        # Default one-year labor + manufacturer materials warranty (generic; customize later)
        final_warranty_text = (
            "Contractor warrants workmanship for one (1) year from substantial completion. "
            "Materials are covered by manufacturer warranties where applicable. "
            "Warranty excludes damage caused by misuse, neglect, unauthorized modifications, or normal wear. "
            "Remedy is limited to repair or replacement at Contractor’s discretion."
        )
    y = _draw_wrapped_text(c, final_warranty_text, left, y, usable, line_height=12)

    # Terms/Privacy snapshots
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

    # Signature block (only on final)
    if not is_preview:
        y -= 0.18 * inch
        c.setFont("Helvetica-Bold", 11)
        c.drawString(left, y, "Signature")
        y -= 0.18 * inch
        c.setFont("Helvetica", 10)
        now = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
        y = _draw_wrapped_text(c, f"Signed by: {signer_name or 'N/A'} ({signer_role or 'N/A'}) at {now}", left, y, usable)
        y = _draw_wrapped_text(c, f"IP: {signer_ip or 'N/A'}", left, y, usable)
        y = _draw_wrapped_text(c, f"User-Agent: {user_agent[:250] if user_agent else 'N/A'}", left, y, usable)

    _timestamp_footer(c)
    c.showPage()
    c.save()
    pdf_bytes = buf.getvalue()
    buf.close()
    return pdf_bytes

def attach_pdf_to_agreement(agreement, pdf_bytes: bytes, *, version: int) -> None:
    fname = f"agreement_{agreement.id}_v{version}.pdf"
    agreement.signed_pdf.save(fname, ContentFile(pdf_bytes), save=True)
