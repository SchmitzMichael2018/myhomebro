from __future__ import annotations

from projects.models import Homeowner
from projects.models_customer_portal import PropertyManagementCompany, PropertyProfile, PropertyUnit


def _safe_text(value) -> str:
    return ("" if value is None else str(value)).strip()


def homeowner_is_property_management_company(homeowner: Homeowner | None) -> bool:
    return bool(
        homeowner
        and _safe_text(getattr(homeowner, "account_type", ""))
        == getattr(Homeowner, "ACCOUNT_TYPE_PROPERTY_MANAGEMENT_COMPANY", "property_management_company")
    )


def company_payload(company: PropertyManagementCompany | None) -> dict | None:
    if company is None:
        return None
    return {
        "id": company.id,
        "name": _safe_text(company.name),
        "phone": _safe_text(company.phone),
        "email": _safe_text(company.email),
        "website": _safe_text(company.website),
        "address_line1": _safe_text(company.address_line1),
        "address_line2": _safe_text(company.address_line2),
        "city": _safe_text(company.city),
        "state": _safe_text(company.state),
        "postal_code": _safe_text(company.postal_code),
        "license_number": _safe_text(company.license_number),
        "notes": _safe_text(company.notes),
        "is_active": bool(company.is_active),
    }


def get_company_for_homeowner(homeowner: Homeowner | None) -> PropertyManagementCompany | None:
    if homeowner is None:
        return None
    try:
        return homeowner.property_management_company
    except PropertyManagementCompany.DoesNotExist:
        return None


def create_or_sync_company_from_homeowner(homeowner: Homeowner | None) -> PropertyManagementCompany | None:
    if not homeowner_is_property_management_company(homeowner):
        return get_company_for_homeowner(homeowner)

    defaults = {
        "name": _safe_text(getattr(homeowner, "company_name", "")) or _safe_text(getattr(homeowner, "full_name", "")),
        "phone": _safe_text(getattr(homeowner, "company_phone", "")) or _safe_text(getattr(homeowner, "phone_number", "")),
        "email": _safe_text(getattr(homeowner, "company_email", "")) or _safe_text(getattr(homeowner, "email", "")),
        "website": _safe_text(getattr(homeowner, "company_website", "")),
        "address_line1": _safe_text(getattr(homeowner, "company_street", "")),
        "address_line2": _safe_text(getattr(homeowner, "company_unit", "")),
        "city": _safe_text(getattr(homeowner, "company_city", "")),
        "state": _safe_text(getattr(homeowner, "company_state", "")),
        "postal_code": _safe_text(getattr(homeowner, "company_zip", "")),
        "license_number": _safe_text(getattr(homeowner, "company_license_number", "")),
        "notes": _safe_text(getattr(homeowner, "company_notes", "")),
        "is_active": True,
    }
    company, created = PropertyManagementCompany.objects.get_or_create(
        homeowner=homeowner,
        defaults=defaults,
    )
    if not created:
        update_fields = []
        for field, value in defaults.items():
            if field != "is_active" and not value:
                continue
            if getattr(company, field) != value:
                setattr(company, field, value)
                update_fields.append(field)
        if update_fields:
            company.save(update_fields=[*update_fields, "updated_at"])
    return company


def create_or_sync_rental_owner_company_from_homeowner(homeowner: Homeowner | None) -> PropertyManagementCompany | None:
    if homeowner is None:
        return None
    if homeowner_is_property_management_company(homeowner):
        return create_or_sync_company_from_homeowner(homeowner)

    name = (
        _safe_text(getattr(homeowner, "company_name", ""))
        or _safe_text(getattr(homeowner, "full_name", ""))
        or _safe_text(getattr(homeowner, "email", ""))
        or "Rental Properties"
    )
    defaults = {
        "name": name,
        "phone": _safe_text(getattr(homeowner, "phone_number", "")),
        "email": _safe_text(getattr(homeowner, "email", "")),
        "address_line1": _safe_text(getattr(homeowner, "street_address", "")),
        "address_line2": _safe_text(getattr(homeowner, "address_line_2", "")),
        "city": _safe_text(getattr(homeowner, "city", "")),
        "state": _safe_text(getattr(homeowner, "state", "")),
        "postal_code": _safe_text(getattr(homeowner, "zip_code", "")),
        "is_active": True,
    }
    company, created = PropertyManagementCompany.objects.get_or_create(
        homeowner=homeowner,
        defaults=defaults,
    )
    if not created:
        update_fields = []
        for field, value in defaults.items():
            if field != "is_active" and not value:
                continue
            if getattr(company, field) != value:
                setattr(company, field, value)
                update_fields.append(field)
        if update_fields:
            company.save(update_fields=[*update_fields, "updated_at"])
    return company


def managed_properties_for_company(company: PropertyManagementCompany | None):
    if company is None:
        return PropertyProfile.objects.none()
    return PropertyProfile.objects.filter(managed_by_company=company).order_by("-is_primary", "-updated_at", "-id")


def units_for_property(property_profile: PropertyProfile | None):
    if property_profile is None:
        return PropertyUnit.objects.none()
    return PropertyUnit.objects.filter(property_profile=property_profile).order_by("unit_label", "id")
