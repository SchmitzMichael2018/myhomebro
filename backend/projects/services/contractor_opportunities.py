from __future__ import annotations

from decimal import Decimal, InvalidOperation
from typing import Any

from django.db import transaction
from django.utils import timezone

from projects.models import Agreement, Contractor, Homeowner, Project
from projects.models_contractor_discovery import (
    ContractorDirectoryDiscovery,
    ContractorDirectoryEntry,
    ContractorDirectoryListing,
    ContractorOpportunity,
)
from projects.models_project_intake import ProjectIntake, ProjectIntakeClarificationPhoto
from projects.services.contractor_directory import normalize_business_name, normalize_phone, normalize_website_domain, upsert_directory_entry_from_place
from projects.services.project_titles import generate_project_title, normalize_project_classification
from projects.utils import categorize_project, load_legal_text


def _safe_text(value: Any) -> str:
    return "" if value is None else str(value).strip()


def _null_if_blank(value: Any) -> str | None:
    text = _safe_text(value)
    return text or None


def _decimal_or_none(value: Any) -> Decimal | None:
    text = _safe_text(value).replace("$", "").replace(",", "")
    if not text:
        return None
    try:
        return Decimal(text)
    except (InvalidOperation, ValueError):
        return None


def _safe_list(value: Any) -> list:
    if isinstance(value, list):
        return value
    if isinstance(value, tuple):
        return list(value)
    if isinstance(value, dict):
        return [value]
    return []


def _load_legal_text_safe(filename: str) -> str:
    try:
        return load_legal_text(filename)
    except FileNotFoundError:
        return ""


def _photo_refs_for_intake(intake: ProjectIntake | None) -> list[dict[str, Any]]:
    if intake is None or not getattr(intake, "pk", None):
        return []
    refs = []
    for photo in ProjectIntakeClarificationPhoto.objects.filter(project_intake=intake).order_by("uploaded_at", "id"):
        refs.append(
            {
                "id": photo.id,
                "url": getattr(photo.image, "url", "") if photo.image else "",
                "caption": photo.caption,
                "original_name": photo.original_name,
            }
        )
    return refs


def _entry_from_listing(listing: ContractorDirectoryListing) -> ContractorDirectoryEntry | None:
    return upsert_directory_entry_from_place(
        {
            "id": listing.google_place_id or f"listing:{listing.id}",
            "business_name": listing.business_name,
            "website_url": listing.website_url,
            "phone_number": listing.phone_number,
            "public_email": listing.email,
            "formatted_address": listing.formatted_address,
            "city": listing.city,
            "state": listing.state,
            "zip_code": listing.zip_code,
            "latitude": listing.latitude,
            "longitude": listing.longitude,
            "rating": listing.google_rating,
            "review_count": listing.google_review_count,
            "primary_trade": listing.primary_trade,
            "trade_categories": listing.trade_categories,
            "source": ContractorDirectoryEntry.SOURCE_PUBLIC_INTAKE,
        },
        context={"source_type": ContractorDirectoryDiscovery.SOURCE_PUBLIC_INTAKE},
    )


def _entry_from_contractor(contractor: Contractor) -> ContractorDirectoryEntry:
    data = {
        "business_name": contractor.business_name or contractor.name or contractor.email,
        "normalized_name": normalize_business_name(contractor.business_name or contractor.name or contractor.email),
        "website": None,
        "website_domain": None,
        "phone": _null_if_blank(contractor.phone),
        "normalized_phone": _null_if_blank(normalize_phone(contractor.phone)),
        "public_email": _null_if_blank(contractor.email),
        "address_line1": _null_if_blank(contractor.address),
        "city": _null_if_blank(contractor.city),
        "state": _null_if_blank(contractor.state),
        "zip_code": _null_if_blank(contractor.zip),
        "services": [skill.name for skill in contractor.skills.all()],
        "source": ContractorDirectoryEntry.SOURCE_PUBLIC_INTAKE,
        "claimed": True,
        "claimed_by_contractor": contractor,
    }
    entry = ContractorDirectoryEntry.objects.filter(claimed_by_contractor=contractor).first()
    if entry is None and data["normalized_phone"]:
        entry = ContractorDirectoryEntry.objects.filter(normalized_phone=data["normalized_phone"]).first()
    if entry is None:
        entry = ContractorDirectoryEntry.objects.create(**data)
    else:
        for field, value in data.items():
            if value not in (None, "", []) and getattr(entry, field) != value:
                setattr(entry, field, value)
        entry.claimed = True
        entry.claimed_by_contractor = contractor
        entry.save()
    return entry


def resolve_directory_entry_from_selection(selection: dict[str, Any]) -> ContractorDirectoryEntry | None:
    directory_entry_id = _safe_text(selection.get("directory_entry_id"))
    if directory_entry_id.isdigit():
        entry = ContractorDirectoryEntry.objects.filter(pk=int(directory_entry_id)).first()
        if entry:
            return entry

    target_id = _safe_text(selection.get("id"))
    target_type, _, target_value = target_id.partition(":")
    if not target_value:
        target_type = _safe_text(selection.get("source"))
        target_value = target_id

    if target_type in {"directory_entry", "entry"} and target_value.isdigit():
        return ContractorDirectoryEntry.objects.filter(pk=int(target_value)).first()
    if target_type == "listing" and target_value.isdigit():
        listing = ContractorDirectoryListing.objects.filter(pk=int(target_value)).first()
        return _entry_from_listing(listing) if listing else None
    if target_type == "contractor" and target_value.isdigit():
        contractor = Contractor.objects.filter(pk=int(target_value)).first()
        return _entry_from_contractor(contractor) if contractor else None

    place_payload = selection.get("place") if isinstance(selection.get("place"), dict) else selection
    return upsert_directory_entry_from_place(
        place_payload,
        context={"source_type": ContractorDirectoryDiscovery.SOURCE_PUBLIC_INTAKE},
    )


def _opportunity_defaults(context: dict[str, Any]) -> dict[str, Any]:
    intake = context.get("intake_request")
    payload = context.get("payload") or {}
    measurements = payload.get("measurements") or payload.get("measurement_answers")
    if measurements is None and intake is not None:
        measurements = getattr(intake, "ai_analysis_payload", {}).get("measurements", [])
    project_description = _null_if_blank(payload.get("project_description") or payload.get("description") or getattr(intake, "accomplishment_text", ""))
    refined_description = _null_if_blank(payload.get("refined_description") or getattr(intake, "ai_description", ""))
    normalized_classification = normalize_project_classification(
        project_type=payload.get("project_type") or getattr(intake, "ai_project_type", ""),
        project_subtype=payload.get("project_subtype") or getattr(intake, "ai_project_subtype", ""),
        description=project_description,
        refined_description=refined_description,
    )
    project_type = _null_if_blank(normalized_classification.get("project_type"))
    project_subtype = _null_if_blank(normalized_classification.get("project_subtype"))
    project_title = generate_project_title(
        project_title=payload.get("project_title") or getattr(intake, "ai_project_title", ""),
        project_type=project_type,
        project_subtype=project_subtype,
        description=project_description,
        refined_description=refined_description,
        measurements=measurements,
    )

    return {
        "project": context.get("project"),
        "homeowner_name": _null_if_blank(payload.get("homeowner_name") or payload.get("customer_name") or getattr(intake, "customer_name", "")),
        "homeowner_email": _null_if_blank(payload.get("homeowner_email") or payload.get("customer_email") or getattr(intake, "customer_email", "")),
        "homeowner_phone": _null_if_blank(payload.get("homeowner_phone") or payload.get("customer_phone") or getattr(intake, "customer_phone", "")),
        "project_address": _null_if_blank(payload.get("project_address") or payload.get("project_address_line1") or getattr(intake, "project_address_line1", "")),
        "project_city": _null_if_blank(payload.get("project_city") or getattr(intake, "project_city", "")),
        "project_state": _null_if_blank(payload.get("project_state") or getattr(intake, "project_state", "")),
        "project_zip": _null_if_blank(payload.get("project_zip") or payload.get("project_postal_code") or getattr(intake, "project_postal_code", "")),
        "project_type": project_type,
        "project_subtype": project_subtype,
        "project_title": project_title,
        "project_description": project_description,
        "refined_description": refined_description,
        "budget_min": _decimal_or_none(payload.get("budget_min")),
        "budget_max": _decimal_or_none(payload.get("budget_max")),
        "timeline": _null_if_blank(payload.get("timeline") or getattr(intake, "desired_timing_text", "")),
        "measurements": _safe_list(measurements),
        "photos": _safe_list(payload.get("photos")) or _photo_refs_for_intake(intake),
        "selected_by_homeowner": True,
    }


def mark_directory_discovery_selected(directory_entry: ContractorDirectoryEntry, context: dict[str, Any] | None = None) -> int:
    context = context or {}
    qs = ContractorDirectoryDiscovery.objects.filter(directory_entry=directory_entry)
    if context.get("intake_request") is not None:
        qs = qs.filter(intake_request=context["intake_request"])
    updated = qs.update(selected_by_homeowner=True)
    return updated


@transaction.atomic
def create_or_update_opportunity_from_selection(selection_context: dict[str, Any]) -> ContractorOpportunity:
    directory_entry = selection_context.get("directory_entry")
    if directory_entry is None:
        directory_entry = resolve_directory_entry_from_selection(selection_context.get("selection") or selection_context)
    if directory_entry is None:
        raise ValueError("Selected contractor could not be matched to a directory entry.")

    intake = selection_context.get("intake_request")
    defaults = _opportunity_defaults(selection_context)
    lookup = {"directory_entry": directory_entry, "intake_request": intake}
    if intake is None:
        lookup = {
            "directory_entry": directory_entry,
            "homeowner_email": defaults.get("homeowner_email"),
            "project_title": defaults.get("project_title"),
            "status": ContractorOpportunity.STATUS_PENDING,
        }
    opportunity, _created = ContractorOpportunity.objects.update_or_create(
        defaults=defaults,
        **lookup,
    )
    mark_directory_discovery_selected(directory_entry, {"intake_request": intake})
    return opportunity


def _find_or_create_customer(opportunity: ContractorOpportunity, contractor: Contractor) -> Homeowner:
    email = _safe_text(opportunity.homeowner_email)
    phone = _safe_text(opportunity.homeowner_phone)
    qs = Homeowner.objects.filter(created_by=contractor)
    homeowner = qs.filter(email__iexact=email).first() if email else None
    if homeowner is None and phone:
        homeowner = qs.filter(phone_number=phone).first()
    if homeowner is not None:
        return homeowner
    return Homeowner.objects.create(
        created_by=contractor,
        full_name=opportunity.homeowner_name or "Project Lead",
        email=email or f"opportunity-{opportunity.pk}@pending.myhomebro.local",
        phone_number=phone,
        street_address=opportunity.project_address or "",
        city=opportunity.project_city or "",
        state=opportunity.project_state or "",
        zip_code=opportunity.project_zip or "",
    )


@transaction.atomic
def convert_opportunity_to_customer_and_draft_agreement(opportunity: ContractorOpportunity, contractor: Contractor) -> dict[str, Any]:
    opportunity = ContractorOpportunity.objects.select_for_update().get(pk=opportunity.pk)
    if opportunity.converted_customer_id and opportunity.converted_agreement_id:
        return {"customer": opportunity.converted_customer, "agreement": opportunity.converted_agreement, "created": False}

    customer = opportunity.converted_customer or _find_or_create_customer(opportunity, contractor)
    generated_title = generate_project_title(
        project_title=opportunity.project_title,
        project_type=opportunity.project_type,
        project_subtype=opportunity.project_subtype,
        description=opportunity.project_description,
        refined_description=opportunity.refined_description,
        measurements=opportunity.measurements,
    )
    project = opportunity.project
    if project is None:
        project = Project.objects.create(
            contractor=contractor,
            homeowner=customer,
            title=generated_title,
            description=opportunity.refined_description or opportunity.project_description or "",
            project_street_address=opportunity.project_address or "",
            project_city=opportunity.project_city or "",
            project_state=opportunity.project_state or "",
            project_zip_code=opportunity.project_zip or "",
        )

    agreement = opportunity.converted_agreement
    if agreement is None:
        terms = _load_legal_text_safe("terms_of_service.txt")
        privacy = _load_legal_text_safe("privacy_policy.txt")
        agreement = Agreement.objects.create(
            project=project,
            contractor=contractor,
            homeowner=customer,
            description=opportunity.refined_description or opportunity.project_description or "",
            project_type=opportunity.project_type or "",
            project_subtype=opportunity.project_subtype or "",
            standardized_category=categorize_project(opportunity.project_type or "", opportunity.project_subtype or ""),
            project_address_line1=opportunity.project_address or "",
            project_address_city=opportunity.project_city or "",
            project_address_state=opportunity.project_state or "",
            project_postal_code=opportunity.project_zip or "",
            status="draft",
            terms_text=terms,
            privacy_text=privacy,
            collaboration_summary_snapshot={
                "source": "contractor_opportunity",
                "opportunity_id": opportunity.id,
                "measurements": opportunity.measurements,
                "photos": opportunity.photos,
                "budget_min": str(opportunity.budget_min) if opportunity.budget_min is not None else "",
                "budget_max": str(opportunity.budget_max) if opportunity.budget_max is not None else "",
                "timeline": opportunity.timeline or "",
            },
        )

    opportunity.project = project
    opportunity.converted_customer = customer
    opportunity.converted_agreement = agreement
    opportunity.status = ContractorOpportunity.STATUS_CONVERTED
    opportunity.conversion_notes = "Converted to draft agreement workspace."
    opportunity.save(
        update_fields=[
            "project",
            "converted_customer",
            "converted_agreement",
            "status",
            "conversion_notes",
            "updated_at",
        ]
    )
    if opportunity.intake_request_id:
        intake = opportunity.intake_request
        intake.homeowner = customer
        intake.agreement = agreement
        intake.status = "converted"
        intake.converted_at = intake.converted_at or timezone.now()
        intake.save(update_fields=["homeowner", "agreement", "status", "converted_at", "updated_at"])

    return {"customer": customer, "agreement": agreement, "created": True}


@transaction.atomic
def accept_contractor_opportunity(opportunity: ContractorOpportunity, contractor: Contractor) -> dict[str, Any]:
    opportunity = ContractorOpportunity.objects.select_for_update().select_related("directory_entry").get(pk=opportunity.pk)
    linked = opportunity.directory_entry.claimed_by_contractor_id == contractor.id
    if not linked:
        raise PermissionError("This opportunity is not linked to your contractor profile.")

    if opportunity.status == ContractorOpportunity.STATUS_CONVERTED and opportunity.converted_agreement_id:
        return {
            "opportunity": opportunity,
            "customer": opportunity.converted_customer,
            "agreement": opportunity.converted_agreement,
            "created": False,
        }

    if opportunity.accepted_at is None:
        opportunity.accepted_at = timezone.now()
    opportunity.accepted_by_contractor = contractor
    opportunity.status = ContractorOpportunity.STATUS_ACCEPTED
    opportunity.save(update_fields=["accepted_at", "accepted_by_contractor", "status", "updated_at"])
    converted = convert_opportunity_to_customer_and_draft_agreement(opportunity, contractor)
    opportunity.refresh_from_db()
    return {"opportunity": opportunity, **converted}
