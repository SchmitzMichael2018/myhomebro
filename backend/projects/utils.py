import os
import logging
from io import BytesIO
from datetime import datetime

from django.conf import settings
from django.core.files.base import ContentFile
from django.urls import reverse
from django.core.mail import send_mail

from twilio.rest import Client  # type: ignore
from pypdf import PdfWriter

from .models import Agreement, Invoice

# ReportLab imports
from reportlab.lib.pagesizes import LETTER
from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
from reportlab.platypus import (
    SimpleDocTemplate, Image, Paragraph, Spacer,
    Table, TableStyle, KeepTogether
)
from reportlab.lib.units import inch
from reportlab.lib import colors
from reportlab.lib.enums import TA_CENTER
from reportlab.graphics.barcode import qr
from reportlab.graphics.shapes import Drawing
from reportlab.graphics import renderPDF

# Static asset paths
LEGAL_PDF_DIR = os.path.join(settings.BASE_DIR, 'static', 'legal')
TERMS_PDF_PATH = os.path.join(LEGAL_PDF_DIR, 'terms_of_service.pdf')
PRIVACY_PDF_PATH = os.path.join(LEGAL_PDF_DIR, 'privacy_policy.pdf')
TXT_SOURCE_DIR = os.path.join(settings.BASE_DIR, '..', 'frontend', 'public', 'static', 'legal')

CATEGORY_KEYWORDS = {
    'Remodel - Bath': ['bath', 'powder room', 'washroom', 'restroom', 'shower', 'en-suite'],
    'Remodel - Kitchen': ['kitchen', 'galley', 'pantry'],
    'Remodel - Basement': ['basement', 'cellar'],
    'Painting - Interior': ['interior', 'indoor', 'walls', 'ceiling', 'room'],
    'Painting - Exterior': ['exterior', 'outdoor', 'siding', 'trim', 'facade'],
    'Repair - Plumbing': ['plumbing', 'pipe', 'faucet', 'leak', 'toilet', 'drain'],
    'Repair - Electrical': ['electrical', 'outlet', 'wiring', 'switch', 'panel'],
    'Installation - Flooring': ['floor', 'flooring', 'tile', 'hardwood', 'laminate', 'carpet'],
    'Installation - Appliance': ['appliance', 'dishwasher', 'oven', 'fridge'],
    'Outdoor - Deck/Patio': ['deck', 'patio', 'porch'],
    'Outdoor - Landscaping': ['landscaping', 'yard', 'garden', 'lawn'],
}

def categorize_project(project_type, subtype_text):
    if not subtype_text:
        return project_type
    text = subtype_text.lower()
    for category, keywords in CATEGORY_KEYWORDS.items():
        if category.startswith(project_type) and any(k in text for k in keywords):
            return category
    return f"{project_type} - {subtype_text.title()}"

def load_legal_text(filename: str) -> str:
    path = os.path.join(TXT_SOURCE_DIR, filename)
    if not os.path.exists(path):
        raise FileNotFoundError(f"Legal source file not found: {path}")
    with open(path, 'r', encoding='utf-8') as f:
        return f.read()

def generate_qr_code(link: str, width=100, height=100):
    qr_code = qr.QrCodeWidget(link)
    bounds = qr_code.getBounds()
    scale_x = width / (bounds[2] - bounds[0])
    scale_y = height / (bounds[3] - bounds[1])
    drawing = Drawing(width, height, transform=[scale_x, 0, 0, scale_y, 0, 0])
    drawing.add(qr_code)
    return drawing

def generate_full_agreement_pdf(agreement: Agreement) -> None:
    base_buf = BytesIO()
    doc = SimpleDocTemplate(
        base_buf,
        pagesize=LETTER,
        leftMargin=0.75 * inch,
        rightMargin=0.75 * inch,
        topMargin=1.2 * inch,
        bottomMargin=0.75 * inch,
    )
    styles = getSampleStyleSheet()
    styles.add(ParagraphStyle(name='CenteredTitle', parent=styles['Title'], alignment=TA_CENTER))
    elements = []

    logo = os.path.join(settings.BASE_DIR, 'static', 'myhomebro_logo.png')
    if os.path.exists(logo):
        elements.append(Image(logo, width=2 * inch, height=0.75 * inch))
    elements.append(Paragraph('MyHomeBro Project Agreement', styles['CenteredTitle']))
    elements.append(Spacer(1, 12))

    elements.extend([
        Paragraph('<b>Project & Parties</b>', styles['Heading4']),
        Paragraph(f'<b>Agreement ID:</b> {agreement.project_uid}', styles['Normal']),
        Paragraph(f'<b>Project:</b> {agreement.project.title}', styles['Normal']),
        Paragraph(f'<b>Description:</b> {agreement.project.description or "N/A"}', styles['Normal']),
        Paragraph(f'<b>Total Cost:</b> ${agreement.total_cost}', styles['Normal']),
        Spacer(1, 12),
    ])

    c = agreement.project.contractor
    elements.extend([
        Paragraph('<b>Contractor Info</b>', styles['Heading4']),
        Paragraph(f'<b>Name:</b> {c.user.get_full_name()}', styles['Normal']),
        Paragraph(f'<b>Email:</b> {c.user.email}', styles['Normal']),
    ])
    if c.phone:
        elements.append(Paragraph(f'<b>Phone:</b> {c.phone}', styles['Normal']))
    elements.append(Spacer(1, 12))

    h = agreement.project.homeowner
    elements.extend([
        Paragraph('<b>Homeowner Info</b>', styles['Heading4']),
        Paragraph(f'<b>Name:</b> {h.full_name}', styles['Normal']),
        Paragraph(f'<b>Email:</b> {h.email}', styles['Normal']),
    ])
    if h.phone_number:
        elements.append(Paragraph(f'<b>Phone:</b> {h.phone_number}', styles['Normal']))
    elements.append(Spacer(1, 12))

    if agreement.milestones.exists():
        data = [['#', 'Title', 'Amount', 'Start → End', 'Status']]
        for idx, m in enumerate(agreement.milestones.all(), start=1):
            status = '✔ Completed' if m.completed else '✘ Incomplete'
            data.append([idx, m.title, f'${m.amount:.2f}', f'{m.start_date} → {m.completion_date}', status])
        tbl = Table(data, hAlign='LEFT', repeatRows=1,
                    colWidths=[0.3*inch, 3*inch, 1*inch, 1.7*inch, 1*inch])
        tbl.setStyle(TableStyle([
            ('BACKGROUND', (0, 0), (-1, 0), colors.lightgrey),
            ('GRID', (0, 0), (-1, -1), 0.5, colors.black),
            ('VALIGN', (0, 0), (-1, -1), 'MIDDLE'),
            ('ALIGN', (2, 1), (2, -1), 'RIGHT'),
        ]))
        elements.append(KeepTogether([tbl, Spacer(1, 12)]))

    # Signature metadata
    if agreement.signed_by_contractor:
        elements.append(Paragraph('<b>Contractor Signature</b>', styles['Heading4']))
        elements.append(Paragraph(f"Signed by: {agreement.contractor_signature_name or 'N/A'}", styles['Normal']))
        elements.append(Paragraph(f"IP: {agreement.contractor_signed_ip or 'N/A'}", styles['Normal']))
        elements.append(Paragraph(f"Timestamp: {agreement.signed_at_contractor.strftime('%Y-%m-%d %I:%M %p') if agreement.signed_at_contractor else 'N/A'}", styles['Normal']))
        elements.append(Spacer(1, 8))
    if agreement.signed_by_homeowner:
        elements.append(Paragraph('<b>Homeowner Signature</b>', styles['Heading4']))
        elements.append(Paragraph(f"Signed by: {agreement.homeowner_signature_name or 'N/A'}", styles['Normal']))
        elements.append(Paragraph(f"IP: {agreement.homeowner_signed_ip or 'N/A'}", styles['Normal']))
        elements.append(Paragraph(f"Timestamp: {agreement.signed_at_homeowner.strftime('%Y-%m-%d %I:%M %p') if agreement.signed_at_homeowner else 'N/A'}", styles['Normal']))
        elements.append(Spacer(1, 12))

    # QR Code to view agreement
    public_url = f"https://www.myhomebro.com/agreements/access/{agreement.homeowner_access_token}/pdf"
    elements.append(Paragraph('<b>Verification QR Code</b>', styles['Heading4']))
    qr_img = generate_qr_code(public_url, width=80, height=80)
    elements.append(qr_img)
    elements.append(Paragraph(f"Scan to verify agreement online:", styles['Normal']))
    elements.append(Paragraph(public_url, styles['Normal']))
    elements.append(Spacer(1, 12))

    # Version History
    elements.append(Paragraph('<b>Version Info</b>', styles['Heading4']))
    elements.append(Paragraph(f"PDF Version: v{agreement.pdf_version}", styles['Normal']))
    elements.append(Paragraph(f"Last Updated: {datetime.now().strftime('%Y-%m-%d %I:%M %p')}", styles['Normal']))

    doc.build(elements)
    base_buf.seek(0)

    merger = PdfWriter()
    merger.append(base_buf)
    if agreement.addendum_file:
        try:
            merger.append(BytesIO(agreement.addendum_file.read()))
        except Exception as e:
            logging.error(f"Addendum merge error for {agreement.id}: {e}")
    for path in (TERMS_PDF_PATH, PRIVACY_PDF_PATH):
        try:
            with open(path, 'rb') as f:
                merger.append(BytesIO(f.read()))
        except Exception as e:
            logging.error(f"Error appending {path}: {e}")

    final_buf = BytesIO()
    merger.write(final_buf)
    final_buf.seek(0)
    name = f"agreement_{agreement.id}_v{agreement.pdf_version}.pdf"
    agreement.pdf_file.save(name, ContentFile(final_buf.getvalue()), save=True)

def generate_invoice_pdf(invoice: Invoice) -> BytesIO:
    buf = BytesIO()
    doc = SimpleDocTemplate(buf, pagesize=LETTER)
    doc.build([Paragraph("Invoice PDF generation not yet implemented.")])
    buf.seek(0)
    return buf

def send_agreement_invite_email(agreement: Agreement, request) -> None:
    homeowner = agreement.project.homeowner
    if not homeowner or not homeowner.email:
        logging.warning(f"No email for agreement {agreement.id}")
        return
    url = reverse("projects_api:agreement-magic-access", kwargs={"token": agreement.homeowner_access_token})
    link = request.build_absolute_uri(url)
    subject = f"Please Review & Sign: '{agreement.project.title}'"
    body = (
        f"Hi {homeowner.full_name},\n\n"
        f"{agreement.project.contractor.user.get_full_name()} has sent you an agreement.\n"
        f"Review here: {link}\n\nThanks,\nMyHomeBro Team"
    )
    try:
        send_mail(subject, body, settings.DEFAULT_FROM_EMAIL, [homeowner.email])
    except Exception as e:
        logging.error(f"Email error for {agreement.id}: {e}")
    phone = homeowner.phone_number
    if phone and all([settings.TWILIO_ACCOUNT_SID, settings.TWILIO_AUTH_TOKEN, settings.TWILIO_FROM_NUMBER]):
        try:
            Client(settings.TWILIO_ACCOUNT_SID, settings.TWILIO_AUTH_TOKEN).messages.create(
                body=f"Sign here: {link}",
                from_=settings.TWILIO_FROM_NUMBER,
                to=phone
            )
        except Exception as e:
            logging.error(f"SMS error for {agreement.id}: {e}")
