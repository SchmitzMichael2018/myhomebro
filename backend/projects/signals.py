import logging

from django.db.models.signals import post_save, pre_save
from django.dispatch import receiver

from .models import Agreement, Invoice
from .tasks import send_invoice_notification, generate_full_agreement_pdf

logger = logging.getLogger(__name__)


@receiver(pre_save, sender=Agreement)
def agreement_pre_save(sender, instance, **kwargs):
    """
    Cache the old escrow_funded state so we can detect when it changes.
    """
    if instance.pk:
        try:
            previous = sender.objects.get(pk=instance.pk)
            instance._previous_escrow_funded = previous.escrow_funded
        except sender.DoesNotExist:
            instance._previous_escrow_funded = False


@receiver(post_save, sender=Agreement)
def generate_full_agreement_pdf_async(sender, instance, created, **kwargs):
    """
    Fire off a Celery task to generate the PDF the moment an Agreement is created.
    """
    if created:
        try:
            generate_full_agreement_pdf.delay(instance.id)
            logger.info(f"✅ PDF generation task dispatched for Agreement {instance.id}.")
        except Exception as e:
            logger.error(f"❌ Error dispatching PDF generation task for Agreement {instance.id}: {e}")


@receiver(post_save, sender=Agreement)
def create_invoices_when_escrow_funded(sender, instance, created, **kwargs):
    """
    When escrow_funded flips from False → True on an existing Agreement,
    create one Invoice per Milestone.
    """
    previous = getattr(instance, "_previous_escrow_funded", False)
    # only on updates, only when escrow_funded just turned True
    if not created and not previous and instance.escrow_funded:
        for milestone in instance.milestones.all():
            invoice, inv_created = Invoice.objects.get_or_create(
                agreement=instance,
                amount=milestone.amount,
                due_date=milestone.completion_date,  # <-- Use completion_date as due_date!
                defaults={"status": "pending"},
            )
            if inv_created:
                logger.info(
                    f"✅ Created Invoice {invoice.id} for milestone {milestone.id}."
                )
            else:
                logger.info(
                    f"ℹ️ Invoice {invoice.id} already exists for milestone {milestone.id}."
                )


@receiver(post_save, sender=Invoice)
def send_invoice_notification_async(sender, instance, created, **kwargs):
    """
    Fire off a Celery task to email the contractor when an Invoice is created.
    """
    if created:
        try:
            send_invoice_notification.delay(instance.id)
            logger.info(f"✅ Invoice notification task dispatched for Invoice {instance.id}.")
        except Exception as e:
            logger.error(f"❌ Error dispatching notification task for Invoice {instance.id}: {e}")





