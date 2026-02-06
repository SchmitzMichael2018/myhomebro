# projects/signals.py

import logging
from django.db import transaction
from django.db.models.signals import post_save, pre_save
from django.dispatch import receiver

from .models import Agreement, Invoice, Contractor
from .models_ai_entitlements import ContractorAIEntitlement
from .tasks import (
    task_send_invoice_notification,
    task_generate_full_agreement_pdf,
)

logger = logging.getLogger(__name__)

# --------------------------------------------------------------------
# Agreement pre-save: track escrow_funded transitions
# --------------------------------------------------------------------
@receiver(pre_save, sender=Agreement)
def agreement_pre_save(sender, instance, **kwargs):
    """
    Cache the previous escrow_funded value so we can detect
    a False → True transition on save.
    """
    if instance.pk:
        try:
            previous = sender.objects.get(pk=instance.pk)
            instance._previous_escrow_funded = previous.escrow_funded
        except sender.DoesNotExist:
            instance._previous_escrow_funded = False


# --------------------------------------------------------------------
# Agreement post-save: generate PDF on creation
# --------------------------------------------------------------------
@receiver(post_save, sender=Agreement)
def on_agreement_creation(sender, instance, created, **kwargs):
    """
    After a new Agreement is created, generate the agreement PDF.
    """
    if created:
        try:
            task_generate_full_agreement_pdf.delay(instance.id)
            logger.info(f"📄 PDF generation queued for Agreement {instance.id}.")
        except Exception as e:
            logger.error(
                f"❌ Failed to dispatch PDF task for Agreement {instance.id}: {e}"
            )


# --------------------------------------------------------------------
# Agreement post-save: escrow funded hook (NO INVOICE CREATION)
# --------------------------------------------------------------------
@receiver(post_save, sender=Agreement)
def on_agreement_escrow_funded(sender, instance: Agreement, created: bool, **kwargs):
    """
    When escrow is funded:
      ✔ Confirms funds are available
      ❌ Does NOT create invoices
      ❌ Does NOT mark milestones invoiced
    """
    was_previously_funded = getattr(instance, "_previous_escrow_funded", False)

    if not created and not was_previously_funded and instance.escrow_funded:
        logger.info(
            f"💰 Escrow funded for Agreement {instance.id}. "
            f"Milestones remain uninvoiced until completed."
        )


# --------------------------------------------------------------------
# Invoice post-save: send notification when invoice is created
# --------------------------------------------------------------------
@receiver(post_save, sender=Invoice)
def on_invoice_creation(sender, instance: Invoice, created: bool, **kwargs):
    """
    After a new Invoice is created, notify the homeowner.
    """
    if created:
        try:
            task_send_invoice_notification.delay(instance.id)
            logger.info(
                f"📨 Invoice notification queued for Invoice {instance.id}."
            )
        except Exception as e:
            logger.error(
                f"❌ Failed to dispatch invoice notification for "
                f"Invoice {instance.id}: {e}"
            )


# --------------------------------------------------------------------
# ✅ NEW: Contractor post-save → auto-create AI entitlement
# --------------------------------------------------------------------
@receiver(post_save, sender=Contractor)
def on_contractor_creation(sender, instance: Contractor, created: bool, **kwargs):
    """
    Automatically provision AI entitlements for every contractor.

    This ensures:
      - No manual admin work
      - Every contractor has a baseline AI plan
      - Admin UI is always populated
    """
    if not created:
        return

    try:
        ContractorAIEntitlement.objects.get_or_create(
            contractor=instance,
            defaults={
                "tier": ContractorAIEntitlement.TIER_FREE,
                "free_recommendations_remaining": 1,  # free trial
                "allow_ai_summaries": True,
                "allow_ai_recommendations": True,
            },
        )
        logger.info(
            f"🤖 AI entitlements auto-created for Contractor {instance.id}."
        )
    except Exception as e:
        logger.error(
            f"❌ Failed to auto-create AI entitlements for Contractor "
            f"{instance.id}: {e}"
        )
