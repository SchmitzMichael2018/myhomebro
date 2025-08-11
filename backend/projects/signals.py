# projects/signals.py

import logging
from django.db import transaction
from django.db.models.signals import post_save, pre_save
from django.dispatch import receiver

# Import the TextChoices enum for status
from .models import Agreement, Invoice, InvoiceStatus
from .tasks import task_send_invoice_notification, task_generate_full_agreement_pdf

logger = logging.getLogger(__name__)


@receiver(pre_save, sender=Agreement)
def agreement_pre_save(sender, instance, **kwargs):
    """
    On an existing Agreement instance, cache the old value of `escrow_funded`
    so we can detect in a post_save signal if it has changed from False to True.
    """
    if instance.pk:
        try:
            previous_instance = sender.objects.get(pk=instance.pk)
            instance._previous_escrow_funded = previous_instance.escrow_funded
        except sender.DoesNotExist:
            instance._previous_escrow_funded = False


@receiver(post_save, sender=Agreement)
def on_agreement_creation(sender, instance, created, **kwargs):
    """
    After a new Agreement is created, dispatch a Celery task to generate the PDF.
    """
    if created:
        try:
            task_generate_full_agreement_pdf.delay(instance.id)
            logger.info(f"PDF generation task dispatched for Agreement {instance.id}.")
        except Exception as e:
            logger.error(f"Error dispatching PDF task for Agreement {instance.id}: {e}")


@receiver(post_save, sender=Agreement)
def create_invoices_when_escrow_funded(sender, instance: Agreement, created: bool, **kwargs):
    """
    When an existing Agreement's `escrow_funded` field flips from False to True,
    this signal automatically creates one 'pending' Invoice for each of its milestones.
    """
    was_previously_funded = getattr(instance, "_previous_escrow_funded", False)
    
    # Ensure this runs only on an UPDATE when the flag changes from False to True.
    if not created and not was_previously_funded and instance.escrow_funded:
        logger.info(f"Escrow funded for Agreement {instance.id}. Creating invoices for milestones.")
        try:
            # Use a transaction to ensure all invoices are created or none are.
            with transaction.atomic():
                for milestone in instance.milestones.all():
                    # Use get_or_create to prevent creating duplicate invoices
                    # if the signal were to ever fire more than once.
                    invoice, inv_created = Invoice.objects.get_or_create(
                        agreement=instance,
                        amount=milestone.amount,
                        # A simple way to link an invoice to a milestone conceptually
                        # is by using its title in the invoice description.
                        defaults={
                            "status": InvoiceStatus.PENDING,
                        }
                    )
                    if inv_created:
                        # Mark the milestone as invoiced
                        milestone.is_invoiced = True
                        milestone.save(update_fields=['is_invoiced'])
                        logger.info(f"✅ Created Invoice {invoice.id} for Milestone {milestone.id}.")
                    else:
                        logger.info(f"ℹ️ Invoice {invoice.id} already exists for Milestone {milestone.id}.")
        except Exception as e:
             logger.error(f"❌ Failed to create invoices for Agreement {instance.id} after funding: {e}")


@receiver(post_save, sender=Invoice)
def on_invoice_creation(sender, instance: Invoice, created: bool, **kwargs):
    """
    After a new Invoice is created, fire off a Celery task to send a notification.
    """
    if created:
        try:
            task_send_invoice_notification.delay(instance.id)
            logger.info(f"✅ Invoice notification task dispatched for Invoice {instance.id}.")
        except Exception as e:
            logger.error(f"❌ Error dispatching notification task for Invoice {instance.id}: {e}")