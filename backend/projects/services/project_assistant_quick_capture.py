from __future__ import annotations

import re
from datetime import timedelta
from decimal import Decimal, InvalidOperation
from difflib import SequenceMatcher

from django.db import transaction
from django.db.models import Q
from django.utils import timezone
from django.utils.dateparse import parse_datetime

from projects.models import (
    Contractor,
    CustomerCommunicationLog,
    Homeowner,
    ProjectAssistantCaptureSession,
)
from projects.models_contractor_discovery import ContractorDirectoryEntry, ContractorOpportunity


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
        {"key": "schedule_estimate", "label": "Schedule Estimate"},
        {"key": "prepare_email", "label": "Prepare Email"},
        {"key": "prepare_text_message", "label": "Prepare Text Message"},
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
