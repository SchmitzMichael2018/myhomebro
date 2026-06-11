# backend/projects/api/ai_agreement_views.py
# AI agreement endpoints. AI is included by default and must not be gated by
# credits, subscriptions, tiers, or purchases.

from __future__ import annotations

import logging
from decimal import Decimal, InvalidOperation

from django.http import JsonResponse
from rest_framework.decorators import api_view, permission_classes
from rest_framework.permissions import IsAuthenticated
from rest_framework.status import HTTP_200_OK, HTTP_400_BAD_REQUEST, HTTP_403_FORBIDDEN, HTTP_404_NOT_FOUND

from projects.ai.agreement_milestone_writer import (
    suggest_scope_and_milestones,
    suggest_pricing_refresh,
)
from projects.models import Agreement, Milestone
from projects.services.ai_orchestrator import orchestrate_user_request
from projects.services.ai.project_classifier import build_project_taxonomy_snapshot, classify_project_from_scope
from projects.services.ai.project_drafter import draft_project_structure
from projects.services.ai.project_understanding import understand_project_request
from projects.services.project_intelligence_orchestrator import build_project_intelligence

logger = logging.getLogger(__name__)


def _get_contractor_for_user(user):
    return getattr(user, "contractor_profile", None)


def _deny(detail: str, code: str, status=HTTP_403_FORBIDDEN, extra: dict | None = None):
    payload = {"detail": detail, "code": code}
    if extra:
        payload.update(extra)
    return JsonResponse(payload, status=status)


def _validation_error(errors: dict[str, list[str]] | dict[str, str], detail: str | None = None):
    payload = {"errors": errors}
    if detail:
        payload["detail"] = detail
    return JsonResponse(payload, status=HTTP_400_BAD_REQUEST)


def _get_agreement_or_404(agreement_id: int):
    try:
        return Agreement.objects.get(id=int(agreement_id))
    except Agreement.DoesNotExist:
        return None


def _ai_access_payload() -> dict:
    return {
        "ai_access": "included",
        "ai_enabled": True,
        "ai_unlimited": True,
    }


def _safe_text(value) -> str:
    return " ".join(str(value or "").split()).strip()


def _milestone_context(value) -> list[str]:
    if not isinstance(value, list):
        return []
    rows: list[str] = []
    for idx, item in enumerate(value[:8], start=1):
        if isinstance(item, str):
            text = _safe_text(item)
        elif isinstance(item, dict):
            title = _safe_text(item.get("title") or item.get("name"))
            description = _safe_text(
                item.get("description") or item.get("scope") or item.get("scope_of_work")
            )
            text = " - ".join(part for part in [title, description] if part)
        else:
            text = ""
        if text:
            rows.append(f"{idx}. {text}")
    return rows


def _compose_description_context(data) -> str:
    direct_context = _safe_text(data.get("current_description"))
    scope_context = _safe_text(data.get("scope_of_work") or data.get("scopeOfWork"))
    description_context = _safe_text(data.get("description"))
    template_context = _safe_text(
        data.get("template_scope")
        or data.get("default_scope")
        or data.get("template_default_scope")
        or data.get("defaultScope")
    )
    milestone_rows = _milestone_context(data.get("milestones"))

    sections: list[str] = []
    for text in [direct_context, scope_context, description_context]:
        if text and text not in sections:
            sections.append(text)
    if template_context:
        sections.append(f"Template/default scope:\n{template_context}")
    if milestone_rows:
        sections.append("Existing milestones:\n" + "\n".join(milestone_rows))
    return "\n\n".join(sections).strip()


@api_view(["POST"])
@permission_classes([IsAuthenticated])
def ai_agreement_description(request):
    contractor = _get_contractor_for_user(request.user)
    if not contractor:
        return _deny("Contractor only.", "CONTRACTOR_ONLY")

    agreement_id = request.data.get("agreement_id") or request.data.get("agreement") or None
    try:
        agreement_id = int(agreement_id) if agreement_id is not None else 0
    except Exception:
        agreement_id = 0

    agreement = None
    if agreement_id:
        agreement = _get_agreement_or_404(agreement_id)
        if not agreement:
            return _validation_error(
                {"agreement_id": ["Agreement not found."]},
                "Agreement not found.",
            )

        # Optional safety: only allow AI on own agreement
        if agreement.contractor_id and agreement.contractor_id != contractor.id:
            return _deny("Not your agreement.", "FORBIDDEN")

    raw_project_title = _safe_text(request.data.get("project_title"))
    raw_project_type = _safe_text(request.data.get("project_type"))
    raw_project_subtype = _safe_text(request.data.get("project_subtype"))
    raw_description = _compose_description_context(request.data)

    if not any([raw_project_title, raw_project_type, raw_project_subtype, raw_description]):
        return _validation_error(
            {"current_description": ["Add a description before asking AI to find a starting point."]},
            "Add a description before asking AI to find a starting point.",
        )

    try:
        understanding = understand_project_request(
            description=raw_description,
            project_title=raw_project_title,
            project_type=raw_project_type,
            project_subtype=raw_project_subtype,
            mode=(request.data.get("mode") or "").strip(),
            contractor=contractor,
        )
    except Exception:
        logger.exception("Agreement AI understanding fallback triggered after unexpected failure.")
        understanding = {
            "project_title": raw_project_title or "Project request",
            "project_type": raw_project_type,
            "project_subtype": raw_project_subtype,
            "description": raw_description,
            "classification": {},
            "recommendation_source": "fallback",
            "confidence": "low",
            "confidence_label": "",
            "reason": "",
        }

    classification = understanding.get("classification") or {}
    draft = {
        "project_title": _safe_text(understanding.get("project_title") or understanding.get("suggested_title")) or raw_project_title,
        "project_type": _safe_text(understanding.get("project_type")) or raw_project_type,
        "project_subtype": _safe_text(understanding.get("project_subtype")) or raw_project_subtype,
        "description": understanding.get("description") or understanding.get("improved_description") or raw_description,
    }

    payload = {
        "detail": "OK",
        "description": draft["description"],
        "_mode": (request.data.get("mode") or "").strip(),
        "_model": understanding.get("_model"),
        "project_title": draft["project_title"],
        "project_type": draft["project_type"],
        "project_subtype": draft["project_subtype"],
        "draft": draft,
        "recommendation_source": understanding.get("recommendation_source", "ai"),
        "confidence": understanding.get("confidence", "recommended"),
        "confidence_label": understanding.get("confidence_label", ""),
        "next_step_guidance": understanding.get("next_step_guidance", ""),
        "reason": understanding.get("reason", ""),
        "clarifying_questions": understanding.get("clarifying_questions", []),
        "suggested_documents_or_photos": understanding.get("suggested_documents_or_photos", []),
        "warnings": understanding.get("warnings", []),
        "classification": {
            "project_type": classification.get("project_type", ""),
            "project_subtype": classification.get("project_subtype", ""),
            "confidence": classification.get("confidence", ""),
            "confidence_label": classification.get("confidence_label", ""),
            "reasoning": classification.get("reason", ""),
            "reason": classification.get("reason", ""),
            "project_title": classification.get("project_title", ""),
            "alternatives": classification.get("alternatives", []),
            "recommended_custom_subtype": classification.get("recommended_custom_subtype", ""),
            "classification_source": classification.get("classification_source", ""),
        },
        **_ai_access_payload(),
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
    contractor = _get_contractor_for_user(request.user)
    if not contractor:
        return _deny("Contractor only.", "CONTRACTOR_ONLY")

    agreement = _get_agreement_or_404(int(agreement_id))
    if not agreement:
        return _deny("Agreement not found.", "AGREEMENT_NOT_FOUND", status=HTTP_404_NOT_FOUND)

    if agreement.contractor_id and agreement.contractor_id != contractor.id:
        return _deny("Not your agreement.", "FORBIDDEN")

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
        "clarification_shaped": bool(out.get("clarification_shaped")),
        "_model": out.get("_model"),
        **_ai_access_payload(),
    }
    return JsonResponse(payload, status=HTTP_200_OK)


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


@api_view(["POST"])
@permission_classes([IsAuthenticated])
def ai_refresh_pricing_estimate(request, agreement_id: int):
    """
    POST /api/projects/agreements/<id>/ai/refresh-pricing-estimate/
    Returns refreshed estimate-assist guidance only.
    """
    contractor = _get_contractor_for_user(request.user)
    if not contractor:
        return _deny("Contractor only.", "CONTRACTOR_ONLY")

    agreement = _get_agreement_or_404(int(agreement_id))
    if not agreement:
        return _deny("Agreement not found.", "AGREEMENT_NOT_FOUND", status=HTTP_404_NOT_FOUND)

    if agreement.contractor_id and agreement.contractor_id != contractor.id:
        return _deny("Not your agreement.", "FORBIDDEN")

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
        **_ai_access_payload(),
    }
    return JsonResponse(payload, status=HTTP_200_OK)


@api_view(["POST"])
@permission_classes([IsAuthenticated])
def agreement_estimate_preview(request, agreement_id: int):
    """
    POST /api/projects/agreements/<id>/estimate-preview/
    Returns a deterministic, read-only estimation preview for Step 2.
    """
    contractor = _get_contractor_for_user(request.user)
    if not contractor:
        return _deny("Contractor only.", "CONTRACTOR_ONLY")

    agreement = _get_agreement_or_404(int(agreement_id))
    if not agreement:
        return _deny("Agreement not found.", "AGREEMENT_NOT_FOUND", status=HTTP_404_NOT_FOUND)

    if agreement.contractor_id and agreement.contractor_id != contractor.id:
        return _deny("Not your agreement.", "FORBIDDEN")

    try:
        out = build_project_intelligence({"agreement": agreement})
    except Exception as e:
        return JsonResponse({"detail": str(e)}, status=HTTP_400_BAD_REQUEST)

    payload = {
        "detail": "OK",
        **(out.get("estimate_preview") or {}),
        **_ai_access_payload(),
    }
    return JsonResponse(payload, status=HTTP_200_OK)


@api_view(["POST"])
@permission_classes([IsAuthenticated])
def ai_orchestrate_assistant(request):
    """
    POST /api/projects/assistant/orchestrate/
    Returns a deterministic orchestration response that coordinates existing
    workflows without mutating data.
    """
    contractor = _get_contractor_for_user(request.user)
    if not contractor:
        return _deny("Contractor only.", "CONTRACTOR_ONLY")

    try:
        out = orchestrate_user_request(contractor=contractor, payload=request.data or {})
    except Exception as e:
        return JsonResponse({"detail": str(e)}, status=HTTP_400_BAD_REQUEST)

    payload = {
        "detail": "OK",
        **out,
        **_ai_access_payload(),
    }
    return JsonResponse(payload, status=HTTP_200_OK)

@api_view(["POST"])
@permission_classes([IsAuthenticated])
def ai_draft_project(request):
    """
    POST /api/projects/agreements/ai/draft/

    Creates a smart Step 1 / Step 2 draft from:
    - agreement_id (optional; uses current draft when available)
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
    contractor = _get_contractor_for_user(request.user)
    if not contractor:
        return _deny("Contractor only.", "CONTRACTOR_ONLY")

    agreement_id = request.data.get("agreement_id") or request.data.get("agreement") or None
    try:
        agreement_id = int(agreement_id) if agreement_id is not None else 0
    except Exception:
        agreement_id = 0

    agreement = None
    if agreement_id:
        agreement = _get_agreement_or_404(agreement_id)
        if not agreement:
            return _validation_error({"agreement_id": ["Agreement not found."]}, "Agreement not found.")

        if agreement.contractor_id and agreement.contractor_id != contractor.id:
            return _deny("Not your agreement.", "FORBIDDEN")

    if not any(
        [
            (request.data.get("project_title") or "").strip(),
            (request.data.get("description") or request.data.get("current_description") or "").strip(),
            (request.data.get("project_type") or "").strip(),
            (request.data.get("project_subtype") or "").strip(),
        ]
    ):
        return _validation_error(
            {"current_description": ["Add a description, project title, type, or subtype before using AI."]},
            "Add a description, project title, type, or subtype before using AI.",
        )

    try:
        intelligence = build_project_intelligence(
            {
                "agreement": agreement,
                "contractor": contractor,
                "project_title": request.data.get("project_title") or "",
                "description": request.data.get("description") or request.data.get("current_description") or "",
                "project_type": request.data.get("project_type") or "",
                "project_subtype": request.data.get("project_subtype") or "",
            }
        )
        analysis = intelligence.get("analysis", {})
        result = draft_project_structure(
            agreement=agreement,
            contractor=contractor,
            project_title=analysis.get("project_title") or request.data.get("project_title") or "",
            description=analysis.get("description") or request.data.get("description") or request.data.get("current_description") or "",
            requested_type=analysis.get("project_type") or request.data.get("project_type") or "",
            requested_subtype=analysis.get("project_subtype") or request.data.get("project_subtype") or "",
        )
    except Exception as e:
        return JsonResponse({"detail": str(e)}, status=HTTP_400_BAD_REQUEST)

    payload = {
        "detail": "OK",
        **result,
        **_ai_access_payload(),
    }
    return JsonResponse(payload, status=HTTP_200_OK)


@api_view(["POST"])
@permission_classes([IsAuthenticated])
def ai_classify_project(request):
    contractor = _get_contractor_for_user(request.user)
    if not contractor:
        return _deny("Contractor only.", "CONTRACTOR_ONLY")

    raw_project_title = (request.data.get("project_title") or "").strip()
    raw_project_type = (request.data.get("project_type") or "").strip()
    raw_project_subtype = (request.data.get("project_subtype") or "").strip()
    raw_description = (request.data.get("description") or request.data.get("current_description") or "").strip()
    raw_scope = (request.data.get("scope_of_work") or request.data.get("scope") or "").strip()

    if not any([raw_project_title, raw_project_type, raw_project_subtype, raw_description, raw_scope]):
        return _validation_error(
            {"current_description": ["Add a description or scope before improving the classification."]},
            "Add a description or scope before improving the classification.",
        )

    taxonomy = build_project_taxonomy_snapshot(contractor=contractor)

    try:
        result = classify_project_from_scope(
            description=raw_description,
            scope=raw_scope or raw_description,
            taxonomy=taxonomy,
            current_values={
                "project_title": raw_project_title,
                "project_type": raw_project_type,
                "project_subtype": raw_project_subtype,
            },
            contractor=contractor,
        )
    except Exception as exc:
        logger.exception("AI classify project failed")
        return JsonResponse(
            {
                "detail": "Couldn't improve the classification. You can edit these fields manually.",
                "error": str(exc),
            },
            status=HTTP_400_BAD_REQUEST,
        )

    payload = {
        "detail": "OK",
        **result,
        "classification": result,
        **_ai_access_payload(),
    }
    return JsonResponse(payload, status=HTTP_200_OK)
