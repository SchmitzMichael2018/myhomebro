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

from decimal import Decimal, InvalidOperation

from django.conf import settings
from django.http import JsonResponse
from rest_framework.decorators import api_view, permission_classes
from rest_framework.permissions import IsAuthenticated
from rest_framework.status import HTTP_200_OK, HTTP_400_BAD_REQUEST, HTTP_403_FORBIDDEN, HTTP_404_NOT_FOUND

from projects.ai.agreement_description_writer import generate_or_improve_description
from projects.ai.agreement_milestone_writer import (
    suggest_scope_and_milestones,
    suggest_pricing_refresh,
)
from projects.models import Agreement, Milestone
from projects.services.ai_credits import consume_agreement_bundle_credit_if_needed
from projects.services.ai.project_drafter import draft_project_structure


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


def _to_nullable_decimal(value):
    if value in (None, "", []):
        return None
    try:
        return Decimal(str(value))
    except (InvalidOperation, ValueError, TypeError):
        return None


def _persist_pricing_estimates(agreement: Agreement, pricing_estimates: list[dict]) -> int:
    if not isinstance(pricing_estimates, list) or not pricing_estimates:
        return 0

    milestone_ids = [
        int(item.get("milestone_id"))
        for item in pricing_estimates
        if item.get("milestone_id") not in (None, "", [])
    ]
    milestones = {
        m.id: m
        for m in Milestone.objects.filter(agreement_id=agreement.id, id__in=milestone_ids)
    }

    persisted = 0

    for item in pricing_estimates:
        milestone_id = item.get("milestone_id")
        if milestone_id in (None, "", []):
            continue

        try:
            milestone = milestones.get(int(milestone_id))
        except Exception:
            milestone = None
        if milestone is None:
            continue

        update_fields = []

        low = _to_nullable_decimal(item.get("suggested_amount_low"))
        if low != getattr(milestone, "suggested_amount_low", None):
            milestone.suggested_amount_low = low
            update_fields.append("suggested_amount_low")

        high = _to_nullable_decimal(item.get("suggested_amount_high"))
        if high != getattr(milestone, "suggested_amount_high", None):
            milestone.suggested_amount_high = high
            update_fields.append("suggested_amount_high")

        labor_low = _to_nullable_decimal(item.get("labor_estimate_low"))
        if labor_low != getattr(milestone, "labor_estimate_low", None):
            milestone.labor_estimate_low = labor_low
            update_fields.append("labor_estimate_low")

        labor_high = _to_nullable_decimal(item.get("labor_estimate_high"))
        if labor_high != getattr(milestone, "labor_estimate_high", None):
            milestone.labor_estimate_high = labor_high
            update_fields.append("labor_estimate_high")

        materials_low = _to_nullable_decimal(item.get("materials_estimate_low"))
        if materials_low != getattr(milestone, "materials_estimate_low", None):
            milestone.materials_estimate_low = materials_low
            update_fields.append("materials_estimate_low")

        materials_high = _to_nullable_decimal(item.get("materials_estimate_high"))
        if materials_high != getattr(milestone, "materials_estimate_high", None):
            milestone.materials_estimate_high = materials_high
            update_fields.append("materials_estimate_high")

        confidence = str(item.get("pricing_confidence") or "").strip().lower()
        if confidence != (getattr(milestone, "pricing_confidence", "") or "").strip().lower():
            milestone.pricing_confidence = confidence
            update_fields.append("pricing_confidence")

        source_note = str(item.get("pricing_source_note") or "").strip()[:255]
        if source_note != (getattr(milestone, "pricing_source_note", "") or "").strip():
            milestone.pricing_source_note = source_note
            update_fields.append("pricing_source_note")

        duration = item.get("recommended_duration_days", None)
        try:
            duration = max(int(duration), 1) if duration not in (None, "", []) else None
        except Exception:
            duration = None
        if duration != getattr(milestone, "recommended_duration_days", None):
            milestone.recommended_duration_days = duration
            update_fields.append("recommended_duration_days")

        materials_hint = str(item.get("materials_hint") or "").strip()
        if materials_hint != (getattr(milestone, "materials_hint", "") or "").strip():
            milestone.materials_hint = materials_hint
            update_fields.append("materials_hint")

        if update_fields:
            milestone.save(update_fields=update_fields)
            persisted += 1

    return persisted
    return JsonResponse(payload, status=HTTP_200_OK)


@api_view(["POST"])
@permission_classes([IsAuthenticated])
def ai_refresh_pricing_estimate(request, agreement_id: int):
    """
    POST /api/projects/agreements/<id>/ai/refresh-pricing-estimate/
    Returns refreshed estimate-assist guidance only.
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

    try:
        out = suggest_pricing_refresh(agreement=agreement)
    except Exception as e:
        return JsonResponse({"detail": str(e)}, status=HTTP_400_BAD_REQUEST)

    persisted_count = _persist_pricing_estimates(agreement, out.get("pricing_estimates", []))

    payload = {
        "detail": "OK",
        "pricing_estimates": out.get("pricing_estimates", []),
        "persisted_count": persisted_count,
        "_model": out.get("_model"),
        "agreement_ai_credit_consumed": True,
        "charged_now": bool(charged_now),
        **_ai_credits_payload(ai_credits),
    }
    return JsonResponse(payload, status=HTTP_200_OK)

@api_view(["POST"])
@permission_classes([IsAuthenticated])
def ai_draft_project(request):
    """
    POST /api/projects/agreements/ai/draft/

    Creates a smart Step 1 / Step 2 draft from:
    - agreement_id (required; save draft first)
    - project_title
    - description
    - optional requested type/subtype

    Returns:
      {
        project_type,
        project_subtype,
        normalized_description,
        suggested_template,
        template_confidence,
        template_score,
        template_reason,
        milestones,
        clarifications,
        pricing_summary,
        estimated_days,
        can_save_template
      }
    """
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

    if agreement.contractor_id and agreement.contractor_id != contractor.id:
        return _deny("Not your agreement.", "FORBIDDEN")

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
        result = draft_project_structure(
            agreement=agreement,
            contractor=contractor,
            project_title=request.data.get("project_title") or "",
            description=request.data.get("description") or request.data.get("current_description") or "",
            requested_type=request.data.get("project_type") or "",
            requested_subtype=request.data.get("project_subtype") or "",
        )
    except Exception as e:
        return JsonResponse({"detail": str(e)}, status=HTTP_400_BAD_REQUEST)

    payload = {
        "detail": "OK",
        **result,
        "agreement_ai_credit_consumed": True,
        "charged_now": bool(charged_now),
        **_ai_credits_payload(ai_credits),
    }
    return JsonResponse(payload, status=HTTP_200_OK)
