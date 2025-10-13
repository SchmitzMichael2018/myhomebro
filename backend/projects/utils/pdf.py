# backend/projects/utils/pdf.py
# Oct-09 layout, adjusted per request:
#  - TOP (header): Contractor logo (fallback to contractor name text)
#  - BOTTOM (footer): MyHomeBro logo (small) + page number (right)
#  - Big "Agreement" title + "Agreement #"
#  - Safe image scaling (prevents ReportLab overflow)
#
# Public API:
#   generate_full_agreement_pdf(agreement_id: int, preview: bool=False) -> str
#
from __future__ import annotations

import os
from typing import Optional, List

from django.conf import settings
from django.utils.timezone import localtime

from reportlab.lib import colors
from reportlab.lib.pagesizes import letter
from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
from reportlab.lib.enums import TA_JUSTIFY
from reportlab.lib.units import inch
from reportlab.platypus import (
    SimpleDocTemplate, Paragraph, Spacer, Table, TableStyle, Image
)
from reportlab.pdfgen import canvas

from projects.models import Agreement, Milestone

# ------------------------------ helpers ------------------------------

def _media_root() -> str:
    mr = getattr(settings, "MEDIA_ROOT", None)
    if not mr:
        raise RuntimeError("MEDIA_ROOT is not configured")
    return mr

def _static_root() -> str:
    return getattr(settings, "STATIC_ROOT", "") or getattr(settings, "BASE_DIR", "")

def _safe(obj, attr, default=""):
    try:
        val = getattr(obj, attr, default)
        return val if val not in ("", None) else default
    except Exception:
        return default

def _fmt_dt(dt) -> str:
    if not dt:
        return "—"
    try:
        return localtime(dt).strftime("%b %d, %Y %I:%M %p")
    except Exception:
        return str(dt)

def _scaled_image(path: str, max_w: float, max_h: float) -> Optional[Image]:
    try:
        if not path or not os.path.exists(path):
            return None
        img = Image(path)
        iw = getattr(img, "imageWidth", None) or getattr(img, "drawWidth", None) or 0
        ih = getattr(img, "imageHeight", None) or getattr(img, "drawHeight", None) or 0
        if not iw or not ih:
            return None
        scale = min(max_w/float(iw), max_h/float(ih), 1.0)
        img.drawWidth = float(iw) * scale
        img.drawHeight = float(ih) * scale
        return img
    except Exception:
        return None

def _myhomebro_logo_path() -> Optional[str]:
    candidates = [
        os.path.join(_static_root(), "myhomebro_logo.png"),
        os.path.join(_static_root(), "static", "myhomebro_logo.png"),
    ]
    for p in candidates:
        if p and os.path.exists(p):
            return p
    return None

def _contractor_logo_path(ag: Agreement) -> Optional[str]:
    try:
        logo = getattr(getattr(ag, "contractor", None), "logo", None)
        if not logo:
            return None
        if hasattr(logo, "path"):
            return logo.path
        if isinstance(logo, str):
            return logo if os.path.isabs(logo) else os.path.join(_media_root(), logo)
    except Exception:
        pass
    return None

# ------------------------------ header/footer ------------------------------

class HeaderFooter:
    """
    Header: thin top rule + Contractor logo (left) or contractor name text.
    Footer: thin bottom rule + MyHomeBro logo (left) + page number (right).
    """
    def __init__(self, contractor_logo_path: Optional[str], contractor_label: str, mhb_logo_path: Optional[str]):
        self.contractor_logo_path = contractor_logo_path
        self.contractor_label = contractor_label
        self.mhb_logo_path = mhb_logo_path
        # Cache scaled footer logo size
        self._footer_logo_w = 75  # px-ish in points
        self._footer_logo_h = 18

    def _draw_footer_logo(self, canv: canvas.Canvas, x: float, y: float):
        # Small MHB logo at footer (if available)
        if not self.mhb_logo_path or not os.path.exists(self.mhb_logo_path):
            return
        try:
            from reportlab.lib.utils import ImageReader
            im = ImageReader(self.mhb_logo_path)
            iw, ih = im.getSize()
            scale = min(self._footer_logo_w/iw, self._footer_logo_h/ih, 1.0)
            w = iw * scale
            h = ih * scale
            canv.drawImage(im, x, y - h, width=w, height=h, mask='auto')
        except Exception:
            # Ignore footer logo errors and keep drawing
            pass

    def draw(self, canv: canvas.Canvas, doc):
        w, h = letter
        canv.saveState()

        # Top rule
        canv.setStrokeColor(colors.HexColor("#E5E7EB"))
        canv.setLineWidth(0.6)
        canv.line(0.75*inch, h-0.9*inch, w-0.75*inch, h-0.9*inch)

        # Left header content: Contractor logo or contractor name text
        x_left = 0.8*inch
        y_top = h-0.72*inch  # baseline for header text
        if self.contractor_logo_path and os.path.exists(self.contractor_logo_path):
            try:
                from reportlab.lib.utils import ImageReader
                im = ImageReader(self.contractor_logo_path)
                iw, ih = im.getSize()
                # Slightly larger than footer logo, but still conservative
                max_w, max_h = 170, 44
                scale = min(max_w/iw, max_h/ih, 1.0)
                w_img = iw * scale
                h_img = ih * scale
                # Align vertically with header baseline
                canv.drawImage(im, x_left, y_top - h_img + 6, width=w_img, height=h_img, mask='auto')
            except Exception:
                # Fallback to text if image fails
                canv.setFont("Helvetica-Bold", 11.5)
                canv.setFillColor(colors.HexColor("#111827"))
                canv.drawString(x_left, y_top, (self.contractor_label or "Contractor")[:40])
        else:
            canv.setFont("Helvetica-Bold", 11.5)
            canv.setFillColor(colors.HexColor("#111827"))
            canv.drawString(x_left, y_top, (self.contractor_label or "Contractor")[:40])

        # Muted right header label (kept subtle)
        canv.setFont("Helvetica", 9.5)
        canv.setFillColor(colors.HexColor("#6B7280"))
        canv.drawRightString(w-0.8*inch, y_top, "Agreement")

        # Bottom rule
        canv.setStrokeColor(colors.HexColor("#E5E7EB"))
        canv.setLineWidth(0.6)
        canv.line(0.75*inch, 0.9*inch, w-0.75*inch, 0.9*inch)

        # Footer left: small MHB logo
        self._draw_footer_logo(canv, 0.8*inch, 0.86*inch)

        # Footer right: page number
        canv.setFont("Helvetica", 9)
        canv.setFillColor(colors.HexColor("#6B7280"))
        canv.drawRightString(w-0.8*inch, 0.7*inch, f"Page {doc.page}")

        canv.restoreState()

# ------------------------------ main ------------------------------

def generate_full_agreement_pdf(agreement_id: int, preview: bool=False) -> str:
    """
    Build the Agreement PDF and return RELATIVE path under MEDIA_ROOT.
    Header shows Contractor branding; footer shows MyHomeBro branding.
    """
    ag = Agreement.objects.select_related("contractor", "homeowner", "project").get(id=agreement_id)

    # Output path
    media_root = _media_root()
    rel_path = f"agreements/preview/agreement_{agreement_id}.pdf" if preview else f"agreements/final/agreement_{agreement_id}.pdf"
    out_path = os.path.join(media_root, rel_path)
    os.makedirs(os.path.dirname(out_path), exist_ok=True)

    # Doc
    doc = SimpleDocTemplate(
        out_path,
        pagesize=letter,
        leftMargin=0.75*inch, rightMargin=0.75*inch,
        topMargin=1.2*inch, bottomMargin=1.0*inch,
        title=f"Agreement #{agreement_id}", author="MyHomeBro"
    )
    story: List = []

    # Styles
    styles = getSampleStyleSheet()
    s_h1   = ParagraphStyle("h1", parent=styles["Heading1"], fontName="Helvetica-Bold", fontSize=20, spaceAfter=6, textColor=colors.HexColor("#111827"))
    s_h2   = ParagraphStyle("h2", parent=styles["Heading2"], fontName="Helvetica-Bold", fontSize=14, spaceBefore=10, spaceAfter=6, textColor=colors.HexColor("#111827"))
    s_p    = ParagraphStyle("p",  parent=styles["Normal"],   fontName="Helvetica", fontSize=10.5, leading=14)
    s_muted= ParagraphStyle("muted", parent=styles["Normal"], fontName="Helvetica", fontSize=10, textColor=colors.HexColor("#6B7280"))
    s_small= ParagraphStyle("small", parent=styles["Normal"], fontName="Helvetica", fontSize=9.5, leading=13, textColor=colors.HexColor("#6B7280"))
    s_justify = ParagraphStyle("just", parent=s_p, alignment=TA_JUSTIFY)

    # ---------- Title block ----------
    story.append(Paragraph("Agreement", s_h1))
    story.append(Paragraph(f"Agreement #: {agreement_id}", s_small))
    story.append(Spacer(1, 12))

    # ---------- Parties / project details ----------
    homeowner_name = _safe(getattr(ag, "homeowner", None), "full_name", "—")
    contractor_name = _safe(getattr(ag, "contractor", None), "business_name", _safe(getattr(ag, "contractor", None), "full_name", "—"))
    project_title = _safe(getattr(ag, "project", None), "title", _safe(ag, "title", "—"))
    start = _safe(ag, "start", None)
    end   = _safe(ag, "end", None)
    total = _safe(ag, "total_cost", "—")

    details = [
        [Paragraph("<b>Project</b>", s_p), Paragraph(project_title or "—", s_p)],
        [Paragraph("<b>Contractor</b>", s_p), Paragraph(contractor_name or "—", s_p)],
        [Paragraph("<b>Homeowner</b>", s_p), Paragraph(homeowner_name or "—", s_p)],
        [Paragraph("<b>Start</b>", s_p), Paragraph(str(start) if start else "—", s_p)],
        [Paragraph("<b>End</b>", s_p), Paragraph(str(end) if end else "—", s_p)],
        [Paragraph("<b>Total Cost</b>", s_p), Paragraph(str(total) if total not in ("", None) else "—", s_p)],
    ]
    tbl = Table(details, colWidths=[1.6*inch, None])
    tbl.setStyle(TableStyle([
        ("GRID", (0,0), (-1,-1), 0.25, colors.HexColor("#E5E7EB")),
        ("BACKGROUND", (0,0), (0,-1), colors.HexColor("#F9FAFB")),
        ("VALIGN", (0,0), (-1,-1), "TOP"),
        ("LEFTPADDING",(0,0), (-1,-1), 6),
        ("RIGHTPADDING",(0,0), (-1,-1), 6),
        ("TOPPADDING",(0,0), (-1,-1), 4),
        ("BOTTOMPADDING",(0,0), (-1,-1), 4),
    ]))
    story.append(tbl)
    story.append(Spacer(1, 12))

    # ---------- Milestones ----------
    story.append(Paragraph("Milestones", s_h2))
    ms_qs = Milestone.objects.filter(agreement=ag).order_by("order")
    if ms_qs.exists():
        rows = [[Paragraph("<b>#</b>", s_small), Paragraph("<b>Title</b>", s_small),
                 Paragraph("<b>Due</b>", s_small), Paragraph("<b>Amount</b>", s_small)]]
        for idx, m in enumerate(ms_qs, start=1):
            due = getattr(m, "completion_date", None) or getattr(m, "start_date", None)
            rows.append([
                Paragraph(str(idx), s_p),
                Paragraph(_safe(m, "title", "—"), s_p),
                Paragraph(str(due) if due else "—", s_p),
                Paragraph(str(getattr(m, "amount", "—") or "—"), s_p),
            ])
        ms_tbl = Table(rows, colWidths=[0.4*inch, None, 1.1*inch, 1.1*inch])
        ms_tbl.setStyle(TableStyle([
            ("GRID", (0,0), (-1,-1), 0.25, colors.HexColor("#E5E7EB")),
            ("BACKGROUND", (0,0), (-1,0), colors.HexColor("#F3F4F6")),
            ("VALIGN", (0,0), (-1,-1), "TOP"),
            ("LEFTPADDING",(0,0), (-1,-1), 5),
            ("RIGHTPADDING",(0,0), (-1,-1), 5),
            ("TOPPADDING",(0,0), (-1,-1), 4),
            ("BOTTOMPADDING",(0,0), (-1,-1), 4),
        ]))
        story.append(ms_tbl)
    else:
        story.append(Paragraph("No milestones defined.", s_muted))
    story.append(Spacer(1, 12))

    # ---------- Warranty ----------
    story.append(Paragraph("Warranty", s_h2))
    warranty = _safe(ag, "warranty_text_snapshot", "")
    story.append(Paragraph(warranty or "—", s_justify))
    story.append(Spacer(1, 12))

    # ---------- Build ----------
    contractor_logo = _contractor_logo_path(ag)  # show at TOP
    contractor_label = contractor_name or "Contractor"
    mhb_logo = _myhomebro_logo_path()           # show at BOTTOM
    header = HeaderFooter(contractor_logo, contractor_label, mhb_logo)
    doc.build(story, onFirstPage=header.draw, onLaterPages=header.draw)

    # Return RELATIVE path
    return os.path.relpath(out_path, _media_root())
