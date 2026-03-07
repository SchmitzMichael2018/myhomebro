# backend/projects/api/ai_void_credit_views.py
# v2026-03-04 — Void Agreement AI credit (draft-only refund) — Option A compatible
#
# Works with:
# - Contractor credit counters: ai_free_agreements_total / ai_free_agreements_used
# - Ledger: AIAgreementUsage (exists => credit was counted for this agreement)
#
# Behavior:
# - Only allowed if agreement is still draft AND not funded AND not executed
# - Deletes the ledger row and decrements ai_free_agreements_used by 1 (floor at 0)

from __future__ import annotations

from django.db import transaction
from django.http import JsonResponse
from rest_framework.decorators import api_view, permission_classes
from rest_framework.permissions import IsAuthenticated
from rest_framework.status import HTTP_200_OK, HTTP_403_FORBIDDEN, HTTP_404_NOT_FOUND

from projects.models import Agreement, Contractor
from projects.models_ai_usage import AIAgreementUsage, AIAgreementFeature


def _get_contractor_for_user(user):
    return getattr(user, "contractor_profile", None)


def _credits_payload(contractor: Contractor) -> dict:
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


@api_view(["POST"])
@permission_classes([IsAuthenticated])
def void_agreement_ai_credit(request, agreement_id: int):
    contractor = _get_contractor_for_user(request.user)
    if not contractor:
        return JsonResponse(
            {"detail": "Contractor only.", "code": "CONTRACTOR_ONLY"},
            status=HTTP_403_FORBIDDEN,
        )

    try:
        agreement = Agreement.objects.get(id=int(agreement_id))
    except Agreement.DoesNotExist:
        return JsonResponse(
            {"detail": "Agreement not found.", "code": "AGREEMENT_NOT_FOUND"},
            status=HTTP_404_NOT_FOUND,
        )

    # Must be your agreement
    if agreement.contractor_id and agreement.contractor_id != contractor.id:
        return JsonResponse(
            {"detail": "Not your agreement.", "code": "FORBIDDEN"},
            status=HTTP_403_FORBIDDEN,
        )

    # Only allow void while still draft + not funded + not executed
    status = (agreement.status or "").strip().lower()
    if status != "draft":
        return JsonResponse(
            {"detail": "Can only void AI credit for draft agreements.", "code": "NOT_ALLOWED"},
            status=HTTP_403_FORBIDDEN,
        )

    if bool(getattr(agreement, "escrow_funded", False)):
        return JsonResponse(
            {"detail": "Cannot void AI credit after escrow is funded.", "code": "NOT_ALLOWED"},
            status=HTTP_403_FORBIDDEN,
        )

    # signature_is_satisfied is a @property on Agreement in your models.py
    if bool(getattr(agreement, "signature_is_satisfied", False)):
        return JsonResponse(
            {"detail": "Cannot void AI credit after agreement is executed.", "code": "NOT_ALLOWED"},
            status=HTTP_403_FORBIDDEN,
        )

    with transaction.atomic():
        # Lock contractor row so decrement is race-safe
        c = Contractor.objects.select_for_update().get(pk=contractor.pk)

        usage = AIAgreementUsage.objects.select_for_update().filter(
            contractor=c,
            agreement_id=int(agreement_id),
            feature_key=AIAgreementFeature.AGREEMENT_BUNDLE,
        ).first()

        if not usage:
            return JsonResponse(
                {
                    "detail": "No AI credit found for this agreement.",
                    "code": "NOT_FOUND",
                    **_credits_payload(c),
                },
                status=HTTP_403_FORBIDDEN,
            )

        # Delete ledger row = refund for this agreement
        usage.delete()

        # Refund credit by decrementing used (floor at 0)
        c.ai_free_agreements_used = max(0, int(c.ai_free_agreements_used or 0) - 1)
        c.save(update_fields=["ai_free_agreements_used"])

        return JsonResponse(
            {
                "detail": "OK",
                "voided": True,
                **_credits_payload(c),
            },
            status=HTTP_200_OK,
        )