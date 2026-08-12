from __future__ import annotations

import re
import secrets
from decimal import Decimal, InvalidOperation

from django.db import IntegrityError, transaction
from django.contrib.auth import get_user_model
from django.contrib.auth.password_validation import validate_password
from django.core.exceptions import ValidationError as DjangoValidationError
from django.db.models import Q
from django.shortcuts import get_object_or_404
from django.utils.dateparse import parse_date
from django.utils import timezone
from rest_framework.permissions import AllowAny, IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

from projects.models import Homeowner
from projects.models_contractor_discovery import ContractorOpportunity, OpportunityEstimateAppointment
from projects.models_proposals import Proposal, ProposalActivity, ProposalAttachment, ProposalLineItem, ProposalMeasurement, ProposalReviewVersion
from projects.services.proposal_customer_review import (
    ACKNOWLEDGEMENT,
    ReviewAccessError,
    build_customer_snapshot,
    public_review_payload,
    portal_token_for_email,
    resolve_activation_token,
    resolve_token,
    review_delivery_eligibility,
    send_review,
    token_for,
    notify_contractor_of_review_event,
)
User = get_user_model()
from projects.models_templates import ProjectTemplate
from projects.services.proposal_pricing_benchmark import build_proposal_pricing_benchmark
from projects.services.customer_conversations import add_contractor_reply, add_estimate_customer_message, conversation_for_proposal, serialize_conversation
from projects.views.contractor_bids import (
    _appointment_key,
    _resolve_contractor,
    _resolve_estimate_source,
    _safe_text,
    _serialize_estimate_appointment,
)

PROPOSAL_UNIT_ALIASES = {
    "each": "ea", "item": "ea", "items": "ea", "lump sum": "ls", "lump-sum": "ls",
    "hour": "hr", "hours": "hr", "hrs": "hr", "days": "day", "inch": "in", "inches": "in",
    "foot": "ft", "feet": "ft", "linear feet": "lf", "linear foot": "lf", "linear ft": "lf", "lin ft": "lf",
    "square feet": "sf", "square foot": "sf", "sq ft": "sf", "sqft": "sf", "square yards": "sy", "square yard": "sy",
    "cubic feet": "cf", "cubic foot": "cf", "cubic yards": "cy", "cubic yard": "cy", "pound": "lb", "pounds": "lb",
    "lbs": "lb", "tons": "ton", "gallon": "gal", "gallons": "gal",
}
PROPOSAL_UNIT_CODES = {"ea", "ls", "hr", "day", "in", "ft", "lf", "sf", "sy", "cf", "cy", "lb", "ton", "gal", "sheet", "roll", "bag", "box", "fixture", "room", "assembly", "trip", "bundle"}


def _normalize_proposal_unit(value):
    unit = " ".join(_safe_text(value).split())
    if not unit:
        return "", None
    lower = unit.lower()
    normalized = PROPOSAL_UNIT_ALIASES.get(lower, lower if lower in PROPOSAL_UNIT_CODES else unit)
    if len(normalized) > 30:
        return "", "Custom unit must be 30 characters or fewer."
    if re.search(r"[<>]|https?://|www\.|\S+@\S+|\b\d{3}[-.\s]\d{3}[-.\s]\d{4}\b", normalized, re.I):
        return "", "Enter a unit without markup, URLs, or contact information."
    return normalized, None


def _format_datetime(value):
    if not value:
        return None
    try:
        return timezone.localtime(value).isoformat()
    except Exception:
        return value.isoformat() if hasattr(value, "isoformat") else str(value)


def _proposal_status_label(status: str) -> str:
    return dict(Proposal.STATUS_CHOICES).get(status, status)


def _proposal_source_type(value: str) -> str:
    normalized = _safe_text(value).lower()
    if normalized in {Proposal.SOURCE_PROPERTY_WORK_ORDER, Proposal.SOURCE_DASHBOARD}:
        return normalized
    key = _appointment_key(value, 1)
    if key is None:
        return ""
    return key[0]


def _activity(proposal: Proposal, event_type: str, message: str, actor=None, metadata=None):
    return ProposalActivity.objects.create(
        proposal=proposal,
        event_type=event_type,
        message=message,
        actor=actor,
        metadata=metadata or {},
    )


def _serialize_measurement(measurement: ProposalMeasurement) -> dict:
    return {
        "id": measurement.id,
        "label": measurement.label,
        "location": measurement.location,
        "quantity": f"{measurement.quantity:.2f}",
        "unit": measurement.unit,
        "notes": measurement.notes,
        "created_at": _format_datetime(measurement.created_at),
        "updated_at": _format_datetime(measurement.updated_at),
    }


def _money(value) -> str:
    return f"{Decimal(value or 0):.2f}"


def _to_decimal(value, field_name: str):
    try:
        return Decimal(str(value))
    except (InvalidOperation, TypeError, ValueError):
        raise ValueError(field_name)


def _serialize_line_item(item: ProposalLineItem) -> dict:
    return {
        "id": item.id,
        "category": item.category,
        "category_label": item.get_category_display(),
        "description": item.description,
        "quantity": _money(item.quantity),
        "unit": item.unit,
        "unit_price": _money(item.unit_price),
        "total": _money(item.total),
        "notes": item.notes,
        "source_template_id": item.source_template_id,
        "source_template_milestone_id": item.source_template_milestone_id,
        "source_milestone_key": item.source_milestone_key,
        "source_milestone_name": item.source_milestone_name,
        "source_milestone_order": item.source_milestone_order,
        "source_allocation_percent": _money(item.source_allocation_percent) if item.source_allocation_percent is not None else None,
        "created_at": _format_datetime(item.created_at),
        "updated_at": _format_datetime(item.updated_at),
    }


def _proposal_totals(proposal: Proposal) -> dict:
    subtotal = Decimal("0.00")
    tax = Decimal("0.00")
    discounts = Decimal("0.00")
    incidentals = Decimal("0.00")
    line_count = 0
    items = list(getattr(proposal, "_prefetched_objects_cache", {}).get("line_items", [])) or list(proposal.line_items.all())
    for item in items:
        line_count += 1
        amount = Decimal(item.total or 0)
        if item.category == ProposalLineItem.CATEGORY_TAX:
            tax += amount
        elif item.category == ProposalLineItem.CATEGORY_DISCOUNT:
            discounts += abs(amount)
        elif item.category == ProposalLineItem.CATEGORY_INCIDENTALS_RESERVE:
            incidentals += amount
        else:
            subtotal += amount
    total = subtotal + tax + incidentals - discounts
    return {
        "subtotal": _money(subtotal),
        "tax": _money(tax),
        "discounts": _money(discounts),
        "incidentals_reserve": _money(incidentals),
        "total": _money(total),
        "line_item_count": line_count,
    }


def _related_count(instance, related_name: str) -> int:
    try:
        cached = getattr(instance, "_prefetched_objects_cache", {}).get(related_name)
        if cached is not None:
            return len(cached)
        return getattr(instance, related_name).count()
    except Exception:
        return 0


def _serialize_attachment(attachment: ProposalAttachment, request=None) -> dict:
    url = attachment.file.url if attachment.file else ""
    if url and request is not None:
        url = request.build_absolute_uri(url)
    return {
        "id": attachment.id,
        "attachment_type": attachment.attachment_type,
        "attachment_type_label": attachment.get_attachment_type_display(),
        "category": attachment.category,
        "category_label": attachment.get_category_display(),
        "original_name": attachment.original_name,
        "caption": attachment.caption,
        "notes": attachment.notes,
        "url": url,
        "created_at": _format_datetime(attachment.created_at),
        "updated_at": _format_datetime(attachment.updated_at),
    }


def _serialize_activity(event: ProposalActivity) -> dict:
    return {
        "id": event.id,
        "event_type": event.event_type,
        "event_label": event.get_event_type_display(),
        "message": event.message,
        "metadata": event.metadata or {},
        "created_at": _format_datetime(event.created_at),
    }


def _serialize_proposal(proposal: Proposal, request=None, include_related=True) -> dict:
    from projects.services.proposal_lifecycle import synchronize_proposal_lifecycle

    synchronize_proposal_lifecycle(proposal)
    appointment = getattr(proposal, "estimate_appointment", None)
    opportunity = getattr(proposal, "contractor_opportunity", None)
    customer_id = getattr(opportunity, "converted_customer_id", None)
    linked_agreement = proposal.converted_agreement or (getattr(opportunity, "converted_agreement", None) if opportunity else None)
    linked_opportunity_title = getattr(opportunity, "project_title", "") if opportunity else ""
    linked_agreement_title = ""
    if linked_agreement is not None:
        linked_project = getattr(linked_agreement, "project", None)
        linked_agreement_title = getattr(linked_project, "title", "") or getattr(linked_agreement, "title", "") or ""
    data = {
        "id": proposal.id,
        "status": proposal.status,
        "status_label": _proposal_status_label(proposal.status),
        "selected_template_id": proposal.selected_template_id,
        "selected_template_name": proposal.selected_template_name_snapshot,
        "selected_template_source": proposal.selected_template_source_snapshot,
        "pricing_template_name": proposal.pricing_template_name_snapshot,
        "source_type": proposal.source_type,
        "source_id": proposal.source_id,
        "contractor_opportunity_id": proposal.contractor_opportunity_id,
        "linked_opportunity_id": proposal.contractor_opportunity_id,
        "linked_opportunity_title": linked_opportunity_title,
        "linked_opportunity_url": f"/app/opportunities?opportunity={proposal.contractor_opportunity_id}" if proposal.contractor_opportunity_id else "",
        "linked_agreement_id": getattr(linked_agreement, "id", None),
        "linked_agreement_title": linked_agreement_title,
        "linked_agreement_url": f"/app/agreements/{linked_agreement.id}" if linked_agreement is not None else "",
        "converted_at": _format_datetime(proposal.converted_at),
        "conversion_method": proposal.conversion_method,
        "converted_review_version": getattr(proposal.converted_review_version, "version", None),
        "customer_id": customer_id,
        "homeowner_id": customer_id,
        "estimate_appointment_id": proposal.estimate_appointment_id,
        "project_title": proposal.project_title,
        "project_summary": proposal.project_summary,
        "project_type": proposal.project_type,
        "project_subtype": proposal.project_subtype,
        "customer_name": proposal.customer_name,
        "customer_email": proposal.customer_email,
        "customer_phone": proposal.customer_phone,
        "customer_preferred_contact": proposal.customer_preferred_contact,
        "service_location": proposal.service_location,
        "project_start_type": proposal.project_start_type,
        "project_start_date": proposal.project_start_date.isoformat() if proposal.project_start_date else "",
        "project_completion_type": proposal.project_completion_type,
        "project_completion_date": proposal.project_completion_date.isoformat() if proposal.project_completion_date else "",
        "scheduling_priority": proposal.scheduling_priority,
        "site_visit_notes": proposal.site_visit_notes,
        "access_notes": proposal.access_notes,
        "risk_notes": proposal.risk_notes,
        "customer_requests": proposal.customer_requests,
        "site_conditions": proposal.site_conditions,
        "quick_checklist": proposal.quick_checklist or [],
        "included_work": proposal.included_work,
        "excluded_work": proposal.excluded_work,
        "assumptions": proposal.assumptions,
        "allowances": proposal.allowances,
        "internal_notes": proposal.internal_notes,
        "appointment": _serialize_estimate_appointment(appointment) if appointment else None,
        "totals": _proposal_totals(proposal),
        "measurement_count": _related_count(proposal, "measurements"),
        "line_item_count": _related_count(proposal, "line_items"),
        "attachment_count": _related_count(proposal, "attachments"),
        "created_at": _format_datetime(proposal.created_at),
        "updated_at": _format_datetime(proposal.updated_at),
    }
    latest_review = proposal.review_versions.order_by("-version").first()
    data["customer_review"] = ({
        "version": latest_review.version,
        "sent_at": _format_datetime(latest_review.sent_at),
        "viewed_at": _format_datetime(latest_review.viewed_at),
        "expires_at": _format_datetime(latest_review.expires_at),
        "decision": latest_review.decision,
        "decided_at": _format_datetime(latest_review.decided_at),
        "decline_reason": latest_review.decline_reason,
        "revision_request_message": latest_review.revision_request_message,
        "delivery": latest_review.delivery_state,
    } if latest_review else None)
    data["customer_review_history"] = [
        {
            "version": item.version,
            "decision": item.decision,
            "decided_at": _format_datetime(item.decided_at),
            "revision_request_message": item.revision_request_message,
            "decline_reason": item.decline_reason,
            "accepted_by": item.accepted_by,
        }
        for item in proposal.review_versions.all()
        if item.decision != ProposalReviewVersion.DECISION_PENDING
    ]
    data["review_delivery_eligibility"] = review_delivery_eligibility(proposal)
    if include_related:
        data["measurements"] = [_serialize_measurement(item) for item in proposal.measurements.all()]
        data["line_items"] = [_serialize_line_item(item) for item in proposal.line_items.all()]
        data["attachments"] = [_serialize_attachment(item, request=request) for item in proposal.attachments.all()]
        data["activity"] = [_serialize_activity(item) for item in proposal.activity.all()[:50]]
    return data


def _proposal_queryset(contractor):
    return (
        Proposal.objects.filter(contractor=contractor)
        .select_related(
            "selected_template",
            "selected_template__source_system_template",
            "contractor_opportunity",
            "contractor_opportunity__converted_agreement",
            "contractor_opportunity__converted_agreement__project",
            "converted_agreement",
            "converted_agreement__project",
            "converted_review_version",
            "estimate_appointment",
        )
        .prefetch_related("measurements", "line_items", "attachments", "activity", "review_versions")
    )


def _snapshot_from_row(row: dict) -> dict:
    snapshot = row.get("request_snapshot") if isinstance(row.get("request_snapshot"), dict) else {}
    return {
        "project_title": _safe_text(row.get("project_title") or snapshot.get("project_title")),
        "project_summary": _safe_text(
            snapshot.get("project_scope_summary")
            or snapshot.get("project_summary")
            or snapshot.get("refined_description")
            or row.get("notes")
            or row.get("project_description")
        ),
        "project_type": _safe_text(row.get("project_type") or snapshot.get("project_type")),
        "project_subtype": _safe_text(row.get("project_subtype") or snapshot.get("project_subtype")),
        "customer_name": _safe_text(row.get("customer_name") or snapshot.get("customer_name")),
        "customer_email": _safe_text(row.get("customer_email") or snapshot.get("customer_email")),
        "customer_phone": _safe_text(row.get("customer_phone") or snapshot.get("customer_phone")),
        "customer_preferred_contact": _safe_text(
            row.get("preferred_contact_method")
            or row.get("customer_preferred_contact")
            or snapshot.get("preferred_contact_method")
            or snapshot.get("customer_preferred_contact")
        ),
        "service_location": _safe_text(row.get("location") or snapshot.get("location") or snapshot.get("service_location") or row.get("service_location")),
        "project_start_type": _safe_text(snapshot.get("project_start_type")) or Proposal.PROJECT_START_FLEXIBLE,
        "project_start_date": snapshot.get("project_start_date") or None,
        "project_completion_type": _safe_text(snapshot.get("project_completion_type")) or Proposal.PROJECT_COMPLETION_NO_DEADLINE,
        "project_completion_date": snapshot.get("project_completion_date") or None,
        "scheduling_priority": _safe_text(snapshot.get("scheduling_priority")) or Proposal.SCHEDULING_PRIORITY_FLEXIBLE,
    }


def _homeowner_address(homeowner: Homeowner) -> str:
    parts = [
        homeowner.street_address,
        homeowner.address_line_2,
        homeowner.city,
        homeowner.state,
        homeowner.zip_code,
    ]
    return ", ".join([_safe_text(part) for part in parts if _safe_text(part)])


def _dashboard_source_id(contractor) -> int:
    for _ in range(8):
        candidate = secrets.randbelow(2_000_000_000) + 1
        if not Proposal.objects.filter(
            contractor=contractor,
            source_type=Proposal.SOURCE_DASHBOARD,
            source_id=candidate,
        ).exists():
            return candidate
    return int(timezone.now().timestamp())


def _structured_schedule_from_payload(data):
    start_type = _safe_text(data.get("project_start_type")) or Proposal.PROJECT_START_FLEXIBLE
    completion_type = _safe_text(data.get("project_completion_type")) or Proposal.PROJECT_COMPLETION_NO_DEADLINE
    priority = _safe_text(data.get("scheduling_priority")) or Proposal.SCHEDULING_PRIORITY_FLEXIBLE

    if start_type not in dict(Proposal.PROJECT_START_CHOICES):
        return None, {"project_start_type": ["Choose a valid project start option."]}
    if completion_type not in dict(Proposal.PROJECT_COMPLETION_CHOICES):
        return None, {"project_completion_type": ["Choose a valid project completion option."]}
    if priority not in dict(Proposal.SCHEDULING_PRIORITY_CHOICES):
        return None, {"scheduling_priority": ["Choose a valid scheduling priority."]}

    start_date_raw = _safe_text(data.get("project_start_date"))
    completion_date_raw = _safe_text(data.get("project_completion_date"))
    start_date = parse_date(start_date_raw) if start_date_raw else None
    completion_date = parse_date(completion_date_raw) if completion_date_raw else None

    if start_date_raw and start_date is None:
        return None, {"project_start_date": ["Choose a valid project start date."]}
    if completion_date_raw and completion_date is None:
        return None, {"project_completion_date": ["Choose a valid project completion date."]}
    if start_type == Proposal.PROJECT_START_SPECIFIC_DATE and start_date is None:
        return None, {"project_start_date": ["Project start date is required when Project Start is Specific Date."]}
    if completion_type == Proposal.PROJECT_COMPLETION_SPECIFIC_DATE and completion_date is None:
        return None, {"project_completion_date": ["Project completion date is required when Project Completion is Specific Date."]}
    if start_type != Proposal.PROJECT_START_SPECIFIC_DATE:
        start_date = None
    if completion_type != Proposal.PROJECT_COMPLETION_SPECIFIC_DATE:
        completion_date = None

    return {
        "project_start_type": start_type,
        "project_start_date": start_date,
        "project_completion_type": completion_type,
        "project_completion_date": completion_date,
        "scheduling_priority": priority,
    }, None


def _dashboard_snapshot(contractor, request):
    customer = None
    customer_id = request.data.get("customer_id") or request.data.get("homeowner_id")
    if customer_id:
        try:
            customer_id_int = int(customer_id)
        except (TypeError, ValueError):
            return None, {"customer_id": ["Choose a valid customer."]}
        customer = Homeowner.objects.filter(created_by=contractor, pk=customer_id_int).first()
        if customer is None:
            return None, {"customer_id": ["Customer was not found."]}

    customer_name = _safe_text(request.data.get("customer_name") or request.data.get("full_name"))
    customer_email = _safe_text(request.data.get("customer_email") or request.data.get("email"))
    customer_phone = _safe_text(request.data.get("customer_phone") or request.data.get("phone") or request.data.get("phone_number"))
    service_location = _safe_text(request.data.get("service_location") or request.data.get("property_address") or request.data.get("address"))

    if customer:
        customer_name = customer_name or _safe_text(customer.full_name)
        customer_email = customer_email or _safe_text(customer.email)
        customer_phone = customer_phone or _safe_text(customer.phone_number)
        service_location = service_location or _homeowner_address(customer)

    project_title = _safe_text(request.data.get("project_title") or request.data.get("title"))
    if not project_title:
        return None, {"project_title": ["Project title is required."]}
    if not customer_name:
        return None, {"customer_name": ["Customer name is required."]}

    project_summary = _safe_text(request.data.get("project_summary") or request.data.get("project_description") or request.data.get("description"))

    schedule, schedule_errors = _structured_schedule_from_payload(request.data)
    if schedule_errors:
        return None, schedule_errors

    return {
        "project_title": project_title,
        "project_summary": project_summary,
        "project_type": _safe_text(request.data.get("project_type")),
        "project_subtype": _safe_text(request.data.get("project_subtype")),
        "customer_name": customer_name,
        "customer_email": customer_email,
        "customer_phone": customer_phone,
        "service_location": service_location,
        **schedule,
    }, None


class ProposalListCreateView(APIView):
    permission_classes = [IsAuthenticated]

    def get(self, request):
        contractor = _resolve_contractor(request.user)
        if contractor is None:
            return Response({"detail": "Contractor profile not found."}, status=404)
        rows = [_serialize_proposal(item, request=request, include_related=False) for item in _proposal_queryset(contractor)]
        return Response({"results": rows})

    def post(self, request):
        contractor = _resolve_contractor(request.user)
        if contractor is None:
            return Response({"detail": "Contractor profile not found."}, status=404)

        source_type_raw = _safe_text(request.data.get("source_type"))
        source_id = request.data.get("source_id")
        source_type = _proposal_source_type(source_type_raw)
        if not source_type:
            return Response({"detail": "Unsupported opportunity source."}, status=400)

        is_dashboard_estimate = source_type == Proposal.SOURCE_DASHBOARD
        if is_dashboard_estimate and source_id in (None, ""):
            source_id_int = _dashboard_source_id(contractor)
        else:
            try:
                source_id_int = int(source_id)
            except (TypeError, ValueError):
                return Response({"source_id": ["A valid source id is required."]}, status=400)

        existing = _proposal_queryset(contractor).filter(source_type=source_type, source_id=source_id_int).first()
        if existing:
            opportunity = getattr(existing, "contractor_opportunity", None)
            linked_agreement = getattr(opportunity, "converted_agreement", None)
            if opportunity is not None and linked_agreement is not None and existing.converted_agreement_id is None:
                from projects.services.proposal_conversion import reconcile_opportunity_proposal_draft
                with transaction.atomic():
                    reconcile_opportunity_proposal_draft(opportunity=opportunity, agreement=linked_agreement)
                existing.refresh_from_db()
            return Response({"proposal": _serialize_proposal(existing, request=request), "created": False}, status=200)

        if is_dashboard_estimate:
            source = None
            snapshot, field_errors = _dashboard_snapshot(contractor, request)
            if field_errors:
                return Response(field_errors, status=400)
            row = {"request_snapshot": snapshot or {}}
        else:
            source, row, error = _resolve_estimate_source(contractor, source_type, source_id_int, request=request)
            if error:
                return Response({"detail": error}, status=400)

        appointment = None
        appointment_id = request.data.get("estimate_appointment_id") or request.data.get("appointment_id")
        if appointment_id and not is_dashboard_estimate:
            appointment_source_type = {
                Proposal.SOURCE_LEAD: OpportunityEstimateAppointment.SOURCE_PUBLIC_LEAD,
                Proposal.SOURCE_INTAKE: OpportunityEstimateAppointment.SOURCE_INTAKE,
                Proposal.SOURCE_OPPORTUNITY: OpportunityEstimateAppointment.SOURCE_OPPORTUNITY,
                Proposal.SOURCE_PROPERTY_WORK_ORDER: OpportunityEstimateAppointment.SOURCE_OPPORTUNITY,
            }.get(source_type, source_type)
            appointment_filter = {"source_type": appointment_source_type}
            if source_type == Proposal.SOURCE_LEAD:
                appointment_filter["public_lead_id"] = source_id_int
            elif source_type == Proposal.SOURCE_INTAKE:
                appointment_filter["project_intake_id"] = source_id_int
            else:
                appointment_filter["contractor_opportunity_id"] = source_id_int
            appointment = OpportunityEstimateAppointment.objects.filter(
                contractor=contractor,
                pk=appointment_id,
                **appointment_filter,
            ).first()
            if appointment is None:
                return Response({"estimate_appointment_id": ["Estimate appointment was not found."]}, status=400)

        contractor_opportunity = source if isinstance(source, ContractorOpportunity) else None
        snapshot = _snapshot_from_row(row)

        try:
            with transaction.atomic():
                proposal = Proposal.objects.create(
                    contractor=contractor,
                    contractor_opportunity=contractor_opportunity,
                    estimate_appointment=appointment,
                    source_type=source_type,
                    source_id=source_id_int,
                    created_by=request.user,
                    status=Proposal.STATUS_IN_PROGRESS,
                    **snapshot,
                )
                _activity(proposal, ProposalActivity.EVENT_CREATED, "Proposal created", actor=request.user)
                if contractor_opportunity is not None and contractor_opportunity.converted_agreement_id:
                    from projects.services.proposal_conversion import reconcile_opportunity_proposal_draft
                    reconcile_opportunity_proposal_draft(
                        opportunity=contractor_opportunity,
                        agreement=contractor_opportunity.converted_agreement,
                    )
                if appointment:
                    _activity(
                        proposal,
                        ProposalActivity.EVENT_APPOINTMENT_LINKED,
                        "Estimate appointment linked",
                        actor=request.user,
                        metadata={"appointment_id": appointment.id},
                    )
        except IntegrityError:
            proposal = _proposal_queryset(contractor).get(source_type=source_type, source_id=source_id_int)
            return Response({"proposal": _serialize_proposal(proposal, request=request), "created": False}, status=200)

        return Response({"proposal": _serialize_proposal(proposal, request=request), "created": True}, status=201)


class ProposalDetailView(APIView):
    permission_classes = [IsAuthenticated]

    EDITABLE_FIELDS = {
        "project_title",
        "service_location",
        "project_start_type",
        "project_start_date",
        "project_completion_type",
        "project_completion_date",
        "scheduling_priority",
        "site_visit_notes",
        "access_notes",
        "risk_notes",
        "customer_requests",
        "site_conditions",
        "quick_checklist",
        "included_work",
        "excluded_work",
        "assumptions",
        "allowances",
        "internal_notes",
        "customer_preferred_contact",
    }

    def _get_proposal(self, request, proposal_id):
        contractor = _resolve_contractor(request.user)
        if contractor is None:
            return None, Response({"detail": "Contractor profile not found."}, status=404)
        return get_object_or_404(_proposal_queryset(contractor), pk=proposal_id), None

    def get(self, request, proposal_id):
        proposal, error = self._get_proposal(request, proposal_id)
        if error:
            return error
        return Response(_serialize_proposal(proposal, request=request))
    def patch(self, request, proposal_id):
        proposal, error = self._get_proposal(request, proposal_id)
        if error:
            return error

        update_fields = []
        if "selected_template_id" in request.data:
            if proposal.status not in {
                Proposal.STATUS_DRAFT,
                Proposal.STATUS_SITE_VISIT,
                Proposal.STATUS_IN_PROGRESS,
                Proposal.STATUS_READY,
                Proposal.STATUS_REVISION_REQUESTED,
            }:
                return Response(
                    {"selected_template_id": ["The Estimate setup cannot change after it is sent to the customer."]},
                    status=409,
                )
            contractor = proposal.contractor
            template_id = request.data.get("selected_template_id")
            template = get_object_or_404(
                ProjectTemplate.objects.filter(
                    Q(contractor=contractor) | Q(is_system_template=True, is_published=True),
                    lifecycle_status=ProjectTemplate.LifecycleStatus.ACTIVE,
                    is_active=True,
                ),
                pk=template_id,
            )
            proposal.selected_template = template
            proposal.selected_template_name_snapshot = template.name
            proposal.selected_template_source_snapshot = "system" if template.is_system_template else "contractor"
            update_fields.extend([
                "selected_template",
                "selected_template_name_snapshot",
                "selected_template_source_snapshot",
            ])
        schedule_fields = {
            "project_start_type",
            "project_start_date",
            "project_completion_type",
            "project_completion_date",
            "scheduling_priority",
        }
        schedule_values = {}
        if any(field in request.data for field in schedule_fields):
            schedule_payload = {
                "project_start_type": proposal.project_start_type,
                "project_start_date": proposal.project_start_date.isoformat() if proposal.project_start_date else "",
                "project_completion_type": proposal.project_completion_type,
                "project_completion_date": proposal.project_completion_date.isoformat() if proposal.project_completion_date else "",
                "scheduling_priority": proposal.scheduling_priority,
            }
            for field in schedule_fields:
                if field in request.data:
                    schedule_payload[field] = request.data.get(field)
            schedule_values, schedule_errors = _structured_schedule_from_payload(schedule_payload)
            if schedule_errors:
                return Response(schedule_errors, status=400)

        for field in self.EDITABLE_FIELDS:
            if field not in request.data:
                continue
            if field == "quick_checklist":
                value = request.data.get(field)
                if not isinstance(value, list):
                    return Response({"quick_checklist": ["Checklist must be a list."]}, status=400)
            elif field == "customer_preferred_contact":
                value = _safe_text(request.data.get(field)).lower()
                if value not in {"", "email", "text", "phone"}:
                    return Response({"customer_preferred_contact": ["Choose Email, Text, Phone, or No preference."]}, status=400)
            elif field in schedule_values:
                value = schedule_values[field]
            else:
                value = _safe_text(request.data.get(field))
                if field == "project_title" and len(value) > 255:
                    return Response({"project_title": ["Project title must be 255 characters or fewer."]}, status=400)
            setattr(proposal, field, value)
            update_fields.append(field)

        if update_fields:
            update_fields.append("updated_at")
            proposal.save(update_fields=update_fields)
            if any(field in update_fields for field in ["site_visit_notes", "access_notes", "risk_notes", "customer_requests", "site_conditions", "quick_checklist"]):
                _activity(proposal, ProposalActivity.EVENT_SITE_VISIT_UPDATED, "Site visit details updated", actor=request.user)
            if any(field in update_fields for field in ["included_work", "excluded_work", "assumptions", "allowances"]):
                _activity(proposal, ProposalActivity.EVENT_SCOPE_EDITED, "Scope details edited", actor=request.user)
            if "internal_notes" in update_fields:
                _activity(proposal, ProposalActivity.EVENT_NOTES_EDITED, "Internal notes edited", actor=request.user)

        if "recalculate_readiness" in request.data:
            from projects.services.proposal_lifecycle import synchronize_proposal_lifecycle

            if request.data.get("recalculate_readiness") is not True:
                return Response({"recalculate_readiness": ["Must be true."]}, status=400)
            synchronize_proposal_lifecycle(proposal, recalculate_readiness=True)

        proposal = _proposal_queryset(proposal.contractor).get(pk=proposal.pk)
        return Response(_serialize_proposal(proposal, request=request))


class ProposalCustomerPreviewView(APIView):
    permission_classes = [IsAuthenticated]

    def get(self, request, proposal_id):
        contractor = _resolve_contractor(request.user)
        if contractor is None:
            return Response({"detail": "Contractor profile not found."}, status=404)
        proposal = get_object_or_404(_proposal_queryset(contractor), pk=proposal_id)
        latest = proposal.review_versions.order_by("-version").first()
        snapshot = latest.snapshot if latest else build_customer_snapshot(proposal)
        return Response({"preview": True, "version": latest.version if latest else None, "estimate": snapshot})


class ProposalSendReviewView(APIView):
    permission_classes = [IsAuthenticated]

    def post(self, request, proposal_id):
        contractor = _resolve_contractor(request.user)
        if contractor is None:
            return Response({"detail": "Contractor profile not found."}, status=404)
        proposal = get_object_or_404(_proposal_queryset(contractor), pk=proposal_id)
        try:
            review, result = send_review(
                proposal=proposal, request=request, resend=bool(request.data.get("resend")),
                channels=request.data.get("channels"),
            )
        except ValueError as exc:
            return Response({"detail": str(exc)}, status=400)
        return Response({"proposal": _serialize_proposal(_proposal_queryset(contractor).get(pk=proposal.pk), request=request), "review": public_review_payload(review, request=request), **result})


class PublicProposalReviewView(APIView):
    permission_classes = [AllowAny]
    authentication_classes = []

    def _resolve(self, token, lock=False):
        try:
            return resolve_token(token, lock=lock), None
        except ReviewAccessError as exc:
            return None, Response({"detail": str(exc)}, status=404)

    def get(self, request, token):
        review, error = self._resolve(token)
        if error:
            return error
        with transaction.atomic():
            review = ProposalReviewVersion.objects.select_for_update().select_related("proposal").get(pk=review.pk)
            current = review.proposal.review_versions.order_by("-version").first()
            if current.pk != review.pk:
                return Response({"detail": "A newer estimate is available. Ask your contractor for the latest review link."}, status=409)
            if review.viewed_at is None:
                review.viewed_at = timezone.now()
                review.save(update_fields=["viewed_at"])
                if review.proposal.status == Proposal.STATUS_SENT:
                    review.proposal.status = Proposal.STATUS_VIEWED
                    review.proposal.save(update_fields=["status", "updated_at"])
                _activity(review.proposal, ProposalActivity.EVENT_ESTIMATE_VIEWED, "Estimate viewed by customer", metadata={"review_version": review.version})
                notify_contractor_of_review_event(review, "estimate_viewed")
        return Response(public_review_payload(review, request=request))

    def post(self, request, token):
        action = _safe_text(request.data.get("action")).lower()
        if action not in {"accept", "request_changes", "decline"}:
            return Response({"action": ["Choose accept, request_changes, or decline."]}, status=400)
        with transaction.atomic():
            review, error = self._resolve(token, lock=True)
            if error:
                return error
            proposal = Proposal.objects.select_for_update().get(pk=review.proposal_id)
            latest = proposal.review_versions.order_by("-version").first()
            if latest.pk != review.pk:
                return Response({"detail": "This estimate version has been superseded."}, status=409)
            if review.expires_at and review.expires_at <= timezone.now():
                proposal.status = Proposal.STATUS_EXPIRED
                proposal.save(update_fields=["status", "updated_at"])
                return Response({"detail": "This estimate is no longer valid. Contact the contractor for an updated estimate."}, status=410)
            if review.decision != ProposalReviewVersion.DECISION_PENDING:
                return Response(public_review_payload(review, request=request))
            now = timezone.now()
            if action == "accept":
                if request.data.get("acknowledgement") != ACKNOWLEDGEMENT:
                    return Response({"acknowledgement": ["Confirm the estimate acknowledgement to continue."]}, status=400)
                review.decision = ProposalReviewVersion.DECISION_ACCEPTED
                review.acceptance_acknowledgement = ACKNOWLEDGEMENT
                review.accepted_by = _safe_text(request.data.get("customer_name")) or proposal.customer_name
                proposal.status = Proposal.STATUS_ACCEPTED
                event, message = ProposalActivity.EVENT_ESTIMATE_ACCEPTED, "Estimate accepted by customer"
            elif action == "request_changes":
                detail = _safe_text(request.data.get("message"))
                if not detail:
                    return Response({"message": ["Tell the contractor what should change."]}, status=400)
                review.decision = ProposalReviewVersion.DECISION_REVISION_REQUESTED
                review.revision_request_message = detail
                proposal.status = Proposal.STATUS_REVISION_REQUESTED
                event, message = ProposalActivity.EVENT_ESTIMATE_REVISION_REQUESTED, "Customer requested estimate changes"
            else:
                review.decision = ProposalReviewVersion.DECISION_DECLINED
                review.decline_reason = _safe_text(request.data.get("reason"))[:80]
                proposal.status = Proposal.STATUS_DECLINED
                event, message = ProposalActivity.EVENT_ESTIMATE_DECLINED, "Estimate declined by customer"
            review.decided_at = now
            review.save(update_fields=["decision", "decided_at", "accepted_by", "acceptance_acknowledgement", "decline_reason", "revision_request_message"])
            proposal.save(update_fields=["status", "updated_at"])
            _activity(proposal, event, message, metadata={"review_version": review.version})
            notify_contractor_of_review_event(review, event)
        return Response(public_review_payload(review, request=request))


class PublicProposalMessageView(APIView):
    permission_classes = [AllowAny]
    authentication_classes = []

    def post(self, request, token):
        try:
            with transaction.atomic():
                review = resolve_token(token, lock=True)
                latest = review.proposal.review_versions.order_by("-version").first()
                if latest is None or latest.pk != review.pk:
                    return Response({"detail": "Use the latest estimate review link to send a message."}, status=409)
                conversation, _message, _created = add_estimate_customer_message(review=review, text=request.data.get("message"), dedupe_key=request.headers.get("Idempotency-Key", ""))
        except ReviewAccessError as exc:
            return Response({"detail": str(exc)}, status=404)
        except ValueError as exc:
            return Response({"message": [str(exc)]}, status=400)
        return Response({"conversation": serialize_conversation(conversation, audience="customer")}, status=201)


class ProposalMessageView(APIView):
    permission_classes = [IsAuthenticated]

    def _proposal(self, request, proposal_id):
        contractor = _resolve_contractor(request.user)
        return get_object_or_404(_proposal_queryset(contractor), pk=proposal_id) if contractor else None

    def get(self, request, proposal_id):
        proposal = self._proposal(request, proposal_id)
        if proposal is None:
            return Response({"detail": "Contractor profile not found."}, status=404)
        conversation = conversation_for_proposal(proposal)
        if conversation:
            conversation.messages.filter(sender_type="customer", contractor_read_at__isnull=True).update(contractor_read_at=timezone.now())
        return Response({"conversation": serialize_conversation(conversation, audience="contractor")})

    def post(self, request, proposal_id):
        proposal = self._proposal(request, proposal_id)
        if proposal is None:
            return Response({"detail": "Contractor profile not found."}, status=404)
        try:
            conversation, _message, _created = add_contractor_reply(proposal=proposal, user=request.user, text=request.data.get("message"), dedupe_key=request.headers.get("Idempotency-Key", ""))
        except ValueError as exc:
            return Response({"message": [str(exc)]}, status=400)
        return Response({"conversation": serialize_conversation(conversation, audience="contractor")}, status=201)

class ProposalPortalActivationView(APIView):
    permission_classes = [AllowAny]
    authentication_classes = []

    def _activation(self, token, lock=False):
        try:
            return resolve_activation_token(token, lock=lock), None
        except ReviewAccessError as exc:
            return None, Response({"detail": str(exc)}, status=403)

    def get(self, request, token):
        activation, error = self._activation(token)
        if error:
            return error
        existing = User.objects.filter(email__iexact=activation.email).first()
        return Response({
            "email": activation.email,
            "account_exists": bool(existing and existing.has_usable_password() and existing.is_active),
            "estimate_url": f"/estimate-review/{token_for(activation.review)}",
        })

    def post(self, request, token):
        password = request.data.get("password") or ""
        if password != (request.data.get("password_confirm") or ""):
            return Response({"password_confirm": ["Passwords do not match."]}, status=400)
        with transaction.atomic():
            activation, error = self._activation(token, lock=True)
            if error:
                return error
            user = User.objects.select_for_update().filter(email__iexact=activation.email).first()
            if user and user.has_usable_password() and user.is_active:
                return Response({"detail": "An account already exists for this email. Sign in instead."}, status=409)
            try:
                validate_password(password, user=user)
            except DjangoValidationError as exc:
                return Response({"password": list(exc.messages)}, status=400)
            if user is None:
                user = User.objects.create_user(email=activation.email, password=password, is_verified=True, is_active=True)
            else:
                user.set_password(password)
                user.is_active = True
                user.is_verified = True
                user.save(update_fields=["password", "is_active", "is_verified"])
            activation.used_at = timezone.now()
            activation.save(update_fields=["used_at"])
        portal_token = portal_token_for_email(activation.email)
        return Response({"ok": True, "detail": "Your MyHomeBro account is ready.", "portal_url": f"/portal/{portal_token}"})

class ProposalPricingBenchmarkView(APIView):
    permission_classes = [IsAuthenticated]

    def get(self, request, proposal_id):
        contractor = _resolve_contractor(request.user)
        if contractor is None:
            return Response({"detail": "Contractor profile not found."}, status=404)
        proposal = get_object_or_404(_proposal_queryset(contractor), pk=proposal_id)
        return Response(build_proposal_pricing_benchmark(proposal))


class ProposalMeasurementListCreateView(APIView):
    permission_classes = [IsAuthenticated]

    def _proposal(self, request, proposal_id):
        contractor = _resolve_contractor(request.user)
        if contractor is None:
            return None, Response({"detail": "Contractor profile not found."}, status=404)
        return get_object_or_404(Proposal.objects.filter(contractor=contractor), pk=proposal_id), None

    def get(self, request, proposal_id):
        proposal, error = self._proposal(request, proposal_id)
        if error:
            return error
        return Response({"results": [_serialize_measurement(item) for item in proposal.measurements.all()]})

    def post(self, request, proposal_id):
        proposal, error = self._proposal(request, proposal_id)
        if error:
            return error
        label = _safe_text(request.data.get("label"))
        if not label:
            return Response({"label": ["Label is required."]}, status=400)
        try:
            quantity = Decimal(str(request.data.get("quantity")))
        except (InvalidOperation, TypeError):
            return Response({"quantity": ["Enter a valid quantity."]}, status=400)
        unit, unit_error = _normalize_proposal_unit(request.data.get("unit"))
        if unit_error:
            return Response({"unit": [unit_error]}, status=400)
        measurement = ProposalMeasurement.objects.create(
            proposal=proposal,
            label=label,
            location=_safe_text(request.data.get("location")),
            quantity=quantity,
            unit=unit,
            notes=_safe_text(request.data.get("notes")),
        )
        _activity(proposal, ProposalActivity.EVENT_MEASUREMENT_ADDED, f"Measurement added: {measurement.label}", actor=request.user)
        return Response(_serialize_measurement(measurement), status=201)


class ProposalMeasurementDetailView(APIView):
    permission_classes = [IsAuthenticated]

    def _measurement(self, request, proposal_id, measurement_id):
        contractor = _resolve_contractor(request.user)
        if contractor is None:
            return None, Response({"detail": "Contractor profile not found."}, status=404)
        measurement = get_object_or_404(
            ProposalMeasurement.objects.select_related("proposal").filter(proposal__contractor=contractor, proposal_id=proposal_id),
            pk=measurement_id,
        )
        return measurement, None

    def patch(self, request, proposal_id, measurement_id):
        measurement, error = self._measurement(request, proposal_id, measurement_id)
        if error:
            return error
        for field in ["label", "location", "notes"]:
            if field in request.data:
                setattr(measurement, field, _safe_text(request.data.get(field)))
        if "unit" in request.data:
            measurement.unit, unit_error = _normalize_proposal_unit(request.data.get("unit"))
            if unit_error:
                return Response({"unit": [unit_error]}, status=400)
        if "quantity" in request.data:
            try:
                measurement.quantity = Decimal(str(request.data.get("quantity")))
            except (InvalidOperation, TypeError):
                return Response({"quantity": ["Enter a valid quantity."]}, status=400)
        if not measurement.label:
            return Response({"label": ["Label is required."]}, status=400)
        measurement.save()
        _activity(measurement.proposal, ProposalActivity.EVENT_MEASUREMENT_UPDATED, f"Measurement updated: {measurement.label}", actor=request.user)
        return Response(_serialize_measurement(measurement))

    def delete(self, request, proposal_id, measurement_id):
        measurement, error = self._measurement(request, proposal_id, measurement_id)
        if error:
            return error
        proposal = measurement.proposal
        label = measurement.label
        measurement.delete()
        _activity(proposal, ProposalActivity.EVENT_MEASUREMENT_REMOVED, f"Measurement removed: {label}", actor=request.user)
        return Response(status=204)


class ProposalLineItemListCreateView(APIView):
    permission_classes = [IsAuthenticated]

    def _proposal(self, request, proposal_id):
        contractor = _resolve_contractor(request.user)
        if contractor is None:
            return None, Response({"detail": "Contractor profile not found."}, status=404)
        return get_object_or_404(Proposal.objects.filter(contractor=contractor), pk=proposal_id), None

    def get(self, request, proposal_id):
        proposal, error = self._proposal(request, proposal_id)
        if error:
            return error
        return Response(
            {
                "results": [_serialize_line_item(item) for item in proposal.line_items.all()],
                "totals": _proposal_totals(proposal),
            }
        )

    def post(self, request, proposal_id):
        proposal, error = self._proposal(request, proposal_id)
        if error:
            return error
        category = _safe_text(request.data.get("category")) or ProposalLineItem.CATEGORY_LABOR
        description = _safe_text(request.data.get("description"))
        errors = {}
        if category not in dict(ProposalLineItem.CATEGORY_CHOICES):
            errors["category"] = ["Choose a valid line item category."]
        if not description:
            errors["description"] = ["Description is required."]
        try:
            quantity = _to_decimal(request.data.get("quantity", "1"), "quantity")
        except ValueError:
            errors["quantity"] = ["Enter a valid quantity."]
            quantity = Decimal("0")
        try:
            unit_price = _to_decimal(request.data.get("unit_price", "0"), "unit_price")
        except ValueError:
            errors["unit_price"] = ["Enter a valid unit price."]
            unit_price = Decimal("0")
        unit, unit_error = _normalize_proposal_unit(request.data.get("unit"))
        if unit_error:
            errors["unit"] = [unit_error]
        if errors:
            return Response(errors, status=400)

        item = ProposalLineItem.objects.create(
            proposal=proposal,
            category=category,
            description=description,
            quantity=quantity,
            unit=unit,
            unit_price=unit_price,
            notes=_safe_text(request.data.get("notes")),
        )
        _activity(
            proposal,
            ProposalActivity.EVENT_LINE_ITEM_ADDED,
            f"Line item added: {item.description}",
            actor=request.user,
            metadata={"line_item_id": item.id, "category": item.category},
        )
        proposal = _proposal_queryset(proposal.contractor).get(pk=proposal.pk)
        return Response(
            {
                "line_item": _serialize_line_item(item),
                "totals": _proposal_totals(proposal),
            },
            status=201,
        )


class ProposalTemplatePricingApplyView(APIView):
    """Copy reusable fixed-price template milestones into an estimate atomically."""

    permission_classes = [IsAuthenticated]

    def post(self, request, proposal_id):
        contractor = _resolve_contractor(request.user)
        if contractor is None:
            return Response({"detail": "Contractor profile not found."}, status=404)
        proposal = get_object_or_404(Proposal.objects.filter(contractor=contractor), pk=proposal_id)
        template_id = request.data.get("template_id")
        template = get_object_or_404(
            ProjectTemplate.objects.prefetch_related("milestones").filter(
                Q(contractor=contractor) | Q(is_system_template=True, is_published=True),
                lifecycle_status=ProjectTemplate.LifecycleStatus.ACTIVE,
                is_active=True,
            ),
            pk=template_id,
        )
        mode = _safe_text(request.data.get("mode")) or "add"
        if mode not in {"add", "replace"}:
            return Response({"mode": ["Choose add or replace."]}, status=400)
        if mode == "replace" and not request.data.get("confirm_replace"):
            return Response({"detail": "Confirm replacement before removing existing pricing."}, status=400)

        reviewed_items = request.data.get("pricing_items")
        if reviewed_items is not None:
            if not isinstance(reviewed_items, list) or not reviewed_items:
                return Response({"pricing_items": ["Review at least one pricing item before applying."]}, status=400)
            prepared = []
            template_milestones = {row.id: row for row in template.milestones.all()}
            for index, row in enumerate(reviewed_items):
                if not isinstance(row, dict):
                    return Response({"pricing_items": [f"Item {index + 1} is invalid."]}, status=400)
                category = _safe_text(row.get("category"))
                if category not in dict(ProposalLineItem.CATEGORY_CHOICES):
                    return Response({"pricing_items": [f"Choose a category for item {index + 1}."]}, status=400)
                description = _safe_text(row.get("description"))
                if not description:
                    return Response({"pricing_items": [f"Enter a description for item {index + 1}."]}, status=400)
                try:
                    quantity = _to_decimal(row.get("quantity", "1"), "quantity")
                    unit_price = _to_decimal(row.get("unit_price"), "unit_price")
                except ValueError:
                    return Response({"pricing_items": [f"Enter valid pricing for item {index + 1}."]}, status=400)
                unit, unit_error = _normalize_proposal_unit(row.get("unit") or "ls")
                if unit_error:
                    return Response({"pricing_items": [f"Item {index + 1}: {unit_error}"]}, status=400)
                if quantity <= 0 or unit_price < 0:
                    return Response({"pricing_items": [f"Item {index + 1} must use a positive quantity and non-negative price."]}, status=400)
                try:
                    source_milestone_id = int(row.get("source_template_milestone_id"))
                    source_milestone = template_milestones[source_milestone_id]
                except (TypeError, ValueError, KeyError):
                    return Response({"pricing_items": [f"Item {index + 1} must identify a milestone from the selected template."]}, status=400)
                prepared.append({
                    "category": category,
                    "description": description,
                    "quantity": quantity,
                    "unit": unit,
                    "unit_price": unit_price,
                    "notes": _safe_text(row.get("notes"))[:2000],
                    "source_template_id": template.id,
                    "source_template_milestone_id": source_milestone.id,
                    "source_milestone_key": source_milestone.normalized_milestone_type[:128],
                    "source_milestone_name": source_milestone.title[:255],
                    "source_milestone_order": source_milestone.sort_order,
                    "source_allocation_percent": source_milestone.suggested_amount_percent,
                })

            with transaction.atomic():
                if mode == "replace":
                    proposal.line_items.all().delete()
                created = [ProposalLineItem.objects.create(proposal=proposal, **row) for row in prepared]
                _activity(
                    proposal,
                    ProposalActivity.EVENT_LINE_ITEM_ADDED,
                    f"Pricing built from {template.name} allocation guidance",
                    actor=request.user,
                    metadata={"template_id": template.id, "mode": mode, "line_item_ids": [item.id for item in created], "basis": _safe_text(request.data.get("target_subtotal"))},
                )
                proposal.selected_template = template
                proposal.selected_template_name_snapshot = template.name
                proposal.selected_template_source_snapshot = "system" if template.is_system_template else "contractor"
                proposal.pricing_template_name_snapshot = template.name
                proposal.save(update_fields=["selected_template", "selected_template_name_snapshot", "selected_template_source_snapshot", "pricing_template_name_snapshot", "updated_at"])
            proposal = _proposal_queryset(contractor).get(pk=proposal.pk)
            return Response({
                "detail": f"Pricing built from {template.name}",
                "template_id": template.id,
                "template_name": template.name,
                "mode": mode,
                "line_items": [_serialize_line_item(item) for item in proposal.line_items.all()],
                "totals": _proposal_totals(proposal),
            })

        reusable = [
            milestone for milestone in template.milestones.all()
            if milestone.suggested_amount_fixed is not None and milestone.suggested_amount_fixed > 0
        ]
        if not reusable:
            return Response({"detail": "This template does not include reusable pricing."}, status=400)

        with transaction.atomic():
            if mode == "replace":
                proposal.line_items.all().delete()
            created = [
                ProposalLineItem.objects.create(
                    proposal=proposal,
                    category=ProposalLineItem.CATEGORY_OTHER,
                    description=milestone.title,
                    quantity=Decimal("1.00"),
                    unit="ea",
                    unit_price=milestone.suggested_amount_fixed,
                    notes=(milestone.description or milestone.pricing_source_note or "")[:2000],
                )
                for milestone in reusable
            ]
            _activity(
                proposal,
                ProposalActivity.EVENT_LINE_ITEM_ADDED,
                f"Pricing copied from {template.name}",
                actor=request.user,
                metadata={"template_id": template.id, "mode": mode, "line_item_ids": [item.id for item in created]},
            )
            proposal.selected_template = template
            proposal.selected_template_name_snapshot = template.name
            proposal.selected_template_source_snapshot = "system" if template.is_system_template else "contractor"
            proposal.pricing_template_name_snapshot = template.name
            proposal.save(update_fields=[
                "selected_template",
                "selected_template_name_snapshot",
                "selected_template_source_snapshot",
                "pricing_template_name_snapshot",
                "updated_at",
            ])

        proposal = _proposal_queryset(contractor).get(pk=proposal.pk)
        return Response({
            "detail": f"Pricing copied from {template.name}",
            "template_id": template.id,
            "template_name": template.name,
            "mode": mode,
            "line_items": [_serialize_line_item(item) for item in proposal.line_items.all()],
            "totals": _proposal_totals(proposal),
        })


class ProposalLineItemDetailView(APIView):
    permission_classes = [IsAuthenticated]

    def _line_item(self, request, proposal_id, line_item_id):
        contractor = _resolve_contractor(request.user)
        if contractor is None:
            return None, Response({"detail": "Contractor profile not found."}, status=404)
        item = get_object_or_404(
            ProposalLineItem.objects.select_related("proposal").filter(proposal__contractor=contractor, proposal_id=proposal_id),
            pk=line_item_id,
        )
        return item, None

    def patch(self, request, proposal_id, line_item_id):
        item, error = self._line_item(request, proposal_id, line_item_id)
        if error:
            return error
        errors = {}
        if "category" in request.data:
            category = _safe_text(request.data.get("category"))
            if category not in dict(ProposalLineItem.CATEGORY_CHOICES):
                errors["category"] = ["Choose a valid line item category."]
            else:
                item.category = category
        if "description" in request.data:
            item.description = _safe_text(request.data.get("description"))
            if not item.description:
                errors["description"] = ["Description is required."]
        if "quantity" in request.data:
            try:
                item.quantity = _to_decimal(request.data.get("quantity"), "quantity")
            except ValueError:
                errors["quantity"] = ["Enter a valid quantity."]
        if "unit_price" in request.data:
            try:
                item.unit_price = _to_decimal(request.data.get("unit_price"), "unit_price")
            except ValueError:
                errors["unit_price"] = ["Enter a valid unit price."]
        if "unit" in request.data:
            item.unit, unit_error = _normalize_proposal_unit(request.data.get("unit"))
            if unit_error:
                errors["unit"] = [unit_error]
        if "notes" in request.data:
            item.notes = _safe_text(request.data.get("notes"))
        if errors:
            return Response(errors, status=400)

        item.save()
        _activity(
            item.proposal,
            ProposalActivity.EVENT_LINE_ITEM_UPDATED,
            f"Line item updated: {item.description}",
            actor=request.user,
            metadata={"line_item_id": item.id, "category": item.category},
        )
        proposal = _proposal_queryset(item.proposal.contractor).get(pk=item.proposal_id)
        return Response({"line_item": _serialize_line_item(item), "totals": _proposal_totals(proposal)})

    def delete(self, request, proposal_id, line_item_id):
        item, error = self._line_item(request, proposal_id, line_item_id)
        if error:
            return error
        proposal = item.proposal
        description = item.description
        metadata = {"line_item_id": item.id, "category": item.category}
        item.delete()
        _activity(
            proposal,
            ProposalActivity.EVENT_LINE_ITEM_REMOVED,
            f"Line item removed: {description}",
            actor=request.user,
            metadata=metadata,
        )
        proposal = _proposal_queryset(proposal.contractor).get(pk=proposal.pk)
        return Response({"totals": _proposal_totals(proposal)}, status=200)


class ProposalAttachmentListCreateView(APIView):
    permission_classes = [IsAuthenticated]

    def _proposal(self, request, proposal_id):
        contractor = _resolve_contractor(request.user)
        if contractor is None:
            return None, Response({"detail": "Contractor profile not found."}, status=404)
        return get_object_or_404(Proposal.objects.filter(contractor=contractor), pk=proposal_id), None

    def get(self, request, proposal_id):
        proposal, error = self._proposal(request, proposal_id)
        if error:
            return error
        return Response({"results": [_serialize_attachment(item, request=request) for item in proposal.attachments.all()]})

    def post(self, request, proposal_id):
        proposal, error = self._proposal(request, proposal_id)
        if error:
            return error
        upload = request.FILES.get("file") or request.FILES.get("photo") or request.FILES.get("document")
        if upload is None:
            return Response({"file": ["Upload a file."]}, status=400)
        attachment_type = _safe_text(request.data.get("attachment_type")) or ProposalAttachment.TYPE_DOCUMENT
        category = _safe_text(request.data.get("category")) or ProposalAttachment.CATEGORY_OTHER
        if attachment_type not in dict(ProposalAttachment.TYPE_CHOICES):
            return Response({"attachment_type": ["Choose photo or document."]}, status=400)
        if category not in dict(ProposalAttachment.CATEGORY_CHOICES):
            return Response({"category": ["Choose a valid category."]}, status=400)
        attachment = ProposalAttachment.objects.create(
            proposal=proposal,
            attachment_type=attachment_type,
            category=category,
            file=upload,
            original_name=getattr(upload, "name", "") or "",
            caption=_safe_text(request.data.get("caption")),
            notes=_safe_text(request.data.get("notes")),
            uploaded_by=request.user,
        )
        _activity(proposal, ProposalActivity.EVENT_ATTACHMENT_UPLOADED, f"Attachment uploaded: {attachment.original_name or attachment.id}", actor=request.user)
        return Response(_serialize_attachment(attachment, request=request), status=201)


class ProposalAttachmentDetailView(APIView):
    permission_classes = [IsAuthenticated]

    def _attachment(self, request, proposal_id, attachment_id):
        contractor = _resolve_contractor(request.user)
        if contractor is None:
            return None, Response({"detail": "Contractor profile not found."}, status=404)
        attachment = get_object_or_404(
            ProposalAttachment.objects.select_related("proposal").filter(proposal__contractor=contractor, proposal_id=proposal_id),
            pk=attachment_id,
        )
        return attachment, None

    def patch(self, request, proposal_id, attachment_id):
        attachment, error = self._attachment(request, proposal_id, attachment_id)
        if error:
            return error
        for field in ["caption", "notes"]:
            if field in request.data:
                setattr(attachment, field, _safe_text(request.data.get(field)))
        if "category" in request.data:
            category = _safe_text(request.data.get("category"))
            if category not in dict(ProposalAttachment.CATEGORY_CHOICES):
                return Response({"category": ["Choose a valid category."]}, status=400)
            attachment.category = category
        attachment.save()
        _activity(attachment.proposal, ProposalActivity.EVENT_ATTACHMENT_UPDATED, f"Attachment updated: {attachment.original_name or attachment.id}", actor=request.user)
        return Response(_serialize_attachment(attachment, request=request))

    def delete(self, request, proposal_id, attachment_id):
        attachment, error = self._attachment(request, proposal_id, attachment_id)
        if error:
            return error
        proposal = attachment.proposal
        name = attachment.original_name or f"Attachment {attachment.id}"
        attachment.delete()
        _activity(proposal, ProposalActivity.EVENT_ATTACHMENT_REMOVED, f"Attachment removed: {name}", actor=request.user)
        return Response(status=204)
