import io
from decimal import Decimal

from django.conf import settings
from django.core.files.base import ContentFile
from django.utils.timezone import localtime

from reportlab.lib.pagesizes import LETTER
from reportlab.pdfgen import canvas


def _usd(cents: int) -> str:
    try:
        return f"{(Decimal(int(cents)) / 100):.2f}"
    except Exception:
        return "0.00"


def _safe_str(val) -> str:
    if val is None:
        return ""
    try:
        return str(val).strip()
    except Exception:
        return ""


def _first_attr(obj, fields, default=""):
    if obj is None:
        return default
    for f in fields:
        try:
            v = getattr(obj, f, None)
        except Exception:
            v = None
        if v is None:
            continue
        s = _safe_str(v)
        if s:
            return s
    return default


def _user_display_name(user):
    if not user:
        return ""
    try:
        if hasattr(user, "get_full_name"):
            full = _safe_str(user.get_full_name())
            if full:
                return full
    except Exception:
        pass

    first = _first_attr(user, ["first_name"], "")
    last = _first_attr(user, ["last_name"], "")
    if first or last:
        return f"{first} {last}".strip()

    return _first_attr(user, ["email"], "")


def _dedupe_lines(lines):
    seen = set()
    out = []
    for line in lines:
        line = _safe_str(line)
        if not line:
            continue
        key = line.lower()
        if key in seen:
            continue
        seen.add(key)
        out.append(line)
    return out


def _draw_wrapped_text(c, text, x, y, max_width, line_height=12, max_lines=6):
    text = _safe_str(text)
    if not text:
        return y

    words = text.split()
    lines = []
    current = ""

    for w in words:
        test = f"{current} {w}".strip()
        if c.stringWidth(test, "Helvetica", 10) <= max_width:
            current = test
        else:
            lines.append(current)
            current = w
        if len(lines) >= max_lines:
            break

    if current and len(lines) < max_lines:
        lines.append(current)

    for line in lines:
        c.drawString(x, y, line)
        y -= line_height

    return y


def _get_myhomebro_logo_path():
    return getattr(settings, "MYHOMEBRO_LOGO_PATH", None)


def _contractor_profile_for_agreement(agreement):
    if not agreement:
        return None

    c = getattr(agreement, "contractor", None)
    if c is None:
        return None

    if hasattr(c, "business_name"):
        return c

    return getattr(c, "contractor_profile", None)


def _contractor_logo_path(contractor):
    if not contractor:
        return None
    logo = getattr(contractor, "logo", None)
    return getattr(logo, "path", None) if logo else None


def _delete_existing_pdf_if_any(receipt):
    try:
        if receipt.pdf_file and receipt.pdf_file.name:
            storage = receipt.pdf_file.storage
            name = receipt.pdf_file.name
            if storage.exists(name):
                storage.delete(name)
            receipt.pdf_file.name = None
    except Exception:
        pass


def generate_receipt_pdf(receipt):
    invoice = receipt.invoice
    agreement = getattr(invoice, "agreement", None)
    project = getattr(agreement, "project", None) if agreement else None

    contractor = _contractor_profile_for_agreement(agreement)
    contractor_user = getattr(contractor, "user", None)
    homeowner_user = getattr(agreement, "homeowner", None)

    invoice_number = _first_attr(invoice, ["invoice_number"], str(invoice.id))
    agreement_title = _first_attr(project, ["title"], _first_attr(agreement, ["project_type"], ""))

    milestone_title = _first_attr(invoice, ["milestone_title_snapshot"], "")
    milestone_desc = _first_attr(invoice, ["milestone_description_snapshot"], "")

    paid = int(receipt.amount_paid_cents or 0)
    fee = int(receipt.platform_fee_cents or 0)
    net = paid - fee

    brand = _safe_str(receipt.card_brand)
    last4 = _safe_str(receipt.card_last4)

    buffer = io.BytesIO()
    c = canvas.Canvas(buffer, pagesize=LETTER)
    width, height = LETTER

    margin_x = 50
    right_x = width - margin_x
    y = height - 45

    # Header
    logo_path = _contractor_logo_path(contractor)
    if logo_path:
        c.drawImage(logo_path, margin_x, y - 35, width=140, height=35, mask="auto")

    c.setFont("Helvetica-Bold", 20)
    c.drawRightString(right_x, y, "Payment Receipt")

    c.setFont("Helvetica", 11)
    c.drawRightString(right_x, y - 18, f"Invoice: {invoice_number}")
    c.drawRightString(right_x, y - 34, f"Agreement: {agreement_title}")

    y -= 60
    c.drawString(margin_x, y, f"Receipt #: {receipt.receipt_number}")
    y -= 14
    c.drawString(margin_x, y, f"Date: {localtime(receipt.created_at).strftime('%Y-%m-%d %I:%M %p %Z')}")

    c.line(margin_x, y - 10, right_x, y - 10)
    y -= 30

    # Contractor / Customer
    contractor_lines = _dedupe_lines([
        getattr(contractor, "business_name", ""),
        _user_display_name(contractor_user),
        getattr(contractor_user, "email", ""),
        getattr(contractor, "phone", ""),
        f"{getattr(contractor,'address','')}, {getattr(contractor,'city','')} {getattr(contractor,'state','')}",
        f"License #: {getattr(contractor,'license_number','')}",
    ])

    customer_lines = _dedupe_lines([
        _user_display_name(homeowner_user),
        getattr(homeowner_user, "email", ""),
        getattr(homeowner_user, "phone", ""),
    ])

    c.setFont("Helvetica-Bold", 12)
    c.drawString(margin_x, y, "Contractor")
    c.drawString(width / 2 + 10, y, "Customer")
    y -= 16

    c.setFont("Helvetica", 10)
    for i in range(max(len(contractor_lines), len(customer_lines))):
        if i < len(contractor_lines):
            c.drawString(margin_x, y, contractor_lines[i])
        if i < len(customer_lines):
            c.drawString(width / 2 + 10, y, customer_lines[i])
        y -= 13

    c.line(margin_x, y - 5, right_x, y - 5)
    y -= 25

    # Work & Milestone
    c.setFont("Helvetica-Bold", 13)
    c.drawString(margin_x, y, "Work & Milestone")
    y -= 18

    c.setFont("Helvetica-Bold", 10)
    c.drawString(margin_x, y, "Milestone:")
    c.setFont("Helvetica", 10)
    y = _draw_wrapped_text(c, milestone_title, margin_x + 120, y, right_x - (margin_x + 120))

    if milestone_desc:
        c.setFont("Helvetica-Bold", 10)
        c.drawString(margin_x, y, "Description:")
        c.setFont("Helvetica", 10)
        y = _draw_wrapped_text(c, milestone_desc, margin_x + 120, y, right_x - (margin_x + 120))

    c.line(margin_x, y - 5, right_x, y - 5)
    y -= 25

    # Amounts
    c.setFont("Helvetica-Bold", 13)
    c.drawString(margin_x, y, "Amounts")
    y -= 18

    c.setFont("Helvetica", 11)
    c.drawString(margin_x, y, f"Amount Paid: ${_usd(paid)}")
    y -= 14
    c.drawString(margin_x, y, f"Platform Fee: ${_usd(fee)}")
    y -= 14
    c.drawString(margin_x, y, f"Net to Contractor: ${_usd(net)}")
    y -= 25

    # Payment Method
    c.setFont("Helvetica-Bold", 13)
    c.drawString(margin_x, y, "Payment Method")
    y -= 18

    c.setFont("Helvetica", 11)
    if brand and last4:
        c.drawString(margin_x, y, f"{brand.upper()} •••• {last4}")
    else:
        c.drawString(margin_x, y, "Card")

    # Footer
    footer_y = 55
    logo = _get_myhomebro_logo_path()
    if logo:
        c.drawImage(logo, margin_x, footer_y - 12, width=90, height=24, mask="auto")

    c.setFont("Helvetica", 9)
    c.drawRightString(right_x, footer_y, "Payment processed securely via MyHomeBro Escrow • myhomebro.com")

    c.showPage()
    c.save()

    _delete_existing_pdf_if_any(receipt)

    # IMPORTANT: upload_to='receipts/' already prefixes the folder
    filename = f"receipt_{receipt.receipt_number}.pdf"
    receipt.pdf_file.save(filename, ContentFile(buffer.getvalue()), save=True)
