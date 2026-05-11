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

LICENSED_TRADE_LABEL = "Licensed Trade Work"
CONTRACTOR_REQUIRED_LABEL = "Contractor Required"
INSPECTION_RECOMMENDED_LABEL = "Inspection Recommended"

RESTRICTED_TRADE_PATTERNS = {
    "electrical panel/service work": (
        "electrical panel",
        "service panel",
        "breaker panel",
        "main panel",
        "panel upgrade",
        "service upgrade",
        "breaker box",
        "subpanel",
        "rewire",
        "rewiring",
        "live wire",
        "live wiring",
        "hot wire",
    ),
    "gas line work": (
        "gas line",
        "gas pipe",
        "gas fitting",
        "natural gas",
        "propane line",
    ),
    "hvac refrigerant handling": (
        "refrigerant",
        "freon",
        "evacuate",
        "charge ac",
        "charge refrigerant",
        "mini split charge",
    ),
    "hvac electrical integration": (
        "hvac electrical",
        "thermostat wiring",
        "heat pump wiring",
        "furnace wiring",
        "air handler wiring",
    ),
    "sewer main work": (
        "sewer main",
        "sewer lateral",
        "main sewer",
        "sewer replacement",
        "sewer line",
    ),
    "structural / load-bearing work": (
        "load-bearing",
        "load bearing",
        "structural",
        "structural beam",
        "bearing wall",
        "support wall",
        "foundation modification",
        "foundation repair",
        "footing",
        "joist sister",
    ),
    "steep / high-risk roofing": (
        "steep roof",
        "high roof",
        "roof pitch",
        "roofing heights",
        "roof access",
        "roof replacement",
        "roof tear off",
    ),
    "fire suppression systems": (
        "sprinkler",
        "fire suppression",
        "fire sprinkler",
    ),
    "major code-critical system modifications": (
        "service change",
        "system modification",
        "major code",
        "code-critical",
        "code critical",
        "rough in",
    ),
}

HOMEOWNER_SAFE_PATTERNS = (
    "demo",
    "demolition",
    "cleanup",
    "clean up",
    "prep",
    "preparation",
    "painting",
    "paint",
    "material staging",
    "materials staging",
    "flooring prep",
    "landscaping",
    "trim work",
    "cabinet assembly",
    "assembly",
)

INSPECTION_PATTERNS = (
    "inspect",
    "inspection",
    "review",
    "walkthrough",
    "final check",
    "final inspection",
)


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


def _contains_any(text: str, needles: Iterable[str]) -> bool:
    return any(_safe_text(needle).lower() in _safe_text(text).lower() for needle in needles)


def detect_restricted_trade_categories(
    *parts: Any,
    project_mode: Any = "",
) -> list[str]:
    text = _text_blob(*parts)
    if not text:
        return []

    labels: list[str] = []
    for label, patterns in RESTRICTED_TRADE_PATTERNS.items():
        if _contains_any(text, patterns):
            labels.append(label)

    mode = _safe_text(project_mode).lower().replace("-", "_").replace(" ", "_")
    if mode == "inspection_only" and "inspection / review" not in labels:
        labels.append("inspection / review")
    return labels


def requires_licensed_professional(*parts: Any, project_mode: Any = "") -> bool:
    return bool(detect_restricted_trade_categories(*parts, project_mode=project_mode))


def milestone_safety_labels(
    *,
    project_mode: Any = "",
    title: Any = "",
    description: Any = "",
    normalized_milestone_type: Any = "",
    milestone_role: Any = "",
) -> list[str]:
    text = _text_blob(title, description, normalized_milestone_type)
    mode = _safe_text(project_mode).lower().replace("-", "_").replace(" ", "_")
    role = normalize_milestone_role(milestone_role)
    labels: list[str] = []
    restricted = detect_restricted_trade_categories(text, project_mode=project_mode)

    if restricted:
        labels.append(LICENSED_TRADE_LABEL)
        if CONTRACTOR_REQUIRED_LABEL not in labels:
            labels.append(CONTRACTOR_REQUIRED_LABEL)

    if mode == "inspection_only" or role == MILESTONE_ROLE_INSPECTION_CHECKPOINT or _contains_any(text, INSPECTION_PATTERNS):
        if INSPECTION_RECOMMENDED_LABEL not in labels:
            labels.append(INSPECTION_RECOMMENDED_LABEL)

    if mode == "assisted_diy" and role == MILESTONE_ROLE_CONTRACTOR_TASK and CONTRACTOR_REQUIRED_LABEL not in labels:
        labels.append(CONTRACTOR_REQUIRED_LABEL)

    return labels


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
        if _contains_any(text, INSPECTION_PATTERNS):
            return MILESTONE_ROLE_INSPECTION_CHECKPOINT
        if detect_restricted_trade_categories(text, project_mode=mode):
            return MILESTONE_ROLE_CONTRACTOR_TASK
        if _contains_any(text, ("homeowner", *HOMEOWNER_SAFE_PATTERNS, "remove", "removal")):
            return MILESTONE_ROLE_HOMEOWNER_TASK
        if _contains_any(text, ("shared", "coordination", "planning", "approval", "consult", "review")):
            return MILESTONE_ROLE_SHARED_TASK
        if _contains_any(text, ("install", "replace", "rough", "finish", "repair", "service", "technical", "code", "trade work")):
            return MILESTONE_ROLE_CONTRACTOR_TASK
        return MILESTONE_ROLE_SHARED_TASK

    if _contains_any(text, INSPECTION_PATTERNS):
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
    next_row["milestone_safety_labels"] = milestone_safety_labels(
        project_mode=project_mode,
        title=next_row.get("title"),
        description=next_row.get("description"),
        normalized_milestone_type=next_row.get("normalized_milestone_type"),
        milestone_role=next_row.get("milestone_role"),
    )
    return next_row


def annotate_milestone_roles(rows: Iterable[dict[str, Any]], *, project_mode: Any = "") -> list[dict[str, Any]]:
    return [annotate_milestone_role(row, project_mode=project_mode) for row in rows or []]
