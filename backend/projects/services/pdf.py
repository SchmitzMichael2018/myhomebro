# backend/projects/services/pdf.py
# v2025-10-22 — Hardened:
#  - Safe saves even if Agreement lacks pdf_file field
#  - Attachment merge guards
#  - Clear return contract (returns path string)
#  - Minor defensive checks to avoid 500s

from __future__ import annotations

import io
import os
from typing import List, Optional, Iterable
from datetime import date, datetime

from django.conf import settings
from django.core.files.base import ContentFile
from django.utils.timezone import localtime

from projects.models import Agreement, Milestone  # Milestone for schedule logic

# Optional PDF merger (append attached PDFs on finalize)
try:
    from PyPDF2 import PdfMerger
except Exception:
    PdfMerger = None  # type: ignore

# Optional: state-aware legal clauses
try:
    from projects.services.legal_clauses import build_legal_notices
except Exception:
    def build_legal_notices(project_state: Optional[str] = None) -> List[tuple[str, str]]:
        return [
            ("Terms Incorporated",
             "The MyHomeBro Terms of Service, Privacy Policy, and any Escrow Program Terms are incorporated into this "
             "Agreement by reference."),
            ("Electronic Signatures & Records",
             "The parties consent to do business electronically and agree that electronic signatures and records have "
             "the same force and effect as wet ink signatures."),
        ]


# ----------------------------- small helpers -----------------------------

def _s(v) -> str:
    return "" if v is None else str(v)

def _currency(v) -> str:
    try:
        return f"${float(v or 0):,.2f}"
    except Exception:
        return "$0.00"

def _first_existing(paths: list[str]) -> Optional[str]:
    for p in paths:
        if p and os.path.exists(p):
            return p
    return None

def _myhomebro_logo_path() -> Optional[str]:
    override = getattr(settings, "MHB_LOGO_PATH", None) or os.environ.get("MHB_LOGO_PATH")
    if override and os.path.exists(override):
        return override

    roots: List[str] = []
    static_root = getattr(settings, "STATIC_ROOT", None)
    if static_root:
        roots += [
            static_root,
            os.path.join(static_root, "assets"),
            os.path.join(static_root, "static"),
            os.path.join(static_root, "staticfiles"),
            os.path.join(static_root, "staticfiles", "assets"),
        ]
    roots.append(os.path.join(getattr(settings, "BASE_DIR", ""), "static"))
    roots += [str(p) for p in getattr(settings, "STATICFILES_DIRS", []) or []]

    candidates: List[str] = []
    for r in roots:
        candidates += [
            os.path.join(r, "myhomebro_logo.png"),
            os.path.join(r, "img", "myhomebro_logo.png"),
            os.path.join(r, "images", "myhomebro_logo.png"),
            os.path.join(r, "assets", "myhomebro_logo.png"),
        ]
    return _first_existing(candidates)

def _contractor_logo_path(ag: Agreement) -> Optional[str]:
    try:
        field = getattr(getattr(ag, "contractor", None), "logo", None)
        if field and hasattr(field, "path") and os.path.exists(field.path):
            return field.path
    except Exception:
        pass
    return None

def _signature_path(field) -> Optional[str]:
    try:
        if field and hasattr(field, "path") and os.path.exists(field.path):
            return field.path
    except Exception:
        pass
    return None

def _due_of(m) -> Optional[str]:
    for attr in (
        "completion_date", "due_date", "end_date", "end",
        "target_date", "finish_date", "scheduled_date", "start_date",
    ):
        val = getattr(m, attr, None)
        if val:
            try:
                val = val.date()
            except Exception:
                pass
            return _s(val)
    return None

def _start_of(m) -> Optional[str]:
    """Find a reasonable 'start' for a milestone."""
    for attr in ("start_date", "scheduled_date", "begin_date", "start"):
        val = getattr(m, attr, None)
        if val:
            try:
                val = val.date()
            except Exception:
                pass
            return _s(val)
    return None

def _fmt_date_friendly(v: object) -> Optional[str]:
    """
    Return 'Oct 1, 2025' style. Accepts date/datetime/ISO string.
    """
    if not v:
        return None
    try:
        if isinstance(v, datetime):
            d = v.date()
        elif isinstance(v, date):
            d = v
        else:
            d = datetime.fromisoformat(str(v)).date()
        txt = d.strftime("%b %d, %Y")
        return txt.replace(" 0", " ")
    except Exception:
        try:
            s = str(v)
            if len(s) == 10 and s[4] == "-" and s[7] == "-":
                return s
        except Exception:
            pass
        return str(v)


# ---------- Address builders (expanded & snapshot-aware) ----------

def _get_first(obj, keys: Iterable[str]) -> Optional[str]:
    for k in keys:
        try:
            v = getattr(obj, k, None)
        except Exception:
            v = None
        if v:
            s = str(v).strip()
            if s:
                return s
    return None

def _fmt_addr_from(obj) -> str:
    """
    Build a single-line address from many common field names on an object
    (contractor / homeowner / project). Includes aliases:
      street_address, address_line1/2, line1/2, street/street2, unit/apt/suite,
      city/town, state/region/province/state_code, zip/zip_code/zipcode/postal_code/postcode
    Also supports nested obj.address (recursively).
    """
    if not obj:
        return ""

    line1 = _get_first(obj, (
        "street_address", "address_line1", "line1", "address1",
        "street1", "street", "address"
    ))
    line2 = _get_first(obj, (
        "address_line2", "line2", "address2", "street2", "unit", "apt", "suite"
    ))
    city  = _get_first(obj, ("city", "town", "city_name"))
    state = _get_first(obj, ("state", "state_code", "region", "province"))
    zipc  = _get_first(obj, ("zip_code", "zip", "zipcode", "postal_code", "postcode"))

    parts: List[str] = []
    if line1: parts.append(line1)
    if line2: parts.append(line2)
    tail = " ".join([p for p in (city, state, zipc) if p])
    if tail:
        parts.append(tail)

    if not parts:
        addr_obj = getattr(obj, "address", None)
        if addr_obj:
            return _fmt_addr_from(addr_obj)

    return " — ".join(parts) if parts else ""

def _composite_addr_from_snapshots(obj, prefix: str) -> str:
    """
    Build an address from *snapshot* fields on Agreement:
      e.g., prefix='homeowner' tries:
        homeowner_address_line1_snapshot / homeowner_street_address_snapshot / homeowner_street_snapshot / homeowner_address_snapshot
        + homeowner_address_line2_snapshot / homeowner_unit_snapshot / homeowner_apt_snapshot / homeowner_suite_snapshot
        + homeowner_city_snapshot + homeowner_state_snapshot(+region/state_code) + homeowner_zip/zipcode/postal_code/postcode _snapshot
      Similarly for prefix='project'.
    """
    if not obj:
        return ""

    def g(name: str) -> Optional[str]:
        return _get_first(obj, (name,))

    line1 = (
        g(f"{prefix}_address_line1_snapshot") or
        g(f"{prefix}_street_address_snapshot") or
        g(f"{prefix}_street_snapshot") or
        g(f"{prefix}_address_snapshot")
    )
    line2 = (
        g(f"{prefix}_address_line2_snapshot") or
        g(f"{prefix}_unit_snapshot") or
        g(f"{prefix}_apt_snapshot") or
        g(f"{prefix}_suite_snapshot")
    )
    city  = g(f"{prefix}_city_snapshot")
    state = g(f"{prefix}_state_snapshot") or g(f"{prefix}_region_snapshot") or g(f"{prefix}_state_code_snapshot")
    zipc  = g(f"{prefix}_zip_snapshot") or g(f"{prefix}_zipcode_snapshot") or g(f"{prefix}_postal_code_snapshot") or g(f"{prefix}_postcode_snapshot")

    parts: List[str] = []
    if line1: parts.append(line1.strip())
    if line2: parts.append(line2.strip())
    tail = " ".join([p for p in (city, state, zipc) if p and str(p).strip()])
    if tail:
        parts.append(tail.strip())
    return " — ".join(parts).strip() if parts else ""

def _project_address(ag: Agreement) -> str:
    """
    Priority:
      1) Agreement.project address fields
      2) Agreement project_*_snapshot composite
      3) Agreement's own address fields
      4) Homeowner object
      5) Homeowner_*_snapshot composite
    """
    proj = getattr(ag, "project", None)
    s = _fmt_addr_from(proj)
    if s:
        return s

    s = _composite_addr_from_snapshots(ag, "project")
    if s:
        return s

    s = _fmt_addr_from(ag)
    if s:
        return s

    h = getattr(ag, "homeowner", None)
    s = _fmt_addr_from(h)
    if s:
        return s

    s = _composite_addr_from_snapshots(ag, "homeowner")
    return s or ""


def _detect_project_state(ag: Agreement) -> Optional[str]:
    """
    Try to infer a 2-letter state code (or state name) from common fields.
    Order: Agreement.project.state -> Homeowner.state -> Contractor.state -> Agreement.state
           -> snapshot fallbacks (project_state_snapshot, homeowner_state_snapshot).
    """
    candidates: List[Optional[str]] = []
    try:
        proj = getattr(ag, "project", None)
        if proj:
            candidates += [getattr(proj, "state", None), getattr(proj, "region", None)]
    except Exception:
        pass
    try:
        h = getattr(ag, "homeowner", None)
        if h:
            candidates += [getattr(h, "state", None), getattr(h, "region", None)]
    except Exception:
        pass
    try:
        c = getattr(ag, "contractor", None)
        if c:
            candidates += [getattr(c, "state", None), getattr(c, "region", None)]
    except Exception:
        pass
    candidates += [getattr(ag, "state", None)]
    # Snapshots as last resort
    candidates += [
        getattr(ag, "project_state_snapshot", None),
        getattr(ag, "homeowner_state_snapshot", None),
    ]

    for v in candidates:
        if not v:
            continue
        s = str(v).strip()
        if not s:
            continue
        return s.upper() if len(s) == 2 else s
    return None


# --------------------------- page chrome (header/footer/watermark) ---------------------------

def _watermark_preview(canvas):
    canvas.saveState()
    canvas.setFont("Helvetica-Bold", 48)
    canvas.setFillGray(0.85)
    canvas.translate(612 / 2, 792 / 2)
    canvas.rotate(30)
    canvas.drawCentredString(0, 0, "PREVIEW – NOT SIGNED")
    canvas.restoreState()

def _header_footer(canvas, doc):
    from reportlab.lib import colors
    from reportlab.lib.pagesizes import letter
    from reportlab.lib.units import inch
    from reportlab.lib.utils import ImageReader

    canvas.saveState()
    w, h = letter

    # Top rule
    canvas.setStrokeColor(colors.HexColor("#E5E7EB"))
    canvas.setLineWidth(0.6)
    canvas.line(0.75 * inch, h - 0.9 * inch, w - 0.75 * inch, h - 0.9 * inch)

    # Right muted label
    canvas.setFont("Helvetica", 9.5)
    canvas.setFillColor(colors.HexColor("#6B7280"))
    canvas.drawRightString(w - 0.8 * inch, h - 0.72 * inch, "Agreement")

    # Bottom rule
    canvas.setStrokeColor(colors.HexColor("#E5E7EB"))
    canvas.setLineWidth(0.6)
    canvas.line(0.75 * inch, 0.9 * inch, w - 0.75 * inch, 0.9 * inch)

    # Footer left: small MHB logo
    mhb_path = _myhomebro_logo_path()
    if mhb_path and os.path.exists(mhb_path):
        try:
            im = ImageReader(mhb_path)
            iw, ih = im.getSize()
            max_w, max_h = 75, 18
            scale = min(max_w / iw, max_h / ih, 1.0)
            fw, fh = iw * scale, ih * scale
            canvas.drawImage(im, 0.8 * inch, 0.86 * inch - fh + 4, width=fw, height=fh, mask='auto')
        except Exception:
            canvas.setFont("Helvetica-Bold", 9)
            canvas.setFillColor(colors.HexColor("#111827"))
            canvas.drawString(0.8 * inch, 0.73 * inch, "MyHomeBro")
    else:
        canvas.setFont("Helvetica-Bold", 9)
        canvas.setFillColor(colors.HexColor("#111827"))
        canvas.drawString(0.8 * inch, 0.73 * inch, "MyHomeBro")

    # Footer right: timestamp + page number
    canvas.setFont("Helvetica", 9)
    ts = localtime().strftime("%Y-%m-%d %H:%M")
    right = f"Generated {ts}  |  Page {canvas.getPageNumber()}"
    canvas.setFillColor(colors.HexColor("#475569"))
    tw = canvas.stringWidth(right, "Helvetica", 9)
    canvas.drawString(w - 0.8 * inch - tw, 0.7 * inch, right)

    canvas.restoreState()


# ------------------------------------- core render -------------------------------------

def build_agreement_pdf_bytes(ag: Agreement, *, is_preview: bool = False) -> bytes:
    """
    Render Agreement PDF to bytes (Oct-09 layout) + header with addresses & license.
    Milestones table spans full printable width. No escrow line.
    """
    from reportlab.lib.pagesizes import letter
    from reportlab.lib.units import inch
    from reportlab.lib import colors
    from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
    from reportlab.platypus import (
        SimpleDocTemplate, Paragraph, Spacer, Table, TableStyle, Image, PageBreak
    )

    def _scaled_image(path: Optional[str], max_w: float, max_h: float) -> Optional[Image]:
        try:
            if not path or not os.path.exists(path):
                return None
            img = Image(path)
            iw = getattr(img, "imageWidth", None) or getattr(img, "drawWidth", None) or 0
            ih = getattr(img, "imageHeight", None) or getattr(img, "drawHeight", None) or 0
            if not iw or not ih:
                return None
            scale = min(max_w / float(iw), max_h / float(ih), 1.0)
            img.drawWidth = float(iw) * scale
            img.drawHeight = float(ih) * scale
            return img
        except Exception:
            return None

    def _paragraphs_from(text: str) -> List[str]:
        if not text:
            return []
        chunks = [p.strip() for p in text.replace("\r\n", "\n").split("\n\n")]
        out: List[str] = []
        for ch in chunks:
            if len(ch) <= 1800:
                out.append(ch)
            else:
                lines = ch.split("\n")
                buf = []
                cur = 0
                for ln in lines:
                    ln = ln.strip()
                    if not ln:
                        if buf:
                            out.append(" ".join(buf)); buf = []; cur = 0
                        continue
                    ln_len = len(ln)
                    if cur + ln_len > 1800 and buf:
                        out.append(" ".join(buf)); buf = [ln]; cur = ln_len
                    else:
                        buf.append(ln); cur += ln_len + 1
                if buf:
                    out.append(" ".join(buf))
        return out

    buf = io.BytesIO()
    doc = SimpleDocTemplate(
        buf,
        pagesize=letter,
        leftMargin=0.75 * inch,
        rightMargin=0.75 * inch,
        topMargin=1.2 * inch,
        bottomMargin=0.9 * inch,
        title=f"Agreement #{getattr(ag,'pk','')}",
    )

    from reportlab.lib import colors
    ss = getSampleStyleSheet()
    s_h1   = ss["Heading1"]; s_h1.fontSize = 22; s_h1.textColor = colors.HexColor("#111827")
    s_h2   = ss["Heading2"]; s_h2.fontSize = 14
    s_body = ss["BodyText"]
    s_small= ParagraphStyle("Small", parent=s_body, fontSize=9.5, leading=13, textColor=colors.HexColor("#6B7280"))
    s_muted= ParagraphStyle("Muted", parent=s_body, fontSize=10, textColor=colors.HexColor("#6B7280"))
    s_just = ParagraphStyle("Just",  parent=s_body, fontSize=10.5, leading=14)
    s_h3   = ParagraphStyle("h3",    parent=s_h2, fontSize=12.5)
    s_lbl  = ParagraphStyle("lbl",   parent=s_body, fontSize=10.5, leading=14, textColor=colors.HexColor("#111827"))
    s_val  = ParagraphStyle("val",   parent=s_body, fontSize=10.5, leading=14)

    story: list = []

    # ---- Header: Contractor logo ONLY ----
    contractor_logo = _contractor_logo_path(ag)
    img_logo = _scaled_image(contractor_logo, max_w=170, max_h=44)
    if img_logo:
        story.append(img_logo); story.append(Spacer(1, 6))

    # === Title: Agreement #ID (with optional Amendment badge) ===
    amend = 0
    try:
        amend = int(getattr(ag, "amendment_number", 0) or 0)
    except Exception:
        amend = 0
    title_txt = f"Agreement #{ag.id}" + (f" — Amendment {amend}" if amend > 0 else "")
    story.append(Paragraph(title_txt, s_h1))
    story.append(Spacer(1, 6))

    # === Project header (addresses, license) ===
    story.append(Paragraph("Project", s_lbl))

    contractor  = getattr(ag, "contractor", None)
    homeowner   = getattr(ag, "homeowner", None)
    project     = getattr(ag, "project", None)

    c_name   = _s(getattr(contractor, "business_name", None) or getattr(contractor, "full_name", None))
    c_email  = _s(getattr(contractor, "email", None))
    c_phone  = _s(getattr(contractor, "phone", None))
    c_addr   = _fmt_addr_from(contractor)
    c_lic_no = _s(getattr(contractor, "license_number", None))
    c_lic_ex = _s(getattr(contractor, "license_expiration", None))

    h_name  = _s(getattr(homeowner, "full_name", None) or getattr(homeowner, "name", None))
    h_email = _s(getattr(homeowner, "email", None))
    h_addr  = _fmt_addr_from(homeowner) or _composite_addr_from_snapshots(ag, "homeowner")

    p_addr  = _project_address(ag)

    proj_type    = _s(getattr(ag, "project_type", None) or getattr(project, "type", None))
    proj_subtype = _s(getattr(ag, "project_subtype", None) or getattr(project, "subtype", None))
    type_line = proj_type if proj_type else "—"
    if proj_subtype:
        type_line = f"{proj_type} — {proj_subtype}" if proj_type else proj_subtype

    # ====== SCHEDULE: from first and last milestone (friendly + TBD) ======
    # If you don't have an "order" field, the ORM still allows ordering by it; but to be safe,
    # fall back to start_date/end_date/id.
    try:
        ms_qs = Milestone.objects.filter(agreement=ag).order_by("order", "id")
    except Exception:
        ms_qs = Milestone.objects.filter(agreement=ag).order_by("start_date", "end_date", "id")

    first_start: Optional[str] = None
    last_due: Optional[str] = None
    if ms_qs.exists():
        first_m = ms_qs.first()
        last_m = ms_qs.last()
        if first_m:
            first_start = _start_of(first_m)
        if last_m:
            last_due = _due_of(last_m)

    schedule_line = "—"
    if first_start or last_due:
        start_txt = _fmt_date_friendly(first_start) if first_start else "TBD"
        end_txt = _fmt_date_friendly(last_due) if last_due else "TBD"
        schedule_line = f"{start_txt} → {end_txt} (est.)"
    else:
        ag_start = _s(getattr(ag, "start", None))
        ag_end   = _s(getattr(ag, "end", None))
        if ag_start or ag_end:
            start_txt = _fmt_date_friendly(ag_start) if ag_start else "TBD"
            end_txt = _fmt_date_friendly(ag_end) if ag_end else "TBD"
            schedule_line = f"{start_txt} → {end_txt} (est.)"

    status_line = (_s(getattr(ag, "status", "")) or "draft").lower()

    def _dot_join(parts: list[str]) -> str:
        return " • ".join([p for p in parts if p])

    story.append(Paragraph(f"<b>Contractor:</b> {_dot_join([c_name, c_email, c_phone]) or '—'}", s_val))
    if c_addr:
        story.append(Paragraph(f"<b>Contractor Address:</b> {c_addr}", s_val))
    if c_lic_no:
        lic = f"License #{c_lic_no}"
        if c_lic_ex:
            lic += f" (exp {c_lic_ex})"
        story.append(Paragraph(f"<b>{lic}</b>", s_small))

    story.append(Paragraph(f"<b>Homeowner:</b> {_dot_join([h_name, h_email]) or '—'}",  s_val))
    if h_addr:
        story.append(Paragraph(f"<b>Homeowner Address:</b> {h_addr}", s_val))

    if p_addr:
        story.append(Paragraph(f"<b>Project Address:</b> {p_addr}", s_val))

    story.append(Paragraph(f"<b>Type:</b> {type_line}", s_val))
    story.append(Paragraph(f"<b>Schedule:</b> {schedule_line}", s_val))
    story.append(Paragraph(f"<b>Status:</b> {status_line}", s_small))
    story.append(Spacer(1, 12))

    # ---- Milestones (SPAN FULL WIDTH) ----
    ms = ms_qs
    story.append(Paragraph("Milestones", s_h2))
    if ms.exists():
        rows = [["#", "Milestone", "Due", "Amount", "Status"]]
        total_amt = 0.0
        for i, m in enumerate(ms, 1):
            title = _s(getattr(m, "title", None) or getattr(m, "description", None) or "—")
            amt = float(getattr(m, "amount", 0) or 0)
            total_amt += amt
            due_raw = _due_of(m)
            due = _fmt_date_friendly(due_raw) if due_raw else "TBD"
            status = "Complete" if getattr(m, "completed", False) else (_s(getattr(m, "status", "")) or "Pending")
            rows.append([str(i), title, due, _currency(amt), status])
        rows.append(["", "", "Total", _currency(total_amt), ""])

        from reportlab.lib.units import inch
        from reportlab.platypus import Table, TableStyle
        c1 = 0.55 * inch
        c3 = 1.25 * inch
        c4 = 1.20 * inch
        c5 = 1.20 * inch
        c2 = max(1.0 * inch, doc.width - (c1 + c3 + c4 + c5))
        col_widths = [c1, c2, c3, c4, c5]

        t = Table(rows, colWidths=col_widths)
        t.setStyle(TableStyle([
            ("FONT", (0, 0), (-1, 0), "Helvetica-Bold"),
            ("BACKGROUND", (0, 0), (-1, 0), colors.HexColor("#F3F4F6")),
            ("GRID", (0, 0), (-1, -1), 0.25, colors.HexColor("#E5E7EB")),
            ("ALIGN", (0, 1), (0, -1), "CENTER"),
            ("ALIGN", (2, 1), (2, -2), "CENTER"),
            ("ALIGN", (3, 1), (3, -2), "RIGHT"),
            ("ALIGN", (4, 1), (4, -2), "CENTER"),
            ("FONT", (2, -1), (3, -1), "Helvetica-Bold"),
            ("BACKGROUND", (0, -1), (-1, -1), colors.HexColor("#FAFAFA")),
        ]))
        story += [t, Spacer(1, 12)]
    else:
        story += [Paragraph("No milestones defined.", s_muted), Spacer(1, 12)]

    # ---- Warranty ----
    story.append(Paragraph("Warranty", s_h2))
    wtype = (_s(getattr(ag, "warranty_type", ""))).strip().lower()
    wtext = _s(getattr(ag, "warranty_text_snapshot", ""))
    if wtype in ("default", "standard", "std") or not wtext:
        story.append(Paragraph(
            "Default workmanship warranty applies. Contractor warrants that all work will be performed in a good and "
            "workmanlike manner and in accordance with applicable codes. Defects arising from normal wear, misuse, "
            "negligence, alteration, or acts of God are excluded.",
            s_just
        ))
    else:
        story.append(Paragraph(wtext.replace("\n", "<br/>"), s_just))
    story.append(Spacer(1, 12))

    # ====================== Legal Notices & Conditions ======================
    from reportlab.platypus import PageBreak
    story.append(PageBreak())
    story.append(Paragraph("Legal Notices & Conditions", s_h2))
    story.append(Spacer(1, 6))

    project_state = _detect_project_state(ag)
    clauses = build_legal_notices(project_state)

    for title, text in clauses:
        story.append(Paragraph(title, s_h3))
        for para in _paragraphs_from(text):
            story.append(Paragraph(para.replace("\n", "<br/>"), s_just))
        story.append(Spacer(1, 8))

    # ---- Signatures page (always reads live fields; cleared → shows '—') ----
    from reportlab.platypus import Table as RLTable, TableStyle as RLTableStyle, Spacer as RLSpacer
    story.append(PageBreak())
    story.append(Paragraph("Signatures", s_h2))

    c_img = _signature_path(getattr(ag, "contractor_signature", None))
    h_img = _signature_path(getattr(ag, "homeowner_signature", None))

    # pull live fields including alias timestamps
    c_name_live = _s(getattr(ag, "contractor_signature_name", None))
    h_name_live = _s(getattr(ag, "homeowner_signature_name", None))
    c_at_live   = getattr(ag, "contractor_signed_at", None) or getattr(ag, "signed_at_contractor", None)
    h_at_live   = getattr(ag, "homeowner_signed_at", None)  or getattr(ag, "signed_at_homeowner", None)

    c_at_txt = _fmt_date_friendly(c_at_live) or "—"
    h_at_txt = _fmt_date_friendly(h_at_live) or "—"
    c_name_txt = c_name_live.strip() if c_name_live and c_name_live.strip() not in ("None", "—") else "—"
    h_name_txt = h_name_live.strip() if h_name_live and h_name_live.strip() not in ("None", "—") else "—"

    def _sig_block(name_txt: str, img_path: Optional[str], signed_txt: str, label: str) -> list:
        block: list = []
        simg = _scaled_image(img_path, max_w=200, max_h=80)
        if simg:
            block += [simg, RLSpacer(1, 3)]
        block += [
            Paragraph(f"<b>{label}:</b> {name_txt}", s_body),
            Paragraph(f"<b>Signed:</b> {signed_txt}", s_small),
        ]
        return block

    sig_tbl = RLTable(
        [[_sig_block(c_name_txt, c_img, c_at_txt, "Contractor"),
          _sig_block(h_name_txt, h_img, h_at_txt, "Homeowner")]],
        colWidths=[3.5 * inch, 3.5 * inch]
    )
    sig_tbl.setStyle(RLTableStyle([("VALIGN", (0, 0), (-1, -1), "TOP")]))
    story.append(sig_tbl)

    if is_preview:
        story.append(Spacer(1, 6))
        story.append(Paragraph("This is a preview. Final version will include any updated signatures.", s_small))

    def _first(c, d):
        if is_preview:
            _watermark_preview(c)
        _header_footer(c, d)

    def _later(c, d):
        if is_preview:
            _watermark_preview(c)
        _header_footer(c, d)

    doc.build(story, onFirstPage=_first, onLaterPages=_later)
    return buf.getvalue()


def generate_full_agreement_pdf(ag: Agreement, *, merge_attachments: bool = True) -> str:
    """
    Generate and persist a full Agreement PDF.
    Returns the final filesystem path (string). Also attempts to save to ag.pdf_file if present.
    """
    version = int(getattr(ag, "pdf_version", 0) or 0) + 1

    base_bytes = build_agreement_pdf_bytes(ag, is_preview=False)

    tmp_dir = os.path.join(getattr(settings, "MEDIA_ROOT", ""), "agreements", "tmp")
    os.makedirs(tmp_dir, exist_ok=True)
    base_path = os.path.join(tmp_dir, f"agreement_{ag.id}_v{version}.pdf")
    with open(base_path, "wb") as f:
        f.write(base_bytes)

    final_path = base_path

    # Merge attachments if configured and available
    if merge_attachments and PdfMerger:
        pdf_paths: List[str] = []
        try:
            atts = list(getattr(ag, "attachments", None).all()) if hasattr(ag, "attachments") else []
        except Exception:
            atts = []
        for att in atts:
            p = getattr(getattr(att, "file", None), "path", None)
            if p and p.lower().endswith(".pdf") and os.path.exists(p):
                pdf_paths.append(p)

        if pdf_paths:
            try:
                merger = PdfMerger()
                merger.append(base_path)
                for p in pdf_paths:
                    merger.append(p)
                merged_path = base_path.replace(".pdf", "_merged.pdf")
                with open(merged_path, "wb") as out:
                    merger.write(out)
                merger.close()
                final_path = merged_path
            except Exception:
                # Fall back to the base document on any merge error
                final_path = base_path

    # Try to persist on the model filefield if it exists; otherwise just return the path.
    saved_on_model = False
    if hasattr(ag, "pdf_file") and getattr(ag, "pdf_file") is not None:
        try:
            with open(final_path, "rb") as fh:
                content = ContentFile(fh.read())
                fname = f"agreement_{ag.id}_v{version}.pdf"
                ag.pdf_file.save(fname, content, save=True)
                if hasattr(ag, "pdf_version"):
                    ag.pdf_version = version
                    ag.save(update_fields=["pdf_version", "pdf_file"])
            saved_on_model = True
        except Exception:
            # Don't crash; still return final_path
            saved_on_model = False

    return getattr(ag.pdf_file, "path", None) if saved_on_model else final_path
