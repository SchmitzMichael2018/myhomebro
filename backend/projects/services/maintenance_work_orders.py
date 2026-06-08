from __future__ import annotations

from django.db import transaction
from django.db.models import Q
from django.utils import timezone

from projects.models import Agreement, AgreementMode, MaintenanceStatus, Milestone, Notification
from projects.models_customer_portal import PropertyProfile, SmartNotificationEvent
from projects.models_maintenance import MaintenanceWorkOrder
from projects.services.notification_center import create_notification
from projects.services.smart_notifications import create_smart_notification


def _safe_text(value) -> str:
    return ("" if value is None else str(value)).strip()


def _agreement_customer_email(agreement: Agreement | None) -> str:
    if agreement is None:
        return ""
    homeowner = getattr(agreement, "homeowner", None)
    if homeowner and getattr(homeowner, "email", None):
        return _safe_text(homeowner.email).lower()
    project = getattr(agreement, "project", None)
    project_homeowner = getattr(project, "homeowner", None) if project else None
    if project_homeowner and getattr(project_homeowner, "email", None):
        return _safe_text(project_homeowner.email).lower()
    return ""


def _agreement_title(agreement: Agreement | None) -> str:
    if agreement is None:
        return "Maintenance service"
    project = getattr(agreement, "project", None)
    return (
        _safe_text(getattr(project, "title", ""))
        or _safe_text(getattr(agreement, "project_title", ""))
        or _safe_text(getattr(agreement, "title", ""))
        or f"Agreement #{agreement.pk}"
    )


def _property_for_agreement(agreement: Agreement | None) -> PropertyProfile | None:
    email = _agreement_customer_email(agreement)
    if not email:
        return None
    return (
        PropertyProfile.objects.filter(customer_email__iexact=email, is_primary=True)
        .order_by("-updated_at", "-id")
        .first()
        or PropertyProfile.objects.filter(customer_email__iexact=email).order_by("-updated_at", "-id").first()
    )


def agreement_supports_work_orders(agreement: Agreement | None) -> bool:
    if agreement is None:
        return False
    if agreement.agreement_mode != AgreementMode.MAINTENANCE and not agreement.recurring_service_enabled:
        return False
    if not agreement.recurring_service_enabled:
        return False
    if agreement.maintenance_status in {
        MaintenanceStatus.PAUSED,
        MaintenanceStatus.CANCELLED,
        MaintenanceStatus.COMPLETED,
    }:
        return False
    return True


def _notify_work_order_scheduled(work_order: MaintenanceWorkOrder) -> None:
    agreement = work_order.maintenance_agreement
    customer_email = _agreement_customer_email(agreement)
    context = {
        "project_title": _agreement_title(agreement),
        "work_order_title": work_order.title,
        "scheduled_date": work_order.scheduled_date.isoformat() if work_order.scheduled_date else "",
        "dedupe_key": f"maintenance_work_order_scheduled:{work_order.pk}",
    }
    if customer_email:
        create_smart_notification(
            event_type=SmartNotificationEvent.MAINTENANCE_WORK_ORDER_SCHEDULED,
            recipient_email=customer_email,
            context=context,
            action_url="/portal",
            homeowner=getattr(agreement, "homeowner", None),
            contractor=getattr(agreement, "contractor", None),
            project=getattr(agreement, "project", None),
            agreement=agreement,
            milestone=getattr(work_order, "source_milestone", None),
            property_profile=getattr(work_order, "property_profile", None),
        )
    create_notification(
        contractor=getattr(work_order, "contractor", None),
        category=Notification.EVENT_MAINTENANCE_WORK_ORDER_SCHEDULED,
        title="Maintenance work order scheduled",
        body=f"{work_order.title} is scheduled for {_agreement_title(agreement)}.",
        link=f"/app/agreements/{agreement.pk}/wizard?step=2" if agreement else "/app/agreements",
        agreement=agreement,
        milestone=getattr(work_order, "source_milestone", None),
    )


def _notify_work_order_completed(work_order: MaintenanceWorkOrder) -> None:
    agreement = work_order.maintenance_agreement
    customer_email = _agreement_customer_email(agreement)
    context = {
        "project_title": _agreement_title(agreement),
        "work_order_title": work_order.title,
        "completed_date": work_order.completed_at.date().isoformat() if work_order.completed_at else "",
        "dedupe_key": f"maintenance_work_order_completed:{work_order.pk}",
    }
    if customer_email:
        create_smart_notification(
            event_type=SmartNotificationEvent.MAINTENANCE_WORK_ORDER_COMPLETED,
            recipient_email=customer_email,
            context=context,
            action_url="/portal",
            homeowner=getattr(agreement, "homeowner", None),
            contractor=getattr(agreement, "contractor", None),
            project=getattr(agreement, "project", None),
            agreement=agreement,
            milestone=getattr(work_order, "source_milestone", None),
            property_profile=getattr(work_order, "property_profile", None),
        )
    create_notification(
        contractor=getattr(work_order, "contractor", None),
        category=Notification.EVENT_MAINTENANCE_WORK_ORDER_COMPLETED,
        title="Maintenance work order completed",
        body=f"{work_order.title} was marked complete.",
        link=f"/app/agreements/{agreement.pk}/wizard?step=2" if agreement else "/app/agreements",
        agreement=agreement,
        milestone=getattr(work_order, "source_milestone", None),
    )


@transaction.atomic
def ensure_work_order_for_milestone(milestone: Milestone) -> MaintenanceWorkOrder | None:
    agreement = getattr(milestone, "agreement", None)
    if not agreement_supports_work_orders(agreement):
        return None
    if not getattr(milestone, "generated_from_recurring_rule", False):
        return None
    if not getattr(milestone, "scheduled_service_date", None) and not getattr(milestone, "start_date", None):
        return None

    defaults = {
        "maintenance_agreement": agreement,
        "property_profile": _property_for_agreement(agreement),
        "contractor": getattr(agreement, "contractor", None),
        "homeowner": getattr(agreement, "homeowner", None),
        "title": _safe_text(getattr(milestone, "title", "")) or f"{_agreement_title(agreement)} service visit",
        "description": _safe_text(getattr(milestone, "description", "")),
        "scheduled_date": getattr(milestone, "scheduled_service_date", None) or getattr(milestone, "start_date", None),
        "status": MaintenanceWorkOrder.STATUS_COMPLETED if getattr(milestone, "completed", False) else MaintenanceWorkOrder.STATUS_SCHEDULED,
        "completed_at": getattr(milestone, "completed_at", None),
        "generated_from_schedule": True,
    }
    if defaults["contractor"] is None:
        return None

    work_order, created = MaintenanceWorkOrder.objects.get_or_create(
        source_milestone=milestone,
        defaults=defaults,
    )
    if not created:
        update_fields = []
        for field_name, value in defaults.items():
            if value is not None and getattr(work_order, field_name, None) != value:
                setattr(work_order, field_name, value)
                update_fields.append(field_name)
        if update_fields:
            work_order.save(update_fields=list(dict.fromkeys(update_fields + ["updated_at"])))
    elif work_order.status == MaintenanceWorkOrder.STATUS_SCHEDULED:
        _notify_work_order_scheduled(work_order)
    return work_order


def ensure_work_orders_for_agreement(agreement: Agreement, *, horizon: int = 1) -> list[MaintenanceWorkOrder]:
    if not agreement_supports_work_orders(agreement):
        return []

    from projects.services.recurring_maintenance import ensure_recurring_milestones

    ensure_recurring_milestones(agreement, horizon=horizon)
    work_orders: list[MaintenanceWorkOrder] = []
    occurrences = (
        agreement.milestones.filter(generated_from_recurring_rule=True)
        .select_related("agreement", "agreement__project", "agreement__contractor", "agreement__homeowner")
        .order_by("scheduled_service_date", "occurrence_sequence_number", "id")
    )
    for occurrence in occurrences:
        work_order = ensure_work_order_for_milestone(occurrence)
        if work_order is not None:
            work_orders.append(work_order)
    return work_orders


@transaction.atomic
def complete_work_order(work_order: MaintenanceWorkOrder, *, completed_by=None, notes: str = "") -> MaintenanceWorkOrder:
    now = timezone.now()
    update_fields = ["status", "completed_at", "completed_by", "updated_at"]
    work_order.status = MaintenanceWorkOrder.STATUS_COMPLETED
    work_order.completed_at = work_order.completed_at or now
    work_order.completed_by = completed_by
    if notes:
        work_order.notes = notes
        update_fields.append("notes")
    work_order.save(update_fields=update_fields)

    milestone = getattr(work_order, "source_milestone", None)
    if milestone is not None and not milestone.completed:
        milestone.completed = True
        milestone.completed_at = work_order.completed_at
        if notes:
            milestone.completion_notes = notes
        milestone.save(update_fields=["completed", "completed_at", "completion_notes"])
        from projects.services.recurring_maintenance import handle_milestone_recurring_state_change

        handle_milestone_recurring_state_change(milestone)
        ensure_work_orders_for_agreement(work_order.maintenance_agreement, horizon=1)

    _notify_work_order_completed(work_order)
    return work_order


def customer_visible_work_order_queryset(email: str):
    normalized_email = _safe_text(email).lower()
    if not normalized_email:
        return MaintenanceWorkOrder.objects.none()
    return (
        MaintenanceWorkOrder.objects.select_related(
            "maintenance_agreement",
            "maintenance_agreement__project",
            "maintenance_agreement__contractor",
            "maintenance_agreement__homeowner",
            "source_milestone",
            "property_profile",
        )
        .prefetch_related("attachments")
        .filter(
            Q(homeowner__email__iexact=normalized_email)
            | Q(maintenance_agreement__homeowner__email__iexact=normalized_email)
            | Q(maintenance_agreement__project__homeowner__email__iexact=normalized_email)
            | Q(property_profile__customer_email__iexact=normalized_email)
        )
        .distinct()
    )
