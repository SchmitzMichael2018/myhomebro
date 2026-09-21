import logging

from django.db import transaction
from django.db.models.signals import post_save
from django.dispatch import receiver

from payments.models import Refund
from projects.models import Contractor, Invoice
from projects.services.referrals import (
    participant_for_user,
    record_qualifying_receipt,
    reserve_founding_slot,
    reverse_receipt_earnings,
)
from receipts.models import Receipt


log = logging.getLogger(__name__)


def _record_receipt_safely(receipt_id):
    try:
        receipt = Receipt.objects.select_related("agreement", "invoice__agreement").get(pk=receipt_id)
        record_qualifying_receipt(receipt)
    except Exception:
        log.exception("Referral reward processing failed for receipt_id=%s", receipt_id)


def _initialize_contractor_safely(contractor_id):
    try:
        contractor = Contractor.objects.select_related("user").get(pk=contractor_id)
        participant_for_user(contractor.user)
        reserve_founding_slot(contractor)
    except Exception:
        log.exception("Referral initialization failed for contractor_id=%s", contractor_id)


@receiver(post_save, sender=Contractor)
def initialize_contractor_referrals(sender, instance, created, **kwargs):
    if created:
        transaction.on_commit(lambda contractor_id=instance.pk: _initialize_contractor_safely(contractor_id))


@receiver(post_save, sender=Receipt)
def record_receipt_referral_reward(sender, instance, created, **kwargs):
    if created:
        transaction.on_commit(lambda receipt_id=instance.pk: _record_receipt_safely(receipt_id))


def _reverse_invoice_receipt_safely(invoice_id, reason):
    try:
        invoice = Invoice.objects.select_related("receipt").get(pk=invoice_id)
        receipt = getattr(invoice, "receipt", None)
        if receipt:
            reverse_receipt_earnings(receipt, reason=reason)
    except Exception:
        log.exception("Referral reward reversal failed for invoice_id=%s", invoice_id)


@receiver(post_save, sender=Invoice)
def reverse_referral_reward_for_invoice_state(sender, instance, **kwargs):
    if instance.disputed or instance.status == "refunded":
        reason = "Invoice disputed." if instance.disputed else "Invoice refunded."
        transaction.on_commit(lambda invoice_id=instance.pk, why=reason: _reverse_invoice_receipt_safely(invoice_id, why))


@receiver(post_save, sender=Refund)
def reverse_referral_reward_for_refund(sender, instance, **kwargs):
    if instance.status != "succeeded":
        return
    agreement_id = getattr(instance.payment, "agreement_id", None)
    if not agreement_id:
        return
    invoice_ids = list(Invoice.objects.filter(agreement_id=agreement_id).values_list("id", flat=True))
    for invoice_id in invoice_ids:
        transaction.on_commit(
            lambda target_id=invoice_id: _reverse_invoice_receipt_safely(target_id, "Underlying payment refunded.")
        )
