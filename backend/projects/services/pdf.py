# backend/projects/services/pdf.py
from __future__ import annotations

import io
import os
from typing import List, Iterable, Optional, Tuple

from django.conf import settings
from django.core.files.base import ContentFile
from django.utils.timezone import localtime

from projects.models import Agreement

DEFAULT_LOGO = os.path.join(getattr(settings, "STATIC_ROOT", ""), "assets", "myhomebro_logo.png")


# ----------------------------- small helpers -----------------------------

def _safe(val) -> str:
    return "" if val is None else str(val)

def _currency(v) -> str:
    try:
        x = float(v or 0)
    except Exception:
        x = 0.0
    return f"${x:,.2f}"

def _file_exists(p: Optional[str]) -> bool:
    return bool(p and os.path.exists(p))

def _find_logo() -> Optional[str]:
    """Find MyHomeBro logo. Try STATIC_ROOT/assets/ first, then BASE_DIR/static/."""
    if _file_exists(DEFAULT_LOGO):
        return DEFAULT_LOGO
    base = getattr(settings, "BASE_DIR", os.getcwd())
    for nm in ("myhomebro_logo.png", "myhomebro_logo.jpg", "myhomebro_logo.jpeg"):
        p = os.path.join(base, "static", nm)
        if _file_exists(p):
            return p
    return None

def _contractor_logo_path(ag: Agreement) -> Optional[str]:
    try:
        logo_field = getattr(getattr(ag, "contractor", None), "logo", None)
        if logo_field and hasattr(logo_field, "path") and os.path.exists(logo_field.path):
            return logo_field.path
    except Exception:
        pass
    return None

def _signature_path(img_field) -> Optional[str]:
    try:
        if img_field and hasattr(img_field, "path") and os.path.exists(img_field.path):
            return img_field.path
    except Exception:
        pass
    return None


# --------------------------- watermark & footer --------------------------

def _watermark_preview(c, text="PREVIEW – NOT SIGNED"):
    c.saveState()
    c.setFont("Helvetica-Bold", 48)
    c.setFillGray(0.85)
    # US Letter 612x792
    c.translate(612 / 2, 792 / 2)
    c.rotate(30)
    c.drawCentredString(0, 0, text)
    c.restoreState()

def _header_footer(canvas, doc):
    """Header rule + page footer (timestamp + page N)."""
    from reportlab.lib import colors
    from reportlab.lib.pagesizes import letter
    from reportlab.lib.units import inch

    canvas.saveState()
    w, h = letter
    # header rule
    canvas.setStrokeColor(colors.HexColor("#E5E7EB"))
    canvas.setLineWidth(0.6)
    canvas.line(0.75 * inch, h - 0.85 * inch, w - 0.75 * inch, h - 0.85 * inch)

    # footer text
    canvas.setFont("Helvetica", 9)
    ts = localtime().strftime("%Y-%m-%d %H:%M")
    left = "MyHomeBro — Agreement PDF"
    right = f"Generated {ts}  |  Page {canvas.getPageNumber()}"
    canvas.setFillColor(colors.HexColor("#475569"))
    canvas.drawString(0.75 * inch, 0.6 * inch, left)
    tw = canvas.stringWidth(right, "Helvetica", 9)
    canvas.drawString(w - 0.75 * inch - tw, 0.6 * inch, right)
    canvas.restoreState()


# ------------------------- ReportLab / Platypus setup --------------------

def _styles():
    from reportlab.lib import colors
    from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
    ss = getSampleStyleSheet()
    h1 = ss["Heading1"]; h1.fontSize = 18; h1.spaceAfter = 10
    h2 = ss["Heading2"]; h2.fontSize = 14; h2.spaceBefore = 6; h2.spaceAfter = 6
    body = ss["BodyText"]; body.fontSize = 10; body.leading = 13
    small = ParagraphStyle("Small", parent=body, fontSize=9, leading=12, textColor=colors.HexColor("#475569"))
    return h1, h2, body, small

def _party_lines(ag: Agreement) -> Tuple[str, str]:
    contractor_name = (
        getattr(ag, "contractor_business_name", None)
        or getattr(getattr(ag, "contractor", None), "business_name", None)
        or getattr(getattr(ag, "contractor", None), "name", None)
        or getattr(ag, "contractor_name", None)
        or "Contractor"
    )
    contractor_email = getattr(ag, "contractor_email", None) or getattr(getattr(ag, "contractor", None), "email", None) or ""
    contractor_phone = getattr(ag, "contractor_phone", None) or getattr(getattr(ag, "contractor", None), "phone", None) or ""
    contractor_line = contractor_name
    if contractor_email:
        contractor_line += f" • {contractor_email}"
    if contractor_phone:
        contractor_line += f" • {contractor_phone}"

    homeowner_name = (
        getattr(ag, "homeowner_name", None)
        or getattr(getattr(ag, "homeowner", None), "name", None)
        or getattr(getattr(ag, "homeowner", None), "full_name", None)
        or "Homeowner"
    )
    homeowner_email = getattr(ag, "homeowner_email", None) or getattr(getattr(ag, "homeowner", None), "email", None) or ""
    homeowner_phone = getattr(getattr(ag, "homeowner", None), "phone", None) or ""
    homeowner_line = homeowner_name
    if homeowner_email:
        homeowner_line += f" • {homeowner_email}"
    if homeowner_phone:
        homeowner_line += f" • {homeowner_phone}"

    return contractor_line, homeowner_line


# ----------------------------- Story builder -----------------------------

def _build_story(ag: Agreement, *, is_preview=False) -> Iterable:
    """
    Build the full Agreement document story (auto-paginates), WITHOUT embedding ToS/Privacy.
    """
    from reportlab.lib import colors
    from reportlab.lib.units import inch
    from reportlab.platypus import (
        Paragraph, Spacer, Table, TableStyle, Image, PageBreak, KeepTogether
    )

    h1, h2, body, small = _styles()

    story: List = []

    # Logos row
    myhb_logo = _find_logo()
    co_logo = _contractor_logo_path(ag)
    row = []
    if co_logo:
        try:
            row.append(Image(co_logo, width=0.9 * inch, height=0.9 * inch))
        except Exception:
            row.append(Spacer(1, 0.9 * inch))
    else:
        row.append(Spacer(1, 0.9 * inch))
    if myhb_logo:
        try:
            row.append(Image(myhb_logo, width=0.9 * inch, height=0.9 * inch))
        except Exception:
            row.append(Spacer(1, 0.9 * inch))
    else:
        row.append(Spacer(1, 0.9 * inch))
    t_logo = Table([row], colWidths=[1 * inch, 1 * inch])
    t_logo.setStyle(TableStyle([("ALIGN", (0, 0), (-1, -1), "LEFT"),
                                ("VALIGN", (0, 0), (-1, -1), "MIDDLE")]))
    story += [t_logo, Spacer(1, 6)]

    # Title and meta
    story.append(Paragraph(f"Agreement #{_safe(getattr(ag, 'pk', ''))}", h1))
    proj_title = _safe(getattr(ag, "project_title", None) or getattr(ag, "title", None) or "Project")
    story.append(Paragraph(proj_title, body))
    story.append(Spacer(1, 2))

    contractor_line, homeowner_line = _party_lines(ag)
    story.append(Paragraph("<b>Contractor</b>: " + contractor_line, body))
    story.append(Paragraph("<b>Homeowner</b>: " + homeowner_line, body))

    ptype = _safe(getattr(ag, "project_type", None))
    psub = _safe(getattr(ag, "project_subtype", None))
    start = _safe(getattr(ag, "start", None) or "TBD")
    end = _safe(getattr(ag, "end", None) or "TBD")
    story.append(Paragraph(f"<b>Type</b>: {ptype or '—'}{(' — ' + psub) if psub else ''}", body))
    story.append(Paragraph(f"<b>Schedule</b>: {start} → {end}", body))
    status = _safe(getattr(ag, "status", "draft"))
    story.append(Paragraph(f"<b>Status</b>: {status}", small))
    story.append(Spacer(1, 10))

    # Scope / description
    desc = _safe(getattr(ag, "description", None) or getattr(ag, "scope_summary", None))
    if desc:
        story += [Paragraph("Scope / Description", h2),
                  Paragraph(desc.replace("\n", "<br/>"), body),
                  Spacer(1, 8)]

    # Milestones table
    from projects.models import Milestone
    ms = Milestone.objects.filter(agreement=ag).order_by("order", "id")
    data = [["#", "Milestone", "Due", "Amount", "Status"]]
    total = 0.0
    for i, m in enumerate(ms, 1):
        title = _safe(m.title or m.description or "—")
        due = getattr(m, "due_date", None) or getattr(m, "target_date", None) or \
              getattr(m, "completion_date", None) or getattr(m, "end", None) or None
        due_str = _safe(due) if due else "—"
        amt = float(getattr(m, "amount", 0) or 0)
        total += amt
        status_str = "Complete" if getattr(m, "completed", False) else (_safe(getattr(m, "status", "")) or "Pending")
        data.append([str(i), title, due_str, _currency(amt), status_str])

    data.append(["", "", "Total", _currency(total), ""])
    table = Table(data, colWidths=[0.35 * inch, 3.8 * inch, 1.25 * inch, 1.1 * inch, 1.2 * inch])
    table.setStyle(TableStyle([
        ("FONT", (0, 0), (-1, 0), "Helvetica-Bold"),
        ("BACKGROUND", (0, 0), (-1, 0), colors.HexColor("#F8FAFC")),
        ("TEXTCOLOR", (0, 0), (-1, 0), colors.HexColor("#475569")),
        ("GRID", (0, 0), (-1, -1), 0.25, colors.HexColor("#E5E7EB")),
        ("ALIGN", (0, 0), (-1, -1), "LEFT"),
        ("ALIGN", (2, 1), (2, -1), "CENTER"),
        ("ALIGN", (3, 1), (3, -1), "RIGHT"),
        ("ALIGN", (4, 1), (4, -2), "CENTER"),
        ("FONT", (2, -1), (3, -1), "Helvetica-Bold"),
        ("BACKGROUND", (0, -1), (-1, -1), colors.HexColor("#FAFAFA")),
    ]))
    story += [Paragraph("Milestones", h2), table, Spacer(1, 10)]

    # Warranty
    story.append(Paragraph("Warranty", h2))
    wtype = (_safe(getattr(ag, "warranty_type", ""))).strip().lower()
    wtext = _safe(getattr(ag, "warranty_text_snapshot", ""))
    if wtype in ("default", "standard", "std"):
        story.append(Paragraph(
            "Default workmanship warranty applies. Contractor warrants that all work will be "
            "performed in a good and workmanlike manner and in accordance with applicable codes. "
            "Defects arising from normal wear, misuse, abuse, or acts of God are excluded.",
            body
        ))
    elif wtype == "custom" and wtext:
        story.append(Paragraph(wtext.replace("\n", "<br/>"), body))
    else:
        story.append(Paragraph(wtext or "No specific warranty clause provided.", body))
    story.append(Spacer(1, 10))

    # Attachments & Addenda
    story.append(Paragraph("Attachments & Addenda", h2))
    try:
        atts = list(ag.attachments.all())
    except Exception:
        atts = []
    if atts:
        rows = [["Category", "Title / File", "Acknowledgement Required"]]
        for f in atts:
            cat = _safe(getattr(f, "category", "OTHER")).upper()
            ttl = _safe(getattr(f, "title", None) or getattr(f, "filename", None) or "Attachment")
            ack = "Yes" if getattr(f, "require_acknowledgement", False) else "No"
            rows.append([cat, ttl, ack])
        att_table = Table(rows, colWidths=[1.2 * inch, 4.5 * inch, 1.3 * inch])
        att_table.setStyle(TableStyle([
            ("FONT", (0, 0), (-1, 0), "Helvetica-Bold"),
            ("BACKGROUND", (0, 0), (-1, 0), colors.HexColor("#F8FAFC")),
            ("TEXTCOLOR", (0, 0), (-1, 0), colors.HexColor("#475569")),
            ("GRID", (0, 0), (-1, -1), 0.25, colors.HexColor("#E5E7EB")),
            ("ALIGN", (0, 0), (-1, -1), "LEFT"),
            ("ALIGN", (2, 1), (2, -1), "CENTER"),
        ]))
        story += [att_table, Spacer(1, 10)]
    else:
        story += [Paragraph("No additional attachments.", body), Spacer(1, 10)]

    # Signatures page (separate page)
    story.append(PageBreak())
    story.append(Paragraph("Signatures", h2))
    story.append(Spacer(1, 6))

    from reportlab.platypus import Image, Table, TableStyle, Spacer as RLSpacer

    c_sig_name = _safe(getattr(ag, "contractor_signature_name", None))
    c_sig_img = _signature_path(getattr(ag, "contractor_signature", None))
    c_sig_time = getattr(ag, "contractor_signed_at", None)
    c_sig_time_str = localtime(c_sig_time).strftime("%Y-%m-%d %H:%M") if c_sig_time else "—"

    h_sig_name = _safe(getattr(ag, "homeowner_signature_name", None))
    h_sig_img = _signature_path(getattr(ag, "homeowner_signature", None))
    h_sig_time = getattr(ag, "homeowner_signed_at", None)
    h_sig_time_str = localtime(h_sig_time).strftime("%Y-%m-%d %H:%M") if h_sig_time else "—"

    c_cell = []
    if c_sig_img:
        try:
            c_cell += [Image(c_sig_img, width=1.8 * inch, height=0.6 * inch), RLSpacer(1, 3)]
        except Exception:
            pass
    c_cell += [Paragraph(f"<b>Contractor Signature:</b> {c_sig_name or '—'}", body),
               Paragraph(f"<b>Signed At:</b> {c_sig_time_str}", small)]

    h_cell = []
    if h_sig_img:
        try:
            h_cell += [Image(h_sig_img, width=1.8 * inch, height=0.6 * inch), RLSpacer(1, 3)]
        except Exception:
            pass
    h_cell += [Paragraph(f"<b>Homeowner Signature:</b> {h_sig_name or '—'}", body),
               Paragraph(f"<b>Signed At:</b> {h_sig_time_str}", small)]

    sig_table = Table([[c_cell, h_cell]], colWidths=[3.5 * inch, 3.5 * inch])
    sig_table.setStyle(TableStyle([("VALIGN", (0, 0), (-1, -1), "TOP")]))
    story += [sig_table, Spacer(1, 10)]

    # Preview watermark note
    if is_preview:
        story += [Paragraph("This is a preview. Final version will include updated signature data.", small)]

    return story


# ----------------------------- build / save ------------------------------

def build_agreement_pdf_bytes(agreement: Agreement, *, is_preview: bool = False) -> bytes:
    """
    Render a complete Agreement PDF to bytes (for preview or final), WITHOUT ToS/Privacy.
    """
    # Lazy import so module import doesn't crash if reportlab is missing
    try:
        from reportlab.lib.pagesizes import letter
        from reportlab.lib.units import inch
        from reportlab.platypus import SimpleDocTemplate
    except Exception as e:
        raise ImportError(
            "reportlab is required to generate Agreement PDFs. Install with: pip install reportlab"
        ) from e

    buf = io.BytesIO()
    doc = SimpleDocTemplate(
        buf,
        pagesize=letter,
        leftMargin=0.75 * inch,
        rightMargin=0.75 * inch,
        topMargin=1.0 * inch,
        bottomMargin=0.75 * inch,
        title=f"Agreement #{getattr(agreement, 'pk', '')}",
        author="MyHomeBro",
    )

    story = list(_build_story(agreement, is_preview=is_preview))

    def _first(canvas, doc_):
        if is_preview:
            _watermark_preview(canvas)
        _header_footer(canvas, doc_)

    def _later(canvas, doc_):
        if is_preview:
            _watermark_preview(canvas)
        _header_footer(canvas, doc_)

    doc.build(story, onFirstPage=_first, onLaterPages=_later)
    pdf = buf.getvalue()
    buf.close()
    return pdf


def generate_full_agreement_pdf(agreement: Agreement, *, merge_attachments: bool = True) -> str:
    """
    Builds a complete Agreement PDF and saves a versioned file to agreement.pdf_file.
    Returns the absolute file path. Optionally merges PDF attachments (if utilities exist).
    """
    version_num = int(getattr(agreement, "pdf_version", 0) or 0) + 1
    bytes_ = build_agreement_pdf_bytes(agreement, is_preview=False)

    # store temp base file
    tmp_dir = os.path.join(getattr(settings, "MEDIA_ROOT", ""), "agreements", "tmp")
    os.makedirs(tmp_dir, exist_ok=True)
    base_path = os.path.join(tmp_dir, f"agreement_{agreement.id}_v{version_num}.pdf")
    with open(base_path, "wb") as f:
        f.write(bytes_)

    final_path = base_path

    if merge_attachments:
        try:
            # Optional: merge PDF attachments (if your helper exists)
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
        except Exception:
            # If merge libs aren't available, skip silently.
            pass

    # save to the model FileField
    with open(final_path, "rb") as fh:
        content = ContentFile(fh.read())
        fname = f"agreement_{agreement.id}_v{version_num}.pdf"
        agreement.pdf_file.save(fname, content, save=True)
        if hasattr(agreement, "pdf_version"):
            try:
                agreement.pdf_version = version_num
                agreement.save(update_fields=["pdf_version", "pdf_file"])
            except Exception:
                pass

    return agreement.pdf_file.path
