from __future__ import annotations

from collections import defaultdict
from datetime import datetime
from typing import Any, Iterable, Optional

from projects.models import Agreement, Milestone, InspectionStatus
from projects.services.milestone_roles import (
    MILESTONE_ROLE_CONTRACTOR_TASK,
    MILESTONE_ROLE_HOMEOWNER_TASK,
    MILESTONE_ROLE_INSPECTION_CHECKPOINT,
    MILESTONE_ROLE_SHARED_TASK,
    milestone_safety_labels,
    normalize_milestone_role,
)


def _safe_text(value: Any) -> str:
    return "" if value is None else str(value).strip()


def _normalize_mode(value: Any) -> str:
    return _safe_text(value).lower().replace("-", "_").replace(" ", "_")


def _fmt_dt(value: Any) -> Optional[str]:
    if not value:
        return None
    try:
        if isinstance(value, datetime):
            return value.isoformat()
        return value.isoformat()
    except Exception:
        s = _safe_text(value)
        return s or None


def _milestones_for_agreement(agreement: Agreement, milestones: Optional[Iterable[Milestone]] = None) -> list[Milestone]:
    if milestones is not None:
        return list(milestones)
    try:
        return list(
            agreement.milestones.select_related("agreement")
            .all()
            .order_by("order", "id")
        )
    except Exception:
        return []


def _milestone_role(milestone: Milestone, project_mode: str) -> str:
    raw = normalize_milestone_role(getattr(milestone, "milestone_role", ""))
    if raw:
        return raw
    title = _safe_text(getattr(milestone, "title", ""))
    description = _safe_text(getattr(milestone, "description", ""))
    text = f"{title} {description}".strip()
    if "inspect" in text.lower() or "walkthrough" in text.lower() or "review" in text.lower():
        return MILESTONE_ROLE_INSPECTION_CHECKPOINT
    if project_mode == "inspection_only":
        return MILESTONE_ROLE_INSPECTION_CHECKPOINT
    if project_mode == "assisted_diy":
        if any(word in text.lower() for word in ("prep", "cleanup", "demo", "demolition", "staging", "painting")):
            return MILESTONE_ROLE_HOMEOWNER_TASK
        if any(word in text.lower() for word in ("shared", "plan", "coordination", "review")):
            return MILESTONE_ROLE_SHARED_TASK
    return MILESTONE_ROLE_CONTRACTOR_TASK


def _milestone_labels(milestone: Milestone, project_mode: str) -> list[str]:
    return milestone_safety_labels(
        project_mode=project_mode,
        title=_safe_text(getattr(milestone, "title", "")),
        description=_safe_text(getattr(milestone, "description", "")),
        normalized_milestone_type=_safe_text(getattr(milestone, "normalized_milestone_type", "")),
        milestone_role=_milestone_role(milestone, project_mode),
    )


def build_responsibility_matrix(
    agreement: Agreement,
    milestones: Optional[Iterable[Milestone]] = None,
) -> dict[str, dict[str, Any]]:
    mode = _normalize_mode(getattr(agreement, "project_mode", ""))
    rows = _milestones_for_agreement(agreement, milestones)
    buckets: dict[str, list[Milestone]] = defaultdict(list)
    for milestone in rows:
        buckets[_milestone_role(milestone, mode)].append(milestone)

    def _section(key: str, title: str, summary: str) -> dict[str, Any]:
        items = buckets.get(key, [])
        return {
            "title": title,
            "count": len(items),
            "summary": summary,
            "milestones": [
                {
                    "id": getattr(m, "id", None),
                    "title": _safe_text(getattr(m, "title", "")) or "Milestone",
                    "role": _milestone_role(m, mode),
                    "safety_labels": _milestone_labels(m, mode),
                    "completed": bool(getattr(m, "completed", False)),
                    "inspection_status": _safe_text(getattr(m, "inspection_status", "")) or InspectionStatus.NOT_REQUESTED,
                }
                for m in items[:8]
            ],
        }

    return {
        "homeowner_responsibilities": _section(
            MILESTONE_ROLE_HOMEOWNER_TASK,
            "Homeowner Responsibilities",
            _safe_text(getattr(agreement, "homeowner_responsibilities", "")) or "Homeowner-safe prep, cleanup, staging, or other agreed participation.",
        ),
        "contractor_responsibilities": _section(
            MILESTONE_ROLE_CONTRACTOR_TASK,
            "Contractor Responsibilities",
            _safe_text(getattr(agreement, "contractor_responsibilities", "")) or "Licensed or contractor-led work remains contractor responsible.",
        ),
        "shared_responsibilities": _section(
            MILESTONE_ROLE_SHARED_TASK,
            "Shared Responsibilities",
            "Collaborative planning, coordination, or jointly supervised tasks.",
        ),
        "excluded_work": _section(
            MILESTONE_ROLE_INSPECTION_CHECKPOINT,
            "Excluded Work",
            _safe_text(getattr(agreement, "excluded_work", "")) or "Restricted work remains contractor-led or excluded from homeowner task assignment.",
        ),
    }


def build_homeowner_acknowledgements(agreement: Agreement, milestones: Optional[Iterable[Milestone]] = None) -> list[dict[str, Any]]:
    mode = _normalize_mode(getattr(agreement, "project_mode", ""))
    rows = _milestones_for_agreement(agreement, milestones)
    needs_collaboration = mode in {"assisted_diy", "consultation", "inspection_only"}
    if not needs_collaboration:
        return []

    has_restricted = any(
        "Licensed Trade Work" in (_milestone_labels(m, mode) or [])
        for m in rows
    )
    homeowner_signed_at = _fmt_dt(getattr(agreement, "signed_at_homeowner", None) or getattr(agreement, "homeowner_signed_at", None))
    contractor_ack_at = _fmt_dt(getattr(agreement, "contractor_ack_at", None))
    shared_ack_at = homeowner_signed_at or contractor_ack_at

    return [
        {
            "key": "homeowner_participation",
            "label": "Homeowner Participation",
            "required": True,
            "acknowledged": bool(shared_ack_at),
            "acknowledged_at": shared_ack_at,
            "detail": "Homeowner participation is limited to the agreed non-restricted activities.",
        },
        {
            "key": "restricted_work",
            "label": "Restricted Work",
            "required": has_restricted,
            "acknowledged": bool(shared_ack_at or not has_restricted),
            "acknowledged_at": shared_ack_at if has_restricted else None,
            "detail": "Licensed or higher-risk trade phases remain contractor-led unless the agreement states otherwise.",
        },
        {
            "key": "safety",
            "label": "Safety Acknowledgement",
            "required": True,
            "acknowledged": bool(shared_ack_at),
            "acknowledged_at": shared_ack_at,
            "detail": "Safety guidance and site rules were reviewed before collaborative work proceeds.",
        },
        {
            "key": "contractor_supervised",
            "label": "Contractor-Supervised Work",
            "required": mode == "assisted_diy",
            "acknowledged": bool(contractor_ack_at or shared_ack_at),
            "acknowledged_at": contractor_ack_at or shared_ack_at,
            "detail": "Assisted DIY work is contractor supervised and may be paused if unsafe conditions arise.",
        },
        {
            "key": "licensed_trade",
            "label": "Licensed-Trade Acknowledgement",
            "required": has_restricted,
            "acknowledged": bool(contractor_ack_at or shared_ack_at),
            "acknowledged_at": contractor_ack_at or shared_ack_at if has_restricted else None,
            "detail": "Some project phases may require licensed professionals depending on local law and scope.",
        },
    ]


def build_inspection_summary(agreement: Agreement, milestones: Optional[Iterable[Milestone]] = None) -> dict[str, Any]:
    rows = _milestones_for_agreement(agreement, milestones)
    inspection_rows = []
    requested = passed = revisions = 0
    for milestone in rows:
        status = _safe_text(getattr(milestone, "inspection_status", "")) or InspectionStatus.NOT_REQUESTED
        if status == InspectionStatus.NOT_REQUESTED:
            continue
        if status == InspectionStatus.REQUESTED:
            requested += 1
        elif status == InspectionStatus.PASSED:
            passed += 1
        elif status == InspectionStatus.REVISION_REQUIRED:
            revisions += 1
        inspection_rows.append(
            {
                "id": getattr(milestone, "id", None),
                "title": _safe_text(getattr(milestone, "title", "")) or "Milestone",
                "status": status,
                "status_label": str(status).replace("_", " ").title(),
                "notes": _safe_text(getattr(milestone, "inspection_notes", "")),
                "requested_at": _fmt_dt(getattr(milestone, "inspection_requested_at", None)),
                "reviewed_at": _fmt_dt(getattr(milestone, "inspection_reviewed_at", None)),
            }
        )
    return {
        "requested_count": requested,
        "passed_count": passed,
        "revision_required_count": revisions,
        "items": inspection_rows[:12],
    }


def build_rescue_project_summary(agreement: Agreement, milestones: Optional[Iterable[Milestone]] = None) -> dict[str, Any]:
    rows = _milestones_for_agreement(agreement, milestones)
    description = " ".join(
        filter(
            None,
            [
                _safe_text(getattr(agreement, "description", "")),
                _safe_text(getattr(agreement, "homeowner_participation_notes", "")),
                _safe_text(getattr(agreement, "project_type", "")),
                _safe_text(getattr(agreement, "project_subtype", "")),
            ],
        )
    ).lower()
    rescue_terms = ("already started", "need help finishing", "finish", "partial", "rescue", "takeover")
    is_rescue = any(term in description for term in rescue_terms)
    completed = sum(1 for m in rows if bool(getattr(m, "completed", False)))
    remaining = max(0, len(rows) - completed)
    summary = "Project already started; contractor-assisted completion and takeover notes apply." if is_rescue else ""
    if not summary and completed and remaining:
        summary = f"{completed} of {len(rows)} milestones are complete; {remaining} remain."
    return {
        "is_rescue_project": is_rescue,
        "summary": summary,
        "completed_count": completed,
        "remaining_count": remaining,
        "takeover_notes": _safe_text(getattr(agreement, "homeowner_participation_notes", "")),
        "contractor_takeover_notes": _safe_text(getattr(agreement, "contractor_responsibilities", "")),
    }


def build_collaboration_summary(agreement: Agreement, milestones: Optional[Iterable[Milestone]] = None) -> dict[str, Any]:
    mode = _normalize_mode(getattr(agreement, "project_mode", ""))
    matrix = build_responsibility_matrix(agreement, milestones)
    inspections = build_inspection_summary(agreement, milestones)
    rescue = build_rescue_project_summary(agreement, milestones)
    rows = _milestones_for_agreement(agreement, milestones)

    homeowner_count = int(matrix["homeowner_responsibilities"].get("count", 0) or 0)
    contractor_count = int(matrix["contractor_responsibilities"].get("count", 0) or 0)
    shared_count = int(matrix["shared_responsibilities"].get("count", 0) or 0)
    inspection_count = int(matrix["excluded_work"].get("count", 0) or 0)

    summary_parts = []
    if mode == "assisted_diy":
        summary_parts.append("Assisted DIY collaboration is active.")
    elif mode == "consultation":
        summary_parts.append("Consultation and guidance mode is active.")
    elif mode == "inspection_only":
        summary_parts.append("Inspection-only workflow is active.")
    else:
        summary_parts.append("Full-service workflow is active.")

    summary_parts.append(
        f"{homeowner_count} homeowner task(s), {contractor_count} contractor task(s), {shared_count} shared task(s), and {inspection_count} inspection checkpoint(s)."
    )
    if inspections["requested_count"]:
        summary_parts.append(f"{inspections['requested_count']} inspection request(s) are open or pending.")
    if rescue["is_rescue_project"] and rescue["summary"]:
        summary_parts.append(rescue["summary"])

    return {
        "project_mode": mode or "full_service",
        "project_mode_label": str(getattr(agreement, "get_project_mode_display", lambda: "")() or mode or "Full Service"),
        "summary": " ".join(summary_parts).strip(),
        "responsibility_matrix": matrix,
        "homeowner_acknowledgements": build_homeowner_acknowledgements(agreement, rows),
        "inspection_summary": inspections,
        "rescue_project_summary": rescue,
        "inspection_checkpoints": inspections["items"],
    }


def build_assisted_diy_snapshot(agreement: Agreement, milestones: Optional[Iterable[Milestone]] = None) -> dict[str, Any]:
    snapshot = build_collaboration_summary(agreement, milestones)
    return snapshot
