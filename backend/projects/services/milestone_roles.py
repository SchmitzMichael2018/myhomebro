from __future__ import annotations

from typing import Any, Iterable


MILESTONE_ROLE_HOMEOWNER_TASK = "homeowner_task"
MILESTONE_ROLE_CONTRACTOR_TASK = "contractor_task"
MILESTONE_ROLE_SHARED_TASK = "shared_task"
MILESTONE_ROLE_INSPECTION_CHECKPOINT = "inspection_checkpoint"

MILESTONE_ROLE_CHOICES = (
    (MILESTONE_ROLE_HOMEOWNER_TASK, "Homeowner Task"),
    (MILESTONE_ROLE_CONTRACTOR_TASK, "Contractor Task"),
    (MILESTONE_ROLE_SHARED_TASK, "Shared Task"),
    (MILESTONE_ROLE_INSPECTION_CHECKPOINT, "Inspection Checkpoint"),
)

ROLE_LABELS = {key: label for key, label in MILESTONE_ROLE_CHOICES}


def _safe_text(value: Any) -> str:
    return "" if value is None else str(value).strip()


def normalize_milestone_role(value: Any) -> str:
    raw = _safe_text(value).lower().replace("-", "_").replace(" ", "_")
    if raw in {MILESTONE_ROLE_HOMEOWNER_TASK, "homeowner"}:
        return MILESTONE_ROLE_HOMEOWNER_TASK
    if raw in {MILESTONE_ROLE_CONTRACTOR_TASK, "contractor"}:
        return MILESTONE_ROLE_CONTRACTOR_TASK
    if raw in {MILESTONE_ROLE_SHARED_TASK, "shared"}:
        return MILESTONE_ROLE_SHARED_TASK
    if raw in {MILESTONE_ROLE_INSPECTION_CHECKPOINT, "inspection", "inspection_checkpoint", "inspectioncheckpoint"}:
        return MILESTONE_ROLE_INSPECTION_CHECKPOINT
    return ""


def milestone_role_label(value: Any) -> str:
    normalized = normalize_milestone_role(value)
    return ROLE_LABELS.get(normalized, "")


def _text_blob(*parts: Any) -> str:
    return " ".join(_safe_text(part).lower() for part in parts if _safe_text(part)).strip()


def infer_milestone_role(
    *,
    project_mode: Any = "",
    title: Any = "",
    description: Any = "",
    normalized_milestone_type: Any = "",
) -> str:
    mode = _safe_text(project_mode).lower().replace("-", "_").replace(" ", "_")
    text = _text_blob(title, description, normalized_milestone_type)

    if mode == "inspection_only":
        return MILESTONE_ROLE_INSPECTION_CHECKPOINT
    if mode == "consultation":
        return MILESTONE_ROLE_SHARED_TASK

    if mode == "assisted_diy":
        if any(term in text for term in ("inspect", "inspection", "review", "walkthrough", "final check", "checkup")):
            return MILESTONE_ROLE_INSPECTION_CHECKPOINT
        if any(
            term in text
            for term in (
                "homeowner",
                "prep",
                "preparation",
                "materials",
                "cleanup",
                "cleanup",
                "remove",
                "removal",
                "demolition",
                "demo",
                "paint",
                "painting",
                "install flooring",
                "demo and prep",
                "staging",
            )
        ):
            return MILESTONE_ROLE_HOMEOWNER_TASK
        if any(term in text for term in ("shared", "coordination", "planning", "approval", "consult", "review")):
            return MILESTONE_ROLE_SHARED_TASK
        if any(term in text for term in ("install", "replace", "rough", "finish", "repair", "service", "technical", "code")):
            return MILESTONE_ROLE_CONTRACTOR_TASK
        return MILESTONE_ROLE_SHARED_TASK

    if any(term in text for term in ("inspection", "review", "walkthrough", "final check")):
        return MILESTONE_ROLE_INSPECTION_CHECKPOINT
    return MILESTONE_ROLE_CONTRACTOR_TASK


def annotate_milestone_role(row: dict[str, Any], *, project_mode: Any = "") -> dict[str, Any]:
    next_row = dict(row or {})
    inferred = infer_milestone_role(
        project_mode=project_mode,
        title=next_row.get("title"),
        description=next_row.get("description"),
        normalized_milestone_type=next_row.get("normalized_milestone_type"),
    )
    next_row["milestone_role"] = normalize_milestone_role(next_row.get("milestone_role")) or inferred
    return next_row


def annotate_milestone_roles(rows: Iterable[dict[str, Any]], *, project_mode: Any = "") -> list[dict[str, Any]]:
    return [annotate_milestone_role(row, project_mode=project_mode) for row in rows or []]
