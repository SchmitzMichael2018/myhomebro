from __future__ import annotations

from dataclasses import dataclass
from typing import Any

from django.utils import timezone

from projects.models import Contractor, ContractorWorkspaceContext
from projects.services.project_intelligence import PROJECT_TYPE_FAMILIES


def _safe_text(value: Any) -> str:
    return "" if value is None else str(value).strip()


def _normalize_key(value: Any) -> str:
    return _safe_text(value).lower()


FAMILY_BY_KEY = {str(family.get("key", "")).strip().lower(): family for family in PROJECT_TYPE_FAMILIES}


def normalize_project_family(value: Any = None) -> dict[str, str]:
    raw = value if isinstance(value, dict) else {}
    family_payload = raw.get("project_family") if isinstance(raw.get("project_family"), dict) else raw

    key = _normalize_key(
        family_payload.get("key")
        or family_payload.get("project_family_key")
        or raw.get("project_family_key")
        or raw.get("key")
    )
    label = _safe_text(
        family_payload.get("label")
        or family_payload.get("project_family_label")
        or raw.get("project_family_label")
        or raw.get("label")
    )

    if not key or key in {"all", "general"}:
        return {"key": "", "label": ""}

    family = FAMILY_BY_KEY.get(key)
    if family is None:
        return {"key": "", "label": ""}

    canonical_label = _safe_text(family.get("label"))
    return {
        "key": key,
        "label": canonical_label or label or "",
    }


def _workspace_context_payload(context: ContractorWorkspaceContext | None) -> dict[str, Any]:
    family = normalize_project_family(
        {
            "project_family_key": getattr(context, "default_project_family_key", "") if context else "",
            "project_family_label": getattr(context, "default_project_family_label", "") if context else "",
        }
    )
    return {
        "project_family": family,
        "source": "server",
        "updated_at": context.context_updated_at.isoformat() if context and context.context_updated_at else None,
    }


def get_workspace_context(contractor: Contractor | None) -> dict[str, Any]:
    if contractor is None:
        return {
            "project_family": {"key": "", "label": ""},
            "source": "server",
            "updated_at": None,
        }

    context = (
        ContractorWorkspaceContext.objects.filter(contractor=contractor)
        .only(
            "id",
            "contractor_id",
            "default_project_family_key",
            "default_project_family_label",
            "context_updated_at",
            "created_at",
            "updated_at",
        )
        .first()
    )
    return _workspace_context_payload(context)


@dataclass
class WorkspaceContextUpdateResult:
    context: ContractorWorkspaceContext
    payload: dict[str, Any]


def update_workspace_context(
    contractor: Contractor | None,
    *,
    project_family: Any = None,
) -> WorkspaceContextUpdateResult | None:
    if contractor is None:
        return None

    normalized_family = normalize_project_family(project_family)
    context, created = ContractorWorkspaceContext.objects.get_or_create(
        contractor=contractor,
        defaults={
            "default_project_family_key": normalized_family["key"],
            "default_project_family_label": normalized_family["label"],
            "context_updated_at": timezone.now(),
        },
    )

    next_key = normalized_family["key"]
    next_label = normalized_family["label"]
    current_key = _safe_text(context.default_project_family_key)
    current_label = _safe_text(context.default_project_family_label)

    changed = created or current_key != next_key or current_label != next_label
    if changed:
        context.default_project_family_key = next_key
        context.default_project_family_label = next_label
        context.context_updated_at = timezone.now()
        context.save(
            update_fields=[
                "default_project_family_key",
                "default_project_family_label",
                "context_updated_at",
                "updated_at",
            ]
        )
    payload = _workspace_context_payload(context)
    return WorkspaceContextUpdateResult(context=context, payload=payload)
