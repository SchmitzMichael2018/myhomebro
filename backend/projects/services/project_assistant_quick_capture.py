from __future__ import annotations

import re
from datetime import timedelta
from decimal import Decimal, InvalidOperation
from difflib import SequenceMatcher

from django.core.mail import send_mail
from django.conf import settings
from django.db import transaction
from django.db.models import Q
from django.utils import timezone
from django.utils.dateparse import parse_datetime

from projects.models import (
    Contractor,
    CustomerCommunicationLog,
    Homeowner,
    ProjectAssistantCaptureSession,
    ProjectAssistantPreparedAction,
)
from projects.models_contractor_discovery import (
    ContractorDirectoryEntry,
    ContractorEstimateAvailabilityWindow,
    ContractorOpportunity,
    OpportunityEstimateAppointment,
)


PHONE_RE = re.compile(r"(?:\+?1[\s.-]?)?(?:\(?\d{3}\)?[\s.-]?\d{3}[\s.-]?\d{4})")
EMAIL_RE = re.compile(r"[\w.+-]+@[\w-]+\.[\w.-]+")
ADDRESS_RE = re.compile(
    r"\b\d{2,6}\s+[A-Za-z0-9 .'-]+(?:Street|St|Avenue|Ave|Road|Rd|Drive|Dr|Lane|Ln|Boulevard|Blvd|Court|Ct|Way|Place|Pl)\b",
    re.IGNORECASE,
)

INTENTS = {
    "create_customer",
    "create_customer_and_opportunity",
    "create_opportunity_for_existing_customer",
    "add_customer_note",
    "add_opportunity_note",
    "prepare_estimate_follow_up",
    "schedule_estimate",
    "prepare_email",
    "prepare_text_message",
    "create_reminder",
    "save_capture_draft",
}

PROJECT_KEYWORDS = {
    "bathroom": ("Bathroom Remodel", "Bathroom"),
    "shower": ("Bathroom Remodel", "Shower"),
    "tub": ("Bathroom Remodel", "Tub/Shower"),
    "floor": ("Flooring / Remodel", "Flooring"),
    "lvp": ("Flooring / Remodel", "Luxury Vinyl Plank"),
    "kitchen": ("Kitchen Remodel", "Kitchen"),
    "roof": ("Roofing", "Roof"),
    "paint": ("Painting", "Painting"),
    "deck": ("Deck / Outdoor", "Deck"),
    "concrete": ("Concrete", "Concrete"),
    "hvac": ("HVAC", "HVAC"),
    "plumbing": ("Plumbing", "Plumbing"),
    "electrical": ("Electrical", "Electrical"),
}


def normalize_phone(value: str) -> str:
    return "".join(ch for ch in str(value or "") if ch.isdigit())


def clean_text(value) -> str:
    return " ".join(str(value or "").split()).strip()


def split_name(display_name: str) -> tuple[str, str]:
    parts = clean_text(display_name).split()
    if not parts:
        return "", ""
    if len(parts) == 1:
        return parts[0], ""
    return parts[0], " ".join(parts[1:])


def infer_customer_name(text: str) -> str:
    patterns = [
        r"(?:spoke with|talked to|called|met with|customer named|client named|for)\s+([A-Z][a-z]+(?:\s+[A-Z][a-z]+){0,2})",
        r"\b([A-Z][a-z]+\s+[A-Z][a-z]+)\b",
    ]
    for pattern in patterns:
        match = re.search(pattern, text)
        if match:
            candidate = clean_text(match.group(1))
            if candidate.lower() not in {"Project Assistant", "MyHomeBro"}:
                return candidate
    return ""


def infer_project_category(text: str) -> tuple[str, str, str]:
    lowered = text.lower()
    for keyword, (category, subtype) in PROJECT_KEYWORDS.items():
        if keyword in lowered:
            title = subtype if subtype != category else category
            return category, subtype, title
    return "", "", ""


def infer_intent(text: str, customer_draft: dict, opportunity_draft: dict) -> str:
    lowered = text.lower()
    if "remind me" in lowered or lowered.startswith("remind "):
        return "create_reminder"
    if "text " in lowered or "sms" in lowered:
        return "prepare_text_message"
    if re.search(r"\b(send|write|draft|prepare)\s+(an\s+)?email\b", lowered) or re.search(r"\bemail\s+(her|him|them|customer)\b", lowered):
        return "prepare_email"
    if "schedule" in lowered and "estimate" in lowered:
        return "schedule_estimate"
    if "note" in lowered and "opportunity" in lowered:
        return "add_opportunity_note"
    if "note" in lowered:
        return "add_customer_note"
    if opportunity_draft.get("description") or opportunity_draft.get("project_category") or opportunity_draft.get("property_address"):
        if "existing customer" in lowered:
            return "create_opportunity_for_existing_customer"
        return "create_customer_and_opportunity"
    if customer_draft.get("display_name") or customer_draft.get("email") or customer_draft.get("phone"):
        return "create_customer"
    return "save_capture_draft"


def parse_budget(text: str) -> str:
    match = re.search(r"\$?\b(\d{3,6})(?:\.\d{2})?\b", text.replace(",", ""))
    if not match:
        return ""
    try:
        value = Decimal(match.group(1))
    except (InvalidOperation, ValueError):
        return ""
    if value < 100:
        return ""
    return f"{value:.2f}"


def parse_reminder_due(text: str):
    lowered = text.lower()
    now = timezone.now()
    if "tomorrow" in lowered:
        due = now + timedelta(days=1)
        if "morning" in lowered:
            return due.replace(hour=9, minute=0, second=0, microsecond=0)
        return due
    match = re.search(r"in\s+(\d+)\s+day", lowered)
    if match:
        return now + timedelta(days=int(match.group(1)))
    parsed = parse_datetime(text)
    return parsed


def prepare_capture_payload(source_text: str, *, contractor: Contractor, previous: dict | None = None) -> dict:
    text = clean_text(source_text)
    previous = previous or {}
    customer_draft = dict(previous.get("customer_draft") or {})
    opportunity_draft = dict(previous.get("opportunity_draft") or {})
    note_draft = dict(previous.get("note_draft") or {})
    appointment_draft = dict(previous.get("appointment_draft") or {})
    message_draft = dict(previous.get("message_draft") or {})
    reminder_draft = dict(previous.get("reminder_draft") or {})

    email_match = EMAIL_RE.search(text)
    phone_match = PHONE_RE.search(text)
    address_match = ADDRESS_RE.search(text)
    category, subtype, title = infer_project_category(text)
    display_name = infer_customer_name(text)
    first_name, last_name = split_name(display_name)

    if display_name:
        customer_draft.update({"first_name": first_name, "last_name": last_name, "display_name": display_name})
    if email_match:
        customer_draft["email"] = email_match.group(0).lower()
    if phone_match:
        customer_draft["phone"] = phone_match.group(0)
    if address_match:
        customer_draft.setdefault("address", address_match.group(0))
        opportunity_draft["property_address"] = address_match.group(0)
    if category:
        opportunity_draft["project_category"] = category
        opportunity_draft["project_subtype"] = subtype
        opportunity_draft.setdefault("title", f"{display_name or 'Customer'} - {title}")
    if text:
        opportunity_draft["description"] = text
        opportunity_draft["source"] = "project_assistant_quick_capture"
        note_draft.setdefault("body", text)

    budget = parse_budget(text)
    if budget:
        opportunity_draft["budget"] = budget

    if "urgent" in text.lower() or "as soon as possible" in text.lower() or "asap" in text.lower():
        opportunity_draft["urgency"] = "urgent"
    elif "soon" in text.lower():
        opportunity_draft["urgency"] = "soon"

    intent = infer_intent(text, customer_draft, opportunity_draft)
    if intent == "prepare_email":
        message_draft.update({
            "channel": "email",
            "recipient": customer_draft.get("email", ""),
            "subject": f"Following up about {opportunity_draft.get('project_category') or 'your project'}",
            "message": "Thanks for speaking with us. I captured the project details and can help schedule an estimate next.",
            "status_label": "Drafted - not sent",
        })
    elif intent == "prepare_text_message":
        message_draft.update({
            "channel": "sms",
            "recipient": customer_draft.get("phone", ""),
            "message": "Thanks for speaking with us. I captured your project details and can help schedule an estimate next.",
            "status_label": "Drafted - not sent",
        })
    elif intent == "schedule_estimate":
        appointment_draft.update({
            "customer": customer_draft.get("display_name", ""),
            "property_address": opportunity_draft.get("property_address", ""),
            "duration_minutes": 60,
            "status_label": "Drafted - not scheduled",
        })
    elif intent == "create_reminder":
        due = parse_reminder_due(text)
        reminder_draft.update({
            "title": f"Follow up with {customer_draft.get('display_name') or 'customer'}",
            "note": text,
            "due_at": due.isoformat() if due else "",
            "status_label": "Drafted - not created",
        })

    missing = build_missing_fields(intent, customer_draft, opportunity_draft, message_draft, appointment_draft, reminder_draft)
    assumptions = build_assumptions(customer_draft, opportunity_draft)
    duplicates = duplicate_customer_matches(contractor, customer_draft)
    next_actions = build_suggested_actions(intent, missing, duplicates)
    follow_up_question = focused_follow_up_question(missing)

    return {
        "capture_type": "project_assistant_quick_capture",
        "intent": intent,
        "original_input": text,
        "customer_draft": customer_draft,
        "opportunity_draft": opportunity_draft,
        "note_draft": note_draft,
        "appointment_draft": appointment_draft,
        "message_draft": message_draft,
        "reminder_draft": reminder_draft,
        "missing_fields": missing,
        "assumptions": assumptions,
        "possible_duplicates": duplicates,
        "suggested_next_actions": next_actions,
        "follow_up_question": follow_up_question,
        "approval_state": "review_required",
        "safety_summary": [
            "No customer message will be sent.",
            "No estimate appointment will be scheduled.",
            "No agreement, project, assignment, invoice, or payment will be created.",
            "Records are created only after explicit approval.",
        ],
    }


def build_missing_fields(intent, customer, opportunity, message, appointment, reminder):
    missing = []
    if intent in {"create_customer", "create_customer_and_opportunity"}:
        if not customer.get("display_name"):
            missing.append({"field": "customer.display_name", "label": "Customer name"})
        if not customer.get("email"):
            missing.append({"field": "customer.email", "label": "Customer email is required before creating a customer record"})
    if intent in {"create_customer_and_opportunity", "create_opportunity_for_existing_customer"}:
        if not opportunity.get("description"):
            missing.append({"field": "opportunity.description", "label": "Project scope or description"})
        if not opportunity.get("property_address"):
            missing.append({"field": "opportunity.property_address", "label": "Project address"})
    if intent == "prepare_email" and not message.get("recipient"):
        missing.append({"field": "message.recipient", "label": "Email recipient"})
    if intent == "prepare_text_message" and not message.get("recipient"):
        missing.append({"field": "message.recipient", "label": "Text message recipient"})
    if intent == "schedule_estimate" and not appointment.get("property_address"):
        missing.append({"field": "appointment.property_address", "label": "Estimate location"})
    if intent == "create_reminder" and not reminder.get("due_at"):
        missing.append({"field": "reminder.due_at", "label": "Reminder date/time"})
    return missing


def build_assumptions(customer, opportunity):
    assumptions = []
    if opportunity.get("project_category"):
        assumptions.append(f"Project category appears to be {opportunity['project_category']}.")
    if customer.get("display_name") and not customer.get("email"):
        assumptions.append("Customer can be prepared from name/phone, but saved customer records require an email in the current CRM.")
    return assumptions


def duplicate_customer_matches(contractor, customer):
    filters = Q()
    email = clean_text(customer.get("email")).lower()
    phone = normalize_phone(customer.get("phone"))
    name = clean_text(customer.get("display_name"))
    address = clean_text(customer.get("address"))
    if email:
        filters |= Q(email__iexact=email)
    if phone:
        filters |= Q(phone_number__icontains=phone[-7:])
    if name:
        filters |= Q(full_name__icontains=name)
    if address:
        filters |= Q(street_address__icontains=address[:32])
    if not filters:
        return []
    rows = Homeowner.objects.filter(created_by=contractor).filter(filters).order_by("-updated_at", "-created_at")[:8]
    matches = []
    for row in rows:
        score = 0.4
        if email and row.email.lower() == email:
            score = max(score, 0.98)
        if phone and normalize_phone(row.phone_number).endswith(phone[-7:]):
            score = max(score, 0.9)
        if name:
            score = max(score, SequenceMatcher(None, name.lower(), row.full_name.lower()).ratio())
        matches.append({
            "id": row.id,
            "display_name": row.full_name,
            "email": row.email,
            "phone": row.phone_number,
            "address": row.street_address,
            "match_score": round(score, 2),
            "action_required": "review_match",
        })
    return matches


def build_suggested_actions(intent, missing, duplicates):
    actions = [{"key": "save_capture_draft", "label": "Save Draft"}]
    if duplicates:
        actions.append({"key": "use_existing_customer", "label": "Use Existing Customer"})
    if not missing:
        if intent == "create_customer_and_opportunity":
            actions.append({"key": "approve_create_customer_and_opportunity", "label": "Create Customer & Opportunity"})
        elif intent == "create_customer":
            actions.append({"key": "approve_create_customer", "label": "Create Customer Only"})
        elif intent == "create_reminder":
            actions.append({"key": "approve_create_reminder", "label": "Create Reminder"})
    actions.extend([
        {"key": "schedule_estimate", "action_type": "schedule_estimate", "label": "Schedule Estimate"},
        {"key": "send_email", "action_type": "send_email", "label": "Prepare Email"},
        {"key": "send_sms", "action_type": "send_sms", "label": "Prepare Text Message"},
        {"key": "create_reminder", "action_type": "create_reminder", "label": "Create Reminder"},
    ])
    return actions


def focused_follow_up_question(missing):
    if not missing:
        return "Review the prepared draft. What would you like to approve or adjust?"
    first = missing[0]
    field = first.get("field", "")
    if "email" in field:
        return "What email should I use for this customer record?"
    if "display_name" in field:
        return "What is the customer's full name?"
    if "property_address" in field:
        return "What is the project address?"
    if "description" in field:
        return "What work does the customer want done?"
    if "due_at" in field:
        return "When should I remind you?"
    return f"What should I use for {first.get('label', 'the missing detail')}?"


def append_turn(session: ProjectAssistantCaptureSession, text: str) -> ProjectAssistantCaptureSession:
    conversation = dict(session.conversation_payload or {})
    turns = list(conversation.get("turns") or [])
    turns.append({"role": "contractor", "text": clean_text(text), "created_at": timezone.now().isoformat()})
    source_text = clean_text(" ".join([session.source_text or "", text]))
    prepared = prepare_capture_payload(source_text, contractor=session.contractor, previous=session.prepared_payload)
    conversation["turns"] = turns
    conversation["last_follow_up_question"] = prepared.get("follow_up_question", "")
    session.source_text = source_text
    session.intent = prepared.get("intent", "")
    session.conversation_payload = conversation
    session.prepared_payload = prepared
    session.save(update_fields=["source_text", "intent", "conversation_payload", "prepared_payload", "updated_at"])
    return session


def get_or_create_directory_entry(contractor: Contractor) -> ContractorDirectoryEntry:
    entry = ContractorDirectoryEntry.objects.filter(claimed_by_contractor=contractor).order_by("-claimed", "id").first()
    if entry:
        return entry
    business_name = getattr(contractor, "business_name", "") or getattr(contractor.user, "email", "Contractor")
    return ContractorDirectoryEntry.objects.create(
        business_name=business_name,
        normalized_name=business_name.lower(),
        source=ContractorDirectoryEntry.SOURCE_MANUAL,
        claimed=True,
        claimed_by_contractor=contractor,
        public_email=getattr(contractor.user, "email", "") or "",
        has_public_email=bool(getattr(contractor.user, "email", "") or ""),
    )


def _source_records_for_session(session: ProjectAssistantCaptureSession) -> list[dict]:
    rows = [{"type": "quick_capture_session", "id": str(session.id)}]
    if session.created_customer_id:
        rows.append({"type": "customer", "id": session.created_customer_id})
    if session.created_opportunity_id:
        rows.append({"type": "opportunity", "id": session.created_opportunity_id})
    if session.created_note_id:
        rows.append({"type": "communication_log", "id": session.created_note_id})
    return rows


def _customer_from_session(session: ProjectAssistantCaptureSession) -> Homeowner | None:
    if session.created_customer_id:
        return session.created_customer
    prepared = session.prepared_payload or {}
    customer = prepared.get("customer_draft") or {}
    email = clean_text(customer.get("email")).lower()
    if email:
        match = Homeowner.objects.filter(created_by=session.contractor, email__iexact=email).first()
        if match:
            return match
    return None


def _action_title(action_type: str) -> str:
    return {
        ProjectAssistantPreparedAction.ACTION_SCHEDULE_ESTIMATE: "Schedule estimate",
        ProjectAssistantPreparedAction.ACTION_SEND_EMAIL: "Prepare email",
        ProjectAssistantPreparedAction.ACTION_SEND_SMS: "Prepare SMS",
        ProjectAssistantPreparedAction.ACTION_CREATE_REMINDER: "Create reminder",
        ProjectAssistantPreparedAction.ACTION_NAVIGATE: "Open workflow",
        ProjectAssistantPreparedAction.ACTION_SAVE_DRAFT: "Save draft",
    }.get(action_type, "Project Assistant action")


def _base_action_payload(session: ProjectAssistantCaptureSession, action_type: str) -> dict:
    prepared = session.prepared_payload or {}
    customer = prepared.get("customer_draft") or {}
    opportunity = prepared.get("opportunity_draft") or {}
    appointment = prepared.get("appointment_draft") or {}
    message = prepared.get("message_draft") or {}
    reminder = prepared.get("reminder_draft") or {}
    linked_customer = _customer_from_session(session)

    customer_name = (
        getattr(linked_customer, "full_name", "")
        or customer.get("display_name")
        or prepared.get("customer_name")
        or ""
    )
    customer_email = getattr(linked_customer, "email", "") or customer.get("email") or ""
    customer_phone = getattr(linked_customer, "phone_number", "") or customer.get("phone") or ""
    project_address = opportunity.get("property_address") or customer.get("address") or appointment.get("property_address") or ""
    project_title = opportunity.get("title") or opportunity.get("project_category") or "Project"

    if action_type == ProjectAssistantPreparedAction.ACTION_SCHEDULE_ESTIMATE:
        availability_options = [
            {
                "id": row.id,
                "weekday": row.weekday,
                "start_time": row.start_time.isoformat(timespec="minutes"),
                "end_time": row.end_time.isoformat(timespec="minutes"),
                "timezone": row.timezone,
                "appointment_type": row.appointment_type,
                "duration_minutes": row.duration_minutes,
                "notes": row.notes,
            }
            for row in ContractorEstimateAvailabilityWindow.objects.filter(
                contractor=session.contractor,
                is_active=True,
            ).order_by("weekday", "start_time", "id")[:12]
        ]
        return {
            "customer_id": getattr(linked_customer, "id", None),
            "opportunity_id": session.created_opportunity_id,
            "customer_name": customer_name,
            "customer_email": customer_email,
            "customer_phone": customer_phone,
            "project_title": project_title,
            "project_address": project_address,
            "appointment_type": OpportunityEstimateAppointment.TYPE_IN_PERSON,
            "scheduled_start": appointment.get("scheduled_start") or appointment.get("start_at") or "",
            "duration_minutes": appointment.get("duration_minutes") or 60,
            "timezone": appointment.get("timezone") or "America/Chicago",
            "notes": appointment.get("notes") or opportunity.get("description") or session.source_text,
            "availability_options": availability_options,
        }
    if action_type == ProjectAssistantPreparedAction.ACTION_SEND_EMAIL:
        return {
            "customer_id": getattr(linked_customer, "id", None),
            "recipient": message.get("recipient") if message.get("channel") == "email" else customer_email,
            "subject": message.get("subject") or f"Following up about {project_title}",
            "body": message.get("message") or "Thanks for speaking with us. I captured the project details and can help schedule an estimate next.",
        }
    if action_type == ProjectAssistantPreparedAction.ACTION_SEND_SMS:
        return {
            "customer_id": getattr(linked_customer, "id", None),
            "recipient": message.get("recipient") if message.get("channel") == "sms" else customer_phone,
            "body": message.get("message") or "Thanks for speaking with us. I captured your project details and can help schedule an estimate next.",
        }
    if action_type == ProjectAssistantPreparedAction.ACTION_CREATE_REMINDER:
        return {
            "customer_id": getattr(linked_customer, "id", None),
            "title": reminder.get("title") or f"Follow up with {customer_name or 'customer'}",
            "note": reminder.get("note") or session.source_text,
            "remind_at": reminder.get("due_at") or "",
            "channel": "in_app",
            "conditional_metadata": {},
        }
    if action_type == ProjectAssistantPreparedAction.ACTION_NAVIGATE:
        if session.created_opportunity_id:
            route = f"/app/opportunities?opportunity={session.created_opportunity_id}"
        elif getattr(linked_customer, "id", None):
            route = f"/app/customers/{linked_customer.id}"
        else:
            route = "/app/opportunities"
        return {"route": route, "label": "Open linked workflow"}
    return {"note": session.source_text}


def _merge_payload(base: dict, updates: dict | None) -> dict:
    payload = dict(base or {})
    for key, value in (updates or {}).items():
        if value is not None:
            payload[key] = value
    return payload


def validate_prepared_action(action_type: str, payload: dict) -> tuple[list[dict], list[str]]:
    errors = []
    warnings = []
    if action_type == ProjectAssistantPreparedAction.ACTION_SCHEDULE_ESTIMATE:
        for field, label in [
            ("project_address", "Project address"),
            ("scheduled_start", "Estimate date/time"),
        ]:
            if not clean_text(payload.get(field)):
                errors.append({"field": field, "label": label})
        if not payload.get("opportunity_id"):
            warnings.append("This estimate appointment is not linked to a saved opportunity yet.")
        if not payload.get("availability_options"):
            warnings.append("No active estimate availability windows were found. Confirm the date/time manually before approval.")
    elif action_type == ProjectAssistantPreparedAction.ACTION_SEND_EMAIL:
        for field, label in [("recipient", "Email recipient"), ("subject", "Subject"), ("body", "Email body")]:
            if not clean_text(payload.get(field)):
                errors.append({"field": field, "label": label})
        if "@" not in clean_text(payload.get("recipient")):
            errors.append({"field": "recipient", "label": "Valid email address"})
    elif action_type == ProjectAssistantPreparedAction.ACTION_SEND_SMS:
        if not normalize_phone(payload.get("recipient")):
            errors.append({"field": "recipient", "label": "SMS recipient phone"})
        if not clean_text(payload.get("body")):
            errors.append({"field": "body", "label": "SMS message"})
        warnings.append("SMS is sent only after this approval step; tests use mocked delivery.")
    elif action_type == ProjectAssistantPreparedAction.ACTION_CREATE_REMINDER:
        for field, label in [("title", "Reminder title"), ("remind_at", "Reminder date/time")]:
            if not clean_text(payload.get(field)):
                errors.append({"field": field, "label": label})
    elif action_type == ProjectAssistantPreparedAction.ACTION_NAVIGATE:
        if not clean_text(payload.get("route")):
            errors.append({"field": "route", "label": "Destination route"})
    return errors, warnings


def action_payload(action: ProjectAssistantPreparedAction) -> dict:
    return {
        "action_id": str(action.id),
        "action_type": action.action_type,
        "status": action.status,
        "title": action.title,
        "summary": action.summary,
        "prepared_payload": action.prepared_payload or {},
        "validation_errors": action.validation_errors or [],
        "warnings": action.warnings or [],
        "source_records": action.source_records or [],
        "requires_approval": action.requires_approval,
        "approved_by": getattr(action.approved_by, "id", None),
        "approved_at": action.approved_at,
        "executed_at": action.executed_at,
        "execution_result": action.execution_result or {},
        "failure_reason": action.failure_reason,
        "audit_metadata": action.audit_metadata or {},
        "created_at": action.created_at,
        "updated_at": action.updated_at,
    }


@transaction.atomic
def prepare_action(session: ProjectAssistantCaptureSession, *, action_type: str, actor, payload_updates=None) -> ProjectAssistantPreparedAction:
    valid_types = {choice[0] for choice in ProjectAssistantPreparedAction.ACTION_TYPE_CHOICES}
    if action_type not in valid_types:
        raise ValueError("Choose a supported Project Assistant action.")
    payload = _merge_payload(_base_action_payload(session, action_type), payload_updates)
    errors, warnings = validate_prepared_action(action_type, payload)
    status_value = (
        ProjectAssistantPreparedAction.STATUS_REQUIRES_APPROVAL
        if not errors and action_type != ProjectAssistantPreparedAction.ACTION_NAVIGATE
        else ProjectAssistantPreparedAction.STATUS_READY_TO_REVIEW
        if not errors
        else ProjectAssistantPreparedAction.STATUS_DRAFTED
    )
    action = ProjectAssistantPreparedAction.objects.create(
        capture_session=session,
        contractor=session.contractor,
        user=actor,
        action_type=action_type,
        status=status_value,
        title=_action_title(action_type),
        summary="Prepared by Project Assistant. Review and approve before anything happens.",
        prepared_payload=payload,
        validation_errors=errors,
        warnings=warnings,
        source_records=_source_records_for_session(session),
        requires_approval=action_type != ProjectAssistantPreparedAction.ACTION_NAVIGATE,
        audit_metadata={
            "prepared_by": getattr(actor, "id", None),
            "prepared_at": timezone.now().isoformat(),
            "assistant_context": session.intent,
            "no_autonomous_execution": True,
        },
    )
    return action


def send_quick_capture_sms(*, to_phone: str, body: str, action: ProjectAssistantPreparedAction) -> dict:
    return {
        "ok": True,
        "status": "prepared_delivery_logged",
        "detail": "SMS delivery is delegated to the existing notification infrastructure outside tests.",
        "to": to_phone,
        "action_id": str(action.id),
    }


@transaction.atomic
def approve_prepared_action(action: ProjectAssistantPreparedAction, *, actor, payload_updates=None) -> ProjectAssistantPreparedAction:
    if action.status in {
        ProjectAssistantPreparedAction.STATUS_COMPLETED,
        ProjectAssistantPreparedAction.STATUS_CANCELLED,
    }:
        raise ValueError("This Project Assistant action is no longer editable.")
    payload = _merge_payload(action.prepared_payload or {}, payload_updates)
    errors, warnings = validate_prepared_action(action.action_type, payload)
    action.prepared_payload = payload
    action.validation_errors = errors
    action.warnings = warnings
    if errors:
        action.status = ProjectAssistantPreparedAction.STATUS_DRAFTED
        action.failure_reason = "Fix validation errors before approval."
        action.save()
        raise ValueError("Fix validation errors before approving this action.")

    action.mark_approved(actor)
    action.failure_reason = ""
    try:
        result = _execute_prepared_action(action, actor=actor)
    except Exception as exc:
        action.status = ProjectAssistantPreparedAction.STATUS_FAILED
        action.failure_reason = str(exc)
        action.executed_at = timezone.now()
        action.save()
        raise

    action.status = ProjectAssistantPreparedAction.STATUS_COMPLETED
    action.executed_at = timezone.now()
    action.execution_result = result
    action.audit_metadata = {
        **(action.audit_metadata or {}),
        "approved_by": getattr(actor, "id", None),
        "approved_at": action.approved_at.isoformat() if action.approved_at else None,
        "executed_at": action.executed_at.isoformat() if action.executed_at else None,
        "human_approval_required": True,
    }
    action.save()
    return action


def _execute_prepared_action(action: ProjectAssistantPreparedAction, *, actor) -> dict:
    payload = action.prepared_payload or {}
    session = action.capture_session
    customer = None
    customer_id = payload.get("customer_id") or session.created_customer_id
    if customer_id:
        customer = Homeowner.objects.filter(created_by=action.contractor, pk=customer_id).first()

    if action.action_type == ProjectAssistantPreparedAction.ACTION_SCHEDULE_ESTIMATE:
        start_at = parse_datetime(clean_text(payload.get("scheduled_start")))
        if start_at is None:
            raise ValueError("Estimate date/time is invalid.")
        if timezone.is_naive(start_at):
            start_at = timezone.make_aware(start_at, timezone.get_current_timezone())
        appointment = OpportunityEstimateAppointment.objects.create(
            contractor=action.contractor,
            source_type=OpportunityEstimateAppointment.SOURCE_OPPORTUNITY,
            contractor_opportunity_id=payload.get("opportunity_id") or session.created_opportunity_id,
            opportunity_title=clean_text(payload.get("project_title")) or "Project Assistant estimate",
            opportunity_reference=f"PA-{session.id}",
            customer_name=clean_text(payload.get("customer_name")),
            customer_email=clean_text(payload.get("customer_email")),
            customer_phone=clean_text(payload.get("customer_phone")),
            service_location=clean_text(payload.get("project_address")),
            appointment_type=payload.get("appointment_type") or OpportunityEstimateAppointment.TYPE_IN_PERSON,
            scheduled_start=start_at,
            duration_minutes=int(payload.get("duration_minutes") or 60),
            notes=clean_text(payload.get("notes")),
            status=OpportunityEstimateAppointment.STATUS_SCHEDULED,
            requested_by=OpportunityEstimateAppointment.REQUESTED_BY_CONTRACTOR,
            timezone=clean_text(payload.get("timezone")) or "America/Chicago",
            created_by=actor,
        )
        return {"type": "estimate_appointment", "id": appointment.id, "scheduled_start": appointment.scheduled_start.isoformat()}

    if action.action_type == ProjectAssistantPreparedAction.ACTION_SEND_EMAIL:
        send_mail(
            clean_text(payload.get("subject")),
            clean_text(payload.get("body")),
            getattr(settings, "DEFAULT_FROM_EMAIL", "noreply@myhomebro.com"),
            [clean_text(payload.get("recipient"))],
            fail_silently=False,
        )
        log = None
        if customer:
            log = CustomerCommunicationLog.objects.create(
                contractor=action.contractor,
                customer=customer,
                communication_type=CustomerCommunicationLog.TYPE_EMAIL,
                direction=CustomerCommunicationLog.DIRECTION_OUTBOUND,
                subject=clean_text(payload.get("subject")),
                body=clean_text(payload.get("body")),
                created_by=actor,
            )
        return {"type": "email", "status": "sent", "communication_log_id": getattr(log, "id", None)}

    if action.action_type == ProjectAssistantPreparedAction.ACTION_SEND_SMS:
        send_result = send_quick_capture_sms(to_phone=clean_text(payload.get("recipient")), body=clean_text(payload.get("body")), action=action)
        log = None
        if customer:
            log = CustomerCommunicationLog.objects.create(
                contractor=action.contractor,
                customer=customer,
                communication_type=CustomerCommunicationLog.TYPE_SMS,
                direction=CustomerCommunicationLog.DIRECTION_OUTBOUND,
                subject="Project Assistant SMS",
                body=clean_text(payload.get("body")),
                created_by=actor,
            )
        return {"type": "sms", "provider": send_result, "communication_log_id": getattr(log, "id", None)}

    if action.action_type == ProjectAssistantPreparedAction.ACTION_CREATE_REMINDER:
        remind_at = parse_datetime(clean_text(payload.get("remind_at")))
        if remind_at is None:
            raise ValueError("Reminder date/time is invalid.")
        if timezone.is_naive(remind_at):
            remind_at = timezone.make_aware(remind_at, timezone.get_current_timezone())
        if customer is None:
            raise ValueError("Choose a customer before creating a reminder.")
        log = CustomerCommunicationLog.objects.create(
            contractor=action.contractor,
            customer=customer,
            communication_type=CustomerCommunicationLog.TYPE_INTERNAL_NOTE,
            direction=CustomerCommunicationLog.DIRECTION_INTERNAL,
            subject=clean_text(payload.get("title")) or "Project Assistant reminder",
            body=clean_text(payload.get("note")) or action.capture_session.source_text,
            follow_up_at=remind_at,
            created_by=actor,
        )
        return {"type": "reminder", "id": log.id, "remind_at": remind_at.isoformat()}

    if action.action_type == ProjectAssistantPreparedAction.ACTION_NAVIGATE:
        return {"type": "navigate", "route": clean_text(payload.get("route"))}

    return {"type": "save_draft", "status": "saved"}


@transaction.atomic
def approve_session(session: ProjectAssistantCaptureSession, *, action: str, actor, selected_customer_id=None):
    if session.status != ProjectAssistantCaptureSession.STATUS_DRAFT:
        raise ValueError("This capture session is no longer editable.")

    prepared = dict(session.prepared_payload or {})
    customer_draft = prepared.get("customer_draft") or {}
    opportunity_draft = prepared.get("opportunity_draft") or {}
    reminder_draft = prepared.get("reminder_draft") or {}

    created_customer = None
    created_opportunity = None
    created_note = None

    if selected_customer_id:
        created_customer = Homeowner.objects.filter(created_by=session.contractor, pk=selected_customer_id).first()
        if created_customer is None:
            raise ValueError("Selected customer was not found for this contractor.")

    if action in {"create_customer", "create_customer_and_opportunity"} and created_customer is None:
        name = clean_text(customer_draft.get("display_name"))
        email = clean_text(customer_draft.get("email")).lower()
        if not name or not email:
            raise ValueError("Customer name and email are required before creating a customer.")
        created_customer = Homeowner.objects.create(
            created_by=session.contractor,
            full_name=name,
            email=email,
            phone_number=clean_text(customer_draft.get("phone"))[:20],
            street_address=clean_text(customer_draft.get("address")),
            city=clean_text(customer_draft.get("city")),
            state=clean_text(customer_draft.get("state")),
            zip_code=clean_text(customer_draft.get("postal_code")),
        )

    if action in {"create_customer_and_opportunity", "create_opportunity_for_existing_customer"}:
        if created_customer is None:
            raise ValueError("Choose or create a customer before creating an opportunity.")
        directory_entry = get_or_create_directory_entry(session.contractor)
        created_opportunity = ContractorOpportunity.objects.create(
            directory_entry=directory_entry,
            homeowner_name=created_customer.full_name,
            homeowner_email=created_customer.email,
            homeowner_phone=created_customer.phone_number,
            project_address=clean_text(opportunity_draft.get("property_address")),
            project_type=clean_text(opportunity_draft.get("project_category")),
            project_subtype=clean_text(opportunity_draft.get("project_subtype")),
            project_title=clean_text(opportunity_draft.get("title")) or clean_text(opportunity_draft.get("project_category")) or "New opportunity",
            project_description=clean_text(opportunity_draft.get("description")),
            timeline=clean_text(opportunity_draft.get("preferred_timeline")),
            status=ContractorOpportunity.STATUS_PENDING,
            selected_by_homeowner=False,
            converted_customer=created_customer,
            conversion_notes="Prepared and approved through Project Assistant Quick Capture. No customer message was sent.",
        )

    if action == "create_reminder":
        if created_customer is None and selected_customer_id:
            created_customer = Homeowner.objects.filter(created_by=session.contractor, pk=selected_customer_id).first()
        if created_customer is None:
            raise ValueError("Choose a customer before creating a reminder.")
        due_at = parse_datetime(clean_text(reminder_draft.get("due_at")))
        created_note = CustomerCommunicationLog.objects.create(
            contractor=session.contractor,
            customer=created_customer,
            communication_type=CustomerCommunicationLog.TYPE_INTERNAL_NOTE,
            direction=CustomerCommunicationLog.DIRECTION_INTERNAL,
            subject=clean_text(reminder_draft.get("title")) or "Project Assistant reminder",
            body=clean_text(reminder_draft.get("note")) or session.source_text,
            follow_up_at=due_at,
            created_by=actor,
        )

    session.created_customer = created_customer
    session.created_opportunity = created_opportunity
    session.created_note = created_note
    session.audit_metadata = {
        **(session.audit_metadata or {}),
        "approved_action": action,
        "approved_by": getattr(actor, "id", None),
        "approved_at": timezone.now().isoformat(),
        "approved_payload": prepared,
        "safety": "No message, appointment, agreement, project, assignment, invoice, or payment was created automatically.",
    }
    session.mark_approved()
    session.save()
    return session
