from __future__ import annotations

from typing import Any

from django.db import transaction

from projects.models import Agreement
from projects.models_learning import AgreementDraftIntelligenceSnapshot
from projects.models_templates import ProjectTemplate


def _safe_text(value: Any) -> str:
    return "" if value is None else str(value).strip()


def _safe_dict(value: Any) -> dict[str, Any]:
    return dict(value) if isinstance(value, dict) else {}


def _normalize_draft_source(value: Any) -> str:
    raw = _safe_text(value).lower()
    allowed = {choice for choice, _label in AgreementDraftIntelligenceSnapshot.DraftSource.choices}
    return raw if raw in allowed else AgreementDraftIntelligenceSnapshot.DraftSource.MANUAL


def _template_from_payload(payload: dict[str, Any], agreement: Agreement) -> ProjectTemplate | None:
    selected_template = getattr(agreement, "selected_template", None)
    if selected_template is not None:
        return selected_template

    template_id = (
        payload.get("selected_template_id")
        or payload.get("selectedTemplateId")
        or payload.get("template_id")
        or payload.get("project_template_id")
    )
    if not template_id:
        recommendation = _safe_dict(payload.get("template_recommendation_result"))
        template_id = recommendation.get("id") or recommendation.get("template_id")
    if not template_id:
        return None
    try:
        return ProjectTemplate.objects.filter(pk=template_id).first()
    except Exception:
        return None


def build_draft_intelligence_payload(
    *,
    agreement: Agreement,
    source_payload: dict[str, Any] | None = None,
) -> dict[str, Any]:
    source_payload = _safe_dict(source_payload)
    draft = _safe_dict(source_payload.get("draft"))
    classification = _safe_dict(
        source_payload.get("advisory_classification") or source_payload.get("classification")
    )
    recommendation = _safe_dict(
        source_payload.get("template_recommendation_result")
        or source_payload.get("template_recommendation")
        or source_payload.get("recommended_template")
    )

    project = getattr(agreement, "project", None)
    selected_template = _template_from_payload(source_payload, agreement)

    original_description = (
        _safe_text(source_payload.get("original_project_description"))
        or _safe_text(source_payload.get("job_description"))
        or _safe_text(source_payload.get("current_description"))
        or _safe_text(source_payload.get("description"))
        or _safe_text(getattr(agreement, "description", ""))
    )

    ai_scope = (
        _safe_text(source_payload.get("ai_scope"))
        or _safe_text(draft.get("description"))
        or _safe_text(draft.get("scope_of_work"))
        or _safe_text(source_payload.get("scope_of_work"))
        or _safe_text(getattr(agreement, "description", ""))
    )

    return {
        "agreement": agreement,
        "contractor": getattr(agreement, "contractor", None),
        "selected_template": selected_template,
        "original_project_description": original_description,
        "ai_project_title": (
            _safe_text(source_payload.get("ai_project_title"))
            or _safe_text(draft.get("project_title"))
            or _safe_text(source_payload.get("project_title"))
            or _safe_text(getattr(project, "title", ""))
        ),
        "ai_project_type": (
            _safe_text(source_payload.get("ai_project_type"))
            or _safe_text(draft.get("project_type"))
            or _safe_text(source_payload.get("project_type"))
            or _safe_text(getattr(agreement, "project_type", ""))
        ),
        "ai_project_subtype": (
            _safe_text(source_payload.get("ai_project_subtype"))
            or _safe_text(draft.get("project_subtype"))
            or _safe_text(source_payload.get("project_subtype"))
            or _safe_text(getattr(agreement, "project_subtype", ""))
        ),
        "ai_scope": ai_scope,
        "advisory_classification": classification,
        "template_recommendation_result": recommendation,
        "template_recommendation_tier": _safe_text(
            source_payload.get("template_recommendation_tier")
            or source_payload.get("recommendation_tier")
            or recommendation.get("match_tier")
            or recommendation.get("tier")
        ),
        "draft_source": _normalize_draft_source(source_payload.get("draft_source")),
        "ai_model_version": _safe_text(
            source_payload.get("ai_model_version")
            or source_payload.get("_model")
            or source_payload.get("model")
        ),
    }


@transaction.atomic
def capture_agreement_draft_intelligence_snapshot(
    agreement: Agreement | int,
    *,
    source_payload: dict[str, Any] | None = None,
) -> AgreementDraftIntelligenceSnapshot:
    if isinstance(agreement, int):
        agreement = Agreement.objects.select_related(
            "project",
            "contractor",
            "selected_template",
        ).get(pk=agreement)

    existing = AgreementDraftIntelligenceSnapshot.objects.filter(agreement=agreement).first()
    if existing is not None:
        return existing

    payload = build_draft_intelligence_payload(agreement=agreement, source_payload=source_payload)
    return AgreementDraftIntelligenceSnapshot.objects.create(**payload)
