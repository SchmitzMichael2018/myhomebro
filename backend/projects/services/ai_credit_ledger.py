# backend/projects/services/ai_credit_ledger.py
# v2026-03-04 — Reserve → Consume → Void logic for "1 credit = 1 agreement"

from __future__ import annotations

from datetime import timedelta
from typing import Tuple, Optional

from django.db import transaction
from django.utils import timezone

from projects.models import Agreement, Contractor
from projects.models_ai_usage import (
    AIAgreementUsage,
    AIAgreementFeature,
    AIAgreementUsageState,
)


VOID_LIMIT_DAYS = 30
VOID_LIMIT_COUNT = 3  # per contractor per rolling window


def _now():
    return timezone.now()


def remaining_agreement_credits(contractor: Contractor) -> int:
    total = int(getattr(contractor, "ai_free_agreements_total", 0) or 0)
    used = int(getattr(contractor, "ai_free_agreements_used", 0) or 0)
    return max(0, total - used)


def credits_payload(contractor: Contractor) -> dict:
    total = int(getattr(contractor, "ai_free_agreements_total", 0) or 0)
    used = int(getattr(contractor, "ai_free_agreements_used", 0) or 0)
    remaining = max(0, total - used)
    return {
        "ai_credits": {
            "free_total": total,
            "free_used": used,
            "free_remaining": remaining,
            "enabled": remaining > 0,
        },
        "remaining_credits": remaining,
    }


def _usage_qs(contractor_id: int, agreement_id: int):
    return AIAgreementUsage.objects.filter(
        contractor_id=contractor_id,
        agreement_id=int(agreement_id),
        feature_key=AIAgreementFeature.AGREEMENT_BUNDLE,
    )


def agreement_has_bundle_access(contractor_id: int, agreement_id: int) -> bool:
    return _usage_qs(contractor_id, agreement_id).exclude(state=AIAgreementUsageState.VOIDED).exists()


def reserve_bundle_once(
    *,
    contractor: Contractor,
    agreement: Agreement,
) -> Tuple[bool, Optional[str], Optional[str]]:
    """
    Reserve 1 credit for an agreement if not already reserved/consumed.

    Returns: (reserved_now, error_code, error_detail)

    - If already reserved/consumed: (False, None, None)
    - If voided previously: can re-reserve (charges again)
    - If no credits: error
    """
    if agreement.contractor_id and agreement.contractor_id != contractor.id:
        return False, "FORBIDDEN", "Not your agreement."

    with transaction.atomic():
        contractor_locked = Contractor.objects.select_for_update().get(pk=contractor.pk)

        usage = _usage_qs(contractor_locked.id, agreement.id).select_for_update().first()

        # Already reserved/consumed → no new charge
        if usage and usage.state in (AIAgreementUsageState.RESERVED, AIAgreementUsageState.CONSUMED):
            return False, None, None

        # Need available credits to reserve
        if remaining_agreement_credits(contractor_locked) <= 0:
            return False, "AI_CREDITS_EXHAUSTED", "No Agreement AI credits remaining."

        # Charge now (reserve)
        used = int(contractor_locked.ai_free_agreements_used or 0)
        contractor_locked.ai_free_agreements_used = used + 1
        contractor_locked.save(update_fields=["ai_free_agreements_used"])

        now = _now()

        if usage and usage.state == AIAgreementUsageState.VOIDED:
            usage.state = AIAgreementUsageState.RESERVED
            usage.reserved_at = now
            usage.voided_at = None
            usage.voided_by_user_id = None
            usage.void_reason = ""
            usage.save(
                update_fields=[
                    "state",
                    "reserved_at",
                    "voided_at",
                    "voided_by_user_id",
                    "void_reason",
                ]
            )
            return True, None, None

        # Create new usage row
        AIAgreementUsage.objects.create(
            contractor=contractor_locked,
            agreement_id=int(agreement.id),
            feature_key=AIAgreementFeature.AGREEMENT_BUNDLE,
            state=AIAgreementUsageState.RESERVED,
            reserved_at=now,
        )
        return True, None, None


def consume_bundle_if_reserved(*, agreement: Agreement) -> bool:
    """
    When agreement becomes executed (signature_is_satisfied=True),
    convert reserved → consumed. No additional credit change here.
    Returns True if updated.
    """
    if not agreement or not agreement.id or not agreement.contractor_id:
        return False

    contractor_id = int(agreement.contractor_id)
    agreement_id = int(agreement.id)

    with transaction.atomic():
        usage = _usage_qs(contractor_id, agreement_id).select_for_update().first()
        if not usage:
            return False
        if usage.state != AIAgreementUsageState.RESERVED:
            return False

        usage.state = AIAgreementUsageState.CONSUMED
        usage.consumed_at = _now()
        usage.save(update_fields=["state", "consumed_at"])
        return True


def _voids_in_window(contractor_id: int) -> int:
    since = _now() - timedelta(days=VOID_LIMIT_DAYS)
    return AIAgreementUsage.objects.filter(
        contractor_id=contractor_id,
        feature_key=AIAgreementFeature.AGREEMENT_BUNDLE,
        state=AIAgreementUsageState.VOIDED,
        voided_at__gte=since,
    ).count()


def void_reserved_bundle(
    *,
    contractor: Contractor,
    agreement: Agreement,
    user_id: Optional[int] = None,
    reason: str = "",
) -> Tuple[bool, Optional[str], Optional[str]]:
    """
    Void (refund) a RESERVED bundle, only if agreement is still draft-ish.

    Returns: (voided_now, error_code, error_detail)
    """
    if agreement.contractor_id and agreement.contractor_id != contractor.id:
        return False, "FORBIDDEN", "Not your agreement."

    # Must be draft and not executed/funded
    status = (agreement.status or "").strip().lower()
    if status != "draft":
        return False, "NOT_ALLOWED", "Can only void credits for draft agreements."

    if bool(getattr(agreement, "escrow_funded", False)):
        return False, "NOT_ALLOWED", "Cannot void credit after escrow is funded."

    if bool(getattr(agreement, "signature_is_satisfied", False)):
        return False, "NOT_ALLOWED", "Cannot void credit after agreement is executed."

    with transaction.atomic():
        contractor_locked = Contractor.objects.select_for_update().get(pk=contractor.pk)

        usage = _usage_qs(contractor_locked.id, agreement.id).select_for_update().first()
        if not usage:
            return False, "NOT_FOUND", "No AI credit reservation found for this agreement."

        if usage.state == AIAgreementUsageState.CONSUMED:
            return False, "NOT_ALLOWED", "Credit already consumed (agreement executed)."

        if usage.state == AIAgreementUsageState.VOIDED:
            return False, "NOT_ALLOWED", "Credit already voided."

        # Enforce monthly cap
        if _voids_in_window(contractor_locked.id) >= VOID_LIMIT_COUNT:
            return False, "VOID_LIMIT_REACHED", f"Void limit reached ({VOID_LIMIT_COUNT} per {VOID_LIMIT_DAYS} days)."

        # Mark voided
        usage.state = AIAgreementUsageState.VOIDED
        usage.voided_at = _now()
        usage.voided_by_user_id = int(user_id) if user_id else None
        usage.void_reason = (reason or "").strip()[:255]
        usage.save(update_fields=["state", "voided_at", "voided_by_user_id", "void_reason"])

        # Refund credit: decrement used (floor at 0)
        used = int(contractor_locked.ai_free_agreements_used or 0)
        contractor_locked.ai_free_agreements_used = max(0, used - 1)
        contractor_locked.save(update_fields=["ai_free_agreements_used"])

        return True, None, None