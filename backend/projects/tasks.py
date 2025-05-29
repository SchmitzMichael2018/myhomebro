# projects/tasks.py
from celery import shared_task
import logging

logger = logging.getLogger(__name__)

@shared_task
def generate_agreement_pdf(agreement_id):
    from .models import Agreement
    from .utils import generate_agreement_pdf  # Your PDF generation function

    try:
        agreement = Agreement.objects.get(id=agreement_id)
        generate_agreement_pdf(agreement.id)
        logger.info(f"✅ PDF generated for Agreement {agreement_id}.")
    except Agreement.DoesNotExist:
        logger.error(f"❌ Agreement with ID {agreement_id} does not exist.")
    except Exception as e:
        logger.error(f"❌ Error generating PDF for Agreement {agreement_id}: {str(e)}")

@shared_task
def send_invoice_notification(invoice_id):
    from .models import Invoice
    from .utils import send_invoice_email  # Your email sending function

    try:
        invoice = Invoice.objects.get(id=invoice_id)
        send_invoice_email(invoice.id)
        logger.info(f"✅ Notification sent for Invoice {invoice_id}.")
    except Invoice.DoesNotExist:
        logger.error(f"❌ Invoice with ID {invoice_id} does not exist.")
    except Exception as e:
        logger.error(f"❌ Error sending invoice notification for Invoice {invoice_id}: {str(e)}")

