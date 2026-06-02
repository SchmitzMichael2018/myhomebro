from __future__ import annotations

from decimal import Decimal
from typing import Any

from django.db import transaction

from projects.models import Agreement
from projects.models_learning import AgreementDraftIntelligenceSnapshot, ContractorEditEvent


TRACKED_FIELDS = (
    ContractorEditEvent.Field.PROJECT_TITLE,
    ContractorEditEvent.Field.PROJECT_TYPE,
    ContractorEditEvent.Field.PROJECT_SUBTYPE,
    ContractorEditEvent.Field.SCOPE,
    ContractorEditEvent.Field.MILESTONES,
    ContractorEditEvent.Field.PRICING,
    ContractorEditEvent.Field.SCHEDULE,
    ContractorEditEvent.Field.EXCLUSIONS,
    ContractorEditEvent.Field.CLARIFICATION_QUESTIONS,
)


def _safe_text(value: Any) -> str:
    return "" if value is None else str(value).strip()


def _json_value(value: Any) -> Any:
    if isinstance(value, Decimal):
        return str(value.quantize(Decimal("0.01")))
    if hasattr(value, "isoformat"):
        return value.isoformat()
    if isinstance(value, dict):
        return {str(key): _json_value(val) for key, val in sorted(value.items(), key=lambda item: str(item[0]))}
    if isinstance(value, (list, tuple)):
        return [_json_value(item) for item in value]
    if value is None:
        return None
    return value


def _scalar(value: Any) -> dict[str, Any]:
    return {"value": _json_value(value)}


def _milestone_rows(agreement: Agreement) -> list[dict[str, Any]]:
    try:
        rows = agreement.milestones.all().order_by("order", "id")
    except Exception:
        return []
    return [
        {
            "id": row.id,
            "order": int(getattr(row, "order", 0) or 0),
            "title": _safe_text(getattr(row, "title", "")),
            "description": _safe_text(getattr(row, "description", "")),
            "amount": _json_value(getattr(row, "amount", None)),
            "start_date": _json_value(getattr(row, "start_date", None)),
            "completion_date": _json_value(getattr(row, "completion_date", None)),
            "normalized_milestone_type": _safe_text(getattr(row, "normalized_milestone_type", "")),
        }
        for row in rows
    ]


def _clarification_snapshot(agreement: Agreement) -> dict[str, Any]:
    scope_obj = getattr(agreement, "ai_scope", None)
    if scope_obj is None:
        return {"questions": [], "answers": {}, "scope_text": ""}
    return {
        "questions": _json_value(getattr(scope_obj, "questions", []) or []),
        "answers": _json_value(getattr(scope_obj, "answers", {}) or {}),
        "scope_text": _safe_text(getattr(scope_obj, "scope_text", "")),
    }


def build_agreement_edit_lineage_state(agreement: Agreement) -> dict[str, Any]:
    project = getattr(agreement, "project", None)
    return {
        ContractorEditEvent.Field.PROJECT_TITLE: _scalar(getattr(project, "title", "")),
        ContractorEditEvent.Field.PROJECT_TYPE: _scalar(getattr(agreement, "project_type", "")),
        ContractorEditEvent.Field.PROJECT_SUBTYPE: _scalar(getattr(agreement, "project_subtype", "")),
        ContractorEditEvent.Field.SCOPE: _scalar(getattr(agreement, "description", "")),
        ContractorEditEvent.Field.MILESTONES: {"items": _milestone_rows(agreement)},
        ContractorEditEvent.Field.PRICING: {
            "total_cost": _json_value(getattr(agreement, "total_cost", None)),
            "payment_mode": _safe_text(getattr(agreement, "payment_mode", "")),
            "payment_structure": _safe_text(getattr(agreement, "payment_structure", "")),
            "pricing_strategy": _safe_text(getattr(agreement, "pricing_strategy", "")),
            "retainage_percent": _json_value(getattr(agreement, "retainage_percent", None)),
        },
        ContractorEditEvent.Field.SCHEDULE: {
            "start": _json_value(getattr(agreement, "start", None)),
            "end": _json_value(getattr(agreement, "end", None)),
            "total_time_estimate": _safe_text(getattr(agreement, "total_time_estimate", "")),
            "recurrence_pattern": _safe_text(getattr(agreement, "recurrence_pattern", "")),
            "recurrence_start_date": _json_value(getattr(agreement, "recurrence_start_date", None)),
            "recurrence_end_date": _json_value(getattr(agreement, "recurrence_end_date", None)),
        },
        ContractorEditEvent.Field.EXCLUSIONS: {
            "excluded_work": _safe_text(getattr(agreement, "excluded_work", "")),
            "homeowner_responsibilities": _safe_text(getattr(agreement, "homeowner_responsibilities", "")),
            "contractor_responsibilities": _safe_text(getattr(agreement, "contractor_responsibilities", "")),
        },
        ContractorEditEvent.Field.CLARIFICATION_QUESTIONS: _clarification_snapshot(agreement),
    }


def _normalize_source(source: Any) -> str:
    raw = _safe_text(source).lower()
    allowed = {choice for choice, _label in ContractorEditEvent.Source.choices}
    return raw if raw in allowed else ContractorEditEvent.Source.CONTRACTOR


def _event_metadata(agreement: Agreement, metadata: dict[str, Any] | None = None) -> dict[str, Any]:
    payload = dict(metadata or {})
    try:
        draft = getattr(agreement, "draft_intelligence_snapshot", None)
    except Exception:
        draft = None
    if draft is not None:
        payload.setdefault("draft_intelligence_snapshot_id", getattr(draft, "id", None))
        payload.setdefault("draft_source", getattr(draft, "draft_source", ""))
        payload.setdefault("selected_template_id", getattr(draft, "selected_template_id", None))
    payload.setdefault("agreement_status", _safe_text(getattr(agreement, "status", "")))
    payload.setdefault("amendment_number", int(getattr(agreement, "amendment_number", 0) or 0))
    return _json_value(payload)


def capture_agreement_edit_lineage_events(
    agreement: Agreement,
    *,
    before_state: dict[str, Any] | None,
    after_state: dict[str, Any] | None = None,
    source: str = ContractorEditEvent.Source.CONTRACTOR,
    change_reason: str = "",
    metadata: dict[str, Any] | None = None,
) -> list[ContractorEditEvent]:
    if before_state is None:
        return []
    after_state = after_state or build_agreement_edit_lineage_state(agreement)
    event_source = _normalize_source(source)
    event_metadata = _event_metadata(agreement, metadata)

    events: list[ContractorEditEvent] = []
    for field in TRACKED_FIELDS:
        original = _json_value(before_state.get(field, {}))
        updated = _json_value(after_state.get(field, {}))
        if original == updated:
            continue
        events.append(
            ContractorEditEvent(
                agreement=agreement,
                contractor=getattr(agreement, "contractor", None),
                field_changed=field,
                original_value=original if isinstance(original, dict) else {"value": original},
                updated_value=updated if isinstance(updated, dict) else {"value": updated},
                source=event_source,
                change_reason=_safe_text(change_reason),
                metadata=event_metadata,
            )
        )
    if not events:
        return []
    return ContractorEditEvent.objects.bulk_create(events)


def build_state_from_draft_snapshot(snapshot: AgreementDraftIntelligenceSnapshot) -> dict[str, Any]:
    return {
        ContractorEditEvent.Field.PROJECT_TITLE: _scalar(snapshot.ai_project_title),
        ContractorEditEvent.Field.PROJECT_TYPE: _scalar(snapshot.ai_project_type),
        ContractorEditEvent.Field.PROJECT_SUBTYPE: _scalar(snapshot.ai_project_subtype),
        ContractorEditEvent.Field.SCOPE: _scalar(snapshot.ai_scope),
        ContractorEditEvent.Field.MILESTONES: {"items": []},
        ContractorEditEvent.Field.PRICING: {},
        ContractorEditEvent.Field.SCHEDULE: {},
        ContractorEditEvent.Field.EXCLUSIONS: {},
        ContractorEditEvent.Field.CLARIFICATION_QUESTIONS: {"questions": [], "answers": {}, "scope_text": ""},
    }


@transaction.atomic
def capture_initial_draft_to_agreement_lineage(
    agreement: Agreement,
    *,
    source: str = ContractorEditEvent.Source.CONTRACTOR,
    change_reason: str = "agreement_created_from_reviewed_draft",
    metadata: dict[str, Any] | None = None,
) -> list[ContractorEditEvent]:
    try:
        snapshot = agreement.draft_intelligence_snapshot
    except AgreementDraftIntelligenceSnapshot.DoesNotExist:
        return []
    after = build_agreement_edit_lineage_state(agreement)
    before = dict(after)
    before.update(
        {
            ContractorEditEvent.Field.PROJECT_TITLE: _scalar(snapshot.ai_project_title),
            ContractorEditEvent.Field.PROJECT_TYPE: _scalar(snapshot.ai_project_type),
            ContractorEditEvent.Field.PROJECT_SUBTYPE: _scalar(snapshot.ai_project_subtype),
            ContractorEditEvent.Field.SCOPE: _scalar(snapshot.ai_scope),
        }
    )
    return capture_agreement_edit_lineage_events(
        agreement,
        before_state=before,
        after_state=after,
        source=source,
        change_reason=change_reason,
        metadata=metadata,
    )
