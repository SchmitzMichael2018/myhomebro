from __future__ import annotations

from types import SimpleNamespace
from typing import Any

from projects.services.intake_analysis import analyze_project_intake
from projects.services.project_intelligence import build_project_intelligence_context
from projects.services.project_plan_suggestions import build_project_plan_suggestion
from projects.services.estimation_engine import build_project_estimate


def _safe_text(value: Any) -> str:
    return "" if value is None else str(value).strip()


def _safe_dict(value: Any) -> dict[str, Any]:
    return dict(value) if isinstance(value, dict) else {}


def _safe_int(value: Any, default: int = 0) -> int:
    try:
        if value in (None, "", []):
            return default
        return max(int(value), 0)
    except Exception:
        return default


class _PhotoCounter:
    def __init__(self, count: int = 0):
        self._count = max(int(count or 0), 0)

    def count(self) -> int:
        return self._count


def _normalize_project_payload(input_payload: Any) -> dict[str, Any]:
    if input_payload is None:
        input_payload = {}
    if isinstance(input_payload, dict):
        payload = dict(input_payload)
    else:
        payload = {"intake": input_payload}

    intake = payload.get("intake")
    agreement = payload.get("agreement")
    lead = payload.get("lead")
    template = payload.get("template")

    source_analysis = {}
    if intake is not None:
        source_analysis = _safe_dict(getattr(intake, "ai_analysis_payload", None))
    elif agreement is not None:
        source_lead = getattr(agreement, "source_lead", None)
        if source_lead is not None:
            source_analysis = _safe_dict(getattr(source_lead, "ai_analysis", None))
        else:
            source_analysis = _safe_dict(getattr(agreement, "ai_analysis_payload", None))
    elif lead is not None:
        source_analysis = _safe_dict(getattr(lead, "ai_analysis", None))

    clarification_answers = payload.get("clarification_answers")
    if clarification_answers is None and intake is not None:
        clarification_answers = getattr(intake, "ai_clarification_answers", None)
    if clarification_answers is None and agreement is not None:
        ai_scope = getattr(agreement, "ai_scope", None)
        clarification_answers = getattr(ai_scope, "answers", None) if ai_scope is not None else None
    if clarification_answers is None and lead is not None:
        clarification_answers = _safe_dict(getattr(lead, "ai_analysis", {})).get("clarification_answers", {})
    clarification_answers = _safe_dict(clarification_answers)

    measurement_handling = _safe_text(payload.get("measurement_handling"))
    if not measurement_handling and intake is not None:
        measurement_handling = _safe_text(getattr(intake, "measurement_handling", ""))
    if not measurement_handling and lead is not None:
        measurement_handling = _safe_text(getattr(lead, "measurement_handling", ""))
    if not measurement_handling and agreement is not None:
        ai_scope = getattr(agreement, "ai_scope", None)
        if ai_scope is not None:
            measurement_handling = _safe_text(getattr(ai_scope, "answers", {}).get("measurement_handling"))
    if not measurement_handling:
        measurement_handling = _safe_text(clarification_answers.get("measurement_handling"))

    project_title = _safe_text(
        payload.get("project_title")
        or payload.get("title")
        or (getattr(agreement, "project", None).title if getattr(agreement, "project", None) else "")
        or getattr(intake, "ai_project_title", "")
        or getattr(lead, "project_type", "")
        or getattr(template, "name", "")
    )
    project_type = _safe_text(
        payload.get("project_type")
        or getattr(agreement, "project_type", "")
        or getattr(intake, "ai_project_type", "")
        or _safe_dict(source_analysis).get("project_type")
        or getattr(template, "project_type", "")
    )
    project_subtype = _safe_text(
        payload.get("project_subtype")
        or getattr(agreement, "project_subtype", "")
        or getattr(intake, "ai_project_subtype", "")
        or _safe_dict(source_analysis).get("project_subtype")
        or getattr(template, "project_subtype", "")
    )
    description = _safe_text(
        payload.get("description")
        or payload.get("current_description")
        or getattr(agreement, "description", "")
        or getattr(intake, "ai_description", "")
        or getattr(intake, "accomplishment_text", "")
        or getattr(lead, "project_description", "")
        or _safe_dict(source_analysis).get("project_scope_summary")
        or getattr(template, "description", "")
    )
    project_scope_summary = _safe_text(
        payload.get("project_scope_summary")
        or _safe_dict(source_analysis).get("project_scope_summary")
        or description
    )
    if not project_scope_summary and agreement is not None:
        project_scope_summary = _safe_text(getattr(agreement, "description", "")) or _safe_text(getattr(getattr(agreement, "project", None), "title", ""))
    project_budget = payload.get("project_budget")
    if project_budget in (None, "", []):
        project_budget = getattr(intake, "ai_project_budget", None)
    project_timeline_days = payload.get("project_timeline_days")
    if project_timeline_days in (None, "", []):
        project_timeline_days = getattr(intake, "ai_project_timeline_days", None)

    photo_count = _safe_int(payload.get("photo_count"), 0)
    if photo_count <= 0 and intake is not None:
        try:
            photo_count = int(getattr(getattr(intake, "clarification_photos", None), "count", lambda: 0)() or 0)
        except Exception:
            photo_count = 0
    if photo_count <= 0:
        photo_count = _safe_int(_safe_dict(source_analysis).get("photo_count"), 0)

    contractor = payload.get("contractor") or getattr(intake, "contractor", None) or getattr(agreement, "contractor", None) or getattr(lead, "contractor", None)

    return {
        "contractor": contractor,
        "intake": intake,
        "agreement": agreement,
        "lead": lead,
        "template": template,
        "project_title": project_title,
        "project_type": project_type,
        "project_subtype": project_subtype,
        "description": description,
        "project_scope_summary": project_scope_summary,
        "clarification_answers": clarification_answers,
        "measurement_handling": measurement_handling,
        "project_budget": project_budget,
        "project_timeline_days": project_timeline_days,
        "photo_count": photo_count,
        "source_analysis": source_analysis,
        "template_id": payload.get("template_id") or getattr(template, "id", None) or getattr(agreement, "selected_template_id", None) or _safe_dict(source_analysis).get("template_id"),
        "template_name": _safe_text(payload.get("template_name") or getattr(template, "name", "") or _safe_dict(source_analysis).get("template_name")),
    }


def _build_intake_like(normalized: dict[str, Any]):
    intake = normalized.get("intake")
    if intake is not None:
        return intake

    photo_count = max(int(normalized.get("photo_count") or 0), 0)
    return SimpleNamespace(
        contractor=normalized.get("contractor"),
        accomplishment_text=normalized.get("description") or normalized.get("project_scope_summary") or normalized.get("project_title"),
        ai_project_title=normalized.get("project_title"),
        ai_project_type=normalized.get("project_type"),
        ai_project_subtype=normalized.get("project_subtype"),
        ai_description=normalized.get("description") or normalized.get("project_scope_summary"),
        ai_project_timeline_days=normalized.get("project_timeline_days"),
        ai_project_budget=normalized.get("project_budget"),
        measurement_handling=normalized.get("measurement_handling"),
        ai_clarification_answers=dict(normalized.get("clarification_answers") or {}),
        clarification_photos=_PhotoCounter(photo_count),
    )


def build_project_intelligence(input_payload: Any) -> dict[str, Any]:
    normalized = _normalize_project_payload(input_payload)
    intake_like = _build_intake_like(normalized)

    analysis = analyze_project_intake(intake=intake_like)
    intelligence_context = build_project_intelligence_context(
        project_title=normalized["project_title"],
        project_type=normalized["project_type"],
        project_subtype=normalized["project_subtype"],
        description=normalized["description"] or normalized["project_scope_summary"],
    )

    plan = build_project_plan_suggestion(
        project_title=analysis.get("project_title", normalized["project_title"]),
        project_type=analysis.get("project_type", normalized["project_type"]),
        project_subtype=analysis.get("project_subtype", normalized["project_subtype"]),
        description=analysis.get("description", normalized["description"]),
        project_scope_summary=analysis.get("project_scope_summary", normalized["project_scope_summary"]),
        clarification_answers=analysis.get("clarification_answers", normalized["clarification_answers"]),
        photo_count=_safe_int(analysis.get("photo_count"), normalized["photo_count"]),
        suggested_total_price=analysis.get("project_budget"),
        suggested_price_low=None,
        suggested_price_high=None,
        suggested_duration_days=analysis.get("project_timeline_days"),
        suggested_duration_low=None,
        suggested_duration_high=None,
        confidence_level=analysis.get("confidence", "none"),
        confidence_reasoning=analysis.get("reason", ""),
        learned_benchmark_used=bool(_safe_dict(analysis.get("recommended_setup")).get("strong_template_match")),
        seeded_benchmark_used=bool(_safe_dict(analysis.get("recommended_setup")).get("recommended_template_id")),
        benchmark_source=_safe_text(_safe_dict(analysis.get("recommended_setup")).get("recommendation_basis")),
        benchmark_match_scope="analysis",
        template_name=_safe_text(analysis.get("template_name")),
        recommended_project_type=_safe_text(analysis.get("project_type")),
        recommended_project_subtype=_safe_text(analysis.get("project_subtype")),
        suggested_workflow=_safe_text(_safe_dict(analysis.get("recommended_setup")).get("suggested_workflow")),
        suggested_template_label=_safe_text(_safe_dict(analysis.get("recommended_setup")).get("suggested_template_label")),
        recommended_template_name=_safe_text(analysis.get("template_name")),
        selected_template_id=analysis.get("template_id"),
        contractor_id=getattr(normalized.get("contractor"), "id", None),
    )

    estimate_preview = None
    agreement = normalized.get("agreement")
    if agreement is not None:
        estimate_preview = build_project_estimate(agreement=agreement)

    return {
        "normalized_input": {
            "project_title": normalized["project_title"],
            "project_type": normalized["project_type"],
            "project_subtype": normalized["project_subtype"],
            "project_scope_summary": normalized["project_scope_summary"],
            "description": normalized["description"],
            "measurement_handling": normalized["measurement_handling"],
            "photo_count": normalized["photo_count"],
            "template_id": normalized["template_id"],
            "template_name": normalized["template_name"],
        },
        "analysis": analysis,
        "classification": intelligence_context,
        "recommended_setup": analysis.get("recommended_setup") or {},
        "suggested_plan": plan,
        "estimate_preview": estimate_preview,
        "confidence": plan.get("confidence_level") if isinstance(plan, dict) else analysis.get("confidence", "none"),
        "confidence_reasoning": plan.get("confidence_reasoning") if isinstance(plan, dict) else analysis.get("reason", ""),
        "explanation_points": plan.get("explanation_points") if isinstance(plan, dict) else [],
        "source_metadata": {
            "entry_type": "agreement" if agreement is not None else "intake_like" if normalized.get("intake") is not None else "lead_or_template",
            "project_family_key": analysis.get("project_family_key", ""),
            "project_family_label": analysis.get("project_family_label", ""),
            "template_id": normalized["template_id"],
        },
    }
