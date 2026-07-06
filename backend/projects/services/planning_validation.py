from __future__ import annotations

from datetime import date, datetime, timedelta

from django.db.models import Q
from django.utils import timezone

from projects.models import (
    Agreement,
    AgreementAssignment,
    Contractor,
    ContractorSubAccount,
    EmployeeCapability,
    Milestone,
    MilestoneAssignment,
    ProjectStatus,
)


STATUS_VALIDATED = "validated"
STATUS_NEEDS_REVIEW = "needs_review"
STATUS_HARD_CONFLICT = "hard_conflict"

UNSIGNED_PIPELINE_STATUSES = {
    "",
    ProjectStatus.DRAFT,
    "sent",
    "pending",
    "pending_signature",
    "awaiting_signature",
    "pending_approval",
    "awaiting_approval",
    "submitted",
    "in_review",
    "review",
}

COMMITTED_STATUSES = {
    ProjectStatus.SIGNED,
    ProjectStatus.FUNDED,
    "active",
    "in_progress",
}


def _date(value):
    if not value:
        return None
    if isinstance(value, date) and not isinstance(value, datetime):
        return value
    if hasattr(value, "date") and not isinstance(value, str):
        try:
            return value.date()
        except Exception:
            pass
    if hasattr(value, "isoformat") and not isinstance(value, str):
        return value
    text = str(value)[:10]
    try:
        return datetime.fromisoformat(text).date()
    except Exception:
        return None


def _agreement_title(agreement: Agreement) -> str:
    project = getattr(agreement, "project", None)
    return (
        getattr(project, "title", "")
        or getattr(agreement, "title", "")
        or getattr(agreement, "project_title_snapshot", "")
        or f"Agreement #{agreement.id}"
    )


def _contractor_for(agreement: Agreement):
    return getattr(agreement, "contractor", None) or getattr(getattr(agreement, "project", None), "contractor", None)


def _is_committed(agreement: Agreement) -> bool:
    status = str(getattr(agreement, "status", "") or "").lower()
    return (
        status in COMMITTED_STATUSES
        or bool(getattr(agreement, "escrow_funded", False))
        or bool(getattr(agreement, "signature_is_satisfied", False))
    )


def _is_unsigned_pipeline(agreement: Agreement) -> bool:
    if _is_committed(agreement):
        return False
    status = str(getattr(agreement, "status", "") or "").lower()
    if status in {ProjectStatus.COMPLETED, ProjectStatus.CANCELLED, "cancelled", "completed"}:
        return False
    return status in UNSIGNED_PIPELINE_STATUSES or not status


def _range_from_agreement(agreement: Agreement):
    planning = getattr(agreement, "planning_assumptions", None) or {}
    start = _date(planning.get("planned_start_date") or planning.get("recommended_start_date"))
    finish = _date(planning.get("planned_finish_date") or planning.get("recommended_finish_date"))
    start = start or _date(getattr(agreement, "start", None))
    finish = finish or _date(getattr(agreement, "end", None))

    milestones = list(Milestone.objects.filter(agreement=agreement).only("start_date", "completion_date", "recommended_duration_days"))
    milestone_starts = [_date(row.start_date) for row in milestones if _date(row.start_date)]
    milestone_finishes = [_date(row.completion_date) for row in milestones if _date(row.completion_date)]
    if not start and milestone_starts:
        start = min(milestone_starts)
    if not finish and milestone_finishes:
        finish = max(milestone_finishes)
    if start and not finish:
        duration = int(planning.get("planned_duration_days") or 0)
        if duration <= 0:
            duration = sum(int(getattr(row, "recommended_duration_days", 0) or 0) for row in milestones) or 1
        finish = start + timedelta(days=max(duration - 1, 0))
    if finish and not start:
        start = finish
    if start and finish and finish < start:
        start, finish = finish, start
    return start, finish


def _duration_days(start, finish) -> int:
    if not start or not finish:
        return 0
    return max((finish - start).days + 1, 1)


def _overlaps(a_start, a_finish, b_start, b_finish) -> bool:
    if not a_start or not a_finish or not b_start or not b_finish:
        return False
    return a_start <= b_finish and b_start <= a_finish


def _capability_name(item) -> str:
    return str(item.get("capability") or item.get("skill_name") or item.get("skill") or item.get("trade") or "").strip()


def _capability_need_count(item) -> int:
    for key in ("count", "needed", "required", "quantity"):
        try:
            value = int(float(item.get(key) or 0))
        except Exception:
            value = 0
        if value > 0:
            return value
    return 1


def _required_capabilities(agreement: Agreement) -> list[dict]:
    planning = getattr(agreement, "planning_assumptions", None) or {}
    raw_mix = planning.get("planning_capability_mix") or planning.get("recommended_capability_mix") or []
    rows: list[dict] = []
    for item in raw_mix if isinstance(raw_mix, list) else []:
        if not isinstance(item, dict):
            continue
        name = _capability_name(item)
        if not name:
            continue
        rows.append({"capability": name, "needed": _capability_need_count(item)})

    if rows:
        return rows

    crew_size = 0
    try:
        crew_size = int(float(planning.get("planned_crew_size") or planning.get("recommended_crew_size") or 0))
    except Exception:
        crew_size = 0
    if crew_size > 0:
        return [{"capability": "General Labor", "needed": crew_size}]
    return []


def _active_capability_counts(contractor: Contractor) -> dict[str, dict]:
    counts: dict[str, dict] = {}
    qs = (
        EmployeeCapability.objects.select_related("skill", "subaccount")
        .filter(subaccount__parent_contractor=contractor, subaccount__is_active=True)
    )
    for row in qs:
        name = getattr(row.skill, "name", "") or ""
        key = name.strip().lower()
        if not key:
            continue
        bucket = counts.setdefault(key, {"capability": name, "total": 0, "subaccount_ids": set()})
        bucket["total"] += 1
        bucket["subaccount_ids"].add(row.subaccount_id)
    return counts


def _assigned_subaccounts_for_agreements(agreement_ids) -> set[int]:
    ids = set()
    for sub_id in AgreementAssignment.objects.filter(agreement_id__in=agreement_ids).values_list("subaccount_id", flat=True):
        if sub_id:
            ids.add(sub_id)
    for sub_id in MilestoneAssignment.objects.filter(milestone__agreement_id__in=agreement_ids).values_list("subaccount_id", flat=True):
        if sub_id:
            ids.add(sub_id)
    return ids


def _committed_agreements(contractor: Contractor, exclude_id=None):
    qs = Agreement.objects.select_related("project").filter(
        Q(contractor=contractor) | Q(project__contractor=contractor)
    ).exclude(status__in=[ProjectStatus.COMPLETED, ProjectStatus.CANCELLED])
    if exclude_id:
        qs = qs.exclude(id=exclude_id)
    return [row for row in qs if _is_committed(row)]


def _timeline_summary(start, finish, overlaps):
    if not start or not finish:
        return {}
    duration = _duration_days(start, finish)
    latest_finish = None
    for row in overlaps:
        other_finish = _date(row.get("finish_date"))
        if other_finish and (latest_finish is None or other_finish > latest_finish):
            latest_finish = other_finish
    if not latest_finish:
        return {
            "start_date": start.isoformat(),
            "finish_date": finish.isoformat(),
            "duration_days": duration,
        }
    next_start = latest_finish + timedelta(days=1)
    next_finish = next_start + timedelta(days=max(duration - 1, 0))
    return {
        "start_date": next_start.isoformat(),
        "finish_date": next_finish.isoformat(),
        "duration_days": duration,
        "reason": "Move this draft after overlapping signed or funded work.",
    }


def build_planning_validation_summary(agreement: Agreement) -> dict:
    contractor = _contractor_for(agreement)
    start, finish = _range_from_agreement(agreement)
    warnings: list[dict] = []
    blockers: list[dict] = []
    conflicts: list[dict] = []

    if contractor is None:
        return {
            "status": STATUS_NEEDS_REVIEW,
            "label": "Needs Review",
            "reason": "Contractor ownership could not be resolved for planning validation.",
            "date_range": {},
            "recommended_timeline": {},
            "required_capabilities": [],
            "conflicts": [],
            "warnings": [],
            "blockers": [{"type": "contractor", "message": "Contractor ownership could not be resolved."}],
            "advisory_notice": "Internal planning validation only. No assignments or schedules are created.",
        }

    if not start or not finish:
        return {
            "status": STATUS_NEEDS_REVIEW,
            "label": "Needs Review",
            "reason": "Add milestone dates or planning assumptions before sending.",
            "date_range": {},
            "recommended_timeline": {},
            "required_capabilities": _required_capabilities(agreement),
            "conflicts": [],
            "warnings": [{"type": "timeline", "message": "No planned start and finish date were available."}],
            "blockers": [],
            "advisory_notice": "Internal planning validation only. No assignments or schedules are created.",
        }

    committed = _committed_agreements(contractor, exclude_id=agreement.id)
    overlapping_commitments = []
    for other in committed:
        other_start, other_finish = _range_from_agreement(other)
        if _overlaps(start, finish, other_start, other_finish):
            overlapping_commitments.append(
                {
                    "agreement_id": other.id,
                    "title": _agreement_title(other),
                    "start_date": other_start.isoformat() if other_start else "",
                    "finish_date": other_finish.isoformat() if other_finish else "",
                    "status": getattr(other, "status", ""),
                }
            )

    required = _required_capabilities(agreement)
    capability_counts = _active_capability_counts(contractor)
    occupied_ids = _assigned_subaccounts_for_agreements([row["agreement_id"] for row in overlapping_commitments])

    for need in required:
        key = need["capability"].strip().lower()
        bucket = capability_counts.get(key, {"total": 0, "subaccount_ids": set(), "capability": need["capability"]})
        occupied_for_skill = len(bucket["subaccount_ids"].intersection(occupied_ids))
        available = max(int(bucket["total"]) - occupied_for_skill, 0)
        need["available"] = available
        need["occupied_by_committed_work"] = occupied_for_skill
        need["status"] = "ready" if available >= need["needed"] else "gap"
        if available < need["needed"]:
            blockers.append(
                {
                    "type": "capability_conflict",
                    "capability": need["capability"],
                    "message": f"{need['capability']} needs {need['needed']} active match(es), but {available} remain available after committed work.",
                }
            )

    assigned_ids = set(
        AgreementAssignment.objects.filter(agreement=agreement).values_list("subaccount_id", flat=True)
    )
    assigned_ids.update(
        MilestoneAssignment.objects.filter(milestone__agreement=agreement).values_list("subaccount_id", flat=True)
    )
    if assigned_ids and occupied_ids:
        duplicate_ids = assigned_ids.intersection(occupied_ids)
        if duplicate_ids:
            names = list(
                ContractorSubAccount.objects.filter(id__in=duplicate_ids).values_list("display_name", flat=True)
            )
            conflicts.append(
                {
                    "type": "employee_overlap",
                    "message": "One or more selected employees are already committed to overlapping signed/funded work.",
                    "employees": names,
                }
            )

    if overlapping_commitments:
        warnings.append(
            {
                "type": "timeline_overlap",
                "message": f"{len(overlapping_commitments)} signed/funded agreement(s) overlap this planned timeline.",
            }
        )

    if not required:
        warnings.append(
            {
                "type": "capability_mix_missing",
                "message": "No capability mix was saved, so validation used only timeline overlap checks.",
            }
        )

    hard_conflict = bool(blockers or conflicts)
    needs_review = bool(warnings or overlapping_commitments)
    if hard_conflict:
        validation_status = STATUS_HARD_CONFLICT
        reason = "Committed work conflicts with the draft timeline or capability assumptions."
    elif needs_review:
        validation_status = STATUS_NEEDS_REVIEW
        reason = "Timeline overlaps committed work or lacks complete planning context."
    else:
        validation_status = STATUS_VALIDATED
        reason = "No blocking timeline or workforce conflicts were detected."

    return {
        "status": validation_status,
        "label": {
            STATUS_VALIDATED: "Validated",
            STATUS_NEEDS_REVIEW: "Needs Review",
            STATUS_HARD_CONFLICT: "Hard Conflict",
        }[validation_status],
        "reason": reason,
        "date_range": {
            "start_date": start.isoformat(),
            "finish_date": finish.isoformat(),
            "duration_days": _duration_days(start, finish),
        },
        "recommended_timeline": _timeline_summary(start, finish, overlapping_commitments),
        "required_capabilities": required,
        "conflicts": conflicts,
        "warnings": warnings,
        "blockers": blockers,
        "overlapping_commitments": overlapping_commitments,
        "advisory_notice": "Internal planning validation only. No assignments or schedules are created.",
    }


def validate_agreement_planning(
    agreement: Agreement,
    *,
    persist: bool = True,
    acknowledged_by=None,
) -> dict:
    summary = build_planning_validation_summary(agreement)
    if persist:
        now = timezone.now()
        fields = [
            "planning_validation_status",
            "planning_validation_checked_at",
            "planning_validation_summary",
        ]
        agreement.planning_validation_status = summary["status"]
        agreement.planning_validation_checked_at = now
        agreement.planning_validation_summary = summary
        if acknowledged_by is not None:
            agreement.planning_validation_acknowledged_at = now
            agreement.planning_validation_acknowledged_by = acknowledged_by
            fields.extend(["planning_validation_acknowledged_at", "planning_validation_acknowledged_by"])
        agreement.save(update_fields=fields)
        summary["checked_at"] = now.isoformat()
        if acknowledged_by is not None:
            summary["acknowledged_at"] = now.isoformat()
            summary["acknowledged_by"] = getattr(acknowledged_by, "id", None)
    return summary


def revalidate_unsigned_pipeline_for_committed_agreement(agreement: Agreement) -> list[dict]:
    contractor = _contractor_for(agreement)
    if contractor is None or not _is_committed(agreement):
        return []

    committed_start, committed_finish = _range_from_agreement(agreement)
    qs = Agreement.objects.select_related("project").filter(
        Q(contractor=contractor) | Q(project__contractor=contractor)
    ).exclude(id=agreement.id)

    results = []
    for candidate in qs:
        if not _is_unsigned_pipeline(candidate):
            continue
        candidate_start, candidate_finish = _range_from_agreement(candidate)
        if committed_start and committed_finish and candidate_start and candidate_finish:
            if not _overlaps(committed_start, committed_finish, candidate_start, candidate_finish):
                continue
        summary = validate_agreement_planning(candidate, persist=True)
        if summary.get("status") in {STATUS_NEEDS_REVIEW, STATUS_HARD_CONFLICT}:
            results.append({"agreement_id": candidate.id, "status": summary.get("status"), "summary": summary})
    return results
