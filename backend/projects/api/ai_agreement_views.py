# backend/projects/api/ai_agreement_views.py
# v2026-03-04 — Agreement AI endpoints (1 credit = 1 agreement)
#
# RULE:
# - First AI use on a given agreement consumes 1 Agreement credit.
# - Re-run AI unlimited times for that same agreement (no additional charge).
#
# Charging is enforced by:
# - AIAgreementUsage uniqueness (contractor, agreement_id, feature_key)
# - Contractor counters: ai_free_agreements_total / ai_free_agreements_used
#
# IMPORTANT:
# - Uses consume_agreement_bundle_credit_if_needed() as single source of truth.

from __future__ import annotations

from django.conf import settings
from django.http import JsonResponse
from rest_framework.decorators import api_view, permission_classes
from rest_framework.permissions import IsAuthenticated
from rest_framework.status import HTTP_200_OK, HTTP_400_BAD_REQUEST, HTTP_403_FORBIDDEN, HTTP_404_NOT_FOUND

from projects.ai.agreement_description_writer import generate_or_improve_description
from projects.ai.agreement_milestone_writer import suggest_scope_and_milestones
from projects.models import Agreement
from projects.services.ai_credits import consume_agreement_bundle_credit_if_needed


def _ai_enabled() -> bool:
    return bool(getattr(settings, "AI_ENABLED", False))


def _get_contractor_for_user(user):
    return getattr(user, "contractor_profile", None)


def _deny(detail: str, code: str, status=HTTP_403_FORBIDDEN, extra: dict | None = None):
    payload = {"detail": detail, "code": code}
    if extra:
        payload.update(extra)
    return JsonResponse(payload, status=status)


def _get_agreement_or_404(agreement_id: int):
    try:
        return Agreement.objects.get(id=int(agreement_id))
    except Agreement.DoesNotExist:
        return None


def _charge_once(contractor, agreement: Agreement):
    """
    Calls the canonical credit service.
    Returns: (charged_now: bool, ai_credits: dict)
    """
    result = consume_agreement_bundle_credit_if_needed(
        contractor=contractor,
        agreement_id=int(agreement.id),
    )
    charged_now = bool(result.get("charged", False))
    ai_credits = (result.get("ai_credits", {}) or {})
    return charged_now, ai_credits


def _ai_credits_payload(ai_credits: dict) -> dict:
    free_total = int(ai_credits.get("free_total", 0) or 0)
    free_used = int(ai_credits.get("free_used", 0) or 0)
    free_remaining = int(ai_credits.get("free_remaining", 0) or 0)
    return {
        "ai_credits": {
            "free_total": free_total,
            "free_used": free_used,
            "free_remaining": free_remaining,
            "enabled": free_remaining > 0,
        },
        "remaining_credits": free_remaining,
    }


@api_view(["POST"])
@permission_classes([IsAuthenticated])
def ai_agreement_description(request):
    if not _ai_enabled():
        return _deny("AI is disabled.", "AI_DISABLED")

    contractor = _get_contractor_for_user(request.user)
    if not contractor:
        return _deny("Contractor only.", "CONTRACTOR_ONLY")

    agreement_id = request.data.get("agreement_id") or request.data.get("agreement") or None
    try:
        agreement_id = int(agreement_id) if agreement_id is not None else 0
    except Exception:
        agreement_id = 0

    if not agreement_id:
        return _deny("Save draft first to use AI.", "AGREEMENT_REQUIRED")

    agreement = _get_agreement_or_404(agreement_id)
    if not agreement:
        return _deny("Agreement not found.", "AGREEMENT_NOT_FOUND", status=HTTP_404_NOT_FOUND)

    # Optional safety: only allow AI on own agreement
    if agreement.contractor_id and agreement.contractor_id != contractor.id:
        return _deny("Not your agreement.", "FORBIDDEN")

    # Charge once per agreement (or free regenerate)
    try:
        charged_now, ai_credits = _charge_once(contractor, agreement)
    except ValueError as e:
        msg = str(e) or "AI not available."
        if "agreement_id is required" in msg:
            return _deny("Save draft first to use AI.", "AGREEMENT_REQUIRED")
        if "No AI credits remaining" in msg:
            return _deny("No Agreement AI credits remaining.", "AI_CREDITS_EXHAUSTED")
        return _deny(msg, "AI_ERROR")

    try:
        out = generate_or_improve_description(
            mode=(request.data.get("mode") or "").strip(),
            project_title=request.data.get("project_title") or "",
            project_type=request.data.get("project_type") or "",
            project_subtype=request.data.get("project_subtype") or "",
            current_description=request.data.get("current_description") or "",
        )
    except Exception as e:
        return JsonResponse({"detail": str(e)}, status=HTTP_400_BAD_REQUEST)

    payload = {
        "detail": "OK",
        "description": out["description"],
        "_mode": out.get("_mode"),
        "_model": out.get("_model"),
        "agreement_ai_credit_consumed": True,
        "charged_now": bool(charged_now),
        **_ai_credits_payload(ai_credits),
    }
    return JsonResponse(payload, status=HTTP_200_OK)


@api_view(["POST"])
@permission_classes([IsAuthenticated])
def ai_suggest_milestones(request, agreement_id: int):
    """
    POST /api/projects/agreements/<id>/ai/suggest-milestones/
    Returns:
      {
        "scope_text": "...",
        "milestones": [...],
        "questions": [...]
      }
    """
    if not _ai_enabled():
        return _deny("AI is disabled.", "AI_DISABLED")

    contractor = _get_contractor_for_user(request.user)
    if not contractor:
        return _deny("Contractor only.", "CONTRACTOR_ONLY")

    agreement = _get_agreement_or_404(int(agreement_id))
    if not agreement:
        return _deny("Agreement not found.", "AGREEMENT_NOT_FOUND", status=HTTP_404_NOT_FOUND)

    if agreement.contractor_id and agreement.contractor_id != contractor.id:
        return _deny("Not your agreement.", "FORBIDDEN")

    try:
        charged_now, ai_credits = _charge_once(contractor, agreement)
    except ValueError as e:
        msg = str(e) or "AI not available."
        if "No AI credits remaining" in msg:
            return _deny("No Agreement AI credits remaining.", "AI_CREDITS_EXHAUSTED")
        return _deny(msg, "AI_ERROR")

    notes = request.data.get("notes", "") if hasattr(request, "data") else ""

    try:
        out = suggest_scope_and_milestones(agreement=agreement, notes=notes)
    except Exception as e:
        return JsonResponse({"detail": str(e)}, status=HTTP_400_BAD_REQUEST)

    payload = {
        "detail": "OK",
        "scope_text": out["scope_text"],
        "milestones": out["milestones"],
        "questions": out.get("questions", []),
        "_model": out.get("_model"),
        "agreement_ai_credit_consumed": True,
        "charged_now": bool(charged_now),
        **_ai_credits_payload(ai_credits),
    }
    return JsonResponse(payload, status=HTTP_200_OK)