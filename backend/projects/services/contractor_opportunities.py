from __future__ import annotations

from decimal import Decimal, InvalidOperation
from typing import Any

from django.db import transaction
from django.utils import timezone

from projects.models import Agreement, Contractor, Homeowner, Notification, Project
from projects.models_contractor_discovery import (
    ContractorDirectoryDiscovery,
    ContractorDirectoryEntry,
    ContractorDirectoryListing,
    ContractorOpportunity,
)
from projects.models_customer_portal import PropertyWorkOrder, PropertyWorkOrderActivity
from projects.models_project_intake import ProjectIntake, ProjectIntakeClarificationPhoto
from projects.services.contractor_directory import normalize_business_name, normalize_phone, normalize_website_domain, upsert_directory_entry_from_place
from projects.services.customer_lifecycle import sync_customer_request_agreement_links, upsert_customer_for_contractor_opportunity
from projects.services.marketplace_permissions import contractor_marketplace_action_block_reason
from projects.services.notification_center import create_notification
from projects.services.project_titles import generate_project_title, normalize_project_classification
from projects.services.sms_automation import evaluate_sms_automation
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
    opportunity, created = ContractorOpportunity.objects.update_or_create(
        defaults=defaults,
        **lookup,
    )
    upsert_customer_for_contractor_opportunity(opportunity)
    mark_directory_discovery_selected(directory_entry, {"intake_request": intake})
    if created and not selection_context.get("suppress_contractor_notification"):
        _notify_selected_contractor_opportunity(opportunity)
    return opportunity


def _notify_selected_contractor_opportunity(opportunity: ContractorOpportunity) -> None:
    directory_entry = getattr(opportunity, "directory_entry", None)
    contractor = getattr(directory_entry, "claimed_by_contractor", None)
    if contractor is None:
        return
    project_title = _safe_text(getattr(opportunity, "project_title", "")) or "New project opportunity"
    homeowner_name = _safe_text(getattr(opportunity, "homeowner_name", "")) or "A homeowner"
    create_notification(
        contractor=contractor,
        user=getattr(contractor, "user", None),
        category=Notification.EVENT_CONTRACTOR_OPPORTUNITY_RECEIVED,
        title="New marketplace opportunity",
        body=f"{homeowner_name} selected your business to review {project_title}.",
        link=f"/app/bids?opportunity={opportunity.id}",
        actor_display_name=homeowner_name,
        actor_email=_safe_text(getattr(opportunity, "homeowner_email", "")),
    )
    evaluate_sms_automation(
        "contractor_opportunity_received",
        contractor=contractor,
        metadata={
            "opportunity_id": opportunity.id,
            "project_title": project_title,
            "homeowner_name": homeowner_name,
            "source": "public_intake_selected_contractor",
        },
    )


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


def _add_property_work_order_activity(work_order: PropertyWorkOrder, activity_type: str, message: str, actor: str = "") -> None:
    PropertyWorkOrderActivity.objects.create(
        work_order=work_order,
        activity_type=activity_type,
        message=_safe_text(message),
        actor=_safe_text(actor).lower(),
    )


def _work_order_agreement_description(work_order: PropertyWorkOrder) -> str:
    property_profile = work_order.property_profile
    unit = getattr(work_order, "unit", None)
    source_request = getattr(work_order, "source_tenant_request", None)
    lines = [
        _safe_text(work_order.description),
        "",
        f"Source work order: {work_order.work_order_number or f'PWO-{work_order.id:06d}'}",
        f"Priority: {work_order.get_priority_display()}",
    ]
    if property_profile is not None:
        address = ", ".join(
            part
            for part in [
                _safe_text(getattr(property_profile, "address_line1", "")),
                _safe_text(getattr(property_profile, "city", "")),
                _safe_text(getattr(property_profile, "state", "")),
                _safe_text(getattr(property_profile, "postal_code", "")),
            ]
            if part
        )
        if address:
            lines.append(f"Property: {address}")
    if unit is not None:
        lines.append(f"Unit: {_safe_text(getattr(unit, 'unit_label', ''))}")
    if source_request is not None:
        lines.append(f"Tenant request: TMR-{source_request.id:06d}")
        submitted_by = _safe_text(getattr(source_request, "submitted_by_name", ""))
        if submitted_by:
            lines.append(f"Resident contact: {submitted_by}")
    return "\n".join(line for line in lines if line is not None).strip()


@transaction.atomic
def create_property_work_order_agreement_draft(
    work_order: PropertyWorkOrder,
    *,
    actor: str = "",
    contractor: Contractor | None = None,
) -> dict[str, Any]:
    work_order = (
        PropertyWorkOrder.objects.select_for_update()
        .select_related(
            "property_management_company",
            "property_management_company__homeowner",
            "property_profile",
            "unit",
            "tenant",
            "source_tenant_request",
            "assigned_contractor",
            "linked_project",
            "linked_agreement",
        )
        .get(pk=work_order.pk)
    )
    if work_order.assignment_type != PropertyWorkOrder.ASSIGNMENT_MARKETPLACE_CONTRACTOR:
        raise ValueError("Only marketplace contractor work orders can create agreement drafts.")
    if work_order.marketplace_status != PropertyWorkOrder.MARKETPLACE_ACCEPTED:
        raise ValueError("The marketplace contractor must accept this work order before creating an agreement draft.")
    assigned_contractor = contractor or work_order.assigned_contractor
    if assigned_contractor is None or work_order.assigned_contractor_id is None:
        raise ValueError("This work order does not have an assigned marketplace contractor.")
    if contractor is not None and work_order.assigned_contractor_id != contractor.id:
        raise PermissionError("Only the assigned contractor can create this agreement draft.")
    if work_order.linked_agreement_id:
        return {
            "project": work_order.linked_project or getattr(work_order.linked_agreement, "project", None),
            "agreement": work_order.linked_agreement,
            "created": False,
            "work_order": work_order,
        }

    company = work_order.property_management_company
    customer = getattr(company, "homeowner", None)
    if customer is None:
        raise ValueError("This property management company is missing a customer account.")
    property_profile = work_order.property_profile
    title = _safe_text(work_order.title) or f"Work order {work_order.work_order_number or work_order.id}"
    description = _work_order_agreement_description(work_order)
    project = work_order.linked_project
    if project is None:
        project = Project.objects.create(
            contractor=assigned_contractor,
            homeowner=customer,
            title=title,
            description=description,
            project_street_address=_safe_text(getattr(property_profile, "address_line1", "")),
            project_city=_safe_text(getattr(property_profile, "city", "")),
            project_state=_safe_text(getattr(property_profile, "state", "")),
            project_zip_code=_safe_text(getattr(property_profile, "postal_code", "")),
            status="draft",
        )

    terms = _load_legal_text_safe("terms_of_service.txt")
    privacy = _load_legal_text_safe("privacy_policy.txt")
    agreement = Agreement.objects.create(
        project=project,
        contractor=assigned_contractor,
        homeowner=customer,
        description=description,
        project_type=work_order.get_category_display(),
        project_subtype=work_order.get_priority_display(),
        standardized_category=categorize_project(work_order.get_category_display(), work_order.get_priority_display()),
        project_address_line1=_safe_text(getattr(property_profile, "address_line1", "")),
        project_address_city=_safe_text(getattr(property_profile, "city", "")),
        project_address_state=_safe_text(getattr(property_profile, "state", "")),
        project_postal_code=_safe_text(getattr(property_profile, "postal_code", "")),
        status="draft",
        step_status="property_work_order_draft",
        terms_text=terms,
        privacy_text=privacy,
        collaboration_summary_snapshot={
            "source": "property_work_order",
            "source_label": "Property work order",
            "property_work_order_id": work_order.id,
            "work_order_number": work_order.work_order_number,
            "property_profile_id": work_order.property_profile_id,
            "property_name": _safe_text(getattr(property_profile, "display_name", "")),
            "unit_id": work_order.unit_id,
            "unit_label": _safe_text(getattr(getattr(work_order, "unit", None), "unit_label", "")),
            "tenant_id": work_order.tenant_id,
            "source_tenant_request_id": work_order.source_tenant_request_id,
            "category": work_order.category,
            "priority": work_order.priority,
        },
    )

    accepted_opportunity = (
        ContractorOpportunity.objects.filter(
            property_work_order=work_order,
            accepted_by_contractor=assigned_contractor,
        )
        .order_by("-accepted_at", "-id")
        .first()
    )
    if accepted_opportunity is not None:
        accepted_opportunity.project = project
        accepted_opportunity.converted_customer = customer
        accepted_opportunity.converted_agreement = agreement
        accepted_opportunity.status = ContractorOpportunity.STATUS_CONVERTED
        accepted_opportunity.conversion_notes = "Converted property work order to draft agreement workspace."
        accepted_opportunity.save(
            update_fields=[
                "project",
                "converted_customer",
                "converted_agreement",
                "status",
                "conversion_notes",
                "updated_at",
            ]
        )

    work_order.linked_project = project
    work_order.linked_agreement = agreement
    work_order.save(update_fields=["linked_project", "linked_agreement", "updated_at"])
    _add_property_work_order_activity(
        work_order,
        PropertyWorkOrderActivity.TYPE_AGREEMENT_DRAFT_CREATED,
        f"Agreement draft created for {assigned_contractor.business_name or assigned_contractor.name}.",
        actor,
    )
    return {"project": project, "agreement": agreement, "created": True, "work_order": work_order}


@transaction.atomic
def accept_property_work_order_opportunity(opportunity: ContractorOpportunity, contractor: Contractor) -> dict[str, Any]:
    opportunity = ContractorOpportunity.objects.select_for_update().select_related("directory_entry", "property_work_order").get(pk=opportunity.pk)
    linked = opportunity.directory_entry.claimed_by_contractor_id == contractor.id
    if not linked:
        raise PermissionError("This opportunity is not linked to your contractor profile.")

    block_reason = contractor_marketplace_action_block_reason(contractor)
    if block_reason:
        raise PermissionError(block_reason)

    work_order = opportunity.property_work_order
    if work_order is None:
        raise PermissionError("This work order opportunity is no longer available.")
    if work_order.marketplace_status == PropertyWorkOrder.MARKETPLACE_WITHDRAWN:
        raise PermissionError("This work order opportunity has been withdrawn.")
    if work_order.marketplace_status == PropertyWorkOrder.MARKETPLACE_ACCEPTED and work_order.assigned_contractor_id not in {None, contractor.id}:
        raise PermissionError("This work order opportunity has already been accepted.")

    now = timezone.now()
    if opportunity.accepted_at is None:
        opportunity.accepted_at = now
    opportunity.accepted_by_contractor = contractor
    opportunity.status = ContractorOpportunity.STATUS_ACCEPTED
    opportunity.save(update_fields=["accepted_at", "accepted_by_contractor", "status", "updated_at"])

    work_order.assignment_type = PropertyWorkOrder.ASSIGNMENT_MARKETPLACE_CONTRACTOR
    work_order.assigned_contractor = contractor
    work_order.assigned_staff_member = None
    work_order.assigned_vendor = None
    work_order.marketplace_status = PropertyWorkOrder.MARKETPLACE_ACCEPTED
    work_order.marketplace_response_at = now
    work_order.save(
        update_fields=[
            "assignment_type",
            "assigned_contractor",
            "assigned_staff_member",
            "assigned_vendor",
            "marketplace_status",
            "marketplace_response_at",
            "updated_at",
        ]
    )
    ContractorOpportunity.objects.filter(property_work_order=work_order, status=ContractorOpportunity.STATUS_PENDING).exclude(pk=opportunity.pk).update(status=ContractorOpportunity.STATUS_EXPIRED, updated_at=now)
    _add_property_work_order_activity(
        work_order,
        PropertyWorkOrderActivity.TYPE_MARKETPLACE_ACCEPTED,
        f"Marketplace opportunity accepted by {contractor.business_name or contractor.name}.",
        getattr(contractor.user, "email", ""),
    )
    return {"opportunity": opportunity, "work_order": work_order, "created": False}


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
        sync_customer_request_agreement_links(intake=intake, agreement=agreement, project=project)

    return {"customer": customer, "agreement": agreement, "created": True}


@transaction.atomic
def accept_contractor_opportunity(opportunity: ContractorOpportunity, contractor: Contractor) -> dict[str, Any]:
    opportunity = ContractorOpportunity.objects.select_for_update().select_related("directory_entry").get(pk=opportunity.pk)
    if opportunity.property_work_order_id:
        return accept_property_work_order_opportunity(opportunity, contractor)
    linked = opportunity.directory_entry.claimed_by_contractor_id == contractor.id
    if not linked:
        raise PermissionError("This opportunity is not linked to your contractor profile.")

    block_reason = contractor_marketplace_action_block_reason(contractor)
    if block_reason:
        raise PermissionError(block_reason)

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
