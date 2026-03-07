import io
from decimal import Decimal

from django.conf import settings
from django.core.files.base import ContentFile
from django.utils.timezone import localtime, now

from reportlab.lib.pagesizes import LETTER
from reportlab.pdfgen import canvas


def _usd(cents: int) -> str:
    try:
        return f"{(Decimal(int(cents)) / 100):,.2f}"
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


def _clean_line(s: str) -> str:
    s = _safe_str(s)
    s = s.replace(" ,", ",").replace(", ,", ",").strip()
    if s == ",":
        return ""
    return s.strip(", ").strip()


def _dedupe_lines(lines):
    seen = set()
    out = []
    for line in lines:
        line = _clean_line(line)
        if not line:
            continue
        key = line.lower()
        if key in seen:
            continue
        seen.add(key)
        out.append(line)
    return out


def _draw_wrapped_text(c, text, x, y, max_width, line_height=12, max_lines=6, font_name="Helvetica", font_size=10):
    text = _safe_str(text)
    if not text:
        return y

    c.setFont(font_name, font_size)

    words = text.split()
    lines = []
    current = ""

    for w in words:
        test = f"{current} {w}".strip()
        if c.stringWidth(test, font_name, font_size) <= max_width:
            current = test
        else:
            if current:
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


def _money_row(c, label: str, value: str, x_left: int, x_right: int, y: int):
    c.setFont("Helvetica", 11)
    c.drawString(x_left, y, label)
    c.drawRightString(x_right, y, value)
    return y - 14


def _is_escrow_funding_invoice(milestone_title: str) -> bool:
    title = _safe_str(milestone_title).lower()
    return title in {
        "escrow funding deposit",
        "escrow funding payment",
        "escrow deposit",
        "escrow funding",
    } or title.startswith("escrow funding")


def generate_receipt_pdf(receipt):
    """
    Generates a professional receipt PDF.

    Shows:
    - Who paid (customer)
    - Contractor
    - Project / agreement context
    - Payment method (brand/last4)
    - Stripe IDs (PI + Charge)
    - Amount paid / platform fee / net (escrow vs payout language)
    """
    invoice = getattr(receipt, "invoice", None)
    agreement = getattr(invoice, "agreement", None) if invoice else getattr(receipt, "agreement", None)
    project = getattr(agreement, "project", None) if agreement else None

    contractor = _contractor_profile_for_agreement(agreement)
    contractor_user = getattr(contractor, "user", None) if contractor else None
    homeowner_user = getattr(agreement, "homeowner", None) if agreement else None

    invoice_number = _first_attr(invoice, ["invoice_number"], str(getattr(invoice, "id", "")))
    agreement_id = getattr(agreement, "id", "")
    project_uid = _first_attr(agreement, ["project_uid"], "")

    agreement_title = _first_attr(project, ["title"], _first_attr(agreement, ["project_type"], ""))
    if not agreement_title:
        agreement_title = f"Agreement #{agreement_id}"

    # Address
    addr1 = _first_attr(agreement, ["project_address_line1"], "")
    addr2 = _first_attr(agreement, ["project_address_line2"], "")
    city = _first_attr(agreement, ["project_address_city"], "")
    st = _first_attr(agreement, ["project_address_state"], "")
    zipc = _first_attr(agreement, ["project_postal_code"], "")
    address_lines = _dedupe_lines([
        addr1,
        addr2,
        _clean_line(f"{city}, {st} {zipc}") if (city or st or zipc) else "",
    ])

    milestone_title = _first_attr(invoice, ["milestone_title_snapshot"], "")
    milestone_desc = _first_attr(invoice, ["milestone_description_snapshot"], "")

    paid = int(getattr(receipt, "amount_paid_cents", 0) or 0)
    fee = int(getattr(receipt, "platform_fee_cents", 0) or 0)
    net = max(paid - fee, 0)

    brand = _safe_str(getattr(receipt, "card_brand", ""))
    last4 = _safe_str(getattr(receipt, "card_last4", ""))
    stripe_charge_id = _safe_str(getattr(receipt, "stripe_charge_id", ""))
    pi_id = _safe_str(getattr(receipt, "stripe_payment_intent_id", ""))

    is_escrow_funding = _is_escrow_funding_invoice(milestone_title)
    escrow_released = bool(getattr(invoice, "escrow_released", False)) if invoice else False

    # Contractor / Customer blocks
    contractor_lines = _dedupe_lines([
        getattr(contractor, "business_name", "") if contractor else "",
        _user_display_name(contractor_user),
        getattr(contractor_user, "email", "") if contractor_user else "",
        getattr(contractor, "phone", "") if contractor else "",
        _clean_line(
            f"{getattr(contractor, 'address', '')}, "
            f"{getattr(contractor, 'city', '')} "
            f"{getattr(contractor, 'state', '')}"
        ) if contractor else "",
        (f"License #: {getattr(contractor, 'license_number', '')}" if contractor and getattr(contractor, "license_number", None) else ""),
    ])

    payer_lines = _dedupe_lines([
        _user_display_name(homeowner_user),
        getattr(homeowner_user, "email", "") if homeowner_user else "",
        getattr(homeowner_user, "phone", "") if homeowner_user else "",
    ])

    # ---- PDF layout ----
    buffer = io.BytesIO()
    c = canvas.Canvas(buffer, pagesize=LETTER)
    width, height = LETTER

    margin_x = 50
    right_x = width - margin_x
    mid_x = width / 2 + 10
    y = height - 45

    # Header logos
    contractor_logo = _contractor_logo_path(contractor)
    myhomebro_logo = _get_myhomebro_logo_path()

    if contractor_logo:
        try:
            c.drawImage(contractor_logo, margin_x, y - 30, width=140, height=32, mask="auto")
        except Exception:
            pass
    elif myhomebro_logo:
        try:
            c.drawImage(myhomebro_logo, margin_x, y - 30, width=140, height=32, mask="auto")
        except Exception:
            pass

    c.setFont("Helvetica-Bold", 22)
    c.drawRightString(right_x, y, "Payment Receipt")

    c.setFont("Helvetica", 10)
    c.drawRightString(right_x, y - 16, f"Receipt #: {getattr(receipt, 'receipt_number', '')}")
    c.drawRightString(right_x, y - 30, f"Invoice #: {invoice_number}")
    c.drawRightString(right_x, y - 44, f"Agreement ID: {agreement_id}")

    y -= 70

    c.setFont("Helvetica-Bold", 12)
    c.drawString(margin_x, y, "Project")
    y -= 14

    c.setFont("Helvetica", 11)
    c.drawString(margin_x, y, agreement_title)
    y -= 14

    if project_uid:
        c.setFont("Helvetica", 10)
        c.drawString(margin_x, y, f"Project UID: {project_uid}")
        y -= 14

    if address_lines:
        c.setFont("Helvetica", 10)
        c.drawString(margin_x, y, "Project Address:")
        y -= 12
        for line in address_lines:
            c.drawString(margin_x + 110, y, line)
            y -= 12
        y -= 4

    c.setFont("Helvetica", 11)
    receipt_dt = getattr(receipt, "created_at", None) or now()
    c.drawString(margin_x, y, f"Date: {localtime(receipt_dt).strftime('%Y-%m-%d %I:%M %p %Z')}")
    y -= 10

    c.line(margin_x, y - 8, right_x, y - 8)
    y -= 26

    # Contractor / Paid By
    c.setFont("Helvetica-Bold", 12)
    c.drawString(margin_x, y, "Contractor")
    c.drawString(mid_x, y, "Paid By")
    y -= 16

    c.setFont("Helvetica", 10)
    for i in range(max(len(contractor_lines), len(payer_lines))):
        if i < len(contractor_lines):
            c.drawString(margin_x, y, contractor_lines[i])
        if i < len(payer_lines):
            c.drawString(mid_x, y, payer_lines[i])
        y -= 13

    c.line(margin_x, y - 6, right_x, y - 6)
    y -= 26

    # Work details
    if milestone_title or milestone_desc:
        c.setFont("Helvetica-Bold", 13)
        c.drawString(margin_x, y, "Work Details")
        y -= 18

        c.setFont("Helvetica-Bold", 10)
        c.drawString(margin_x, y, "Item:")
        y = _draw_wrapped_text(
            c,
            milestone_title or "Payment",
            margin_x + 120,
            y,
            right_x - (margin_x + 120),
            max_lines=2,
            font_name="Helvetica",
            font_size=10,
        )

        if milestone_desc:
            c.setFont("Helvetica-Bold", 10)
            c.drawString(margin_x, y, "Description:")
            y = _draw_wrapped_text(
                c,
                milestone_desc,
                margin_x + 120,
                y,
                right_x - (margin_x + 120),
                max_lines=3,
                font_name="Helvetica",
                font_size=10,
            )

        c.line(margin_x, y - 6, right_x, y - 6)
        y -= 26

    # Amounts
    c.setFont("Helvetica-Bold", 13)
    c.drawString(margin_x, y, "Amounts")
    y -= 18

    y = _money_row(c, "Amount Paid", f"${_usd(paid)}", margin_x, right_x, y)
    y = _money_row(c, "Platform Fee", f"${_usd(fee)}", margin_x, right_x, y)

    if is_escrow_funding and not escrow_released:
        y = _money_row(c, "Net Held in Escrow", f"${_usd(net)}", margin_x, right_x, y)
    else:
        y = _money_row(c, "Net to Contractor", f"${_usd(net)}", margin_x, right_x, y)

    y -= 10
    c.line(margin_x, y, right_x, y)
    y -= 20

    # Payment Method + Stripe IDs
    c.setFont("Helvetica-Bold", 13)
    c.drawString(margin_x, y, "Payment Method")
    y -= 18

    c.setFont("Helvetica", 11)
    if brand and last4:
        c.drawString(margin_x, y, f"{brand.upper()} •••• {last4}")
    elif brand:
        c.drawString(margin_x, y, brand.upper())
    else:
        c.drawString(margin_x, y, "Card (details unavailable)")

    y -= 16
    c.setFont("Helvetica", 9)

    if pi_id:
        c.drawString(margin_x, y, f"Payment Intent: {pi_id}")
        y -= 12
    if stripe_charge_id:
        c.drawString(margin_x, y, f"Charge ID: {stripe_charge_id}")
        y -= 12

    # Status / escrow note
    y -= 8
    c.setFont("Helvetica-Bold", 12)
    c.drawString(margin_x, y, "Status")
    y -= 16
    c.setFont("Helvetica", 10)

    if is_escrow_funding and not escrow_released:
        c.drawString(margin_x, y, "Funds received and currently held in escrow.")
        y -= 12
        c.drawString(margin_x, y, "Release occurs according to milestone approval and agreement terms.")
        y -= 12
    elif escrow_released:
        c.drawString(margin_x, y, "Funds have been released from escrow.")
        y -= 12
    else:
        c.drawString(margin_x, y, "Payment received.")
        y -= 12

    # Footer
    footer_y = 55
    if myhomebro_logo:
        try:
            c.drawImage(myhomebro_logo, margin_x, footer_y - 12, width=90, height=24, mask="auto")
        except Exception:
            pass

    c.setFont("Helvetica", 9)
    c.drawRightString(right_x, footer_y, "Payment processed securely via MyHomeBro Escrow • myhomebro.com")

    c.showPage()
    c.save()

    _delete_existing_pdf_if_any(receipt)

    # IMPORTANT: upload_to='receipts/' already prefixes the folder
    filename = f"receipt_{receipt.receipt_number}.pdf"
    receipt.pdf_file.save(filename, ContentFile(buffer.getvalue()), save=True)