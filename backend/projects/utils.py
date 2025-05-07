# utils.py
import os
from fpdf import FPDF
from django.conf import settings
from django.core.files.storage import FileSystemStorage
from .models import Agreement
import base64
from io import BytesIO
from PIL import Image


def generate_agreement_pdf(agreement_id):
    try:
        # ✅ Fetch Agreement Details
        agreement = Agreement.objects.get(id=agreement_id)
        pdf = FPDF()
        pdf.add_page()
        pdf.set_auto_page_break(auto=True, margin=15)
        pdf.set_font("Arial", "B", 16)
        pdf.cell(200, 10, "MyHomeBro Contractor Agreement", ln=True, align="C")

        # ✅ Agreement Summary Section
        pdf.set_font("Arial", "", 12)
        pdf.ln(10)
        pdf.multi_cell(0, 8, f"Project Title: {agreement.project_name}")
        pdf.multi_cell(0, 8, f"Agreement ID: {agreement.project_uid}")
        pdf.multi_cell(0, 8, f"Homeowner: {agreement.homeowner.name if agreement.homeowner else 'Unknown'}")
        pdf.multi_cell(0, 8, f"Contractor: {agreement.contractor.name if agreement.contractor else 'Unknown'}")
        pdf.multi_cell(0, 8, f"Total Cost: ${agreement.total_price}")
        pdf.multi_cell(0, 8, f"Start Date: {agreement.start_date}")
        pdf.multi_cell(0, 8, f"End Date: {agreement.end_date}")
        pdf.multi_cell(0, 8, f"Total Duration: {agreement.total_duration_days} days")

        # ✅ Terms and Conditions Section
        pdf.ln(10)
        pdf.set_font("Arial", "B", 14)
        pdf.multi_cell(0, 8, "Terms and Conditions")
        pdf.set_font("Arial", "", 12)
        pdf.multi_cell(0, 8, agreement.terms)

        # ✅ Liability Waiver
        pdf.ln(10)
        pdf.set_font("Arial", "B", 14)
        pdf.multi_cell(0, 8, "Liability Waiver")
        pdf.set_font("Arial", "", 12)
        pdf.multi_cell(0, 8, agreement.liability_waiver)

        # ✅ Dispute Resolution
        pdf.ln(10)
        pdf.set_font("Arial", "B", 14)
        pdf.multi_cell(0, 8, "Dispute Resolution")
        pdf.set_font("Arial", "", 12)
        pdf.multi_cell(0, 8, agreement.dispute_resolution)

        # ✅ Signatures Section
        pdf.ln(15)
        pdf.set_font("Arial", "B", 14)
        pdf.cell(0, 8, "Signatures", ln=True)
        pdf.set_font("Arial", "", 12)
        
        if agreement.homeowner_signature:
            pdf.multi_cell(0, 8, f"Homeowner Signature: (Signed on {agreement.homeowner_signed_at})")
            insert_signature(pdf, agreement.homeowner_signature, x=10, y=pdf.get_y() + 5)
            pdf.ln(30)
        else:
            pdf.multi_cell(0, 8, "Homeowner Signature: Not Signed")

        if agreement.contractor_signature:
            pdf.multi_cell(0, 8, f"Contractor Signature: (Signed on {agreement.contractor_signed_at})")
            insert_signature(pdf, agreement.contractor_signature, x=10, y=pdf.get_y() + 5)
            pdf.ln(30)
        else:
            pdf.multi_cell(0, 8, "Contractor Signature: Not Signed")

        # ✅ Add Escrow Button (Hyperlink)
        pdf.ln(10)
        escrow_url = f"{settings.SITE_URL}/escrow/fund/{agreement.id}"
        pdf.set_text_color(0, 0, 255)
        pdf.set_font("Arial", "U", 12)
        pdf.cell(0, 10, "Fund Escrow Now", link=escrow_url, ln=True)

        # ✅ Save the PDF securely in media/agreements
        fs = FileSystemStorage(location=os.path.join(settings.MEDIA_ROOT, 'agreements'))
        filename = f"Agreement_{agreement.project_uid}.pdf"
        pdf_path = fs.path(filename)
        pdf.output(pdf_path)

        print(f"✅ PDF generated: {pdf_path}")
        return pdf_path

    except Agreement.DoesNotExist:
        print("❌ Agreement not found.")
        return None


def insert_signature(pdf, signature_base64, x, y):
    """
    Helper function to insert a digital signature (Base64) into the PDF.
    """
    try:
        # ✅ Decode the Base64 signature
        image_data = base64.b64decode(signature_base64)
        image = Image.open(BytesIO(image_data))
        temp_image_path = os.path.join(settings.MEDIA_ROOT, "temp_signature.png")
        image.save(temp_image_path)

        # ✅ Add the image to the PDF
        pdf.image(temp_image_path, x=x, y=y, w=60)  # Adjust width for proper sizing
        os.remove(temp_image_path)
    except Exception as e:
        print(f"❌ Error inserting signature: {e}")



