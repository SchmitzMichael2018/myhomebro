from __future__ import annotations

import logging

from django.utils import timezone

from projects.models_customer_portal import CustomerRequest, PropertyHomeSystem
from projects.models_maintenance import MaintenanceWorkOrder

logger = logging.getLogger(__name__)


def _safe_save(instance, fields: list[str]) -> None:
    if not fields:
        return
    try:
        instance.save(update_fields=list(dict.fromkeys(fields + ["updated_at"])))
    except Exception:
        logger.warning("Could not update lifecycle link for %s", instance, exc_info=True)


def customer_request_for_intake(intake) -> CustomerRequest | None:
    if intake is None:
        return None
    request_id = (getattr(intake, "ai_analysis_payload", None) or {}).get("source_customer_request_id")
    qs = CustomerRequest.objects.select_related("linked_home_system", "property_profile", "source_intake", "converted_project")
    if request_id:
        request_row = qs.filter(pk=request_id).first()
        if request_row is not None:
            return request_row
    return qs.filter(source_intake=intake).order_by("-updated_at", "-id").first()


def sync_customer_request_agreement_links(*, intake=None, agreement=None, project=None) -> CustomerRequest | None:
    request_row = customer_request_for_intake(intake)
    if request_row is None:
        return None

    updates = []
    if agreement is not None:
        project = project or getattr(agreement, "project", None)
    if project is not None and getattr(request_row, "converted_project_id", None) != getattr(project, "id", None):
        request_row.converted_project = project
        updates.append("converted_project")
    if request_row.status != CustomerRequest.STATUS_CONVERTED_TO_PROJECT:
        request_row.status = CustomerRequest.STATUS_CONVERTED_TO_PROJECT
        updates.append("status")
    _safe_save(request_row, updates)

    system = getattr(request_row, "linked_home_system", None)
    if system is not None and agreement is not None and getattr(system, "linked_agreement_id", None) != getattr(agreement, "id", None):
        system.linked_agreement = agreement
        _safe_save(system, ["linked_agreement"])
    return request_row


def sync_work_order_home_system(work_order: MaintenanceWorkOrder) -> PropertyHomeSystem | None:
    if getattr(work_order, "home_system_id", None):
        return work_order.home_system
    agreement = getattr(work_order, "maintenance_agreement", None)
    if agreement is None:
        return None
    system = (
        PropertyHomeSystem.objects.filter(linked_agreement=agreement, is_archived=False)
        .order_by("id")
        .first()
    )
    if system is None:
        return None
    work_order.home_system = system
    try:
        work_order.save(update_fields=["home_system", "updated_at"])
    except Exception:
        logger.warning("Could not link work order %s to home system %s", work_order.pk, system.pk, exc_info=True)
    return system


def complete_home_system_from_work_order(work_order: MaintenanceWorkOrder) -> None:
    system = sync_work_order_home_system(work_order)
    if system is None:
        return
    completed_at = getattr(work_order, "completed_at", None) or timezone.now()
    system.last_service_date = completed_at.date()
    system.resolved_at = completed_at
    system.reminder_delivery_status = PropertyHomeSystem.DELIVERY_STATUS_RESOLVED
    system.next_notification_at = None
    _safe_save(system, ["last_service_date", "resolved_at", "reminder_delivery_status", "next_notification_at"])
