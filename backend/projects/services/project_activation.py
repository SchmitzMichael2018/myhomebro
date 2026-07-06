from __future__ import annotations

from decimal import Decimal
from typing import Any

from projects.models import (
    Agreement,
    ContractorSubAccount,
    EmployeeCapability,
    EmployeeWorkSchedule,
)


def _money(value: Any) -> Decimal:
    try:
        return Decimal(str(value or "0")).quantize(Decimal("0.01"))
    except Exception:
        return Decimal("0.00")


def _date_iso(value: Any) -> str:
    if not value:
        return ""
    try:
        return value.isoformat()
    except Exception:
        return str(value)[:10]


def _status(label: str, ready: bool, *, detail: str = "", blocker: bool = False) -> dict[str, Any]:
    return {
        "label": label,
        "ready": bool(ready),
        "status": "ready" if ready else "blocked" if blocker else "warning",
        "detail": detail,
    }


def _project_title(agreement: Agreement) -> str:
    project = getattr(agreement, "project", None)
    return (
        getattr(project, "title", "")
        or getattr(agreement, "project_title", "")
        or getattr(agreement, "title", "")
        or f"Agreement #{agreement.id}"
    )


def _signature_ready(agreement: Agreement) -> bool:
    value = getattr(agreement, "signature_is_satisfied", False)
    return bool(value() if callable(value) else value)


def _crew_needs_from_planning(agreement: Agreement) -> list[dict[str, Any]]:
    planning = getattr(agreement, "planning_assumptions", None) or {}
    raw_mix = planning.get("planning_capability_mix") or planning.get("recommended_capability_mix") or []
    if not isinstance(raw_mix, list):
        raw_mix = []

    contractor = getattr(agreement, "contractor", None)
    capability_counts: dict[str, int] = {}
    if contractor is not None:
        qs = (
            EmployeeCapability.objects.filter(
                subaccount__parent_contractor=contractor,
                subaccount__is_active=True,
            )
            .select_related("skill")
            .values_list("skill__name", flat=True)
        )
        for name in qs:
            key = str(name or "").strip().lower()
            if key:
                capability_counts[key] = capability_counts.get(key, 0) + 1

    needs = []
    for item in raw_mix:
        if not isinstance(item, dict):
            continue
        capability = str(item.get("capability") or "").strip()
        if not capability:
            continue
        try:
            count = max(0, int(float(item.get("count") or 0)))
        except (TypeError, ValueError):
            count = 0
        available = capability_counts.get(capability.lower(), 0)
        needs.append(
            {
                "capability": capability,
                "needed": count,
                "available": available,
                "gap": max(0, count - available),
                "status": "ready" if available >= count else "gap",
            }
        )
    return needs


def build_activation_preview(agreement: Agreement) -> dict[str, Any]:
    """
    Read-only project activation preview.

    This intentionally does not create assignments, schedules, reservations, calendar
    entries, payments, signatures, PDFs, or customer-visible status changes.
    """
    planning = getattr(agreement, "planning_assumptions", None) or {}
    milestones = list(getattr(agreement, "milestones").all()) if hasattr(getattr(agreement, "milestones", None), "all") else []
    signature_ready = _signature_ready(agreement)
    is_direct_pay = bool(getattr(agreement, "is_direct_pay", False))
    escrow_funded = bool(getattr(agreement, "escrow_funded", False))
    funding_ready = is_direct_pay or escrow_funded
    contractor = getattr(agreement, "contractor", None)
    incidentals_amount = _money(getattr(agreement, "incidentals_reserve_amount", 0))
    attachment_count = 0
    homeowner_visible_attachment_count = 0
    try:
        attachment_qs = getattr(agreement, "attachments")
        attachment_count = attachment_qs.count()
        homeowner_visible_attachment_count = attachment_qs.filter(visible_to_homeowner=True).count()
    except Exception:
        attachment_count = int(getattr(agreement, "attachments_count", 0) or 0)
        homeowner_visible_attachment_count = attachment_count

    active_employee_count = 0
    schedule_count = 0
    if contractor is not None:
        active_employee_count = ContractorSubAccount.objects.filter(
            parent_contractor=contractor,
            is_active=True,
        ).count()
        schedule_count = EmployeeWorkSchedule.objects.filter(
            subaccount__parent_contractor=contractor,
            subaccount__is_active=True,
        ).count()

    suggested_start = (
        planning.get("planned_start_date")
        or planning.get("recommended_start_date")
        or _date_iso(getattr(agreement, "start", None))
    )
    suggested_finish = (
        planning.get("planned_finish_date")
        or planning.get("recommended_finish_date")
        or _date_iso(getattr(agreement, "end", None))
    )

    checklist = [
        _status(
            "Agreement signed",
            signature_ready,
            detail="Signature requirements are satisfied." if signature_ready else "Agreement must be signed before activation.",
            blocker=True,
        ),
        _status(
            "Funding ready",
            funding_ready,
            detail=(
                "Direct Pay agreement; escrow funding is not required."
                if is_direct_pay
                else "Escrow funding is complete."
                if escrow_funded
                else "Escrow funding is required before activation."
            ),
            blocker=not funding_ready,
        ),
        _status(
            "Milestones available",
            bool(milestones),
            detail=f"{len(milestones)} milestone{'s' if len(milestones) != 1 else ''} available." if milestones else "Add at least one milestone before activation.",
            blocker=True,
        ),
        _status(
            "Planning assumptions saved",
            bool(planning),
            detail="Agreement Wizard planning assumptions are available." if planning else "No saved planning assumptions yet.",
        ),
        _status(
            "Workforce available",
            active_employee_count > 0,
            detail=f"{active_employee_count} active employee{'s' if active_employee_count != 1 else ''} available." if active_employee_count else "No active employees found for workforce planning.",
        ),
        _status(
            "Documents/photos attached",
            attachment_count > 0,
            detail=f"{attachment_count} agreement attachment{'s' if attachment_count != 1 else ''} found." if attachment_count else "No agreement attachments found.",
        ),
    ]

    blockers = [
        {"type": item["label"].lower().replace(" ", "_"), "message": item["detail"]}
        for item in checklist
        if item["status"] == "blocked"
    ]
    warnings = [
        {"type": item["label"].lower().replace(" ", "_"), "message": item["detail"]}
        for item in checklist
        if item["status"] == "warning"
    ]

    if incidentals_amount > 0:
        warnings.append(
            {
                "type": "incidentals_reserve",
                "message": f"Incidentals Reserve configured at ${incidentals_amount:.2f}; track expense usage separately from milestones.",
            }
        )
    if active_employee_count > 0 and schedule_count == 0:
        warnings.append(
            {
                "type": "employee_availability",
                "message": "Active employees exist, but no employee work schedules are configured yet.",
            }
        )

    milestone_rows = []
    material_notes = []
    for milestone in milestones:
        material_hint = str(getattr(milestone, "materials_hint", "") or "").strip()
        if material_hint:
            material_notes.append(
                {
                    "milestone_id": milestone.id,
                    "milestone_title": getattr(milestone, "title", "") or f"Milestone #{milestone.id}",
                    "note": material_hint,
                }
            )
        milestone_rows.append(
            {
                "id": milestone.id,
                "order": getattr(milestone, "order", None),
                "title": getattr(milestone, "title", "") or f"Milestone #{milestone.id}",
                "start_date": _date_iso(getattr(milestone, "start_date", None)),
                "completion_date": _date_iso(getattr(milestone, "completion_date", None)),
                "duration_days": getattr(milestone, "recommended_duration_days", None),
                "amount": str(getattr(milestone, "amount", "") or ""),
                "materials_hint": material_hint,
                "completed": bool(getattr(milestone, "completed", False)),
            }
        )

    crew_needs = _crew_needs_from_planning(agreement)
    for need in crew_needs:
        if need["gap"] > 0:
            warnings.append(
                {
                    "type": "capability_gap",
                    "message": f"{need['capability']} needs {need['needed']} but only {need['available']} active employee capability match(es) were found.",
                }
            )

    return {
        "agreement_id": agreement.id,
        "preview_only": True,
        "advisory_notice": "Preview only. No assignments or schedules are created.",
        "source_summary": {
            "title": _project_title(agreement),
            "status": getattr(agreement, "status", ""),
            "payment_mode": getattr(agreement, "payment_mode", ""),
            "signature_ready": signature_ready,
            "funding_ready": funding_ready,
            "escrow_funded": escrow_funded,
            "incidentals_reserve_amount": f"{incidentals_amount:.2f}",
        },
        "readiness_checklist": checklist,
        "blockers": blockers,
        "warnings": warnings,
        "suggested_schedule": {
            "start_date": suggested_start or "",
            "finish_date": suggested_finish or "",
            "duration_days": planning.get("planned_duration_days") or planning.get("estimated_total_working_days") or None,
            "include_weekends": bool(planning.get("include_weekends", False)),
            "priority": planning.get("planning_priority") or "",
            "confidence": planning.get("planning_confidence"),
        },
        "milestone_timeline_summary": milestone_rows,
        "crew_capability_needs": crew_needs,
        "material_readiness_notes": material_notes
        or [
            {
                "note": "No milestone material hints found. Review materials before activation if this project requires ordering or customer selections."
            }
        ],
        "document_summary": {
            "attachment_count": attachment_count,
            "customer_visible_attachment_count": homeowner_visible_attachment_count,
        },
        "planning_assumptions": planning,
        "customer_visible_launch_summary_preview": {
            "headline": f"{_project_title(agreement)} is being prepared for project kickoff.",
            "start_date": suggested_start or "",
            "finish_date": suggested_finish or "",
            "message": (
                "Your contractor is preparing the project schedule and kickoff details."
                if not blockers
                else "Your contractor is reviewing project readiness before kickoff."
            ),
            "milestone_count": len(milestones),
        },
    }
