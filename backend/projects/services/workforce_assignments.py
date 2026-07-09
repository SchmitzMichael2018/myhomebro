from __future__ import annotations

from collections import defaultdict
from datetime import date, datetime, time, timedelta
from decimal import Decimal
from typing import Any

from django.utils import timezone

from projects.models import (
    AgreementAssignment,
    Contractor,
    ContractorSubAccount,
    CrewAssignmentDraft,
    EmployeeCapability,
    Milestone,
    MilestoneAssignment,
    ProjectStatus,
)
from projects.models_customer_portal import PropertyWorkOrder
from projects.models_maintenance import MaintenanceWorkOrder
from projects.models_proposals import Proposal
from projects.models_warranty import WarrantyWorkOrder


ACTIVE_AGREEMENT_STATUSES = {
    ProjectStatus.SIGNED,
    ProjectStatus.FUNDED,
    ProjectStatus.IN_PROGRESS,
}
TERMINAL_STATUSES = {ProjectStatus.COMPLETED, ProjectStatus.CANCELLED}


def _clean(value: Any) -> str:
    return str(value or "").strip()


def _iso(value: Any) -> str | None:
    if value is None:
        return None
    if isinstance(value, datetime):
        return value.isoformat()
    if isinstance(value, date):
        return datetime.combine(value, time.min).isoformat()
    return str(value)


def _date_value(value: Any) -> date | None:
    if value is None:
        return None
    if isinstance(value, datetime):
        return timezone.localtime(value).date() if timezone.is_aware(value) else value.date()
    if isinstance(value, date):
        return value
    return None


def _money_state(value: Any) -> str:
    try:
        amount = Decimal(str(value or "0"))
    except Exception:
        amount = Decimal("0")
    return "paid" if amount > Decimal("0") else "none"


def _address_for_agreement(agreement) -> str:
    if not agreement:
        return ""
    parts = [
        agreement.project_address_line1,
        agreement.project_address_line2,
        agreement.project_address_city,
        agreement.project_address_state,
        agreement.project_postal_code,
    ]
    return ", ".join([_clean(part) for part in parts if _clean(part)])


def _address_for_project(project) -> str:
    if not project:
        return ""
    parts = [
        project.project_street_address,
        project.project_address_line_2,
        project.project_city,
        project.project_state,
        project.project_zip_code,
    ]
    return ", ".join([_clean(part) for part in parts if _clean(part)])


def _homeowner_label(agreement=None, project=None, homeowner=None) -> str:
    candidate = homeowner or getattr(agreement, "homeowner", None) or getattr(project, "homeowner", None)
    return _clean(getattr(candidate, "full_name", "")) or _clean(getattr(candidate, "email", ""))


def _agreement_label(agreement) -> str:
    if not agreement:
        return ""
    project = getattr(agreement, "project", None)
    return _clean(getattr(project, "title", "")) or f"Agreement #{agreement.id}"


def _project_label(project, fallback: str = "") -> str:
    return _clean(getattr(project, "title", "")) or fallback


def _member_payload(subaccount: ContractorSubAccount | None = None, *, name: str = "", member_type: str = "employee") -> dict:
    if subaccount is None:
        return {
            "member_type": "unassigned" if not name else member_type,
            "member_id": None,
            "member_name": name or "Unassigned",
        }
    return {
        "member_type": member_type,
        "member_id": subaccount.id,
        "member_name": subaccount.display_name,
    }


def _row(**kwargs) -> dict:
    base = {
        "source_type": "",
        "source_id": None,
        "source_label": "",
        "member_type": "unassigned",
        "member_id": None,
        "member_name": "Unassigned",
        "contractor_id": None,
        "project_id": None,
        "project_label": "",
        "agreement_id": None,
        "agreement_label": "",
        "milestone_id": None,
        "milestone_label": "",
        "customer_id": None,
        "customer_label": "",
        "property_address": "",
        "scheduled_start": None,
        "scheduled_end": None,
        "status": "",
        "priority": "normal",
        "required_skills": [],
        "location": "",
        "financial_sensitivity": "none",
        "is_warranty_work": False,
        "is_maintenance_work": False,
        "is_estimate_work": False,
        "is_subcontractor_work": False,
        "open_url": "",
    }
    base.update(kwargs)
    return base


def _required_skills(*values: str) -> list[str]:
    seen = []
    for value in values:
        text = _clean(value)
        if text and text.lower() not in {item.lower() for item in seen}:
            seen.append(text)
    return seen[:4]


def _milestone_assignee(milestone: Milestone) -> tuple[ContractorSubAccount | None, str, str]:
    assignment = getattr(milestone, "subaccount_assignment", None)
    if assignment and assignment.subaccount_id:
        return assignment.subaccount, "employee", assignment.subaccount.display_name

    invitation = getattr(milestone, "assigned_subcontractor_invitation", None)
    if invitation is not None:
        accepted_by = getattr(invitation, "accepted_by_user", None)
        display = _clean(getattr(invitation, "display_name", "")) or _clean(getattr(invitation, "email", ""))
        if accepted_by is not None:
            subaccount = ContractorSubAccount.objects.filter(user=accepted_by).first()
            if subaccount:
                return subaccount, "subcontractor", subaccount.display_name
        return None, "subcontractor", display or "Assigned subcontractor"

    return None, "unassigned", "Unassigned"


def normalize_workforce_assignments(contractor: Contractor) -> dict:
    today = timezone.localdate()
    week_end = today + timedelta(days=7)
    rows: list[dict] = []

    subaccounts = list(
        ContractorSubAccount.objects.filter(parent_contractor=contractor, is_active=True)
        .select_related("user")
        .prefetch_related("capabilities__skill")
        .order_by("display_name", "id")
    )
    subaccount_by_user_id = {row.user_id: row for row in subaccounts}

    agreement_assignments = (
        AgreementAssignment.objects.filter(agreement__contractor=contractor, agreement__is_archived=False)
        .exclude(agreement__status__in=TERMINAL_STATUSES)
        .select_related("agreement", "agreement__project", "agreement__homeowner", "subaccount")
    )
    for assignment in agreement_assignments:
        agreement = assignment.agreement
        project = agreement.project
        start = getattr(agreement, "start", None) or getattr(project, "created_at", None)
        rows.append(
            _row(
                source_type="agreement_assignment",
                source_id=assignment.id,
                source_label="Agreement assignment",
                **_member_payload(assignment.subaccount),
                contractor_id=contractor.id,
                project_id=project.id if project else None,
                project_label=_project_label(project, _agreement_label(agreement)),
                agreement_id=agreement.id,
                agreement_label=_agreement_label(agreement),
                customer_id=agreement.homeowner_id,
                customer_label=_homeowner_label(agreement=agreement),
                property_address=_address_for_agreement(agreement) or _address_for_project(project),
                scheduled_start=_iso(start),
                scheduled_end=_iso(getattr(agreement, "end", None)),
                status=agreement.status,
                required_skills=_required_skills(agreement.project_type, agreement.standardized_category),
                location=_address_for_agreement(agreement) or _address_for_project(project),
                financial_sensitivity=_money_state(agreement.total_cost),
                is_maintenance_work=bool(getattr(agreement, "is_maintenance", False)),
                open_url=f"/app/agreements/{agreement.id}",
            )
        )

    milestones = (
        Milestone.objects.filter(agreement__contractor=contractor, agreement__is_archived=False)
        .exclude(agreement__status__in=TERMINAL_STATUSES)
        .select_related(
            "agreement",
            "agreement__project",
            "agreement__homeowner",
            "subaccount_assignment",
            "subaccount_assignment__subaccount",
            "assigned_subcontractor_invitation",
            "assigned_subcontractor_invitation__accepted_by_user",
        )
        .order_by("completion_date", "agreement_id", "order", "id")
    )
    for milestone in milestones:
        agreement = milestone.agreement
        project = agreement.project
        subaccount, member_type, member_name = _milestone_assignee(milestone)
        member = _member_payload(subaccount, name=member_name, member_type=member_type)
        scheduled = milestone.scheduled_service_date or milestone.completion_date or milestone.start_date
        rows.append(
            _row(
                source_type="milestone_assignment" if subaccount else "unassigned_milestone",
                source_id=getattr(getattr(milestone, "subaccount_assignment", None), "id", milestone.id),
                source_label="Milestone assignment" if subaccount else "Unassigned milestone",
                **member,
                contractor_id=contractor.id,
                project_id=project.id if project else None,
                project_label=_project_label(project, _agreement_label(agreement)),
                agreement_id=agreement.id,
                agreement_label=_agreement_label(agreement),
                milestone_id=milestone.id,
                milestone_label=milestone.title,
                customer_id=agreement.homeowner_id,
                customer_label=_homeowner_label(agreement=agreement),
                property_address=_address_for_agreement(agreement) or _address_for_project(project),
                scheduled_start=_iso(scheduled),
                scheduled_end=_iso(milestone.completion_date),
                status="completed" if milestone.completed else milestone.subcontractor_completion_status,
                priority="high" if milestone.subcontractor_completion_status == "submitted_for_review" else "normal",
                required_skills=_required_skills(milestone.normalized_milestone_type, agreement.project_type, milestone.materials_hint),
                location=_address_for_agreement(agreement) or _address_for_project(project),
                financial_sensitivity=_money_state(milestone.amount),
                is_maintenance_work=bool(agreement.is_maintenance or milestone.generated_from_recurring_rule),
                is_subcontractor_work=member_type == "subcontractor",
                open_url=f"/app/agreements/{agreement.id}?milestone={milestone.id}",
            )
        )

    warranty_orders = (
        WarrantyWorkOrder.objects.filter(contractor=contractor)
        .exclude(status__in=[WarrantyWorkOrder.STATUS_COMPLETED, WarrantyWorkOrder.STATUS_CLOSED, WarrantyWorkOrder.STATUS_CANCELLED])
        .select_related("agreement", "agreement__project", "agreement__homeowner", "warranty_request", "assigned_user")
    )
    for work_order in warranty_orders:
        agreement = work_order.agreement
        project = agreement.project if agreement else work_order.project
        subaccount = subaccount_by_user_id.get(work_order.assigned_user_id)
        rows.append(
            _row(
                source_type="warranty_work_order",
                source_id=work_order.id,
                source_label="Warranty work order",
                **_member_payload(subaccount),
                contractor_id=contractor.id,
                project_id=getattr(project, "id", None),
                project_label=_project_label(project, work_order.title),
                agreement_id=getattr(agreement, "id", None),
                agreement_label=_agreement_label(agreement),
                customer_id=getattr(agreement, "homeowner_id", None),
                customer_label=_homeowner_label(agreement=agreement, project=project),
                property_address=_address_for_agreement(agreement) or _address_for_project(project),
                scheduled_start=_iso(work_order.scheduled_for),
                status=work_order.status,
                priority="high" if getattr(getattr(work_order, "warranty_request", None), "severity", "") in {"high", "critical"} else "normal",
                required_skills=_required_skills(getattr(work_order, "materials", ""), getattr(getattr(work_order, "warranty_request", None), "area_affected", "")),
                location=_address_for_agreement(agreement) or _address_for_project(project),
                financial_sensitivity="warranty",
                is_warranty_work=True,
                open_url=f"/app/warranty/requests/{work_order.warranty_request_id}",
            )
        )

    maintenance_orders = (
        MaintenanceWorkOrder.objects.filter(contractor=contractor)
        .exclude(status__in=[MaintenanceWorkOrder.STATUS_COMPLETED, MaintenanceWorkOrder.STATUS_CANCELLED])
        .select_related("maintenance_agreement", "maintenance_agreement__project", "maintenance_agreement__homeowner", "source_milestone")
    )
    for work_order in maintenance_orders:
        agreement = work_order.maintenance_agreement
        project = agreement.project if agreement else None
        assigned = getattr(getattr(work_order, "source_milestone", None), "subaccount_assignment", None)
        subaccount = getattr(assigned, "subaccount", None)
        rows.append(
            _row(
                source_type="maintenance_work_order",
                source_id=work_order.id,
                source_label="Maintenance work order",
                **_member_payload(subaccount),
                contractor_id=contractor.id,
                project_id=getattr(project, "id", None),
                project_label=_project_label(project, work_order.title),
                agreement_id=getattr(agreement, "id", None),
                agreement_label=_agreement_label(agreement),
                milestone_id=work_order.source_milestone_id,
                milestone_label=_clean(getattr(work_order.source_milestone, "title", "")),
                customer_id=getattr(agreement, "homeowner_id", None),
                customer_label=_homeowner_label(agreement=agreement),
                property_address=_address_for_agreement(agreement) or _address_for_project(project),
                scheduled_start=_iso(work_order.scheduled_date),
                status=work_order.status,
                required_skills=_required_skills(work_order.title, work_order.description),
                location=_address_for_agreement(agreement) or _address_for_project(project),
                financial_sensitivity="recurring_service",
                is_maintenance_work=True,
                open_url=f"/app/maintenance/work-orders/{work_order.id}",
            )
        )

    property_orders = (
        PropertyWorkOrder.objects.filter(assigned_contractor=contractor)
        .exclude(status__in=[PropertyWorkOrder.STATUS_CLOSED, PropertyWorkOrder.STATUS_CANCELLED])
        .select_related("linked_agreement", "linked_project", "property_profile", "unit", "tenant")
    )
    for work_order in property_orders:
        agreement = work_order.linked_agreement
        project = work_order.linked_project or getattr(agreement, "project", None)
        rows.append(
            _row(
                source_type="property_work_order",
                source_id=work_order.id,
                source_label="Property work order",
                contractor_id=contractor.id,
                project_id=getattr(project, "id", None),
                project_label=_project_label(project, work_order.title),
                agreement_id=getattr(agreement, "id", None),
                agreement_label=_agreement_label(agreement),
                customer_label=_clean(getattr(getattr(work_order, "tenant", None), "full_name", "")) or _clean(getattr(getattr(work_order, "property_profile", None), "display_name", "")),
                property_address=_clean(getattr(getattr(work_order, "property_profile", None), "display_name", "")),
                scheduled_start=_iso(work_order.scheduled_for),
                status=work_order.status,
                priority=work_order.priority,
                required_skills=_required_skills(work_order.get_category_display(), work_order.title),
                location=_clean(getattr(getattr(work_order, "property_profile", None), "display_name", "")),
                financial_sensitivity="property_work_order",
                is_maintenance_work=True,
                open_url=f"/app/customer-portal/properties/work-orders/{work_order.id}",
            )
        )

    proposals = Proposal.objects.filter(contractor=contractor).exclude(status__in=[Proposal.STATUS_CONVERTED, Proposal.STATUS_DECLINED, Proposal.STATUS_EXPIRED])
    for proposal in proposals.select_related("estimate_appointment", "contractor_opportunity").order_by("-updated_at", "-id")[:100]:
        appointment = proposal.estimate_appointment
        scheduled = getattr(appointment, "scheduled_start", None) or getattr(appointment, "appointment_start", None) or proposal.project_start_date
        rows.append(
            _row(
                source_type="estimate_appointment" if appointment else "estimate_workspace",
                source_id=proposal.id,
                source_label="Estimate workspace",
                contractor_id=contractor.id,
                project_label=proposal.project_title or "Estimate",
                customer_label=proposal.customer_name,
                property_address=proposal.service_location,
                scheduled_start=_iso(scheduled),
                status=proposal.status,
                priority="high" if proposal.scheduling_priority == Proposal.SCHEDULING_PRIORITY_REQUIRED else "normal",
                required_skills=_required_skills(proposal.project_type, proposal.project_subtype),
                location=proposal.service_location,
                financial_sensitivity="estimate",
                is_estimate_work=True,
                open_url=f"/app/estimates/{proposal.id}",
            )
        )

    drafts = CrewAssignmentDraft.objects.filter(contractor=contractor, status=CrewAssignmentDraft.STATUS_DRAFT).select_related("source_agreement", "source_agreement__project")
    for draft in drafts:
        agreement = draft.source_agreement
        project = getattr(agreement, "project", None)
        rows.append(
            _row(
                source_type="crew_assignment_draft",
                source_id=draft.id,
                source_label="Crew recommendation draft",
                contractor_id=contractor.id,
                project_id=getattr(project, "id", None),
                project_label=_project_label(project, "Crew recommendation"),
                agreement_id=getattr(agreement, "id", None),
                agreement_label=_agreement_label(agreement),
                scheduled_start=_iso(draft.updated_at),
                status=draft.status,
                required_skills=[],
                financial_sensitivity="planning",
                open_url=f"/app/team/assignments?draft={draft.id}",
            )
        )

    rows.sort(key=lambda item: (item["scheduled_start"] is None, item["scheduled_start"] or "", item["source_type"], item["source_id"] or 0))

    return {
        "results": rows,
        "summary": _build_summary(rows, today, week_end),
        "capacity": calculate_capacity_states(rows, subaccounts, today, week_end),
        "skills_matrix": build_skills_matrix(rows, subaccounts),
        "assistant": build_team_assistant_summary(rows, today, week_end),
    }


def _build_summary(rows: list[dict], today: date, week_end: date) -> dict:
    def in_window(row: dict, start: date, end: date) -> bool:
        value = _date_value(row.get("scheduled_start"))
        return bool(value and start <= value <= end)

    return {
        "total": len(rows),
        "today_count": sum(1 for row in rows if in_window(row, today, today)),
        "this_week_count": sum(1 for row in rows if in_window(row, today, week_end)),
        "unassigned_count": sum(1 for row in rows if not row.get("member_id")),
        "at_risk_count": sum(1 for row in rows if row.get("priority") in {"high", "urgent", "emergency"}),
        "warranty_count": sum(1 for row in rows if row.get("is_warranty_work")),
        "maintenance_count": sum(1 for row in rows if row.get("is_maintenance_work")),
        "estimate_count": sum(1 for row in rows if row.get("is_estimate_work")),
        "subcontractor_count": sum(1 for row in rows if row.get("is_subcontractor_work")),
    }


def capacity_state_for_counts(today_count: int, week_count: int) -> tuple[str, list[str]]:
    reasons: list[str] = []
    if today_count >= 4 or week_count >= 12:
        reasons.append("Workload exceeds the launch capacity threshold.")
        return "overbooked", reasons
    if today_count >= 3 or week_count >= 9:
        reasons.append("Workload is close to the launch capacity threshold.")
        return "near_capacity", reasons
    if today_count == 0 and week_count <= 2:
        reasons.append("Light workload based on scheduled and assigned records.")
        return "available", reasons
    reasons.append("Workload is within the expected range.")
    return "normal", reasons


def calculate_capacity_states(rows: list[dict], subaccounts: list[ContractorSubAccount], today: date, week_end: date) -> list[dict]:
    rows_by_member: dict[int, list[dict]] = defaultdict(list)
    for row in rows:
        member_id = row.get("member_id")
        if member_id:
            rows_by_member[int(member_id)].append(row)

    output = []
    for subaccount in subaccounts:
        member_rows = rows_by_member.get(subaccount.id, [])
        today_count = 0
        week_count = 0
        for row in member_rows:
            scheduled = _date_value(row.get("scheduled_start"))
            if scheduled == today:
                today_count += 1
            if scheduled and today <= scheduled <= week_end:
                week_count += 1
        state, reasons = capacity_state_for_counts(today_count, week_count)
        output.append(
            {
                "member_id": subaccount.id,
                "member_name": subaccount.display_name,
                "role": subaccount.role,
                "state": state,
                "assignment_count_today": today_count,
                "assignment_count_week": week_count,
                "assignment_count_total": len(member_rows),
                "reasons": reasons,
            }
        )
    return output


def build_skills_matrix(rows: list[dict], subaccounts: list[ContractorSubAccount]) -> list[dict]:
    members_by_skill: dict[str, list[dict]] = defaultdict(list)
    for subaccount in subaccounts:
        for capability in getattr(subaccount, "capabilities", []).all():
            skill = _clean(getattr(capability.skill, "name", ""))
            if not skill:
                continue
            members_by_skill[skill].append(
                {
                    "member_id": subaccount.id,
                    "member_name": subaccount.display_name,
                    "skill_level": capability.skill_level,
                    "primary": capability.skill_level in {"lead", "expert"},
                }
            )

    required = []
    for row in rows:
        for skill in row.get("required_skills") or []:
            if skill and skill.lower() not in {item.lower() for item in required}:
                required.append(skill)

    skill_names = sorted(set(members_by_skill.keys()) | set(required), key=str.lower)
    output = []
    for skill in skill_names:
        members = members_by_skill.get(skill, [])
        if not members:
            coverage = "missing"
        elif len(members) == 1:
            coverage = "thin"
        else:
            coverage = "covered"
        output.append(
            {
                "skill": skill,
                "member_count": len(members),
                "members": members,
                "coverage": coverage,
            }
        )
    return output


def build_team_assistant_summary(rows: list[dict], today: date, week_end: date) -> dict:
    unassigned = [row for row in rows if not row.get("member_id")]
    at_risk = [row for row in rows if row.get("priority") in {"high", "urgent", "emergency"}]
    week_rows = [row for row in rows if (scheduled := _date_value(row.get("scheduled_start"))) and today <= scheduled <= week_end]
    recommendations = []
    if unassigned:
        recommendations.append("Review unassigned work before confirming new schedules.")
    if at_risk:
        recommendations.append("Check high-priority warranty, property, or review items first.")
    if week_rows:
        recommendations.append("Confirm this week's workload against employee availability before committing new work.")
    if not recommendations:
        recommendations.append("No immediate workforce risks found in the current read model.")

    return {
        "summary": f"{len(rows)} workforce records normalized across assignments, estimates, warranty, maintenance, and crew planning.",
        "confidence": "medium",
        "evidence_count": len(rows),
        "recommendations": recommendations,
        "safe_actions": [
            "Prepare assignment review",
            "Prepare capacity review",
            "Open source records",
        ],
        "human_only_actions": [
            "Assign team members",
            "Send customer messages",
            "Approve warranty coverage",
            "Release or refund payments",
        ],
    }
