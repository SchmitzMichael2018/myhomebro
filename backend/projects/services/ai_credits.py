# backend/projects/services/ai_credits.py
# v2026-03-04 — Agreement-level credit consumption (1 credit = 1 agreement)
#
# IMPORTANT:
# - Avoid importing projects.models.Contractor at import-time (prevents circular import)
# - Use apps.get_model("projects", "Contractor") under the hood

from __future__ import annotations

from django.apps import apps
from django.db import transaction

from projects.models_ai_usage import AIAgreementUsage, AIAgreementFeature


def _get_contractor_model():
    return apps.get_model("projects", "Contractor")


def _credits_snapshot(contractor) -> dict:
    total = getattr(contractor, "ai_free_agreements_total", None)
    used = getattr(contractor, "ai_free_agreements_used", None)

    if total is None or used is None:
        return {"configured": False, "total": 0, "used": 0, "remaining": 0}

    total_n = int(total or 0)
    used_n = int(used or 0)
    return {
        "configured": True,
        "total": total_n,
        "used": used_n,
        "remaining": max(0, total_n - used_n),
    }


@transaction.atomic
def consume_agreement_bundle_credit_if_needed(*, contractor, agreement_id: int) -> dict:
    """
    Option A logic (no-charge regenerate):

    - If an AGREEMENT_BUNDLE usage record already exists for this agreement:
        charged = False, and credits are unchanged.
    - Else:
        if remaining <= 0: raise ValueError
        create usage record + increment ai_free_agreements_used by 1
        charged = True

    Returns:
      {
        "charged": bool,
        "ai_credits": {"free_total": int, "free_used": int, "free_remaining": int}
      }
    """
    if not agreement_id or int(agreement_id) <= 0:
        raise ValueError("agreement_id is required.")

    Contractor = _get_contractor_model()

    # Lock contractor row to prevent race conditions on credits
    c = Contractor.objects.select_for_update().get(pk=contractor.pk)

    snap = _credits_snapshot(c)
    if not snap["configured"]:
        raise ValueError("AI credits not configured for this contractor.")

    # If already used for this agreement, regenerate is free
    exists = AIAgreementUsage.objects.filter(
        contractor=c,
        agreement_id=int(agreement_id),
        feature_key=AIAgreementFeature.AGREEMENT_BUNDLE,
    ).exists()

    if exists:
        snap2 = _credits_snapshot(c)
        return {
            "charged": False,
            "ai_credits": {
                "free_total": snap2["total"],
                "free_used": snap2["used"],
                "free_remaining": snap2["remaining"],
            },
        }

    if snap["remaining"] <= 0:
        raise ValueError("No AI credits remaining.")

    # Create ledger row (unique constraint protects against duplicates)
    AIAgreementUsage.objects.create(
        contractor=c,
        agreement_id=int(agreement_id),
        feature_key=AIAgreementFeature.AGREEMENT_BUNDLE,
    )

    # Increment usage
    c.ai_free_agreements_used = int(c.ai_free_agreements_used or 0) + 1
    c.save(update_fields=["ai_free_agreements_used"])

    snap3 = _credits_snapshot(c)
    return {
        "charged": True,
        "ai_credits": {
            "free_total": snap3["total"],
            "free_used": snap3["used"],
            "free_remaining": snap3["remaining"],
        },
    }