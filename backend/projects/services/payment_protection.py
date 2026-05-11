from __future__ import annotations

from typing import Any

from projects.models import InspectionStatus
from projects.services.milestone_roles import detect_restricted_trade_categories, milestone_safety_labels


def _safe_text(value: Any) -> str:
    return "" if value is None else str(value).strip()


def _normalize_mode(value: Any) -> str:
    return _safe_text(value).lower().replace("-", "_").replace(" ", "_")


def build_payment_protection_summary(*, project_mode: Any = "", payment_preference: Any = "", milestones: list[Any] | None = None) -> dict[str, Any]:
    mode = _normalize_mode(project_mode)
    preference = _normalize_mode(payment_preference) or "escrow"
    rows = list(milestones or [])

    restricted = []
    inspection_needed = False
    assisted_work = False
    for row in rows:
        labels = milestone_safety_labels(
            project_mode=mode,
            title=getattr(row, "title", ""),
            description=getattr(row, "description", ""),
            normalized_milestone_type=getattr(row, "normalized_milestone_type", ""),
            milestone_role=getattr(row, "milestone_role", ""),
        )
        restricted.extend(detect_restricted_trade_categories(
            getattr(row, "title", ""),
            getattr(row, "description", ""),
            getattr(row, "normalized_milestone_type", ""),
            project_mode=mode,
        ))
        if InspectionStatus.NOT_REQUESTED != getattr(row, "inspection_status", InspectionStatus.NOT_REQUESTED):
            inspection_needed = True
        if getattr(row, "milestone_role", "") in {"homeowner_task", "shared_task"}:
            assisted_work = True
        if "Inspection Recommended" in labels:
            inspection_needed = True

    if mode in {"inspection_only"} or restricted:
        level = "required"
        label = "Escrow Required"
        reason = "Inspection and high-risk trade phases benefit from protected milestone payments."
    elif mode in {"assisted_diy", "consultation"} or assisted_work or preference == "discuss":
        level = "recommended"
        label = "Escrow Recommended"
        reason = "Collaborative projects are usually best protected with milestone-based escrow."
    else:
        level = "preferred"
        label = "Escrow Preferred"
        reason = "Escrow milestone payments help protect both homeowners and contractors."

    return {
        "payment_preference": preference,
        "label": label,
        "level": level,
        "reason": reason,
        "requires_escrow": level == "required",
        "recommended_payment_mode": "escrow" if level == "required" or preference != "direct" else "direct",
        "inspection_checkpoints": inspection_needed,
    }
