from __future__ import annotations

from collections import defaultdict
from datetime import timedelta
from decimal import Decimal
from typing import Any

from django.db.models import Q
from django.utils import timezone

from projects.models import Agreement, Contractor, Homeowner, MaintenanceStatus
from projects.models_customer_portal import PropertyIntelligenceSnapshot, PropertyProfile
from projects.models_maintenance import MaintenanceWorkOrder
from projects.services.property_intelligence import build_property_intelligence


def _safe_text(value: Any) -> str:
    return " ".join(str(value or "").split()).strip()


def _iso(value: Any) -> str:
    if not value:
        return ""
    try:
        return value.isoformat()
    except Exception:
        return str(value)


def _money(value: Any) -> str:
    try:
        return f"{Decimal(str(value or 0)).quantize(Decimal('0.00')):.2f}"
    except Exception:
        return "0.00"


def _contractor_name(contractor: Contractor | None) -> str:
    if not contractor:
        return ""
    user = getattr(contractor, "user", None)
    return (
        _safe_text(getattr(contractor, "business_name", ""))
        or _safe_text(getattr(contractor, "name", ""))
        or _safe_text(getattr(user, "get_full_name", lambda: "")())
        or _safe_text(getattr(user, "email", ""))
    )


def _customer_name(homeowner: Homeowner | None) -> str:
    if not homeowner:
        return ""
    return _safe_text(getattr(homeowner, "company_name", "")) or _safe_text(getattr(homeowner, "full_name", "")) or _safe_text(getattr(homeowner, "email", ""))


def _property_name(profile: PropertyProfile | None) -> str:
    if not profile:
        return ""
    return _safe_text(getattr(profile, "display_name", "")) or _safe_text(getattr(profile, "address_line1", "")) or f"Property #{profile.id}"


def _project_title(agreement: Agreement | None) -> str:
    if not agreement:
        return ""
    project = getattr(agreement, "project", None)
    return _safe_text(getattr(project, "title", "")) or _safe_text(getattr(agreement, "title", "")) or f"Agreement #{agreement.id}"


def _work_order_row(work_order: MaintenanceWorkOrder, *, today=None) -> dict[str, Any]:
    today = today or timezone.localdate()
    agreement = getattr(work_order, "maintenance_agreement", None)
    profile = getattr(work_order, "property_profile", None)
    scheduled_date = getattr(work_order, "scheduled_date", None)
    days_overdue = (today - scheduled_date).days if scheduled_date and scheduled_date < today and work_order.status != MaintenanceWorkOrder.STATUS_COMPLETED else 0
    return {
        "id": work_order.id,
        "title": _safe_text(getattr(work_order, "title", "")) or f"Work order #{work_order.id}",
        "service_type": _safe_text(getattr(work_order, "title", "")) or _project_title(agreement) or "Maintenance service",
        "description": _safe_text(getattr(work_order, "description", "")),
        "status": _safe_text(getattr(work_order, "status", "")),
        "status_label": work_order.get_status_display() if hasattr(work_order, "get_status_display") else _safe_text(getattr(work_order, "status", "")),
        "scheduled_date": _iso(scheduled_date),
        "completed_at": _iso(getattr(work_order, "completed_at", None)),
        "days_overdue": max(0, days_overdue),
        "property": _property_name(profile),
        "property_id": getattr(profile, "id", None),
        "customer": _customer_name(getattr(work_order, "homeowner", None)),
        "customer_email": _safe_text(getattr(getattr(work_order, "homeowner", None), "email", "")),
        "contractor": _contractor_name(getattr(work_order, "contractor", None)),
        "contractor_id": getattr(getattr(work_order, "contractor", None), "id", None),
        "agreement": _project_title(agreement),
        "agreement_id": getattr(agreement, "id", None),
        "project_id": getattr(getattr(agreement, "project", None), "id", None) if agreement else None,
        "work_order_url": f"/app/admin/maintenance?work_order={work_order.id}",
        "agreement_url": f"/app/admin/agreements/{agreement.id}" if agreement else "",
        "property_url": f"/app/admin/maintenance?property={getattr(profile, 'id', '')}" if profile else "",
        "contractor_url": f"/app/admin/contractors?contractor={getattr(getattr(work_order, 'contractor', None), 'id', '')}" if getattr(work_order, "contractor", None) else "",
    }


def _contract_row(agreement: Agreement, *, today=None) -> dict[str, Any]:
    today = today or timezone.localdate()
    end_date = getattr(agreement, "recurrence_end_date", None)
    expires_in_days = (end_date - today).days if end_date else None
    homeowner = getattr(agreement, "homeowner", None)
    project = getattr(agreement, "project", None)
    return {
        "id": agreement.id,
        "title": _project_title(agreement),
        "status": _safe_text(getattr(agreement, "maintenance_status", "")),
        "contractor": _contractor_name(getattr(agreement, "contractor", None)),
        "customer": _customer_name(homeowner),
        "customer_email": _safe_text(getattr(homeowner, "email", "")),
        "property": _safe_text(getattr(project, "project_street_address", "")) or _safe_text(getattr(project, "title", "")),
        "recurrence_pattern": _safe_text(getattr(agreement, "recurrence_pattern", "")),
        "recurrence_interval": getattr(agreement, "recurrence_interval", None),
        "recurrence_start_date": _iso(getattr(agreement, "recurrence_start_date", None)),
        "recurrence_end_date": _iso(end_date),
        "next_occurrence_date": _iso(getattr(agreement, "next_occurrence_date", None)),
        "expires_in_days": expires_in_days,
        "total_cost": _money(getattr(agreement, "total_cost", 0)),
        "agreement_url": f"/app/admin/agreements/{agreement.id}",
    }


def _latest_property_snapshot(profile: PropertyProfile) -> PropertyIntelligenceSnapshot | None:
    return PropertyIntelligenceSnapshot.objects.filter(property_profile=profile).order_by("-generated_at", "-id").first()


def _property_attention_rows(emails: set[str], *, limit: int = 12) -> list[dict[str, Any]]:
    rows = []
    seen_profiles = set()
    for email in sorted(email for email in emails if email):
        try:
            intelligence = build_property_intelligence(email, persist=False)
        except Exception:
            continue
        for profile_summary in intelligence.get("properties", [])[:3]:
            profile_id = profile_summary.get("property_id")
            if not profile_id or profile_id in seen_profiles:
                continue
            profile = PropertyProfile.objects.filter(pk=profile_id).first()
            if not profile:
                continue
            seen_profiles.add(profile_id)
            latest = _latest_property_snapshot(profile)
            health = profile_summary.get("health", {}) or {}
            insights = intelligence.get("insights", []) if intelligence.get("property_id") == profile_id else []
            priority = [
                row for row in insights if row.get("bucket") == "needs_attention" or row.get("severity") in {"high", "medium"}
            ][:3]
            rows.append(
                {
                    "property_id": profile.id,
                    "property": _property_name(profile),
                    "customer_email": _safe_text(profile.customer_email),
                    "health_status": _safe_text(health.get("status")) or _safe_text(getattr(latest, "health_status", "")),
                    "health_label": _safe_text(health.get("label")) or _safe_text(getattr(latest, "health_status", "")).replace("_", " ").title(),
                    "health_score": health.get("score") if health.get("score") is not None else getattr(latest, "health_score", 0),
                    "confidence": _safe_text(health.get("confidence")) or _safe_text(getattr(latest, "confidence", "")),
                    "insight_count": profile_summary.get("insight_count", 0),
                    "priority_insights": priority,
                    "property_url": f"/app/admin/maintenance?property={profile.id}",
                }
            )
    rows.sort(key=lambda row: (0 if row["health_status"] == "needs_attention" else 1, -(int(row.get("insight_count") or 0)), row["property"]))
    return rows[:limit]


def build_maintenance_operations_payload(params: dict[str, Any] | None = None) -> dict[str, Any]:
    today = timezone.localdate()
    week_end = today + timedelta(days=7)
    month_start = today.replace(day=1)
    expiring_cutoff = today + timedelta(days=45)

    maintenance_contracts = Agreement.objects.select_related("project", "contractor", "homeowner").filter(
        Q(agreement_mode="maintenance") | Q(recurring_service_enabled=True)
    )
    active_contracts = maintenance_contracts.exclude(maintenance_status__in=[MaintenanceStatus.CANCELLED, MaintenanceStatus.COMPLETED])
    inactive_contracts = maintenance_contracts.filter(maintenance_status__in=[MaintenanceStatus.CANCELLED, MaintenanceStatus.COMPLETED])
    expiring_contracts = active_contracts.filter(recurrence_end_date__isnull=False, recurrence_end_date__gte=today, recurrence_end_date__lte=expiring_cutoff)
    expired_contracts = maintenance_contracts.filter(recurrence_end_date__isnull=False, recurrence_end_date__lt=today).exclude(
        maintenance_status__in=[MaintenanceStatus.CANCELLED, MaintenanceStatus.COMPLETED]
    )
    contracts_without_future_visits = active_contracts.filter(next_occurrence_date__isnull=True)

    work_qs = MaintenanceWorkOrder.objects.select_related(
        "maintenance_agreement",
        "maintenance_agreement__project",
        "contractor",
        "homeowner",
        "property_profile",
    )
    active_statuses = [MaintenanceWorkOrder.STATUS_SCHEDULED, MaintenanceWorkOrder.STATUS_IN_PROGRESS]
    upcoming = work_qs.filter(status__in=active_statuses, scheduled_date__gte=today).order_by("scheduled_date", "id")
    due_this_week = work_qs.filter(status__in=active_statuses, scheduled_date__gte=today, scheduled_date__lte=week_end)
    overdue = work_qs.filter(status__in=active_statuses, scheduled_date__lt=today).order_by("scheduled_date", "id")
    completed_this_month = work_qs.filter(status=MaintenanceWorkOrder.STATUS_COMPLETED, completed_at__date__gte=month_start).order_by("-completed_at", "-id")

    property_profiles_with_plans = PropertyProfile.objects.filter(maintenance_work_orders__maintenance_agreement__in=active_contracts).distinct()
    property_plan_count = property_profiles_with_plans.count() or active_contracts.exclude(project__isnull=True).count()
    customer_emails = set(active_contracts.exclude(homeowner__email="").values_list("homeowner__email", flat=True))
    customer_emails.update(work_qs.exclude(homeowner__email="").values_list("homeowner__email", flat=True))
    attention_rows = _property_attention_rows(customer_emails)
    high_priority_count = sum(1 for row in attention_rows if row.get("health_status") == "needs_attention")

    contractor_stats = defaultdict(lambda: {"contractor": "", "completed": 0, "on_time": 0, "overdue": 0})
    for row in completed_this_month:
        contractor = getattr(row, "contractor", None)
        key = getattr(contractor, "id", None)
        if not key:
            continue
        stats = contractor_stats[key]
        stats["contractor_id"] = key
        stats["contractor"] = _contractor_name(contractor)
        stats["completed"] += 1
        scheduled = getattr(row, "scheduled_date", None)
        completed = getattr(row, "completed_at", None)
        if scheduled and completed and completed.date() <= scheduled:
            stats["on_time"] += 1
    for row in overdue:
        contractor = getattr(row, "contractor", None)
        key = getattr(contractor, "id", None)
        if not key:
            continue
        stats = contractor_stats[key]
        stats["contractor_id"] = key
        stats["contractor"] = _contractor_name(contractor)
        stats["overdue"] += 1
    contractor_performance = []
    for stats in contractor_stats.values():
        completed = stats["completed"]
        contractor_performance.append(
            {
                **stats,
                "on_time_rate": round((stats["on_time"] / completed) * 100, 2) if completed else None,
                "contractor_url": f"/app/admin/contractors?contractor={stats.get('contractor_id')}",
            }
        )
    contractor_performance.sort(key=lambda row: (-row["overdue"], -row["completed"], row["contractor"]))

    renewal_rows = [_contract_row(row, today=today) for row in expiring_contracts.order_by("recurrence_end_date", "id")[:10]]
    renewal_rows.extend(_contract_row(row, today=today) for row in expired_contracts.order_by("recurrence_end_date", "id")[:6])
    renewal_rows.extend(_contract_row(row, today=today) for row in contracts_without_future_visits.order_by("updated_at", "id")[:6])

    return {
        "generated_at": _iso(timezone.now()),
        "kpis": {
            "active_contracts": active_contracts.count(),
            "inactive_contracts": inactive_contracts.count(),
            "contracts_expiring_soon": expiring_contracts.count(),
            "upcoming_work_orders": upcoming.count(),
            "due_this_week": due_this_week.count(),
            "overdue_work_orders": overdue.count(),
            "completed_this_month": completed_this_month.count(),
            "properties_with_active_plans": property_plan_count,
            "properties_needing_attention": len(attention_rows),
            "high_priority_property_items": high_priority_count,
        },
        "queues": {
            "upcoming": [_work_order_row(row, today=today) for row in upcoming[:20]],
            "overdue": [_work_order_row(row, today=today) for row in overdue[:20]],
            "recently_completed": [_work_order_row(row, today=today) for row in completed_this_month[:20]],
            "renewals": renewal_rows[:20],
            "property_attention": attention_rows,
            "contractor_performance": contractor_performance[:20],
        },
        "audit": {
            "available_metrics": [
                "contract counts",
                "work order status counts",
                "upcoming/due/overdue/completed dates",
                "property intelligence health",
                "contractor completion/on-time counts",
            ],
            "available_statuses": [choice[0] for choice in MaintenanceWorkOrder.STATUS_CHOICES],
            "available_dates": [
                "recurrence_start_date",
                "recurrence_end_date",
                "next_occurrence_date",
                "scheduled_date",
                "completed_at",
                "created_at",
                "updated_at",
            ],
            "ownership_fields": [
                "maintenance_agreement",
                "contractor",
                "homeowner",
                "property_profile",
                "source_milestone",
            ],
        },
    }
