# backend/projects/signals_billing.py
from __future__ import annotations

import logging

from django.db.models.signals import post_save
from django.dispatch import receiver

from projects.models import Contractor
from projects.models_billing import ContractorBillingProfile

log = logging.getLogger(__name__)


@receiver(post_save, sender=Contractor)
def ensure_billing_profile(sender, instance: Contractor, created: bool, **kwargs):
    """
    Auto-create billing profile whenever a Contractor is created.
    Safe to run on every save (get_or_create).
    """
    try:
        ContractorBillingProfile.objects.get_or_create(contractor=instance)
    except Exception:
        log.exception("Failed creating ContractorBillingProfile for contractor_id=%s", getattr(instance, "id", None))
