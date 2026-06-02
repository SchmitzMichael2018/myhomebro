# projects/signals.py

import logging
from django.db import transaction
from django.db.models import Avg, Count
from django.db.models.signals import post_save, pre_save, post_delete
from django.dispatch import receiver
from django.utils import timezone

from .models import Agreement, Contractor, ContractorReview, Invoice, Milestone
from .models_dispute import Dispute
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
    _capture_milestone_performance_from_invoice(instance, "invoice_created" if created else "invoice_saved")
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
# ✅ Milestone save/delete → touch Agreement.updated_at
# --------------------------------------------------------------------
def _touch_agreement_updated_at(agreement: Agreement | None):
    """
    Preview cache invalidation relies on Agreement.updated_at.
    Milestone changes must bump Agreement.updated_at so cached previews regenerate.
    """
    if not agreement or not getattr(agreement, "id", None):
        return
    try:
        Agreement.objects.filter(pk=agreement.pk).update(updated_at=timezone.now())
    except Exception as e:
        logger.warning(
            f"⚠️ Could not touch Agreement.updated_at for {getattr(agreement, 'pk', None)}: {e}"
        )


@receiver(post_save, sender=Milestone)
def on_milestone_saved_touch_agreement(sender, instance: Milestone, created: bool, **kwargs):
    _touch_agreement_updated_at(getattr(instance, "agreement", None))
    _capture_milestone_performance(instance, "milestone_created" if created else "milestone_saved")


@receiver(post_delete, sender=Milestone)
def on_milestone_deleted_touch_agreement(sender, instance: Milestone, **kwargs):
    _touch_agreement_updated_at(getattr(instance, "agreement", None))


def _capture_milestone_performance(milestone: Milestone | None, source_event: str):
    if milestone is None or not getattr(milestone, "id", None):
        return
    try:
        from projects.services.milestone_performance import capture_milestone_performance_snapshot

        capture_milestone_performance_snapshot(
            milestone.id,
            source_event=source_event,
        )
    except Exception as exc:
        logger.warning(
            "Milestone performance capture skipped for milestone %s: %s",
            getattr(milestone, "id", None),
            exc,
        )


def _capture_milestone_performance_from_invoice(invoice: Invoice | None, source_event: str):
    if invoice is None:
        return
    milestone = getattr(invoice, "source_milestone", None)
    milestone_id = getattr(milestone, "id", None) or getattr(invoice, "milestone_id_snapshot", None)
    if not milestone_id:
        return
    try:
        from projects.services.milestone_performance import capture_milestone_performance_snapshot

        capture_milestone_performance_snapshot(
            int(milestone_id),
            source_event=source_event,
        )
    except Exception as exc:
        logger.warning(
            "Milestone performance capture skipped for invoice %s: %s",
            getattr(invoice, "id", None),
            exc,
        )


@receiver(post_save, sender=Dispute)
def on_dispute_saved_capture_milestone_performance(sender, instance: Dispute, created: bool, **kwargs):
    _capture_milestone_performance(
        getattr(instance, "milestone", None),
        "dispute_opened" if created else "dispute_saved",
    )


def _refresh_contractor_review_stats(contractor_id: int | None):
    if not contractor_id:
        return
    stats = ContractorReview.objects.filter(
        contractor_id=contractor_id,
        is_verified=True,
        is_public=True,
    ).aggregate(
        review_count=Count("id"),
        average_rating=Avg("rating"),
    )
    Contractor.objects.filter(pk=contractor_id).update(
        review_count=int(stats.get("review_count") or 0),
        average_rating=round(float(stats.get("average_rating") or 0), 2),
        updated_at=timezone.now(),
    )


@receiver(post_save, sender=ContractorReview)
def on_contractor_review_saved(sender, instance: ContractorReview, **kwargs):
    _refresh_contractor_review_stats(getattr(instance, "contractor_id", None))


@receiver(post_delete, sender=ContractorReview)
def on_contractor_review_deleted(sender, instance: ContractorReview, **kwargs):
    _refresh_contractor_review_stats(getattr(instance, "contractor_id", None))
