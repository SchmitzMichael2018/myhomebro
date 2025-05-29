# projects/utils.py
from io import BytesIO
from django.core.mail import send_mail
from reportlab.pdfgen import canvas
from django.conf import settings
from .models import Agreement, Invoice
import logging
import os

logger = logging.getLogger(__name__)

def generate_agreement_pdf(agreement_or_id):
    """
    Generates a PDF for the Agreement and saves it to a directory.
    Accepts an Agreement instance or agreement_id.
    Returns the full path to the PDF.
    Raises exceptions for view to handle.
    """
    # Accept either instance or ID
    if isinstance(agreement_or_id, Agreement):
        agreement = agreement_or_id
    else:
        agreement = Agreement.objects.get(id=agreement_or_id)

    buffer = BytesIO()
    p = canvas.Canvas(buffer)
    # Add more fields as desired
    p.drawString(100, 750, f"Agreement ID: {agreement.id}")
    p.drawString(100, 730, f"Contractor: {agreement.contractor}")
    p.drawString(100, 710, f"Total Cost: {agreement.total_cost}")
    # Example: homeowner, project, milestones, etc.
    p.showPage()
    p.save()
    buffer.seek(0)

    # Use MEDIA_ROOT for better Django compatibility
    pdf_directory = os.path.join(settings.MEDIA_ROOT, "agreements")
    os.makedirs(pdf_directory, exist_ok=True)

    pdf_path = os.path.join(pdf_directory, f"agreement_{agreement.id}.pdf")
    with open(pdf_path, "wb") as pdf_file:
        pdf_file.write(buffer.getbuffer())

    logger.info(f"✅ PDF generated for Agreement {agreement.id} at {pdf_path}.")
    return pdf_path





