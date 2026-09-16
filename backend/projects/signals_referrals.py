import logging

from django.db import transaction
from django.db.models.signals import post_save
from django.dispatch import receiver

from projects.models import Contractor
from projects.services.referrals import participant_for_user, record_qualifying_receipt, reserve_founding_slot
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
