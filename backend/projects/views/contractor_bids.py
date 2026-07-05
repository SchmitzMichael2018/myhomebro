from __future__ import annotations

from decimal import Decimal

from django.utils import timezone
from django.utils.dateparse import parse_datetime
from django.db.models import Q
from rest_framework import status
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

from projects.models import AgreementProjectClass, PublicContractorLead
from projects.models_contractor_discovery import ContractorOpportunity, OpportunityEstimateAppointment
from projects.models_proposals import Proposal
from projects.models_customer_portal import PropertyWorkOrder
from projects.models_project_intake import ProjectIntake
from projects.services.agreements.project_create import resolve_contractor_for_user
from projects.services.bid_workflow import (
    bid_next_action,
    bid_status_group,
    bid_status_label,
    format_money,
    infer_project_class,
    normalize_bid_status,
    parse_money_like_text,
    project_class_label,
)
from projects.services.public_lead_pipeline import (
    is_website_sales_lead,
    public_lead_source_label,
    website_lead_filter_key,
)


def _resolve_contractor(user):
    return resolve_contractor_for_user(user)


def _safe_text(value) -> str:
    if value is None:
        return ""
    return str(value).strip()


def _format_date(value):
    if not value:
        return None


def _format_datetime(value):
    if not value:
        return None
    try:
        return value.isoformat()
    except Exception:
        return None
    try:
        return value.isoformat()
    except Exception:
        return None


def _agreement_label(agreement) -> str:
    if agreement is None:
        return ""
    project = getattr(agreement, "project", None)
    return (
        _safe_text(getattr(project, "title", ""))
        or _safe_text(getattr(agreement, "project_title", ""))
        or f"Agreement #{agreement.id}"
    )


def _agreement_reference(agreement) -> str:
    if agreement is None:
        return ""
    project = getattr(agreement, "project", None)
    project_number = _safe_text(getattr(project, "number", ""))
    if project_number:
        return f"Agreement {project_number}"
    return f"Agreement #{agreement.id}"


def _serialize_estimate_appointment(appointment) -> dict | None:
    if appointment is None:
        return None
    return {
        "id": appointment.id,
        "source_type": appointment.source_type,
        "source_id": (
            appointment.public_lead_id
            or appointment.project_intake_id
            or appointment.contractor_opportunity_id
        ),
        "status": appointment.status,
        "appointment_type": appointment.appointment_type,
        "appointment_type_label": appointment.get_appointment_type_display(),
        "scheduled_start": _format_datetime(appointment.scheduled_start),
        "duration_minutes": appointment.duration_minutes,
        "notes": appointment.notes,
        "requested_by": appointment.requested_by,
        "timezone": appointment.timezone,
        "confirmed_at": _format_datetime(appointment.confirmed_at),
        "declined_at": _format_datetime(appointment.declined_at),
        "decline_reason": appointment.decline_reason,
        "proposed_start": _format_datetime(appointment.proposed_start),
        "customer_message": appointment.customer_message,
        "customer_name": appointment.customer_name,
        "customer_email": appointment.customer_email,
        "customer_phone": appointment.customer_phone,
        "service_location": appointment.service_location,
        "opportunity_title": appointment.opportunity_title,
        "opportunity_reference": appointment.opportunity_reference,
        "created_at": _format_datetime(appointment.created_at),
    }


def _appointment_key(source_type: str, source_id) -> tuple[str, int] | None:
    try:
        value = int(source_id)
    except (TypeError, ValueError):
        return None
    normalized = _safe_text(source_type).lower()
    if normalized in {"lead", "quote_request", "public_lead"}:
        return ("lead", value)
    if normalized in {"intake", "project_intake"}:
        return ("intake", value)
    if normalized in {"opportunity", "marketplace", "property_work_order"}:
        return ("opportunity", value)
    return None


def _latest_appointments_for_rows(contractor, rows: list[dict]) -> dict[tuple[str, int], OpportunityEstimateAppointment]:
    wanted: set[tuple[str, int]] = set()
    for row in rows:
        key = _appointment_key(row.get("source_kind"), row.get("source_id"))
        if key:
            wanted.add(key)
    if not wanted:
        return {}

    lead_ids = [source_id for source_type, source_id in wanted if source_type == "lead"]
    intake_ids = [source_id for source_type, source_id in wanted if source_type == "intake"]
    opportunity_ids = [source_id for source_type, source_id in wanted if source_type == "opportunity"]
    query = Q()
    if lead_ids:
        query |= Q(source_type=OpportunityEstimateAppointment.SOURCE_PUBLIC_LEAD, public_lead_id__in=lead_ids)
    if intake_ids:
        query |= Q(source_type=OpportunityEstimateAppointment.SOURCE_INTAKE, project_intake_id__in=intake_ids)
    if opportunity_ids:
        query |= Q(source_type=OpportunityEstimateAppointment.SOURCE_OPPORTUNITY, contractor_opportunity_id__in=opportunity_ids)
    if not query:
        return {}

    visible_statuses = [
        OpportunityEstimateAppointment.STATUS_REQUESTED,
        OpportunityEstimateAppointment.STATUS_PROPOSED,
        OpportunityEstimateAppointment.STATUS_CONFIRMED,
        OpportunityEstimateAppointment.STATUS_SCHEDULED,
    ]
    appointments = (
        OpportunityEstimateAppointment.objects.filter(contractor=contractor, status__in=visible_statuses)
        .filter(query)
        .order_by("source_type", "public_lead_id", "project_intake_id", "contractor_opportunity_id", "-scheduled_start", "-id")
    )
    out: dict[tuple[str, int], OpportunityEstimateAppointment] = {}
    for appointment in appointments:
        key = _appointment_key(
            appointment.source_type,
            appointment.public_lead_id or appointment.project_intake_id or appointment.contractor_opportunity_id,
        )
        if key and key not in out:
            out[key] = appointment
    return out


def _attach_estimate_appointments(contractor, rows: list[dict]) -> list[dict]:
    latest_by_key = _latest_appointments_for_rows(contractor, rows)
    for row in rows:
        key = _appointment_key(row.get("source_kind"), row.get("source_id"))
        appointment = latest_by_key.get(key) if key else None
        row["latest_estimate_appointment"] = _serialize_estimate_appointment(appointment)
        row["estimate_scheduled"] = bool(appointment)
    return rows


def _serialize_proposal_summary(proposal: Proposal | None) -> dict | None:
    if proposal is None:
        return None
    return {
        "id": proposal.id,
        "status": proposal.status,
        "status_label": proposal.get_status_display(),
        "project_title": proposal.project_title,
        "source_type": proposal.source_type,
        "source_id": proposal.source_id,
        "updated_at": _format_datetime(proposal.updated_at),
    }


def _attach_proposals(contractor, rows: list[dict]) -> list[dict]:
    wanted: set[tuple[str, int]] = set()
    for row in rows:
        key = _appointment_key(row.get("source_kind"), row.get("source_id"))
        if key:
            wanted.add(key)
    if not wanted:
        return rows

    query = Q()
    for source_type, source_id in wanted:
        query |= Q(source_type=source_type, source_id=source_id)
    if not query:
        return rows

    proposals = (
        Proposal.objects.filter(contractor=contractor)
        .filter(query)
        .order_by("source_type", "source_id", "-updated_at", "-id")
    )
    by_key: dict[tuple[str, int], Proposal] = {}
    for proposal in proposals:
        key = (proposal.source_type, proposal.source_id)
        if key not in by_key:
            by_key[key] = proposal

    for row in rows:
        key = _appointment_key(row.get("source_kind"), row.get("source_id"))
        proposal = by_key.get(key) if key else None
        row["latest_proposal"] = _serialize_proposal_summary(proposal)
        row["proposal_id"] = proposal.id if proposal else None
    return rows


def _milestone_preview(payload) -> list[str]:
    items = payload if isinstance(payload, list) else []
    out: list[str] = []
    for row in items[:3]:
        if isinstance(row, dict):
            title = _safe_text(row.get("title") or row.get("name"))
            if title:
                out.append(title)
    return out


def _estimate_amount_from_payload(payload) -> Decimal | None:
    if not isinstance(payload, dict):
        return None
    estimate = payload.get("estimate_preview")
    if not isinstance(estimate, dict):
        return None
    return parse_money_like_text(estimate.get("suggested_total_price"))


def _format_bid_amount(amount: Decimal | None) -> str:
    if amount is None:
        return "-"
    return f"${amount:,.2f}"


def _contractor_status_label(status: str) -> str:
    normalized = _safe_text(status).lower()
    if normalized == "expired":
        return "Not Selected"
    return bid_status_label(normalized)


def _contractor_status_note(status: str) -> str:
    normalized = _safe_text(status).lower()
    if normalized == "follow_up":
        return "This lead is saved for later review."
    if normalized == "expired":
        return "Another contractor was selected for this project."
    if normalized == "declined":
        return "This bid was declined."
    return ""


def _measurement_label(value) -> str:
    normalized = _safe_text(value).lower()
    if normalized == "provided":
        return "Provided"
    if normalized == "site_visit_required":
        return "Site visit required"
    if normalized == "not_sure":
        return "Not sure"
    return ""


def _request_path_label(intake) -> str:
    if _safe_text(getattr(intake, "lead_source", "")).lower() == "quote_request":
        return "Request a Quote"
    flow = _safe_text(getattr(intake, "post_submit_flow", "")).lower()
    if flow == "multi_contractor":
        return "Multi-quote request"
    if flow == "single_contractor":
        return "Single contractor request"
    return "Project request"


def _clarification_summary(source_intake) -> list[dict]:
    if source_intake is None:
        return []
    questions = getattr(source_intake, "ai_clarification_questions", None)
    answers = getattr(source_intake, "ai_clarification_answers", None)
    if not isinstance(questions, list) or not isinstance(answers, dict):
        return []

    rows: list[dict] = []
    for question in questions:
        if len(rows) >= 6 or not isinstance(question, dict):
            continue
        key = _safe_text(question.get("key"))
        if not key:
            continue
        raw_value = answers.get(key)
        if isinstance(raw_value, list):
            value = ", ".join(_safe_text(item) for item in raw_value if _safe_text(item))
        else:
            value = _safe_text(raw_value)
        if not value:
            continue
        label = _safe_text(question.get("label") or question.get("question") or key)
        rows.append({"key": key, "label": label, "value": value})
    return rows


def _request_signals(*, source_intake, snapshot: dict) -> list[str]:
    signals: list[str] = []

    if snapshot.get("guided_intake_completed"):
        signals.append("Guided Intake")
    if snapshot.get("photo_count", 0):
        signals.append("Photos")
    if snapshot.get("budget"):
        signals.append("Budget Provided")
    if snapshot.get("timeline"):
        signals.append("Timeline Provided")
    if snapshot.get("measurement_handling"):
        signals.append("Measurements Noted")
    if snapshot.get("clarification_count", 0):
        signals.append("Clarifications Answered")
    if _request_path_label(source_intake) == "Request a Quote":
        signals.append("Request a Quote")
    if _request_path_label(source_intake) == "Multi-quote request":
        signals.append("Multi-Quote Request")
    return signals


def _snapshot_from_intake(*, source_intake, lead=None, analysis=None, request=None) -> dict:
    if source_intake is None and lead is None:
        return {}

    analysis = analysis if isinstance(analysis, dict) else {}
    source_intake = source_intake or None
    lead = lead or None

    photos = []
    if source_intake is not None:
        try:
            photo_rows = list(source_intake.clarification_photos.all().order_by("-uploaded_at", "-id"))
        except Exception:
            photo_rows = []
        for photo in photo_rows[:6]:
            image = getattr(photo, "image", None)
            image_url = ""
            try:
                image_url = request.build_absolute_uri(image.url) if request and image else getattr(image, "url", "")
            except Exception:
                image_url = ""
            photos.append(
                {
                    "id": getattr(photo, "id", None),
                    "image_url": image_url,
                    "original_name": _safe_text(getattr(photo, "original_name", "")),
                    "caption": _safe_text(getattr(photo, "caption", "")),
                    "uploaded_at": _format_date(getattr(photo, "uploaded_at", None)),
                }
            )

    clarification_summary = _clarification_summary(source_intake)
    clarification_answers = getattr(source_intake, "ai_clarification_answers", {}) if source_intake else {}
    measurement_handling = _measurement_label(
        getattr(source_intake, "measurement_handling", "")
        or clarification_answers.get("measurement_handling", "")
    )
    project_scope_summary = (
        _safe_text(analysis.get("project_scope_summary"))
        or _safe_text(getattr(source_intake, "ai_description", ""))
        or _safe_text(analysis.get("suggested_description"))
        or _safe_text(getattr(lead, "project_description", ""))
    )
    project_family_key = _safe_text(analysis.get("project_family_key"))
    project_family_label = _safe_text(analysis.get("project_family_label"))
    budget_value = getattr(source_intake, "ai_project_budget", None) if source_intake else None
    budget_label = (
        f"${Decimal(str(budget_value)).quantize(Decimal('0.01')):,.2f}"
        if budget_value not in {None, ""}
        else _safe_text(getattr(lead, "budget_text", ""))
        or _safe_text(analysis.get("suggested_total_price"))
    )
    timeline_value = getattr(source_intake, "ai_project_timeline_days", None) if source_intake else None
    timeline_label = (
        _safe_text(getattr(source_intake, "desired_timing_text", "")) or (
            f"{int(timeline_value)} days"
            if timeline_value not in {None, ""}
            else _safe_text(getattr(lead, "preferred_timeline", ""))
        )
    )
    project_title = (
        _safe_text(getattr(source_intake, "ai_project_title", ""))
        or _safe_text(analysis.get("suggested_title"))
        or _safe_text(getattr(lead, "project_type", ""))
        or _safe_text(getattr(lead, "project_description", ""))
        or "Project Request"
    )
    project_type = _safe_text(getattr(source_intake, "ai_project_type", "")) or _safe_text(analysis.get("project_type"))
    project_subtype = _safe_text(getattr(source_intake, "ai_project_subtype", "")) or _safe_text(analysis.get("project_subtype"))
    property_type = _safe_text(getattr(source_intake, "property_type", "")) or _safe_text(analysis.get("property_type"))
    budget_range_text = _safe_text(getattr(source_intake, "budget_range_text", "")) or _safe_text(analysis.get("budget_range_text"))
    preferred_contact_method = _safe_text(getattr(source_intake, "preferred_contact_method", "")) or _safe_text(analysis.get("preferred_contact_method"))
    contact_consent = bool(getattr(source_intake, "contact_consent", False) or analysis.get("contact_consent"))
    refined_description = (
        project_scope_summary
        or _safe_text(getattr(lead, "project_description", ""))
    )
    project_address = getattr(source_intake, "project_address_display", "") if source_intake else ""
    if not project_address:
        project_address = "\n".join(
            part
            for part in [
                _safe_text(getattr(lead, "project_address", "")),
                ", ".join(
                    p
                    for p in [
                        _safe_text(getattr(lead, "city", "")),
                        _safe_text(getattr(lead, "state", "")),
                        _safe_text(getattr(lead, "zip_code", "")),
                    ]
                    if p
                ),
            ]
            if part
        )
    location = _safe_text(project_address)
    if not location and source_intake is not None:
        location = "\n".join(
            part
            for part in [
                _safe_text(getattr(source_intake, "project_address_line1", "")),
                _safe_text(getattr(source_intake, "project_address_line2", "")),
                ", ".join(
                    p
                    for p in [
                        _safe_text(getattr(source_intake, "project_city", "")),
                        _safe_text(getattr(source_intake, "project_state", "")),
                        _safe_text(getattr(source_intake, "project_postal_code", "")),
                    ]
                    if p
                ),
            ]
            if part
        )
    request_path_label = _request_path_label(source_intake)
    clarification_count = len([row for row in clarification_summary if row.get("value")])
    project_phases = _milestone_preview(analysis.get("milestones") or getattr(source_intake, "ai_milestones", []) or [])
    recommended_setup = analysis.get("recommended_setup") or {}
    snapshot = {
        "project_title": project_title,
        "project_type": project_type,
        "project_subtype": project_subtype,
        "project_family_key": project_family_key,
        "project_family_label": project_family_label,
        "recommended_setup": recommended_setup,
        "refined_description": refined_description,
        "project_scope_summary": project_scope_summary,
        "location": location,
        "request_path_label": request_path_label,
        "measurement_handling": measurement_handling,
        "desired_timing_text": _safe_text(getattr(source_intake, "desired_timing_text", "")),
        "timeline": timeline_label,
        "budget": budget_label,
        "property_type": property_type,
        "budget_range_text": budget_range_text,
        "preferred_contact_method": preferred_contact_method,
        "contact_consent": contact_consent,
        "clarification_summary": clarification_summary,
        "clarification_count": clarification_count,
        "photo_count": len(photos),
        "photos": photos,
        "milestones": project_phases,
        "guided_intake_completed": bool(
            source_intake
            and (
                getattr(source_intake, "ai_clarification_questions", None)
                or getattr(source_intake, "ai_clarification_answers", None)
                or getattr(source_intake, "clarification_photos", None)
            )
        ),
        "materials_status": next(
            (
                row["value"]
                for row in clarification_summary
                if "material" in _safe_text(row.get("key", "")).lower()
                or "material" in _safe_text(row.get("label", "")).lower()
            ),
            "",
        ),
    }
    snapshot["request_signals"] = _request_signals(source_intake=source_intake, snapshot=snapshot)
    return snapshot


def _workspace_stage(status: str, source_kind: str) -> str:
    normalized_status = _safe_text(status).lower()
    normalized_source = _safe_text(source_kind).lower()
    if normalized_source == "property_work_order":
        if normalized_status in {"declined", "expired", "withdrawn"}:
            return "closed"
        if normalized_status == "accepted":
            return "follow_up"
        if normalized_status in {"awarded", "converted"}:
            return "active_bid"
        return "new_lead"
    if normalized_status in {"declined", "expired"}:
        return "closed"
    if normalized_status == "follow_up":
        return "follow_up"
    if normalized_source == "lead" and normalized_status in {"draft", "submitted"}:
        return "new_lead"
    if normalized_source == "marketplace" and normalized_status in {"pending", "submitted"}:
        return "new_lead"
    return "active_bid"


def _workspace_stage_label(stage: str) -> str:
    normalized = _safe_text(stage).lower()
    if normalized == "new_lead":
        return "New Lead"
    if normalized == "follow_up":
        return "Follow-Up"
    if normalized == "closed":
        return "Closed / Archived"
    return "Active Bid"


def _bid_row_from_lead(lead, request=None) -> dict:
    linked_agreement = getattr(lead, "converted_agreement", None)
    source_intake = getattr(lead, "source_intake", None)
    if linked_agreement is None and getattr(source_intake, "agreement_id", None):
        linked_agreement = source_intake.agreement

    analysis = (
        getattr(source_intake, "ai_analysis_payload", None)
        or getattr(lead, "ai_analysis", None)
        or {}
    )
    snapshot = _snapshot_from_intake(source_intake=source_intake, lead=lead, analysis=analysis, request=request)
    project_title = (
        _safe_text(snapshot.get("project_title"))
        or _safe_text(analysis.get("suggested_title"))
        or _safe_text(lead.project_type)
        or _safe_text(lead.project_description)
        or f"Lead #{lead.id}"
    )
    project_notes = (
        _safe_text(snapshot.get("project_scope_summary"))
        or _safe_text(snapshot.get("refined_description"))
        or _safe_text(analysis.get("suggested_description"))
        or _safe_text(lead.project_description)
        or _safe_text(lead.project_type)
    )
    project_class = (
        _safe_text(getattr(linked_agreement, "project_class", ""))
        or infer_project_class(
            _safe_text(snapshot.get("project_type")) or lead.project_type,
            _safe_text(snapshot.get("project_subtype")) or lead.project_description,
            _safe_text(snapshot.get("timeline")) or lead.preferred_timeline,
            _safe_text(snapshot.get("budget")) or lead.budget_text,
            analysis.get("project_type"),
            analysis.get("project_subtype"),
            project_notes,
        )
    )
    status = normalize_bid_status(
        raw_status=lead.status,
        has_agreement=bool(getattr(linked_agreement, "id", None)),
        record_kind="lead",
    )
    submitted_at = (
        getattr(lead, "accepted_at", None)
        or getattr(source_intake, "submitted_at", None)
        or getattr(source_intake, "completed_at", None)
        or lead.converted_at
        or lead.created_at
    )
    bid_amount = (
        getattr(linked_agreement, "total_cost", None)
        or parse_money_like_text(snapshot.get("budget"))
        or parse_money_like_text(lead.budget_text)
        or parse_money_like_text(analysis.get("suggested_total_price"))
    )
    workspace_stage = _workspace_stage(status, "lead")
    source_label = public_lead_source_label(getattr(lead, "source", ""))
    source_filter_key = website_lead_filter_key(getattr(lead, "source", ""))

    return {
        "bid_id": f"lead-{lead.id}",
        "record_id": lead.id,
        "source_kind": "lead",
        "source_kind_label": source_label,
        "lead_source": _safe_text(getattr(lead, "source", "")),
        "lead_source_label": source_label,
        "lead_source_filter": source_filter_key,
        "is_website_lead": is_website_sales_lead(lead),
        "workspace_stage": workspace_stage,
        "workspace_stage_label": _workspace_stage_label(workspace_stage),
        "source_id": lead.id,
        "source_reference": f"Lead #{lead.id}",
        "project_title": project_title,
        "customer_name": _safe_text(lead.full_name) or "Unknown Customer",
        "customer_email": _safe_text(lead.email),
        "customer_phone": _safe_text(lead.phone),
        "location": _safe_text(snapshot.get("location")) or _safe_text(lead.city) or _safe_text(lead.project_address),
        "project_type": _safe_text(snapshot.get("project_type")) or _safe_text(lead.project_type),
        "project_subtype": _safe_text(snapshot.get("project_subtype")),
        "property_type": _safe_text(snapshot.get("property_type")),
        "budget_range_text": _safe_text(snapshot.get("budget_range_text")),
        "preferred_contact_method": _safe_text(snapshot.get("preferred_contact_method")),
        "contact_consent": bool(snapshot.get("contact_consent")),
        "project_family_key": _safe_text(snapshot.get("project_family_key")),
        "project_family_label": _safe_text(snapshot.get("project_family_label")),
        "request_path_label": _safe_text(snapshot.get("request_path_label")),
        "measurement_handling": _safe_text(snapshot.get("measurement_handling")),
        "desired_timing_text": _safe_text(snapshot.get("desired_timing_text")),
        "photo_count": int(snapshot.get("photo_count") or 0),
        "request_signals": snapshot.get("request_signals") or [],
        "request_snapshot": snapshot,
        "project_class": project_class,
        "project_class_label": project_class_label(project_class),
        "bid_amount": format_money(bid_amount) if bid_amount is not None else None,
        "bid_amount_label": _format_bid_amount(bid_amount),
        "submitted_at": _format_date(submitted_at),
        "updated_at": _format_date(getattr(lead, "updated_at", None)),
        "status": status,
        "status_label": _contractor_status_label(status),
        "status_group": bid_status_group(status),
        "status_note": _contractor_status_note(status),
        "linked_agreement_id": getattr(linked_agreement, "id", None),
        "linked_agreement_label": _agreement_label(linked_agreement),
        "linked_agreement_reference": _agreement_reference(linked_agreement),
        "linked_agreement_url": f"/app/agreements/{linked_agreement.id}" if linked_agreement else "",
        "notes": project_notes,
        "timeline": _safe_text(snapshot.get("timeline")) or _safe_text(lead.preferred_timeline),
        "budget_text": _safe_text(snapshot.get("budget")) or _safe_text(lead.budget_text),
        "milestone_preview": _milestone_preview(analysis.get("milestones") or snapshot.get("milestones") or []),
        "next_action": bid_next_action(
            status=status,
            linked_agreement_id=getattr(linked_agreement, "id", None),
            source_kind="lead",
        ),
    }


def _marketplace_status(opportunity) -> str:
    raw = _safe_text(getattr(opportunity, "status", "")).lower()
    return {
        ContractorOpportunity.STATUS_PENDING: "submitted",
        ContractorOpportunity.STATUS_ACCEPTED: "follow_up",
        ContractorOpportunity.STATUS_CONVERTED: "awarded",
        ContractorOpportunity.STATUS_DECLINED: "declined",
        ContractorOpportunity.STATUS_EXPIRED: "expired",
    }.get(raw, raw or "submitted")


def _marketplace_budget_text(opportunity) -> str:
    low = getattr(opportunity, "budget_min", None)
    high = getattr(opportunity, "budget_max", None)
    if low and high:
        return f"${Decimal(str(low)):,.2f} - ${Decimal(str(high)):,.2f}"
    if low:
        return f"From ${Decimal(str(low)):,.2f}"
    if high:
        return f"Up to ${Decimal(str(high)):,.2f}"
    return ""


def _bid_row_from_marketplace_opportunity(opportunity, request=None) -> dict:
    linked_agreement = getattr(opportunity, "converted_agreement", None)
    status = _marketplace_status(opportunity)
    project_title = (
        _safe_text(getattr(opportunity, "project_title", ""))
        or _safe_text(getattr(opportunity, "project_type", ""))
        or f"Marketplace Opportunity #{opportunity.id}"
    )
    notes = _safe_text(getattr(opportunity, "refined_description", "")) or _safe_text(getattr(opportunity, "project_description", ""))
    location = "\n".join(
        part
        for part in [
            _safe_text(getattr(opportunity, "project_address", "")),
            ", ".join(
                p
                for p in [
                    _safe_text(getattr(opportunity, "project_city", "")),
                    _safe_text(getattr(opportunity, "project_state", "")),
                    _safe_text(getattr(opportunity, "project_zip", "")),
                ]
                if p
            ),
        ]
        if part
    )
    project_class = infer_project_class(
        _safe_text(getattr(opportunity, "project_type", "")),
        _safe_text(getattr(opportunity, "project_subtype", "")),
        _safe_text(getattr(opportunity, "timeline", "")),
        _marketplace_budget_text(opportunity),
        notes,
    )
    workspace_stage = _workspace_stage(status, "marketplace")
    photos = getattr(opportunity, "photos", None) or []
    measurements = getattr(opportunity, "measurements", None) or []
    request_signals = ["Marketplace"]
    if photos:
        request_signals.append("Photos")
    if measurements:
        request_signals.append("Measurements")
    snapshot = {
        "project_title": project_title,
        "project_type": _safe_text(getattr(opportunity, "project_type", "")),
        "project_subtype": _safe_text(getattr(opportunity, "project_subtype", "")),
        "project_family_key": "",
        "project_family_label": "",
        "recommended_setup": {},
        "refined_description": notes,
        "project_scope_summary": notes,
        "location": location,
        "request_path_label": "Marketplace",
        "measurement_handling": "Provided" if measurements else "",
        "timeline": _safe_text(getattr(opportunity, "timeline", "")),
        "budget": _marketplace_budget_text(opportunity),
        "photo_count": len(photos),
        "photos": photos,
        "measurements": measurements,
        "request_signals": request_signals,
    }
    return {
        "bid_id": f"opportunity-{opportunity.id}",
        "record_id": opportunity.id,
        "source_kind": "marketplace",
        "source_kind_label": "Marketplace",
        "lead_source": "marketplace",
        "lead_source_label": "Marketplace",
        "lead_source_filter": "marketplace",
        "is_website_lead": False,
        "workspace_stage": workspace_stage,
        "workspace_stage_label": _workspace_stage_label(workspace_stage),
        "source_id": opportunity.id,
        "source_reference": f"Marketplace #{opportunity.id}",
        "project_title": project_title,
        "customer_name": _safe_text(getattr(opportunity, "homeowner_name", "")) or "Marketplace Customer",
        "customer_email": _safe_text(getattr(opportunity, "homeowner_email", "")),
        "customer_phone": _safe_text(getattr(opportunity, "homeowner_phone", "")),
        "location": location,
        "project_type": _safe_text(getattr(opportunity, "project_type", "")),
        "project_subtype": _safe_text(getattr(opportunity, "project_subtype", "")),
        "property_type": "",
        "budget_range_text": _marketplace_budget_text(opportunity),
        "preferred_contact_method": "",
        "contact_consent": False,
        "project_family_key": "",
        "project_family_label": "",
        "request_path_label": "Marketplace",
        "measurement_handling": "Provided" if measurements else "",
        "desired_timing_text": "",
        "photo_count": len(photos),
        "request_signals": request_signals,
        "request_snapshot": snapshot,
        "project_class": project_class,
        "project_class_label": project_class_label(project_class),
        "bid_amount": None,
        "bid_amount_label": _marketplace_budget_text(opportunity) or "-",
        "submitted_at": _format_date(getattr(opportunity, "selected_at", None) or getattr(opportunity, "created_at", None)),
        "updated_at": _format_date(getattr(opportunity, "updated_at", None)),
        "status": status,
        "status_label": _contractor_status_label(status),
        "status_group": bid_status_group(status),
        "status_note": _contractor_status_note(status),
        "linked_agreement_id": getattr(linked_agreement, "id", None),
        "linked_agreement_label": _agreement_label(linked_agreement),
        "linked_agreement_reference": _agreement_reference(linked_agreement),
        "linked_agreement_url": f"/app/agreements/{linked_agreement.id}" if linked_agreement else "",
        "notes": notes,
        "timeline": _safe_text(getattr(opportunity, "timeline", "")),
        "estimate_preference": _safe_text(getattr(opportunity, "estimate_preference", "")),
        "estimate_preference_label": opportunity.get_estimate_preference_display() if getattr(opportunity, "estimate_preference", "") else "",
        "estimate_preference_notes": _safe_text(getattr(opportunity, "estimate_preference_notes", "")),
        "budget_text": _marketplace_budget_text(opportunity),
        "milestone_preview": [],
        "next_action": bid_next_action(
            status=status,
            linked_agreement_id=getattr(linked_agreement, "id", None),
            source_kind="marketplace",
        ),
    }


def _bid_row_from_intake(intake, request=None) -> dict:
    if getattr(intake, "public_lead_id", None):
        return {}

    linked_agreement = getattr(intake, "agreement", None)
    analysis = intake.ai_analysis_payload or {}
    snapshot = _snapshot_from_intake(source_intake=intake, analysis=analysis, request=request)
    project_title = (
        _safe_text(snapshot.get("project_title"))
        or _safe_text(intake.ai_project_title)
        or _safe_text(analysis.get("project_title"))
        or _safe_text(intake.accomplishment_text)
        or f"Intake #{intake.id}"
    )
    project_notes = (
        _safe_text(snapshot.get("project_scope_summary"))
        or _safe_text(snapshot.get("refined_description"))
        or _safe_text(intake.ai_description)
        or _safe_text(intake.accomplishment_text)
        or _safe_text(intake.ai_project_subtype)
        or _safe_text(intake.ai_project_type)
    )
    project_class = (
        _safe_text(getattr(linked_agreement, "project_class", ""))
        or infer_project_class(
            _safe_text(snapshot.get("project_type")) or intake.ai_project_type,
            _safe_text(snapshot.get("project_subtype")) or intake.ai_project_subtype,
            _safe_text(snapshot.get("refined_description")) or intake.ai_description,
            intake.accomplishment_text,
            intake.customer_name,
            project_notes,
        )
    )
    status = normalize_bid_status(
        raw_status=intake.status,
        has_agreement=bool(getattr(linked_agreement, "id", None)),
        record_kind="intake",
    )
    submitted_at = intake.submitted_at or intake.analyzed_at or intake.converted_at or intake.created_at
    bid_amount = (
        getattr(linked_agreement, "total_cost", None)
        or parse_money_like_text(snapshot.get("budget"))
        or _estimate_amount_from_payload(analysis)
    )
    workspace_stage = _workspace_stage(status, "intake")

    return {
        "bid_id": f"intake-{intake.id}",
        "record_id": intake.id,
        "source_kind": "intake",
        "source_kind_label": "Intake",
        "workspace_stage": workspace_stage,
        "workspace_stage_label": _workspace_stage_label(workspace_stage),
        "source_id": intake.id,
        "source_reference": f"Intake #{intake.id}",
        "project_title": project_title,
        "customer_name": _safe_text(intake.customer_name) or "Unknown Customer",
        "customer_email": _safe_text(intake.customer_email),
        "customer_phone": _safe_text(intake.customer_phone),
        "location": _safe_text(snapshot.get("location")) or _safe_text(intake.project_address_display),
        "project_type": _safe_text(snapshot.get("project_type")) or _safe_text(intake.ai_project_type),
        "project_subtype": _safe_text(snapshot.get("project_subtype")) or _safe_text(intake.ai_project_subtype),
        "property_type": _safe_text(snapshot.get("property_type")) or _safe_text(getattr(intake, "property_type", "")),
        "budget_range_text": _safe_text(snapshot.get("budget_range_text")) or _safe_text(getattr(intake, "budget_range_text", "")),
        "preferred_contact_method": _safe_text(snapshot.get("preferred_contact_method")) or _safe_text(getattr(intake, "preferred_contact_method", "")),
        "contact_consent": bool(snapshot.get("contact_consent") or getattr(intake, "contact_consent", False)),
        "project_family_key": _safe_text(snapshot.get("project_family_key")),
        "project_family_label": _safe_text(snapshot.get("project_family_label")),
        "request_path_label": _safe_text(snapshot.get("request_path_label")),
        "measurement_handling": _safe_text(snapshot.get("measurement_handling")) or _safe_text(intake.measurement_handling),
        "desired_timing_text": _safe_text(snapshot.get("desired_timing_text")) or _safe_text(getattr(intake, "desired_timing_text", "")),
        "photo_count": int(snapshot.get("photo_count") or 0),
        "request_signals": snapshot.get("request_signals") or [],
        "request_snapshot": snapshot,
        "project_class": project_class,
        "project_class_label": project_class_label(project_class),
        "bid_amount": format_money(bid_amount) if bid_amount is not None else None,
        "bid_amount_label": _format_bid_amount(bid_amount),
        "submitted_at": _format_date(submitted_at),
        "updated_at": _format_date(getattr(intake, "updated_at", None)),
        "status": status,
        "status_label": _contractor_status_label(status),
        "status_group": bid_status_group(status),
        "status_note": _contractor_status_note(status),
        "linked_agreement_id": getattr(linked_agreement, "id", None),
        "linked_agreement_label": _agreement_label(linked_agreement),
        "linked_agreement_reference": _agreement_reference(linked_agreement),
        "linked_agreement_url": f"/app/agreements/{linked_agreement.id}" if linked_agreement else "",
        "notes": project_notes,
        "timeline": _safe_text(snapshot.get("timeline")),
        "budget_text": _safe_text(snapshot.get("budget")),
        "milestone_preview": _milestone_preview(analysis.get("milestones") or snapshot.get("milestones") or intake.ai_milestones or []),
        "next_action": bid_next_action(
            status=status,
            linked_agreement_id=getattr(linked_agreement, "id", None),
            source_kind="intake",
        ),
    }


def _absolute_file_url(file_field, request=None) -> str:
    if not file_field:
        return ""
    try:
        url = file_field.url
    except Exception:
        return ""
    if request:
        try:
            return request.build_absolute_uri(url)
        except Exception:
            return url
    return url


def _property_location(property_profile) -> str:
    if property_profile is None:
        return ""
    line_one = _safe_text(getattr(property_profile, "address_line1", ""))
    line_two = _safe_text(getattr(property_profile, "address_line2", ""))
    city_line = ", ".join(
        part
        for part in [
            _safe_text(getattr(property_profile, "city", "")),
            _safe_text(getattr(property_profile, "state", "")),
            _safe_text(getattr(property_profile, "postal_code", "")),
        ]
        if part
    )
    return "\n".join(part for part in [line_one, line_two, city_line] if part)


def _property_work_order_photos(work_order, request=None) -> list[dict]:
    photos: list[dict] = []
    source_request = getattr(work_order, "source_tenant_request", None)
    try:
        request_attachments = list(source_request.attachments.all()) if source_request is not None else []
    except Exception:
        request_attachments = []
    try:
        work_order_attachments = list(work_order.attachments.all())
    except Exception:
        work_order_attachments = []

    for attachment in [*request_attachments, *work_order_attachments][:8]:
        file_field = getattr(attachment, "file", None)
        image_url = _absolute_file_url(file_field, request=request)
        content_type = _safe_text(getattr(attachment, "content_type", ""))
        original_name = _safe_text(getattr(attachment, "original_filename", ""))
        photos.append(
            {
                "id": getattr(attachment, "id", None),
                "image_url": image_url if content_type.startswith("image/") else "",
                "url": image_url,
                "original_name": original_name or "Attachment",
                "caption": _safe_text(getattr(attachment, "attachment_type", "")) or "Maintenance request attachment",
                "content_type": content_type,
                "uploaded_at": _format_date(getattr(attachment, "created_at", None)),
            }
        )
    return photos


def _property_work_order_status(opportunity, work_order) -> str:
    opportunity_status = _safe_text(getattr(opportunity, "status", "")).lower()
    marketplace_status = _safe_text(getattr(work_order, "marketplace_status", "")).lower()
    if getattr(work_order, "linked_agreement_id", None) or getattr(opportunity, "converted_agreement_id", None):
        return "awarded"
    if opportunity_status in {ContractorOpportunity.STATUS_DECLINED, ContractorOpportunity.STATUS_EXPIRED}:
        return "declined" if opportunity_status == ContractorOpportunity.STATUS_DECLINED else "expired"
    if marketplace_status == PropertyWorkOrder.MARKETPLACE_WITHDRAWN:
        return "expired"
    if marketplace_status == PropertyWorkOrder.MARKETPLACE_DECLINED:
        return "declined"
    if opportunity_status == ContractorOpportunity.STATUS_ACCEPTED or marketplace_status == PropertyWorkOrder.MARKETPLACE_ACCEPTED:
        return "accepted"
    return "submitted"


def _property_work_order_status_label(status: str) -> str:
    normalized = _safe_text(status).lower()
    return {
        "submitted": "Needs Response",
        "accepted": "Accepted",
        "awarded": "Agreement Draft Ready",
        "declined": "Declined",
        "expired": "Closed",
    }.get(normalized, _contractor_status_label(normalized))


def _property_work_order_status_group(status: str) -> str:
    normalized = _safe_text(status).lower()
    if normalized == "submitted":
        return "open"
    if normalized == "accepted":
        return "follow_up"
    if normalized == "awarded":
        return "awarded"
    return "declined_expired"


def _property_work_order_next_action(status: str, linked_agreement_id: int | None) -> dict:
    normalized = _safe_text(status).lower()
    if normalized == "submitted":
        return {"key": "accept_property_work_order", "label": "Accept Work Order", "target": ""}
    if normalized == "accepted":
        return {"key": "prepare_agreement_draft", "label": "Prepare Agreement Draft", "target": ""}
    if normalized == "awarded" and linked_agreement_id:
        return {
            "key": "open_agreement",
            "label": "Open Agreement Draft",
            "target": f"/app/agreements/{linked_agreement_id}/wizard?step=1",
        }
    return {"key": "view_details", "label": "View Details", "target": ""}


def _bid_row_from_property_work_order_opportunity(opportunity, request=None) -> dict:
    work_order = getattr(opportunity, "property_work_order", None)
    if work_order is None:
        return {}

    property_profile = getattr(work_order, "property_profile", None)
    company = getattr(work_order, "property_management_company", None)
    unit = getattr(work_order, "unit", None)
    tenant = getattr(work_order, "tenant", None)
    linked_agreement = getattr(work_order, "linked_agreement", None) or getattr(opportunity, "converted_agreement", None)
    linked_agreement_id = getattr(linked_agreement, "id", None)
    work_order_number = _safe_text(getattr(work_order, "work_order_number", "")) or f"PWO-{work_order.id:06d}"
    property_label = (
        _safe_text(getattr(property_profile, "display_name", ""))
        or _safe_text(getattr(property_profile, "address_line1", ""))
        or "Managed property"
    )
    unit_label = _safe_text(getattr(unit, "unit_label", ""))
    tenant_name = " ".join(
        part
        for part in [
            _safe_text(getattr(tenant, "first_name", "")),
            _safe_text(getattr(tenant, "last_name", "")),
        ]
        if part
    )
    location = _property_location(property_profile) or _safe_text(getattr(opportunity, "project_address", ""))
    priority_label = work_order.get_priority_display()
    category_label = work_order.get_category_display()
    photos = _property_work_order_photos(work_order, request=request)
    status = _property_work_order_status(opportunity, work_order)
    workspace_stage = _workspace_stage(status, "property_work_order")
    source_reference = work_order_number
    project_title = _safe_text(getattr(work_order, "title", "")) or _safe_text(getattr(opportunity, "project_title", "")) or work_order_number
    notes = _safe_text(getattr(work_order, "description", "")) or _safe_text(getattr(opportunity, "project_description", ""))
    request_signals = ["Property Management", priority_label, category_label]
    if photos:
        request_signals.append("Photos/Attachments")

    snapshot = {
        "project_title": project_title,
        "project_type": category_label,
        "project_subtype": priority_label,
        "project_family_key": "property_management_work_order",
        "project_family_label": "Property Management Work Order",
        "recommended_setup": {},
        "refined_description": notes,
        "project_scope_summary": notes,
        "location": location,
        "request_path_label": "Property Management Work Order",
        "measurement_handling": "",
        "desired_timing_text": "",
        "timeline": _safe_text(getattr(opportunity, "timeline", "")),
        "budget": "",
        "property_type": _safe_text(getattr(property_profile, "property_type", "")),
        "budget_range_text": "",
        "preferred_contact_method": "",
        "contact_consent": False,
        "clarification_summary": [
            {"key": "property", "label": "Property", "value": property_label},
            {"key": "unit", "label": "Unit", "value": unit_label or "Whole property"},
            {"key": "tenant", "label": "Tenant", "value": tenant_name or "-"},
            {"key": "priority", "label": "Priority", "value": priority_label},
            {"key": "category", "label": "Category", "value": category_label},
        ],
        "clarification_count": 5,
        "photo_count": len(photos),
        "photos": photos,
        "milestones": [],
        "guided_intake_completed": False,
        "materials_status": "",
        "property": property_label,
        "unit": unit_label,
        "tenant": tenant_name,
        "priority": priority_label,
        "category": category_label,
        "work_order_number": work_order_number,
    }
    snapshot["request_signals"] = request_signals

    next_action = _property_work_order_next_action(status, linked_agreement_id)
    linked_url = (
        f"/app/agreements/{linked_agreement_id}/wizard?step=1"
        if linked_agreement_id
        else ""
    )

    return {
        "bid_id": f"opportunity-{opportunity.id}",
        "record_id": opportunity.id,
        "source_kind": "property_work_order",
        "source_kind_label": "Property Management Work Order",
        "lead_source": "marketplace",
        "lead_source_label": "Marketplace",
        "lead_source_filter": "marketplace",
        "is_website_lead": False,
        "workspace_stage": workspace_stage,
        "workspace_stage_label": _workspace_stage_label(workspace_stage),
        "source_id": opportunity.id,
        "source_reference": source_reference,
        "project_title": project_title,
        "customer_name": _safe_text(getattr(company, "name", "")) or _safe_text(getattr(opportunity, "homeowner_name", "")) or "Property Management",
        "customer_email": _safe_text(getattr(company, "email", "")) or _safe_text(getattr(opportunity, "homeowner_email", "")),
        "customer_phone": _safe_text(getattr(company, "phone", "")) or _safe_text(getattr(opportunity, "homeowner_phone", "")),
        "location": location,
        "project_type": category_label,
        "project_subtype": priority_label,
        "property_type": _safe_text(getattr(property_profile, "property_type", "")),
        "budget_range_text": "",
        "preferred_contact_method": "",
        "contact_consent": False,
        "project_family_key": "property_management_work_order",
        "project_family_label": "Property Management Work Order",
        "request_path_label": "Property Management Work Order",
        "measurement_handling": "",
        "desired_timing_text": "",
        "photo_count": len(photos),
        "request_signals": request_signals,
        "request_snapshot": snapshot,
        "project_class": AgreementProjectClass.COMMERCIAL,
        "project_class_label": project_class_label(AgreementProjectClass.COMMERCIAL),
        "bid_amount": None,
        "bid_amount_label": "-",
        "submitted_at": _format_date(getattr(opportunity, "selected_at", None) or getattr(work_order, "marketplace_sent_at", None) or getattr(work_order, "created_at", None)),
        "updated_at": _format_date(getattr(opportunity, "updated_at", None) or getattr(work_order, "updated_at", None)),
        "status": status,
        "status_label": _property_work_order_status_label(status),
        "status_group": _property_work_order_status_group(status),
        "status_note": "Property management work order routed through MyHomeBro.",
        "linked_agreement_id": linked_agreement_id,
        "linked_agreement_label": _agreement_label(linked_agreement),
        "linked_agreement_reference": _agreement_reference(linked_agreement),
        "linked_agreement_url": linked_url,
        "notes": notes,
        "timeline": _safe_text(getattr(opportunity, "timeline", "")),
        "budget_text": "",
        "milestone_preview": [],
        "property_work_order_id": work_order.id,
        "work_order_number": work_order_number,
        "marketplace_status": _safe_text(getattr(work_order, "marketplace_status", "")),
        "marketplace_status_label": work_order.get_marketplace_status_display(),
        "next_action": next_action,
    }


def _filter_rows(
    rows: list[dict],
    *,
    status_filter: str = "",
    project_class_filter: str = "",
    source_filter: str = "",
    search: str = "",
) -> list[dict]:
    status_value = _safe_text(status_filter).lower()
    class_value = _safe_text(project_class_filter).lower()
    source_value = _safe_text(source_filter).lower()
    query = _safe_text(search).lower()

    out = []
    for row in rows:
        if status_value and status_value != "all" and row.get("status") != status_value:
            continue
        if class_value and class_value != "all" and row.get("project_class") != class_value:
            continue
        if source_value and source_value != "all":
            row_source = _safe_text(row.get("lead_source_filter") or row.get("source_kind")).lower()
            if source_value == "website_leads":
                if not row.get("is_website_lead"):
                    continue
            elif row_source != source_value:
                continue
        if query:
            haystack = " ".join(
                [
                    _safe_text(row.get("project_title")),
                    _safe_text(row.get("customer_name")),
                    _safe_text(row.get("customer_email")),
                    _safe_text(row.get("customer_phone")),
                    _safe_text(row.get("location")),
                    _safe_text(row.get("notes")),
                    _safe_text(row.get("budget_text")),
                    _safe_text(row.get("status_label")),
                    _safe_text(row.get("source_reference")),
                    _safe_text(row.get("linked_agreement_reference")),
                    _safe_text(row.get("source_kind_label")),
                    _safe_text(row.get("work_order_number")),
                    " ".join(_safe_text(signal) for signal in (row.get("request_signals") or [])),
                ]
            ).lower()
            if query not in haystack:
                continue
        out.append(row)
    return out


class ContractorBidsView(APIView):
    permission_classes = [IsAuthenticated]

    def get(self, request):
        contractor = _resolve_contractor(request.user)
        if contractor is None:
            return Response({"detail": "Contractor profile not found."}, status=404)

        leads = list(
            contractor.public_leads.select_related(
                "converted_agreement",
                "source_intake",
                "source_intake__agreement",
            )
            .prefetch_related("source_intake__clarification_photos")
            .order_by("-created_at", "-id")
        )
        intakes = list(
            ProjectIntake.objects.filter(contractor=contractor)
            .select_related("agreement", "public_lead", "public_lead__converted_agreement")
            .prefetch_related("clarification_photos")
            .order_by("-created_at", "-id")
        )
        property_work_order_opportunities = list(
            ContractorOpportunity.objects.filter(
                property_work_order__isnull=False,
            )
            .filter(
                Q(directory_entry__claimed_by_contractor=contractor)
                | Q(accepted_by_contractor=contractor)
            )
            .select_related(
                "converted_agreement",
                "directory_entry",
                "property_work_order",
                "property_work_order__linked_agreement",
                "property_work_order__property_management_company",
                "property_work_order__property_profile",
                "property_work_order__unit",
                "property_work_order__tenant",
                "property_work_order__source_tenant_request",
            )
            .prefetch_related(
                "property_work_order__attachments",
                "property_work_order__source_tenant_request__attachments",
            )
            .order_by("-selected_at", "-id")
        )
        marketplace_opportunities = list(
            ContractorOpportunity.objects.filter(
                property_work_order__isnull=True,
            )
            .filter(
                Q(directory_entry__claimed_by_contractor=contractor)
                | Q(accepted_by_contractor=contractor)
            )
            .select_related(
                "converted_agreement",
                "directory_entry",
            )
            .order_by("-selected_at", "-id")
        )

        rows: list[dict] = []
        linked_intake_ids = set()
        for lead in leads:
            source_intake = getattr(lead, "source_intake", None)
            if source_intake is not None:
                linked_intake_ids.add(source_intake.id)
            row = _bid_row_from_lead(lead, request=request)
            rows.append(row)

        for intake in intakes:
            if intake.id in linked_intake_ids or getattr(intake, "public_lead_id", None):
                continue
            row = _bid_row_from_intake(intake, request=request)
            if row:
                rows.append(row)

        for opportunity in property_work_order_opportunities:
            row = _bid_row_from_property_work_order_opportunity(opportunity, request=request)
            if row:
                rows.append(row)

        for opportunity in marketplace_opportunities:
            row = _bid_row_from_marketplace_opportunity(opportunity, request=request)
            if row:
                rows.append(row)

        rows.sort(
            key=lambda row: (
                row.get("submitted_at") or "",
                row.get("bid_id") or 0,
            ),
            reverse=True,
        )
        rows = _attach_estimate_appointments(contractor, rows)
        rows = _attach_proposals(contractor, rows)

        status_filter = _safe_text(request.GET.get("status", "")).lower()
        project_class_filter = _safe_text(request.GET.get("project_class", "")).lower()
        source_filter = _safe_text(request.GET.get("source", "")).lower()
        search = _safe_text(request.GET.get("search", ""))
        filtered_rows = _filter_rows(
            rows,
            status_filter=status_filter,
            project_class_filter=project_class_filter,
            source_filter=source_filter,
            search=search,
        )

        summary = {
            "total_bids": len(filtered_rows),
            "follow_up_leads": sum(1 for row in filtered_rows if row.get("workspace_stage") == "follow_up"),
            "open_bids": sum(1 for row in filtered_rows if row.get("status_group") == "open"),
            "under_review_bids": sum(1 for row in filtered_rows if row.get("status_group") == "under_review"),
            "awarded_bids": sum(1 for row in filtered_rows if row.get("status_group") == "awarded"),
            "declined_expired_bids": sum(
                1 for row in filtered_rows if row.get("status_group") == "declined_expired"
            ),
            "residential_count": sum(
                1 for row in filtered_rows if row.get("project_class") == AgreementProjectClass.RESIDENTIAL
            ),
            "commercial_count": sum(
                1 for row in filtered_rows if row.get("project_class") == AgreementProjectClass.COMMERCIAL
            ),
            "property_work_order_count": sum(
                1 for row in filtered_rows if row.get("source_kind") == "property_work_order"
            ),
            "website_leads": sum(1 for row in filtered_rows if row.get("is_website_lead")),
            "new_website_leads": sum(
                1
                for row in filtered_rows
                if row.get("is_website_lead") and row.get("workspace_stage") == "new_lead"
            ),
            "website_leads_needing_follow_up": sum(
                1
                for row in filtered_rows
                if row.get("is_website_lead")
                and row.get("workspace_stage") in {"new_lead", "follow_up"}
            ),
            "marketplace_eligibility": {
                "verification_status": getattr(contractor, "marketplace_verification_status", "unverified") or "unverified",
                "preferred": bool(
                    getattr(contractor, "marketplace_preferred", False)
                    and getattr(contractor, "marketplace_verification_status", "") == contractor.MARKETPLACE_VERIFIED
                ),
                "stripe_ready": bool(contractor.charges_enabled and contractor.payouts_enabled and not contractor.stripe_deauthorized_at),
                "charges_enabled": bool(contractor.charges_enabled),
                "payouts_enabled": bool(contractor.payouts_enabled),
                "action_needed": not bool(
                    getattr(contractor, "marketplace_verification_status", "") == contractor.MARKETPLACE_VERIFIED
                    and contractor.charges_enabled
                    and contractor.payouts_enabled
                    and not contractor.stripe_deauthorized_at
                ),
            },
        }

        return Response(
            {
                "results": filtered_rows,
                "summary": summary,
                "filters": {
                    "status": status_filter or "all",
                    "project_class": project_class_filter or "all",
                    "source": source_filter or "all",
                    "search": search,
                },
            },
            status=200,
        )


def _resolve_estimate_source(contractor, source_type: str, source_id, request=None):
    key = _appointment_key(source_type, source_id)
    if key is None:
        return None, {}, "Unsupported opportunity source."
    normalized_type, normalized_id = key

    if normalized_type == "lead":
        lead = (
            contractor.public_leads.select_related("converted_agreement", "source_intake", "source_intake__agreement")
            .prefetch_related("source_intake__clarification_photos")
            .filter(pk=normalized_id)
            .first()
        )
        if lead is None:
            return None, {}, "Opportunity source not found."
        return lead, _bid_row_from_lead(lead, request=request), ""

    if normalized_type == "intake":
        intake = (
            ProjectIntake.objects.filter(contractor=contractor, pk=normalized_id)
            .select_related("agreement", "public_lead", "public_lead__converted_agreement")
            .prefetch_related("clarification_photos")
            .first()
        )
        if intake is None:
            return None, {}, "Opportunity source not found."
        return intake, _bid_row_from_intake(intake, request=request), ""

    opportunity = (
        ContractorOpportunity.objects.filter(pk=normalized_id)
        .filter(Q(directory_entry__claimed_by_contractor=contractor) | Q(accepted_by_contractor=contractor))
        .select_related(
            "converted_agreement",
            "directory_entry",
            "property_work_order",
            "property_work_order__linked_agreement",
            "property_work_order__property_management_company",
            "property_work_order__property_profile",
            "property_work_order__unit",
            "property_work_order__tenant",
            "property_work_order__source_tenant_request",
        )
        .prefetch_related(
            "property_work_order__attachments",
            "property_work_order__source_tenant_request__attachments",
        )
        .first()
    )
    if opportunity is None:
        return None, {}, "Opportunity source not found."
    if getattr(opportunity, "property_work_order_id", None):
        return opportunity, _bid_row_from_property_work_order_opportunity(opportunity, request=request), ""
    return opportunity, _bid_row_from_marketplace_opportunity(opportunity, request=request), ""


def _estimate_source_kwargs(source_type: str, source) -> dict:
    normalized_type = _appointment_key(source_type, getattr(source, "id", None))[0]
    if normalized_type == "lead":
        return {"source_type": OpportunityEstimateAppointment.SOURCE_PUBLIC_LEAD, "public_lead": source}
    if normalized_type == "intake":
        return {"source_type": OpportunityEstimateAppointment.SOURCE_INTAKE, "project_intake": source}
    return {"source_type": OpportunityEstimateAppointment.SOURCE_OPPORTUNITY, "contractor_opportunity": source}


def _estimate_customer_message(appointment: OpportunityEstimateAppointment) -> str:
    local_start = timezone.localtime(appointment.scheduled_start)
    when = f"{local_start.strftime('%b')} {local_start.day}, {local_start.year} at {local_start.strftime('%I:%M %p').lstrip('0')}"
    type_label = appointment.get_appointment_type_display().lower()
    location = f" at {appointment.service_location}" if appointment.service_location and appointment.appointment_type == appointment.TYPE_IN_PERSON else ""
    return (
        f"Hi {appointment.customer_name or 'there'}, this confirms our {type_label} for "
        f"{appointment.opportunity_title or 'your project'} on {when}{location}. "
        "Please let me know if anything changes before then."
    )


class OpportunityEstimateAppointmentCreateView(APIView):
    permission_classes = [IsAuthenticated]

    def post(self, request):
        contractor = _resolve_contractor(request.user)
        if contractor is None:
            return Response({"detail": "Contractor profile not found."}, status=status.HTTP_404_NOT_FOUND)

        source_type = _safe_text(request.data.get("source_type"))
        source_id = request.data.get("source_id")
        source, row, error = _resolve_estimate_source(contractor, source_type, source_id, request=request)
        if error:
            return Response({"detail": error}, status=status.HTTP_400_BAD_REQUEST)

        customer_name = _safe_text(request.data.get("customer_name")) or _safe_text(row.get("customer_name"))
        customer_email = _safe_text(request.data.get("customer_email")) or _safe_text(row.get("customer_email"))
        customer_phone = _safe_text(request.data.get("customer_phone")) or _safe_text(row.get("customer_phone"))
        service_location = _safe_text(request.data.get("service_location")) or _safe_text(row.get("location"))
        appointment_type = _safe_text(request.data.get("appointment_type"))
        scheduled_start_raw = _safe_text(request.data.get("scheduled_start"))
        notes = _safe_text(request.data.get("notes"))

        errors = {}
        if not customer_name:
            errors["customer_name"] = ["Customer name is required."]
        if not customer_email and not customer_phone:
            errors["contact"] = ["Customer email or phone is required."]
        if appointment_type not in dict(OpportunityEstimateAppointment.TYPE_CHOICES):
            errors["appointment_type"] = ["Choose phone_call, video_call, or in_person."]
        if appointment_type == OpportunityEstimateAppointment.TYPE_IN_PERSON and not service_location:
            errors["service_location"] = ["Service location is required for an in-person estimate."]

        scheduled_start = parse_datetime(scheduled_start_raw) if scheduled_start_raw else None
        if scheduled_start is None:
            errors["scheduled_start"] = ["Scheduled start is required."]
        elif timezone.is_naive(scheduled_start):
            scheduled_start = timezone.make_aware(scheduled_start, timezone.get_current_timezone())

        try:
            duration_minutes = int(request.data.get("duration_minutes") or 60)
        except (TypeError, ValueError):
            duration_minutes = 0
        if duration_minutes < 15 or duration_minutes > 480:
            errors["duration_minutes"] = ["Duration must be between 15 and 480 minutes."]

        if errors:
            return Response(errors, status=status.HTTP_400_BAD_REQUEST)

        appointment = OpportunityEstimateAppointment.objects.create(
            contractor=contractor,
            **_estimate_source_kwargs(source_type, source),
            opportunity_title=_safe_text(row.get("project_title")),
            opportunity_reference=_safe_text(row.get("source_reference")),
            customer_name=customer_name,
            customer_email=customer_email,
            customer_phone=customer_phone,
            service_location=service_location,
            appointment_type=appointment_type,
            scheduled_start=scheduled_start,
            duration_minutes=duration_minutes,
            notes=notes,
            requested_by=OpportunityEstimateAppointment.REQUESTED_BY_CONTRACTOR,
            timezone=_safe_text(request.data.get("timezone")) or "America/Chicago",
            created_by=request.user,
        )
        message = _estimate_customer_message(appointment)
        appointment.customer_message = message
        appointment.save(update_fields=["customer_message", "updated_at"])
        return Response(
            {
                "appointment": _serialize_estimate_appointment(appointment),
                "source_summary": {
                    "source_type": appointment.source_type,
                    "source_id": appointment.public_lead_id or appointment.project_intake_id or appointment.contractor_opportunity_id,
                    "project_title": appointment.opportunity_title,
                    "reference": appointment.opportunity_reference,
                },
                "customer_message": message,
            },
            status=status.HTTP_201_CREATED,
        )
