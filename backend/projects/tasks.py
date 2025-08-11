# projects/tasks.py

import logging
from datetime import timedelta

from celery import shared_task # type: ignore
from django.conf import settings
from django.utils import timezone
from django.apps import apps # This import was missing and is required for lazy model loading

# Import the notification functions we will use
from chat.notifications import notify_new_message
from projects.notifications import notify_invoice_created, notify_escrow_auto_released  # Assuming these are in projects/notifications.py
from .models import Agreement, Invoice, InvoiceStatus
from .utils import generate_full_agreement_pdf as _generate_pdf

logger = logging.getLogger(__name__)

# --- NOTIFICATION TASKS ---

@shared_task(name="notify_recipient_new_message")
def task_notify_recipient_new_message(message_id: int):
    """
    Celery task to send a notification for a new chat message.
    This task calls the centralized notification logic in the chat app.
    """
    # Use apps.get_model for lazy loading to prevent circular imports
    Message = apps.get_model('chat', 'Message')
    try:
        # Optimized query to get all necessary related objects
        message = Message.objects.select_related('conversation', 'sender').get(pk=message_id)
        # Call the single, correct notification function from the chat app
        notify_new_message(message)
        logger.info(f"Successfully processed new message notification for message ID: {message_id}")
    except Message.DoesNotExist:
        logger.warning(f"Message with ID {message_id} not found for notification task.")
    except Exception as e:
        logger.error(f"Error in task_notify_recipient_new_message for message ID {message_id}: {e}")


@shared_task(name="send_invoice_notification")
def task_send_invoice_notification(invoice_id: int):
    """
    Celery task to send a notification when a new invoice is created.
    """
    try:
        invoice = Invoice.objects.select_related('agreement__project__homeowner').get(id=invoice_id)
        # It's better to have a dedicated notification function for this
        # This function would live in a new `projects/notifications.py` file
        notify_invoice_created(invoice)
        logger.info(f"Successfully processed invoice notification for Invoice ID: {invoice_id}")
    except Invoice.DoesNotExist:
        logger.error(f"Invoice with ID {invoice_id} does not exist for notification task.")
    except Exception as e:
        logger.error(f"Error in task_send_invoice_notification for Invoice ID {invoice_id}: {e}")


# --- PDF & BACKGROUND PROCESSING TASKS ---

@shared_task(name="generate_full_agreement_pdf")
def task_generate_full_agreement_pdf(agreement_id: int):
    """
    Celery task to generate the full agreement PDF in the background and save it
    to the model's `pdf_file` field.
    """
    try:
        agreement = Agreement.objects.get(id=agreement_id)
        # This util function was updated to save the file directly to the model
        _generate_pdf(agreement)
        logger.info(f"Successfully generated PDF for Agreement ID: {agreement_id}.")
    except Agreement.DoesNotExist:
        logger.error(f"Agreement with ID {agreement_id} does not exist for PDF generation.")
    except Exception as e:
        logger.error(f"Error in task_generate_full_agreement_pdf for Agreement ID {agreement_id}: {e}")


@shared_task(name="auto_release_undisputed_invoices")
def task_auto_release_undisputed_invoices():
    """
    A daily scheduled task (via CELERY_BEAT_SCHEDULE) to auto-release escrow
    for invoices that have been pending for more than 5 days without dispute.
    """
    now = timezone.now()
    cutoff_date = now - timedelta(days=5)

    # Use the InvoiceStatus enum for safety and clarity
    invoices_to_release = Invoice.objects.filter(
        status=InvoiceStatus.PENDING,
        disputed=False,
        escrow_released=False,
        marked_complete_at__lte=cutoff_date,
    ).select_related('agreement__project__contractor__user')

    if not invoices_to_release.exists():
        logger.info("No invoices eligible for auto-release at this time.")
        return

    for invoice in invoices_to_release:
        try:
            # The logic to release payment and notify should be atomic
            # and ideally refactored into a service function for reusability.
            invoice.status = InvoiceStatus.PAID
            invoice.escrow_released = True
            invoice.escrow_released_at = now
            invoice.save(update_fields=["status", "escrow_released", "escrow_released_at"])

            # Call a dedicated notification function
            notify_escrow_auto_released(invoice)
            
            logger.info(f"Auto-released escrow for Invoice #{invoice.id} and sent notification.")

        except Exception as e:
            logger.error(f"Failed to auto-release Invoice #{invoice.id}: {e}")

@shared_task
def process_agreement_signing(agreement_id: int) -> str:
    """
    Called after a homeowner or contractor signs an Agreement:
    - regenerate the PDF,
    - send notification emails,
    - etc.
    """
    try:
        agreement = Agreement.objects.get(pk=agreement_id)
        # e.g. agreement.generate_pdf() or your own logic here
        agreement.generate_full_agreement_pdf()
        # notify…
        return f"Agreement {agreement_id} processed"
    except Agreement.DoesNotExist:
        return f"Agreement {agreement_id} not found"