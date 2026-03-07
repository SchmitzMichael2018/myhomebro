# backend/projects/signals_ai_usage.py
# v2026-03-04 — consume reserved AI bundle when agreement becomes executed

from __future__ import annotations

from django.db.models.signals import post_save
from django.dispatch import receiver

from projects.models import Agreement
from projects.services.ai_credit_ledger import consume_bundle_if_reserved


@receiver(post_save, sender=Agreement)
def on_agreement_saved_consume_ai_bundle(sender, instance: Agreement, created: bool, **kwargs):
    """
    When agreement becomes executed (signature_is_satisfied=True),
    mark reserved bundle as consumed.

    NOTE: signature_is_satisfied is a @property; we only run consume when it's True.
    The consume function is idempotent and will only transition reserved → consumed.
    """
    try:
        if instance and instance.id and instance.signature_is_satisfied:
            consume_bundle_if_reserved(agreement=instance)
    except Exception:
        # Never break agreement save due to AI bookkeeping
        pass