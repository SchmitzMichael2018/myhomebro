# projects/utils.py

import os
from io import BytesIO
from datetime import datetime
import tempfile

from django.conf import settings
from reportlab.lib.pagesizes import LETTER
from reportlab.lib.units import inch
from reportlab.platypus import (
    Paragraph,
    Table,
    TableStyle,
    SimpleDocTemplate,
    Spacer,
    Image,
    KeepTogether,
)
from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
from reportlab.graphics.barcode.qr import QrCodeWidget
from reportlab.graphics.shapes import Drawing
from reportlab.lib import colors


# --------------------------------------------------------------------------------------------------
# 1) load_legal_text: read a file from <BASE_DIR>/static/legal/<filename>
# --------------------------------------------------------------------------------------------------
def load_legal_text(filename):
    """
    Read a legal text file from <BASE_DIR>/static/legal/<filename> and return its contents.
    If the file does not exist, return an empty string.
    """
    base_dir = settings.BASE_DIR  # should point at the folder containing manage.py
    path = os.path.join(base_dir, "static", "legal", filename)
    try:
        with open(path, "r", encoding="utf-8") as f:
            return f.read()
    except FileNotFoundError:
        return ""


# --------------------------------------------------------------------------------------------------
# 2) generate_full_agreement_pdf: build a PDF that includes project details + full TOS & Privacy
# --------------------------------------------------------------------------------------------------
def generate_full_agreement_pdf(agreement):
    buffer = BytesIO()
    doc = SimpleDocTemplate(
        buffer,
        pagesize=LETTER,
        leftMargin=0.75 * inch,
        rightMargin=0.75 * inch,
        topMargin=1.2 * inch,
        bottomMargin=0.75 * inch,
    )

    styles = getSampleStyleSheet()
    styles.add(ParagraphStyle(name="CenteredTitle", parent=styles["Title"], alignment=1))
    elements = []

    # --- Add logo if it exists ---
    logo_path = os.path.join(settings.BASE_DIR, "static", "myhomebro_logo.png")
    if os.path.exists(logo_path):
        elements.append(Image(logo_path, width=2 * inch, height=0.75 * inch))

    # --- Title ---
    elements.append(Paragraph("MyHomeBro Project Agreement", styles["CenteredTitle"]))
    elements.append(Spacer(1, 12))

    # --- Project Details ---
    elements.append(Paragraph("<b>Project & Parties</b>", styles["Heading4"]))
    elements.append(Paragraph(f"<b>Agreement ID:</b> {agreement.id}", styles["Normal"]))
    elements.append(Paragraph(f"<b>Project:</b> {agreement.project.title}", styles["Normal"]))
    elements.append(Paragraph(f"<b>Description:</b> {agreement.project.description}", styles["Normal"]))
    type_val = agreement.project_type or "—"
    subtype_val = agreement.project_subtype or "—"
    elements.append(Paragraph(f"<b>Type/Subtype:</b> {type_val} / {subtype_val}", styles["Normal"]))
    elements.append(Paragraph(f"<b>Total Cost:</b> ${agreement.total_cost}", styles["Normal"]))
    elements.append(Spacer(1, 12))

    # --- Contractor Info ---
    contractor_profile = getattr(agreement.contractor, "contractor_profile", None)
    contractor_name = getattr(contractor_profile, "name", "—")
    contractor_email = getattr(contractor_profile, "email", "—")
    contractor_phone = getattr(contractor_profile, "phone", "—")
    contractor_address = getattr(contractor_profile, "address", "—")
    contractor_business = getattr(contractor_profile, "business_name", "—")
    contractor_license = getattr(contractor_profile, "license_number", None)

    elements.append(Paragraph("<b>Contractor Info</b>", styles["Heading4"]))
    elements.append(Paragraph(f"Business Name: {contractor_business}", styles["Normal"]))
    elements.append(Paragraph(f"Name: {contractor_name}", styles["Normal"]))
    elements.append(Paragraph(f"Email: {contractor_email}", styles["Normal"]))
    elements.append(Paragraph(f"Phone: {contractor_phone}", styles["Normal"]))
    elements.append(Paragraph(f"Address: {contractor_address}", styles["Normal"]))
    if contractor_license:
        elements.append(Paragraph(f"License #: {contractor_license}", styles["Normal"]))
    elements.append(Spacer(1, 8))

    # --- Homeowner Info ---
    homeowner = getattr(agreement.project, "homeowner", None)
    homeowner_name = getattr(homeowner, "name", "—")
    homeowner_email = getattr(homeowner, "email", "—")
    homeowner_phone = getattr(homeowner, "phone", "—")
    homeowner_address = getattr(homeowner, "address", "—")
    project_address = getattr(agreement.project, "project_address", "—")

    elements.append(Paragraph("<b>Homeowner Info</b>", styles["Heading4"]))
    elements.append(Paragraph(f"Name: {homeowner_name}", styles["Normal"]))
    elements.append(Paragraph(f"Email: {homeowner_email}", styles["Normal"]))
    elements.append(Paragraph(f"Phone: {homeowner_phone}", styles["Normal"]))
    elements.append(Paragraph(f"Home Address: {homeowner_address}", styles["Normal"]))
    elements.append(Paragraph(f"Project Address: {project_address}", styles["Normal"]))
    elements.append(Spacer(1, 8))

    # --- Milestones Table ---
    if agreement.milestones.exists():
        elements.append(Paragraph("<b>Milestones</b>", styles["Heading3"]))
        data = [["#", "Title", "Amount", "Start → End", "Duration", "Status"]]
        for idx, milestone in enumerate(agreement.milestones.all(), start=1):
            duration_str = f"{milestone.days}d {milestone.hours}h {milestone.minutes}m"
            data.append(
                [
                    idx,
                    milestone.title,
                    f"${milestone.amount:.2f}",
                    f"{milestone.start_date} → {milestone.completion_date}",
                    duration_str,
                    "✔ Completed" if milestone.completed else "✘ Incomplete",
                ]
            )
        table = Table(data, hAlign="LEFT", repeatRows=1)
        table.setStyle(
            TableStyle(
                [
                    ("BACKGROUND", (0, 0), (-1, 0), colors.lightgrey),
                    ("GRID", (0, 0), (-1, -1), 0.5, colors.black),
                    ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
                    ("ALIGN", (2, 0), (2, -1), "RIGHT"),
                ]
            )
        )
        elements.append(KeepTogether([table, Spacer(1, 12)]))

    # --- Terms of Service ---
    elements.append(Paragraph("<b>Terms of Service</b>", styles["Heading3"]))
    terms_text = load_legal_text("terms_of_service.txt") or "Error loading Terms of Service."
    for para in terms_text.strip().split("\n\n"):
        elements.append(Paragraph(para.strip(), styles["Normal"]))
        elements.append(Spacer(1, 6))
    elements.append(Spacer(1, 12))

    # --- Privacy Policy ---
    elements.append(Paragraph("<b>Privacy Policy</b>", styles["Heading3"]))
    privacy_text = load_legal_text("privacy_policy.txt") or "Error loading Privacy Policy."
    for para in privacy_text.strip().split("\n\n"):
        elements.append(Paragraph(para.strip(), styles["Normal"]))
        elements.append(Spacer(1, 6))
    elements.append(Spacer(1, 12))

    # --- Signatures and Acceptance ---
    elements.append(Paragraph("<b>Signatures and Acceptance</b>", styles["Heading3"]))

    def signature_block(name, sig_name, sig_ip, sig_time):
        return f"<b>{name}:</b> {sig_name or '—'} (IP: {sig_ip or '—'})<br/>Date: {sig_time or '—'}"

    elements.append(
        Paragraph(
            signature_block(
                "Contractor Signature",
                agreement.contractor_signature_name,
                agreement.contractor_signed_ip,
                agreement.signed_at_contractor,
            ),
            styles["Normal"],
        )
    )
    elements.append(Spacer(1, 6))
    elements.append(
        Paragraph(
            signature_block(
                "Homeowner Signature",
                agreement.homeowner_signature_name,
                agreement.homeowner_signed_ip,
                agreement.signed_at_homeowner,
            ),
            styles["Normal"],
        )
    )
    elements.append(Spacer(1, 12))

    # --- QR Code for verification ---
    qr_code = QrCodeWidget(f"https://myhomebro.com/verify/{agreement.id}")
    d = Drawing(80, 80)
    d.add(qr_code)
    elements.append(Paragraph("<b>Verify this agreement online:</b>", styles["Normal"]))
    elements.append(d)
    elements.append(Spacer(1, 12))

    # --- Footer with timestamp and page numbers ---
    def add_footer(canvas_obj, doc_obj):
        canvas_obj.setFont("Helvetica", 8)
        canvas_obj.drawString(
            0.75 * inch, 0.5 * inch, "Generated by MyHomeBro – legal terms and data are included."
        )
        canvas_obj.drawRightString(7.75 * inch, 0.5 * inch, f"Page {doc_obj.page}")
        canvas_obj.drawCentredString(
            4.25 * inch,
            0.35 * inch,
            f"Generated on {datetime.now().strftime('%Y-%m-%d %I:%M %p')}",
        )

    doc.build(elements, onFirstPage=add_footer, onLaterPages=add_footer)

    # --- Write the in-memory buffer to a temp file on disk ---
    buffer.seek(0)
    temp_dir = tempfile.gettempdir()
    pdf_path = os.path.join(temp_dir, f"agreement_{agreement.id}.pdf")
    with open(pdf_path, "wb") as f:
        f.write(buffer.getbuffer())

    return pdf_path
