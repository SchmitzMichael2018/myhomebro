# backend/projects/services/invoice_pdf.py
from __future__ import annotations

import io
import os
from datetime import datetime
from decimal import Decimal
from typing import Any, List, Tuple

from django.utils import timezone

from reportlab.lib.pagesizes import letter
from reportlab.lib.units import inch
from reportlab.lib import colors
from reportlab.lib.utils import ImageReader
from reportlab.pdfgen import canvas

from projects.models import MilestoneComment, MilestoneFile


def _money(value) -> str:
    try:
        return f"${Decimal(value):,.2f}"
    except Exception:
        try:
            return f"${float(value):,.2f}"
        except Exception:
            return "$0.00"


def _safe_dt(dt) -> str:
    if not dt:
        return "—"
    try:
        if timezone.is_naive(dt):
            dt = timezone.make_aware(dt, timezone.get_current_timezone())
        dt = dt.astimezone(timezone.get_current_timezone())
        return dt.strftime("%Y-%m-%d %I:%M %p")
    except Exception:
        try:
            return dt.strftime("%Y-%m-%d")
        except Exception:
            return "—"


def _wrap_text(c: canvas.Canvas, text: str, font_name: str, font_size: int, max_width: float) -> list[str]:
    if not text:
        return ["—"]
    words = str(text).split()
    lines: list[str] = []
    cur = ""
    for w in words:
        test = (cur + " " + w).strip()
        if c.stringWidth(test, font_name, font_size) <= max_width:
            cur = test
        else:
            if cur:
                lines.append(cur)
            cur = w
    if cur:
        lines.append(cur)
    return lines or ["—"]


def _maybe_page_break(c: canvas.Canvas, y: float, min_y: float) -> float:
    if y < min_y:
        c.showPage()
        return letter[1] - 0.75 * inch
    return y


def _get_contractor(invoice) -> Any:
    ag = getattr(invoice, "agreement", None)
    proj = getattr(ag, "project", None) if ag else None
    return getattr(proj, "contractor", None) if proj else None


def _get_homeowner(invoice) -> Any:
    ag = getattr(invoice, "agreement", None)
    proj = getattr(ag, "project", None) if ag else None
    return getattr(proj, "homeowner", None) if proj else None


def _contractor_business_name(contractor) -> str:
    if not contractor:
        return "Contractor"
    name = (getattr(contractor, "business_name", "") or "").strip()
    if name:
        return name
    name2 = (getattr(contractor, "name", "") or "").strip()
    if name2:
        return name2
    user = getattr(contractor, "user", None)
    return (getattr(user, "email", "") or "Contractor").strip()


def _contractor_address_lines(contractor) -> list[str]:
    if not contractor:
        return []
    lines: list[str] = []

    addr = (getattr(contractor, "address", "") or "").strip()
    if addr:
        for ln in addr.splitlines():
            ln = ln.strip()
            if ln:
                lines.append(ln)

    city = (getattr(contractor, "city", "") or "").strip()
    state = (getattr(contractor, "state", "") or "").strip()
    if city or state:
        lines.append(", ".join([p for p in [city, state] if p]))

    phone = (getattr(contractor, "phone", "") or "").strip()
    if phone:
        lines.append(phone)

    email = (getattr(contractor, "email", "") or "").strip()
    if email:
        lines.append(email)

    return lines


def _contractor_logo_path(contractor) -> str | None:
    if not contractor:
        return None
    logo = getattr(contractor, "logo", None)
    if not logo:
        return None
    try:
        p = logo.path
        if p and os.path.exists(p):
            return p
    except Exception:
        return None
    return None


def _homeowner_lines(homeowner, invoice) -> list[str]:
    lines = []
    name = getattr(homeowner, "full_name", None) or getattr(invoice, "homeowner_name", None) or "—"
    email = getattr(homeowner, "email", None) or getattr(invoice, "homeowner_email", None) or "—"
    lines.append(name)
    lines.append(email)

    phone = (getattr(homeowner, "phone_number", "") or "").strip()
    if phone:
        lines.append(phone)

    street = (getattr(homeowner, "street_address", "") or "").strip()
    line2 = (getattr(homeowner, "address_line_2", "") or "").strip()
    city = (getattr(homeowner, "city", "") or "").strip()
    state = (getattr(homeowner, "state", "") or "").strip()
    zip_code = (getattr(homeowner, "zip_code", "") or "").strip()

    if street:
        lines.append(street)
    if line2:
        lines.append(line2)

    city_state = ", ".join([p for p in [city, state] if p]).strip()
    if city_state and zip_code:
        lines.append(f"{city_state} {zip_code}")
    elif city_state:
        lines.append(city_state)
    elif zip_code:
        lines.append(zip_code)

    return [ln for ln in lines if ln]


def _fallback_notes_and_attachments_from_milestone(invoice) -> Tuple[str, List[dict]]:
    m = getattr(invoice, "source_milestone", None)
    if not m:
        return "", []

    comments = MilestoneComment.objects.filter(milestone=m).order_by("created_at")
    lines = []
    for cmt in comments:
        content = (getattr(cmt, "content", "") or "").strip()
        if content:
            lines.append(f"- {content}")
    notes = "\n".join(lines).strip()

    files = MilestoneFile.objects.filter(milestone=m).order_by("-uploaded_at")
    att = []
    for f in files:
        if not getattr(f, "file", None):
            continue
        url = ""
        try:
            url = f.file.url
            if url.startswith("/"):
                url = "https://www.myhomebro.com" + url
        except Exception:
            url = ""
        att.append({
            "id": f.id,
            "name": getattr(f.file, "name", "") or f"file_{f.id}",
            "url": url,
            "uploaded_at": getattr(f, "uploaded_at", None).isoformat() if getattr(f, "uploaded_at", None) else None,
        })

    return notes, att


def _milestone_from_invoice(invoice) -> Tuple[Any, str, str, str, list]:
    ms_id = getattr(invoice, "milestone_id_snapshot", None) or getattr(invoice, "milestone_id", None)
    ms_title = (getattr(invoice, "milestone_title_snapshot", None) or getattr(invoice, "milestone_title", None) or "").strip()
    ms_desc = (getattr(invoice, "milestone_description_snapshot", None) or getattr(invoice, "milestone_description", None) or "").strip()

    notes = (getattr(invoice, "milestone_completion_notes", None) or "").strip()
    attachments = getattr(invoice, "milestone_attachments_snapshot", None)
    if not isinstance(attachments, list):
        attachments = []

    if not notes or not attachments:
        fb_notes, fb_atts = _fallback_notes_and_attachments_from_milestone(invoice)
        if not notes and fb_notes:
            notes = fb_notes
        if (not attachments) and fb_atts:
            attachments = fb_atts

    if (not ms_title or not ms_desc or not ms_id) and hasattr(invoice, "source_milestone"):
        m = getattr(invoice, "source_milestone", None)
        if m:
            ms_id = ms_id or getattr(m, "id", None)
            ms_title = ms_title or (getattr(m, "title", "") or "").strip()
            ms_desc = ms_desc or (getattr(m, "description", "") or "").strip()

    return ms_id, (ms_title or "—"), (ms_desc or "—"), (notes or ""), attachments


def generate_invoice_pdf_bytes(invoice, include_action_links: bool = False) -> bytes:
    """
    Contractor PDF should NOT include approve/dispute links.
    keep include_action_links=False for contractor endpoints.
    """
    buf = io.BytesIO()
    c = canvas.Canvas(buf, pagesize=letter)

    left = 0.75 * inch
    right = letter[0] - 0.75 * inch
    top = letter[1] - 0.75 * inch
    min_y = 0.85 * inch

    inv_id = getattr(invoice, "id", None)
    invoice_number = getattr(invoice, "invoice_number", None) or f"INV-{inv_id or '—'}"
    status = getattr(invoice, "status", None) or "—"
    amount = getattr(invoice, "amount", None) or 0
    created_at = getattr(invoice, "created_at", None)

    agreement = getattr(invoice, "agreement", None)
    agreement_id = getattr(agreement, "id", None)

    project = getattr(agreement, "project", None) if agreement else None
    project_title = getattr(project, "title", None) or getattr(invoice, "project_title", None) or "—"

    contractor = _get_contractor(invoice)
    contractor_name = _contractor_business_name(contractor)
    contractor_lines = _contractor_address_lines(contractor)
    logo_path = _contractor_logo_path(contractor)

    homeowner = _get_homeowner(invoice)
    bill_to_lines = _homeowner_lines(homeowner, invoice)

    ms_id, ms_title, ms_desc, completion_notes, attachments = _milestone_from_invoice(invoice)

    # -------- HEADER --------
    y = top

    logo_w = 1.65 * inch
    logo_h = 0.75 * inch
    if logo_path:
        try:
            img = ImageReader(logo_path)
            c.drawImage(img, left, y - logo_h + 5, width=logo_w, height=logo_h, preserveAspectRatio=True, mask="auto")
        except Exception:
            logo_path = None

    c.setFont("Helvetica-Bold", 18)
    c.setFillColor(colors.black)
    name_x = left + (logo_w + 12 if logo_path else 0)
    c.drawString(name_x, y, contractor_name)

    c.setFont("Helvetica-Bold", 18)
    c.drawRightString(right, y, "INVOICE")

    y -= 0.25 * inch

    c.setFont("Helvetica", 9)
    c.setFillColor(colors.grey)
    for ln in contractor_lines[:6]:
        c.drawString(name_x, y, ln)
        y -= 12
    c.setFillColor(colors.black)

    y = min(y, top - 0.55 * inch)
    c.setStrokeColor(colors.lightgrey)
    c.line(left, y, right, y)
    y -= 0.25 * inch

    # -------- SUMMARY --------
    c.setFont("Helvetica-Bold", 11)
    c.drawString(left, y, f"Invoice #: {invoice_number}")
    c.setFont("Helvetica", 10)
    c.drawString(left, y - 14, f"Agreement #: {agreement_id if agreement_id is not None else '—'}")
    c.drawString(left, y - 28, f"Project: {project_title}")

    c.setFont("Helvetica-Bold", 11)
    c.drawRightString(right, y, f"Amount: {_money(amount)}")
    c.setFont("Helvetica", 10)
    c.drawRightString(right, y - 14, f"Status: {str(status).replace('_', ' ').title()}")
    c.drawRightString(right, y - 28, f"Issued: {_safe_dt(created_at)}")

    y -= 0.55 * inch
    c.setStrokeColor(colors.lightgrey)
    c.line(left, y, right, y)
    y -= 0.25 * inch

    # -------- BILL TO --------
    c.setFont("Helvetica-Bold", 12)
    c.drawString(left, y, "Bill To")
    y -= 16
    c.setFont("Helvetica", 10)
    for ln in bill_to_lines:
        y = _maybe_page_break(c, y, min_y)
        c.drawString(left, y, ln)
        y -= 14
    y -= 10

    y = _maybe_page_break(c, y, min_y)

    # -------- MILESTONE --------
    c.setFont("Helvetica-Bold", 12)
    c.drawString(left, y, "Milestone")
    y -= 16

    c.setFont("Helvetica-Bold", 10)
    c.drawString(left, y, "Title:")
    c.setFont("Helvetica", 10)
    title_line = f"#{ms_id} — {ms_title}" if ms_id else ms_title
    c.drawString(left + 45, y, title_line)
    y -= 14

    c.setFont("Helvetica-Bold", 10)
    c.drawString(left, y, "Description:")
    y -= 14
    c.setFont("Helvetica", 10)
    for ln in _wrap_text(c, ms_desc, "Helvetica", 10, right - left):
        y = _maybe_page_break(c, y, min_y)
        c.drawString(left, y, ln)
        y -= 14
    y -= 10

    y = _maybe_page_break(c, y, min_y)

    # -------- COMPLETION NOTES --------
    c.setFont("Helvetica-Bold", 12)
    c.drawString(left, y, "Completion Notes")
    y -= 16
    c.setFont("Helvetica", 10)

    if not completion_notes:
        c.setFillColor(colors.grey)
        c.drawString(left, y, "—")
        c.setFillColor(colors.black)
        y -= 14
    else:
        for raw in completion_notes.splitlines():
            ln = raw.strip()
            if not ln:
                continue
            for wln in _wrap_text(c, ln, "Helvetica", 10, right - left):
                y = _maybe_page_break(c, y, min_y)
                c.drawString(left, y, wln)
                y -= 14
    y -= 10

    y = _maybe_page_break(c, y, min_y)

    # -------- ATTACHMENTS (blue underlined links) --------
    c.setFont("Helvetica-Bold", 12)
    c.setFillColor(colors.black)
    c.drawString(left, y, "Attachments")
    y -= 16

    c.setFont("Helvetica", 10)
    if not attachments:
        c.setFillColor(colors.grey)
        c.drawString(left, y, "—")
        c.setFillColor(colors.black)
        y -= 14
    else:
        for a in attachments:
            y = _maybe_page_break(c, y, min_y)
            if not isinstance(a, dict):
                c.setFillColor(colors.black)
                c.drawString(left, y, "• Attachment")
                y -= 14
                continue

            name = (a.get("name") or a.get("filename") or "attachment").strip()
            display = os.path.basename(name) or name
            url = (a.get("url") or "").strip()

            c.setFillColor(colors.black)
            c.drawString(left, y, "• ")
            link_x = left + c.stringWidth("• ", "Helvetica", 10)

            c.setFillColor(colors.blue)
            c.drawString(link_x, y, display)

            text_w = c.stringWidth(display, "Helvetica", 10)
            c.setStrokeColor(colors.blue)
            c.setLineWidth(0.8)
            c.line(link_x, y - 2, link_x + text_w, y - 2)

            if url:
                c.linkURL(url, (link_x, y - 2, link_x + text_w, y + 10), relative=0)

            c.setFillColor(colors.black)
            c.setStrokeColor(colors.black)
            y -= 14

    # -------- FOOTER --------
    c.setFont("Helvetica", 8)
    c.setFillColor(colors.grey)
    c.drawString(left, 0.6 * inch, f"Generated {datetime.now().strftime('%Y-%m-%d %I:%M %p')}")
    c.setFillColor(colors.black)

    c.showPage()
    c.save()

    pdf = buf.getvalue()
    buf.close()
    return pdf
