from __future__ import annotations

import secrets
from decimal import Decimal, InvalidOperation

from django.db import IntegrityError, transaction
from django.shortcuts import get_object_or_404
from django.utils.dateparse import parse_date
from django.utils import timezone
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

from projects.models import Homeowner
from projects.models_contractor_discovery import ContractorOpportunity, OpportunityEstimateAppointment
from projects.models_proposals import Proposal, ProposalActivity, ProposalAttachment, ProposalLineItem, ProposalMeasurement
from projects.views.contractor_bids import (
    _appointment_key,
    _resolve_contractor,
    _resolve_estimate_source,
    _safe_text,
    _serialize_estimate_appointment,
)


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
    appointment = getattr(proposal, "estimate_appointment", None)
    data = {
        "id": proposal.id,
        "status": proposal.status,
        "status_label": _proposal_status_label(proposal.status),
        "source_type": proposal.source_type,
        "source_id": proposal.source_id,
        "contractor_opportunity_id": proposal.contractor_opportunity_id,
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
        "created_at": _format_datetime(proposal.created_at),
        "updated_at": _format_datetime(proposal.updated_at),
    }
    if include_related:
        data["measurements"] = [_serialize_measurement(item) for item in proposal.measurements.all()]
        data["line_items"] = [_serialize_line_item(item) for item in proposal.line_items.all()]
        data["attachments"] = [_serialize_attachment(item, request=request) for item in proposal.attachments.all()]
        data["activity"] = [_serialize_activity(item) for item in proposal.activity.all()[:50]]
    return data


def _proposal_queryset(contractor):
    return (
        Proposal.objects.filter(contractor=contractor)
        .select_related("contractor_opportunity", "estimate_appointment")
        .prefetch_related("measurements", "line_items", "attachments", "activity")
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
                    **snapshot,
                )
                _activity(proposal, ProposalActivity.EVENT_CREATED, "Proposal created", actor=request.user)
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
        "status",
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
        previous_status = proposal.status
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
            if field == "status":
                value = _safe_text(request.data.get(field))
                if value not in dict(Proposal.STATUS_CHOICES):
                    return Response({"status": ["Choose a valid proposal status."]}, status=400)
            elif field == "quick_checklist":
                value = request.data.get(field)
                if not isinstance(value, list):
                    return Response({"quick_checklist": ["Checklist must be a list."]}, status=400)
            elif field in schedule_values:
                value = schedule_values[field]
            else:
                value = _safe_text(request.data.get(field))
            setattr(proposal, field, value)
            update_fields.append(field)

        if update_fields:
            update_fields.append("updated_at")
            proposal.save(update_fields=update_fields)
            if "status" in update_fields and proposal.status != previous_status:
                _activity(
                    proposal,
                    ProposalActivity.EVENT_STATUS_UPDATED,
                    f"Status updated to {_proposal_status_label(proposal.status)}",
                    actor=request.user,
                    metadata={"from": previous_status, "to": proposal.status},
                )
            if any(field in update_fields for field in ["site_visit_notes", "access_notes", "risk_notes", "customer_requests", "site_conditions", "quick_checklist"]):
                _activity(proposal, ProposalActivity.EVENT_SITE_VISIT_UPDATED, "Site visit details updated", actor=request.user)
            if any(field in update_fields for field in ["included_work", "excluded_work", "assumptions", "allowances"]):
                _activity(proposal, ProposalActivity.EVENT_SCOPE_EDITED, "Scope details edited", actor=request.user)
            if "internal_notes" in update_fields:
                _activity(proposal, ProposalActivity.EVENT_NOTES_EDITED, "Internal notes edited", actor=request.user)

        proposal = _proposal_queryset(proposal.contractor).get(pk=proposal.pk)
        return Response(_serialize_proposal(proposal, request=request))


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
        measurement = ProposalMeasurement.objects.create(
            proposal=proposal,
            label=label,
            location=_safe_text(request.data.get("location")),
            quantity=quantity,
            unit=_safe_text(request.data.get("unit")),
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
        for field in ["label", "location", "unit", "notes"]:
            if field in request.data:
                setattr(measurement, field, _safe_text(request.data.get(field)))
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
        if errors:
            return Response(errors, status=400)

        item = ProposalLineItem.objects.create(
            proposal=proposal,
            category=category,
            description=description,
            quantity=quantity,
            unit=_safe_text(request.data.get("unit")),
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
            item.unit = _safe_text(request.data.get("unit"))
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
