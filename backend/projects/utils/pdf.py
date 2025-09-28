# backend/projects/utils/pdf.py
# v2025-09-26 — Full Agreement PDF (ReportLab) + Attachments TOC + Stamped PDF Append (PyPDF2)
#
# Public API:
#   generate_full_agreement_pdf(agreement_id: int, preview: bool=False) -> str
#
# Features:
# - Branded cover (MyHomeBro + contractor logos, business/customer info)
# - Agreement details, milestones, warranty
# - Inline image attachments (PNG/JPG, etc.)
# - PDF attachments:
#     * Mini Table of Contents listing Attachment A/B/C... with starting page numbers
#     * Each appended PDF page stamped with "Attachment <Letter> — <Title>"
# - Signatures with timestamps (and IP if available)
# - Page numbers + generated timestamp on every page
#
# Notes:
# - If PyPDF2 is unavailable, PDFs are summarized in the TOC but not appended.
# - All paths returned are RELATIVE to MEDIA_ROOT.

import os
import io
import math
import string
from decimal import Decimal
from datetime import datetime

from django.conf import settings
from django.utils import timezone
from django.utils.text import slugify

from reportlab.lib import colors
from reportlab.lib.enums import TA_RIGHT, TA_JUSTIFY
from reportlab.lib.pagesizes import letter
from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
from reportlab.lib.units import mm
from reportlab.pdfgen import canvas
from reportlab.platypus import (
    SimpleDocTemplate, Paragraph, Spacer, Table, TableStyle, Image, KeepTogether
)

# Optional: merge/overlay PDF attachments
try:
    from PyPDF2 import PdfReader, PdfWriter
    _HAS_PYPDF2 = True
except Exception:
    _HAS_PYPDF2 = False

# Models (safe imports)
from projects.models import Agreement, Milestone
try:
    from projects.models import AgreementAttachment
except Exception:
    AgreementAttachment = None


# ----------------- small helpers -----------------
def _money(v):
    try:
        return f"${Decimal(v):,.2f}"
    except Exception:
        try:
            return f"${Decimal(str(v)):,.2f}"
        except Exception:
            return "-"

def _fmt_dt(v):
    try:
        if not v:
            return "-"
        if hasattr(v, "strftime"):
            return v.strftime("%Y-%m-%d %H:%M")
        return str(v)
    except Exception:
        return "-"

def _fmt_date(v):
    try:
        if not v:
            return "-"
        return v.strftime("%Y-%m-%d")
    except Exception:
        return str(v) or "-"

def _safe(obj, name, default=""):
    try:
        val = getattr(obj, name, default)
        return "" if val is None else val
    except Exception:
        return default

def _media_root():
    mr = getattr(settings, "MEDIA_ROOT", None)
    if not mr:
        raise RuntimeError("MEDIA_ROOT is not configured")
    return mr

def _static_logo_paths():
    base_dir = getattr(settings, "BASE_DIR", os.getcwd())
    candidates = [
        os.path.join(base_dir, "backend", "static", "myhomebro_logo.png"),
        os.path.join(getattr(settings, "STATIC_ROOT", "") or "", "myhomebro_logo.png"),
    ]
    for p in candidates:
        if p and os.path.exists(p):
            return p
    return None

def _contractor_logo_path(agreement):
    try:
        contractor = getattr(agreement, "contractor", None)
        for field in ("logo", "logo_file", "company_logo", "business_logo", "logo_path"):
            f = getattr(contractor, field, None)
            if not f:
                continue
            if hasattr(f, "path") and os.path.exists(f.path):
                return f.path
            if isinstance(f, str):
                p = os.path.join(_media_root(), f) if not os.path.isabs(f) else f
                if os.path.exists(p):
                    return p
    except Exception:
        pass
    return None


# ----------------- header/footer -----------------
class HeaderFooter:
    def __init__(self, title_text, sub_text):
        self.title_text = title_text
        self.sub_text = sub_text

    def draw(self, canv: canvas.Canvas, doc):
        w, h = letter
        canv.saveState()
        # Top rule
        canv.setStrokeColor(colors.HexColor("#E5E7EB"))
        canv.setLineWidth(0.6)
        canv.line(18*mm, h - 24*mm, w - 18*mm, h - 24*mm)
        # Title
        canv.setFont("Helvetica-Bold", 11)
        canv.setFillColor(colors.HexColor("#111827"))
        canv.drawString(18*mm, h - 16*mm, (self.title_text or "")[:120])
        # Sub
        canv.setFont("Helvetica", 8)
        canv.setFillColor(colors.HexColor("#6B7280"))
        canv.drawString(18*mm, h - 21*mm, (self.sub_text or "")[:140])
        # Footer
        canv.setFont("Helvetica", 8)
        canv.setFillColor(colors.HexColor("#6B7280"))
        canv.drawString(18*mm, 12*mm, f"Generated {timezone.now().strftime('%Y-%m-%d %H:%M %Z')}")
        canv.drawRightString(w - 18*mm, 12*mm, f"Page {doc.page}")
        canv.restoreState()


# ----------------- core generator -----------------
def generate_full_agreement_pdf(agreement_id: int, preview: bool = False) -> str:
    media_root = _media_root()

    # Data
    ag = Agreement.objects.select_related("contractor", "project").filter(pk=agreement_id).first()
    if not ag:
        raise ValueError(f"Agreement {agreement_id} not found")

    milestones = list(Milestone.objects.filter(agreement_id=agreement_id).order_by("id"))
    attachments = []
    if AgreementAttachment:
        try:
            attachments = list(AgreementAttachment.objects.filter(agreement_id=agreement_id).order_by("id"))
        except Exception:
            attachments = []

    # Output path
    folder = os.path.join("agreements", str(agreement_id), "previews" if preview else "final")
    os.makedirs(os.path.join(media_root, folder), exist_ok=True)
    ts = timezone.now().strftime("%Y%m%d-%H%M%S")
    fn_slug = slugify(_safe(ag, "title", f"agreement-{agreement_id}")) or f"agreement-{agreement_id}"
    filename = f"{ts}-{fn_slug}.pdf"
    rel_path = os.path.join(folder, filename)
    abs_path = os.path.join(media_root, rel_path)

    # Styles
    styles = getSampleStyleSheet()
    s_h1 = ParagraphStyle("h1", parent=styles["Heading1"], fontName="Helvetica-Bold", fontSize=16, leading=20, spaceAfter=8, textColor=colors.HexColor("#111827"))
    s_h2 = ParagraphStyle("h2", parent=styles["Heading2"], fontName="Helvetica-Bold", fontSize=13, leading=16, spaceAfter=6, textColor=colors.HexColor("#111827"))
    s_p  = ParagraphStyle("p",  parent=styles["Normal"],   fontName="Helvetica", fontSize=9.5, leading=13, spaceAfter=4, textColor=colors.HexColor("#111827"))
    s_small = ParagraphStyle("small", parent=styles["Normal"], fontName="Helvetica", fontSize=8, leading=11, textColor=colors.HexColor("#6B7280"))
    s_justify = ParagraphStyle("just", parent=s_p, alignment=TA_JUSTIFY)

    # Build base doc
    buf = io.BytesIO()
    doc = SimpleDocTemplate(
        buf, pagesize=letter,
        rightMargin=18*mm, leftMargin=18*mm, topMargin=28*mm, bottomMargin=24*mm,
        title=f"Agreement #{agreement_id}", author="MyHomeBro"
    )
    story = []

    # Logos row
    mhb_logo = _static_logo_paths()
    con_logo = _contractor_logo_path(ag)
    from reportlab.platypus import Table
    left = []
    if mhb_logo and os.path.exists(mhb_logo):
        try:
            left.append(Image(mhb_logo, width=120, height=24, kind="proportional"))
        except Exception:
            pass
    right_obj = ""
    if con_logo and os.path.exists(con_logo):
        try:
            right_obj = Image(con_logo, width=140, height=36, kind="proportional")
        except Exception:
            right_obj = ""
    logos_tbl = Table([[KeepTogether(left), right_obj]], colWidths=[None, 160])
    logos_tbl.setStyle(TableStyle([
        ("VALIGN", (0,0), (-1,-1), "MIDDLE"),
        ("ALIGN", (1,0), (1,0), "RIGHT"),
        ("LEFTPADDING",(0,0), (-1,-1), 0),
        ("RIGHTPADDING",(0,0), (-1,-1), 0),
        ("TOPPADDING",(0,0), (-1,-1), 0),
        ("BOTTOMPADDING",(0,0), (-1,-1), 2),
    ]))
    story.append(logos_tbl)
    story.append(Spacer(1, 6))

    # Title + number
    story.append(Paragraph(_safe(ag, "title", "Agreement"), s_h1))
    story.append(Paragraph(f"Agreement #: <b>{agreement_id}</b>", s_small))

    # Contractor/customer details
    contractor = _safe(ag, "contractor", None)
    business_name = _safe(contractor, "business_name", _safe(contractor, "name", ""))
    c_email = _safe(contractor, "email", "")
    c_phone = _safe(contractor, "phone", "")
    c_addr  = ", ".join([_safe(contractor, "address1", ""), _safe(contractor, "city", ""), _safe(contractor, "state", ""), _safe(contractor, "zip", "")]).strip(", ")

    h_name  = _safe(ag, "homeowner_name", _safe(ag, "homeowner", ""))
    h_email = _safe(ag, "homeowner_email", "")
    h_phone = _safe(ag, "homeowner_phone", "")

    facts_left = [
        ["Contractor", business_name or "-"],
        ["Email", c_email or "-"],
        ["Phone", c_phone or "-"],
        ["Address", c_addr or "-"],
    ]
    facts_right = [
        ["Customer", h_name or "-"],
        ["Email", h_email or "-"],
        ["Phone", h_phone or "-"],
        ["", ""],
    ]
    facts_tbl = Table([[Table(facts_left, colWidths=[70, None]), Table(facts_right, colWidths=[70, None])]])
    facts_tbl.setStyle(TableStyle([
        ("FONT", (0,0), (-1,-1), "Helvetica", 9.5),
        ("LEFTPADDING",(0,0), (-1,-1), 0),
        ("RIGHTPADDING",(0,0), (-1,-1), 0),
        ("VALIGN", (0,0), (-1,-1), "TOP"),
    ]))
    story.append(Spacer(1, 4))
    story.append(facts_tbl)
    story.append(Spacer(1, 6))

    # Project facts
    project_type    = _safe(ag, "project_type", "")
    project_subtype = _safe(ag, "project_subtype", "")
    start_dt        = _safe(ag, "start", "")
    end_dt          = _safe(ag, "end", "")
    display_total   = _money(_safe(ag, "display_total", _safe(ag, "total_cost", "0")))
    proj_rows = [
        ["Project Type", project_type or "-"],
        ["Project Subtype", project_subtype or "-"],
        ["Start", start_dt or "-"],
        ["End", end_dt or "-"],
        ["Total", display_total or "-"],
    ]
    proj_tbl = Table(proj_rows, colWidths=[110, None])
    proj_tbl.setStyle(TableStyle([
        ("FONT", (0,0), (0,-1), "Helvetica-Bold", 9.5),
        ("FONT", (1,0), (1,-1), "Helvetica", 9.5),
        ("ROWSPACING", (0,0), (-1,-1), 2),
        ("LINEBELOW", (0,-1), (-1,-1), 0.25, colors.HexColor("#E5E7EB")),
    ]))
    story.append(proj_tbl)
    story.append(Spacer(1, 6))

    # Description
    desc = _safe(ag, "description", _safe(ag, "job_description", ""))
    if desc:
        story.append(Paragraph("Description of Work", s_h2))
        for ln in str(desc).splitlines():
            t = ln.strip()
            if not t:
                continue
            story.append(Paragraph(t, s_justify))
        story.append(Spacer(1, 6))

    # Milestones
    if milestones:
        story.append(Paragraph("Milestones", s_h2))
        rows = [["Title", "Start", "End", "Amount", "Status"]]
        for m in milestones:
            rows.append([
                _safe(m, "title", "-"),
                _fmt_date(_safe(m, "start_date", None)),
                _fmt_date(_safe(m, "end_date", None)),
                _money(_safe(m, "amount", 0)),
                _safe(m, "status", _safe(m, "state", "-")),
            ])
        mt = Table(rows, colWidths=[None, 70, 70, 70, 70], repeatRows=1)
        mt.setStyle(TableStyle([
            ("BACKGROUND", (0,0), (-1,0), colors.HexColor("#EEF2FF")),
            ("FONT", (0,0), (-1,0), "Helvetica-Bold", 9),
            ("FONT", (0,1), (-1,-1), "Helvetica", 9),
            ("GRID", (0,0), (-1,-1), 0.25, colors.HexColor("#E5E7EB")),
            ("ALIGN", (1,1), (-1,-1), "CENTER"),
            ("ALIGN", (3,1), (3,-1), "RIGHT"),
        ]))
        story.append(mt)
        story.append(Spacer(1, 8))

    # Warranty
    story.append(Paragraph("Warranty", s_h2))
    warranty_type = str(_safe(ag, "warranty_type", "")).upper()
    default_warranty_text = _safe(ag, "default_warranty_text", "")
    custom_warranty = _safe(ag, "warranty_text_snapshot", _safe(ag, "custom_warranty_text", ""))
    use_default = warranty_type in ("", "DEFAULT") or (not custom_warranty)
    w_txt = custom_warranty if not use_default else (default_warranty_text or
        "Contractor warrants workmanship for one (1) year from substantial completion. Manufacturer warranties apply where applicable. "
        "Warranty excludes damage caused by misuse, neglect, unauthorized modifications, or normal wear. "
        "Remedy is limited to repair or replacement at Contractor’s discretion."
    )
    story.append(Paragraph(w_txt.replace("\n", "<br/>"), s_justify))
    story.append(Spacer(1, 8))

    # Attachment summary + collect files by type
    pdf_attachments = []
    image_attachments = []
    if attachments:
        story.append(Paragraph("Attachments & Addenda", s_h2))
        rows = [["Title", "Category", "Visible", "Ack Required"]]
        for a in attachments:
            rows.append([
                _safe(a, "title", "-"),
                _safe(a, "category", "-"),
                "Yes" if _safe(a, "visible", False) else "No",
                "Yes" if _safe(a, "ack_required", False) else "No",
            ])
            # detect actual file
            try:
                file_field = getattr(a, "file", None) or getattr(a, "document", None) or getattr(a, "path", None)
                fpath = ""
                if hasattr(file_field, "path"):
                    fpath = file_field.path
                elif isinstance(file_field, str):
                    fpath = file_field if os.path.isabs(file_field) else os.path.join(media_root, file_field)
                if fpath and os.path.exists(fpath):
                    ext = os.path.splitext(fpath)[1].lower()
                    if ext in (".pdf",):
                        pdf_attachments.append((fpath, _safe(a, "title", os.path.basename(fpath))))
                    elif ext in (".png", ".jpg", ".jpeg", ".gif", ".bmp", ".tif", ".tiff"):
                        image_attachments.append((fpath, _safe(a, "title", os.path.basename(fpath))))
            except Exception:
                pass

        at = Table(rows, colWidths=[None, 120, 60, 80], repeatRows=1)
        at.setStyle(TableStyle([
            ("BACKGROUND", (0,0), (-1,0), colors.HexColor("#F3F4F6")),
            ("FONT", (0,0), (-1,0), "Helvetica-Bold", 9),
            ("FONT", (0,1), (-1,-1), "Helvetica", 9),
            ("GRID", (0,0), (-1,-1), 0.25, colors.HexColor("#E5E7EB")),
        ]))
        story.append(at)
        story.append(Spacer(1, 6))

        # Inline image attachments
        if image_attachments:
            story.append(Paragraph("Attachment Images", s_h2))
            for (img_path, ititle) in image_attachments:
                try:
                    story.append(Paragraph(ititle or os.path.basename(img_path), s_small))
                    story.append(Image(img_path, width=460, height=9999, kind="proportional"))
                    story.append(Spacer(1, 8))
                except Exception:
                    continue

    # Signatures
    story.append(Paragraph("Signatures", s_h2))
    c_signed_at = _safe(ag, "signed_at_contractor", _safe(ag, "contractor_signed_at", None))
    c_ip        = _safe(ag, "contractor_signed_ip", _safe(ag, "contractor_ip", ""))
    c_sigfile   = _safe(ag, "contractor_signature_file", _safe(ag, "contractor_signature_path", ""))

    h_signed_at = _safe(ag, "signed_at_homeowner", None)
    h_ip        = _safe(ag, "homeowner_signed_ip", _safe(ag, "homeowner_ip", ""))
    h_sigfile   = _safe(ag, "homeowner_signature_file", _safe(ag, "homeowner_signature_path", ""))

    if c_sigfile:
        c_abs = c_sigfile.path if hasattr(c_sigfile, "path") else (c_sigfile if os.path.isabs(c_sigfile) else os.path.join(media_root, c_sigfile))
        if c_abs and os.path.exists(c_abs):
            try: story.append(Image(c_abs, width=140, height=999, kind="proportional"))
            except Exception: pass
    story.append(Paragraph(f"Contractor Signed: {_fmt_dt(c_signed_at)}  {('IP: '+str(c_ip)) if c_ip else ''}", s_small))
    story.append(Spacer(1, 2))

    if h_sigfile:
        h_abs = h_sigfile.path if hasattr(h_sigfile, "path") else (h_sigfile if os.path.isabs(h_sigfile) else os.path.join(media_root, h_sigfile))
        if h_abs and os.path.exists(h_abs):
            try: story.append(Image(h_abs, width=140, height=999, kind="proportional"))
            except Exception: pass
    story.append(Paragraph(f"Homeowner Signed: {_fmt_dt(h_signed_at)}  {('IP: '+str(h_ip)) if h_ip else ''}", s_small))

    # Build base
    hdr = HeaderFooter(
        title_text=f"MyHomeBro Agreement #{agreement_id}",
        sub_text=f"{business_name or 'Contractor'} — {_safe(ag, 'title', 'Agreement')}",
    )
    doc.build(story, onFirstPage=hdr.draw, onLaterPages=hdr.draw)

    # Write base PDF
    with open(abs_path, "wb") as f:
        f.write(buf.getvalue())

    # Append PDFs with TOC and headers
    if pdf_attachments and _HAS_PYPDF2:
        try:
            # 1) Read base and count pages
            base_reader = PdfReader(abs_path)
            base_count = len(base_reader.pages)

            # 2) Pre-scan attachments to get page counts
            att_pages = []
            for (path, title) in pdf_attachments:
                try:
                    r = PdfReader(path)
                    att_pages.append(len(r.pages))
                except Exception:
                    att_pages.append(0)

            # 3) Compute TOC size (lines per page ~38, adjust as needed)
            lines = len(pdf_attachments)
            lines_per_page = 38
            toc_pages = max(1, math.ceil(lines / lines_per_page))

            # 4) Compute starting pages for each attachment (1-based)
            starts = []
            running = base_count + toc_pages
            for count in att_pages:
                starts.append(running + 1)
                running += count

            # 5) Build TOC PDF (attachments list)
            toc_buf = io.BytesIO()
            c = canvas.Canvas(toc_buf, pagesize=letter)
            w, h = letter
            c.setFont("Helvetica-Bold", 14)
            c.drawString(18*mm, h - 30*mm, "Attachments — Table of Contents")
            c.setFont("Helvetica", 9.5)
            y = h - 40*mm
            idx = 0
            for i, (path, title) in enumerate(pdf_attachments):
                letter_label = string.ascii_uppercase[i] if i < 26 else f"Att-{i+1}"
                line = f"{letter_label}. {title or os.path.basename(path)}"
                c.drawString(18*mm, y, line[:95])
                # right-aligned page num
                c.drawRightString(w - 18*mm, y, f"p. {starts[i] if att_pages[i]>0 else '—'}")
                y -= 6*mm
                idx += 1
                if (idx % lines_per_page) == 0 and (i+1) < len(pdf_attachments):
                    c.showPage()
                    c.setFont("Helvetica-Bold", 14)
                    c.drawString(18*mm, h - 30*mm, "Attachments — Table of Contents (cont.)")
                    c.setFont("Helvetica", 9.5)
                    y = h - 40*mm
            c.showPage()
            c.save()
            toc_reader = PdfReader(io.BytesIO(toc_buf.getvalue()))

            # 6) Create stamped pages for each attachment and merge
            writer = PdfWriter()
            # add all base pages
            for p in base_reader.pages:
                writer.add_page(p)
            # add TOC pages
            for p in toc_reader.pages:
                writer.add_page(p)

            for i, (path, title) in enumerate(pdf_attachments):
                if not os.path.exists(path):
                    continue
                try:
                    r = PdfReader(path)
                except Exception:
                    continue
                label = string.ascii_uppercase[i] if i < 26 else f"Att-{i+1}"
                header_text = f"Attachment {label} — {title or os.path.basename(path)}"

                for p in r.pages:
                    # Build an overlay header matching this page's size
                    mb = p.mediabox
                    pw = float(mb.right - mb.left)
                    ph = float(mb.top - mb.bottom)
                    overlay_buf = io.BytesIO()
                    canv = canvas.Canvas(overlay_buf, pagesize=(pw, ph))
                    # Header text
                    canv.setFont("Helvetica-Bold", 11)
                    canv.setFillColor(colors.HexColor("#111827"))
                    canv.drawString(18*mm, ph - 18*mm, header_text[:120])
                    # Divider
                    canv.setStrokeColor(colors.HexColor("#E5E7EB"))
                    canv.setLineWidth(0.6)
                    canv.line(18*mm, ph - 22*mm, pw - 18*mm, ph - 22*mm)
                    canv.save()
                    overlay_reader = PdfReader(io.BytesIO(overlay_buf.getvalue()))
                    p.merge_page(overlay_reader.pages[0])
                    writer.add_page(p)

            # overwrite combined file
            with open(abs_path, "wb") as out:
                writer.write(out)
        except Exception:
            # If any error, keep base PDF as-is; attachments already summarized
            pass

    return rel_path
