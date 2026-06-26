from __future__ import annotations

import logging
import re
from typing import Any

from django.utils import timezone

from projects.models import Homeowner
from projects.models_customer_portal import CustomerRequest, PropertyHomeSystem
from projects.models_maintenance import MaintenanceWorkOrder

logger = logging.getLogger(__name__)


def _safe_text(value: Any) -> str:
    return "" if value is None else str(value).strip()


def _normalize_email(value: Any) -> str:
    return _safe_text(value).lower()


def _normalize_phone(value: Any) -> str:
    digits = re.sub(r"\D+", "", _safe_text(value))
    if len(digits) == 11 and digits.startswith("1"):
        return digits[1:]
    return digits


def _first_present(payload: dict[str, Any], *keys: str) -> str:
    for key in keys:
        value = _safe_text(payload.get(key))
        if value:
            return value
    return ""


def _customer_email_for_create(email: str, phone_digits: str, source: str) -> str:
    if email:
        return email
    token = phone_digits or _normalize_phone(source) or "unknown"
    return f"phone-{token}@pending.myhomebro.local"


def _fill_missing_customer_fields(customer: Homeowner, payload: dict[str, Any]) -> list[str]:
    updates: list[str] = []
    field_sources = {
        "full_name": ("full_name", "customer_name", "homeowner_name", "name"),
        "company_name": ("company_name", "business_name", "property_management_company_name"),
        "phone_number": ("phone_number", "phone", "customer_phone", "homeowner_phone"),
        "street_address": ("street_address", "address_line1", "customer_address_line1", "project_address", "project_address_line1", "property_address_line1"),
        "address_line_2": ("address_line_2", "address_line2", "customer_address_line2", "project_address_line2", "property_address_line2"),
        "city": ("city", "customer_city", "project_city", "property_city"),
        "state": ("state", "customer_state", "project_state", "property_state"),
        "zip_code": ("zip_code", "zip", "postal_code", "customer_postal_code", "project_postal_code", "project_zip", "property_postal_code"),
    }
    for field, keys in field_sources.items():
        current = _safe_text(getattr(customer, field, ""))
        if current:
            continue
        value = _first_present(payload, *keys)
        if value:
            setattr(customer, field, value)
            updates.append(field)
    if not _safe_text(getattr(customer, "status", "")):
        customer.status = "active"
        updates.append("status")
    return updates


def upsert_contractor_customer_from_request(contractor, source: str, payload: dict[str, Any] | None) -> Homeowner | None:
    """
    Create or update a contractor-scoped customer when a request becomes visible to that contractor.

    Request/project details stay on their source models; this only maintains the contact row used by Customers.
    """
    if contractor is None:
        return None
    payload = payload or {}
    email = _normalize_email(_first_present(payload, "email", "customer_email", "homeowner_email"))
    raw_phone = _first_present(payload, "phone", "phone_number", "customer_phone", "homeowner_phone")
    phone_digits = _normalize_phone(raw_phone)
    if not email and not phone_digits:
        return None

    qs = Homeowner.objects.filter(created_by=contractor)
    customer = qs.filter(email__iexact=email).first() if email else None
    if customer is None and not email and phone_digits:
        for row in qs.exclude(phone_number="").order_by("-updated_at", "-id"):
            if _normalize_phone(row.phone_number) == phone_digits:
                customer = row
                break

    if customer is None:
        name = _first_present(payload, "full_name", "customer_name", "homeowner_name", "name")
        company_name = _first_present(payload, "company_name", "business_name", "property_management_company_name")
        customer = Homeowner.objects.create(
            created_by=contractor,
            full_name=name or company_name or email or raw_phone or "Customer",
            company_name=company_name,
            email=_customer_email_for_create(email, phone_digits, source),
            phone_number=raw_phone,
            street_address=_first_present(payload, "street_address", "address_line1", "customer_address_line1", "project_address", "project_address_line1", "property_address_line1"),
            address_line_2=_first_present(payload, "address_line_2", "address_line2", "customer_address_line2", "project_address_line2", "property_address_line2"),
            city=_first_present(payload, "city", "customer_city", "project_city", "property_city"),
            state=_first_present(payload, "state", "customer_state", "project_state", "property_state"),
            zip_code=_first_present(payload, "zip_code", "zip", "postal_code", "customer_postal_code", "project_postal_code", "project_zip", "property_postal_code"),
            status="active",
        )
        return customer

    updates = _fill_missing_customer_fields(customer, payload)
    if updates:
        customer.save(update_fields=list(dict.fromkeys(updates + ["updated_at"])))
    return customer


def _payload_from_intake(intake) -> dict[str, Any]:
    return {
        "customer_name": getattr(intake, "customer_name", ""),
        "customer_email": getattr(intake, "customer_email", ""),
        "customer_phone": getattr(intake, "customer_phone", ""),
        "customer_address_line1": getattr(intake, "customer_address_line1", ""),
        "customer_address_line2": getattr(intake, "customer_address_line2", ""),
        "customer_city": getattr(intake, "customer_city", ""),
        "customer_state": getattr(intake, "customer_state", ""),
        "customer_postal_code": getattr(intake, "customer_postal_code", ""),
        "project_address_line1": getattr(intake, "project_address_line1", ""),
        "project_address_line2": getattr(intake, "project_address_line2", ""),
        "project_city": getattr(intake, "project_city", ""),
        "project_state": getattr(intake, "project_state", ""),
        "project_postal_code": getattr(intake, "project_postal_code", ""),
    }


def upsert_customer_for_project_intake(intake, *, contractor=None, source: str = "project_intake") -> Homeowner | None:
    contractor = contractor or getattr(intake, "contractor", None)
    customer = upsert_contractor_customer_from_request(contractor, source, _payload_from_intake(intake))
    if customer is not None and getattr(intake, "homeowner_id", None) != customer.id:
        intake.homeowner = customer
        intake.save(update_fields=["homeowner", "updated_at"])
    return customer


def upsert_customer_for_public_lead(lead, *, source: str = "public_lead") -> Homeowner | None:
    customer = upsert_contractor_customer_from_request(
        getattr(lead, "contractor", None),
        source,
        {
            "full_name": getattr(lead, "full_name", ""),
            "email": getattr(lead, "email", ""),
            "phone": getattr(lead, "phone", ""),
            "project_address": getattr(lead, "project_address", ""),
            "city": getattr(lead, "city", ""),
            "state": getattr(lead, "state", ""),
            "zip_code": getattr(lead, "zip_code", ""),
        },
    )
    updates = []
    if customer is not None and getattr(lead, "converted_homeowner_id", None) != customer.id:
        lead.converted_homeowner = customer
        updates.append("converted_homeowner")
    try:
        source_intake = getattr(lead, "source_intake", None)
    except Exception:
        source_intake = None
    if customer is not None and source_intake is not None and getattr(source_intake, "homeowner_id", None) != customer.id:
        source_intake.homeowner = customer
        source_intake.save(update_fields=["homeowner", "updated_at"])
    if updates:
        lead.save(update_fields=updates + ["updated_at"])
    return customer


def upsert_customer_for_contractor_opportunity(opportunity, *, contractor=None, source: str = "contractor_opportunity") -> Homeowner | None:
    contractor = contractor or getattr(getattr(opportunity, "directory_entry", None), "claimed_by_contractor", None) or getattr(opportunity, "accepted_by_contractor", None)
    customer = upsert_contractor_customer_from_request(
        contractor,
        source,
        {
            "homeowner_name": getattr(opportunity, "homeowner_name", ""),
            "homeowner_email": getattr(opportunity, "homeowner_email", ""),
            "homeowner_phone": getattr(opportunity, "homeowner_phone", ""),
            "project_address": getattr(opportunity, "project_address", ""),
            "project_city": getattr(opportunity, "project_city", ""),
            "project_state": getattr(opportunity, "project_state", ""),
            "project_zip": getattr(opportunity, "project_zip", ""),
        },
    )
    updates = []
    if customer is not None and getattr(opportunity, "converted_customer_id", None) != customer.id:
        opportunity.converted_customer = customer
        updates.append("converted_customer")
    intake = getattr(opportunity, "intake_request", None)
    if customer is not None and intake is not None and getattr(intake, "homeowner_id", None) != customer.id:
        intake.homeowner = customer
        intake.save(update_fields=["homeowner", "updated_at"])
    if updates:
        opportunity.save(update_fields=updates + ["updated_at"])
    return customer


def upsert_pm_customer_for_property_work_order_opportunity(opportunity, *, contractor=None, source: str = "property_work_order") -> Homeowner | None:
    work_order = getattr(opportunity, "property_work_order", None)
    company = getattr(work_order, "property_management_company", None)
    owner = getattr(company, "homeowner", None)
    property_profile = getattr(work_order, "property_profile", None)
    if owner is not None:
        payload = {
            "full_name": getattr(owner, "full_name", ""),
            "company_name": getattr(owner, "company_name", "") or getattr(company, "name", ""),
            "email": getattr(owner, "email", ""),
            "phone": getattr(owner, "phone_number", "") or getattr(company, "phone", ""),
            "street_address": getattr(owner, "street_address", ""),
            "city": getattr(owner, "city", ""),
            "state": getattr(owner, "state", ""),
            "zip_code": getattr(owner, "zip_code", ""),
            "property_address_line1": getattr(property_profile, "address_line1", ""),
            "property_city": getattr(property_profile, "city", ""),
            "property_state": getattr(property_profile, "state", ""),
            "property_postal_code": getattr(property_profile, "postal_code", ""),
        }
    elif company is not None:
        payload = {
            "company_name": getattr(company, "name", ""),
            "email": getattr(company, "email", ""),
            "phone": getattr(company, "phone", ""),
            "property_address_line1": getattr(property_profile, "address_line1", ""),
            "property_city": getattr(property_profile, "city", ""),
            "property_state": getattr(property_profile, "state", ""),
            "property_postal_code": getattr(property_profile, "postal_code", ""),
        }
    else:
        payload = {}
    customer = upsert_contractor_customer_from_request(contractor, source, payload)
    if customer is not None and getattr(opportunity, "converted_customer_id", None) != customer.id:
        opportunity.converted_customer = customer
        opportunity.save(update_fields=["converted_customer", "updated_at"])
    return customer


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
