from __future__ import annotations

from copy import deepcopy
from difflib import SequenceMatcher
import logging
import time

from django.conf import settings
from django.db import transaction
from django.utils import timezone

from projects.models import Capture, CaptureEvent, Homeowner
from projects.services.capture_lifecycle import (
    CaptureLifecycleError,
    check_expected_version,
    transition_capture,
)
from projects.services.customer_accounts import normalize_customer_phone


logger = logging.getLogger(__name__)


class CaptureProcessingError(CaptureLifecycleError):
    code = "capture_processing_error"


class CaptureSchemaError(CaptureLifecycleError):
    code = "invalid_capture_review"


PROJECT_CAPTURE_TYPES = {
    Capture.TYPE_PROJECT_UPDATE,
    Capture.TYPE_PROGRESS_PHOTO,
    Capture.TYPE_ISSUE,
    Capture.TYPE_COMMUNICATION,
    Capture.TYPE_DOCUMENT,
}
SUPPORTED_TYPES = {Capture.TYPE_QUICK_LEAD, Capture.TYPE_QUICK_NOTE, *PROJECT_CAPTURE_TYPES}
DESTINATIONS = {
    "unassigned_note",
    "customer_note",
    "project_note",
    "opportunity_note",
    "follow_up",
}
DUPLICATE_DECISIONS = {"link_existing", "create_separate", "not_same_person"}
PROJECT_DESTINATIONS = {
    "project_note",
    "project_activity",
    "project_attachment",
    "project_issue",
    "communication_log",
    "follow_up",
}


def _text(value, limit=2000):
    return str(value or "").strip()[:limit]


def _follow_up(value=None):
    value = value if isinstance(value, dict) else {}
    unknown = set(value) - {"suggested", "subject", "due_at", "source_phrase"}
    if unknown:
        raise CaptureSchemaError(f"Unsupported follow-up fields: {', '.join(sorted(unknown))}.")
    return {
        "suggested": bool(value.get("suggested", False)),
        "subject": _text(value.get("subject"), 200),
        "due_at": value.get("due_at") or None,
        "source_phrase": _text(value.get("source_phrase"), 500),
    }


def _bounded_list(value, limit=20):
    if not isinstance(value, list):
        raise CaptureSchemaError("Review lists must be arrays.")
    return [_text(item, 300) for item in value[:limit] if _text(item, 300)]


def build_quick_lead_draft(raw):
    name = _text(raw.get("name"), 200)
    summary = _text(raw.get("text") or raw.get("transcript") or raw.get("notes"), 2000)
    missing = [] if name else ["person.name"]
    return {
        "schema_version": "quick_lead.v1",
        "person": {
            "name": name,
            "phone": _text(raw.get("phone"), 60),
            "email": _text(raw.get("email"), 254),
        },
        "opportunity": {
            "title": _text(f"{name} project" if name else "", 200),
            "summary": summary,
            "project_type": "",
            "location_text": "",
        },
        "follow_up": _follow_up(),
        "proposed_destinations": ["customer", "opportunity"],
        "missing_fields": missing,
        "uncertainties": [],
        "warnings": [],
    }


def build_quick_note_draft(raw):
    body = _text(raw.get("text") or raw.get("transcript"), 5000)
    return {
        "schema_version": "quick_note.v1",
        "title": _text(raw.get("title"), 200),
        "body": body,
        "suggested_destination": "unassigned_note",
        "destination_candidates": [],
        "follow_up": _follow_up(),
        "missing_fields": [] if body else ["body"],
        "uncertainties": [],
        "warnings": [],
    }


def build_project_capture_draft(capture):
    raw = capture.raw_text_payload or {}
    metadata = raw.get("input_metadata") if isinstance(raw.get("input_metadata"), dict) else {}
    body = _text(raw.get("text") or raw.get("transcript"), 5000)
    title = _text(raw.get("title"), 200)
    project = capture.project
    milestone = capture.milestone
    destinations = {
        Capture.TYPE_PROJECT_UPDATE: ["project_activity", "project_note"],
        Capture.TYPE_PROGRESS_PHOTO: ["project_attachment", "project_activity"],
        Capture.TYPE_ISSUE: ["project_issue", "project_activity"],
        Capture.TYPE_COMMUNICATION: ["communication_log", "project_activity"],
        Capture.TYPE_DOCUMENT: ["project_attachment", "project_activity"],
    }[capture.capture_type]
    if capture.capture_type == Capture.TYPE_PROJECT_UPDATE and capture.artifacts.exists():
        destinations.append("project_attachment")
    missing = []
    if capture.capture_type in {
        Capture.TYPE_PROJECT_UPDATE,
        Capture.TYPE_ISSUE,
        Capture.TYPE_COMMUNICATION,
    } and not body:
        missing.append("body")
    if capture.capture_type == Capture.TYPE_ISSUE and not metadata.get("issue_classification"):
        missing.append("issue_classification")
    return {
        "schema_version": f"{capture.capture_type}.v1",
        "project": {"id": project.id, "title": _text(project.title, 255)},
        "milestone": (
            {"id": milestone.id, "title": _text(milestone.title, 255)}
            if milestone else None
        ),
        "title": title or {
            Capture.TYPE_PROJECT_UPDATE: "Project update",
            Capture.TYPE_PROGRESS_PHOTO: "Progress photos",
            Capture.TYPE_ISSUE: "Project issue",
            Capture.TYPE_COMMUNICATION: "Customer communication",
            Capture.TYPE_DOCUMENT: "Project document",
        }[capture.capture_type],
        "body": body,
        "issue_classification": _text(metadata.get("issue_classification"), 40),
        "communication_type": _text(metadata.get("communication_type"), 32),
        "communication_direction": _text(
            metadata.get("communication_direction") or "internal", 16
        ),
        "customer_visible": bool(metadata.get("customer_visible", False)),
        "customer_communication": {
            "suggested": False,
            "draft": "",
        },
        "follow_up": _follow_up(),
        "proposed_destinations": destinations,
        "missing_fields": missing,
        "uncertainties": [],
        "warnings": [
            "Milestone completion is never changed by Project Capture."
        ],
    }


def validate_structured_draft(capture_type, value):
    if not isinstance(value, dict):
        raise CaptureSchemaError("Structured draft must be an object.")
    if capture_type in PROJECT_CAPTURE_TYPES:
        allowed = {
            "schema_version", "project", "milestone", "title", "body",
            "issue_classification", "communication_type", "communication_direction",
            "customer_visible", "customer_communication", "follow_up",
            "proposed_destinations", "missing_fields", "uncertainties", "warnings",
        }
        unknown = set(value) - allowed
        if unknown:
            raise CaptureSchemaError(
                f"Unsupported Project Capture fields: {', '.join(sorted(unknown))}."
            )
        if value.get("schema_version") != f"{capture_type}.v1":
            raise CaptureSchemaError(
                f"Project Capture schema_version must remain {capture_type}.v1."
            )
        project = value.get("project")
        milestone = value.get("milestone")
        if not isinstance(project, dict) or set(project) - {"id", "title"} or not project.get("id"):
            raise CaptureSchemaError("Project association is required.")
        if milestone is not None and (
            not isinstance(milestone, dict)
            or set(milestone) - {"id", "title"}
            or not milestone.get("id")
        ):
            raise CaptureSchemaError("Milestone association is invalid.")
        destinations = value.get("proposed_destinations", [])
        if (
            not isinstance(destinations, list)
            or any(item not in PROJECT_DESTINATIONS for item in destinations)
        ):
            raise CaptureSchemaError("Project Capture destinations are invalid.")
        required = {
            Capture.TYPE_PROJECT_UPDATE: {"project_activity", "project_note"},
            Capture.TYPE_PROGRESS_PHOTO: {"project_attachment", "project_activity"},
            Capture.TYPE_ISSUE: {"project_issue", "project_activity"},
            Capture.TYPE_COMMUNICATION: {"communication_log", "project_activity"},
            Capture.TYPE_DOCUMENT: {"project_attachment", "project_activity"},
        }[capture_type]
        if not required.issubset(set(destinations)):
            raise CaptureSchemaError("Required Project Capture destinations cannot be removed.")
        body = _text(value.get("body"), 5000)
        classification = _text(value.get("issue_classification"), 40)
        if capture_type == Capture.TYPE_ISSUE and classification not in {
            "project_issue", "punch_item", "customer_concern", "potential_warranty",
            "potential_change_request", "internal_note",
        }:
            raise CaptureSchemaError("Choose a valid issue classification.")
        communication_type = _text(value.get("communication_type"), 32)
        if capture_type == Capture.TYPE_COMMUNICATION and communication_type not in {
            "phone_call", "email", "sms", "in_person", "other",
        }:
            raise CaptureSchemaError("Choose a valid communication type.")
        direction = _text(value.get("communication_direction") or "internal", 16)
        if direction not in {"internal", "inbound", "outbound"}:
            raise CaptureSchemaError("Communication direction is invalid.")
        customer_communication = value.get("customer_communication") or {}
        if not isinstance(customer_communication, dict) or set(customer_communication) - {
            "suggested", "draft"
        }:
            raise CaptureSchemaError("Customer communication suggestion is invalid.")
        missing = []
        if capture_type in {
            Capture.TYPE_PROJECT_UPDATE,
            Capture.TYPE_ISSUE,
            Capture.TYPE_COMMUNICATION,
        } and not body:
            missing.append("body")
        return {
            "schema_version": f"{capture_type}.v1",
            "project": {
                "id": project["id"],
                "title": _text(project.get("title"), 255),
            },
            "milestone": (
                {
                    "id": milestone["id"],
                    "title": _text(milestone.get("title"), 255),
                }
                if milestone else None
            ),
            "title": _text(value.get("title"), 255),
            "body": body,
            "issue_classification": classification,
            "communication_type": communication_type,
            "communication_direction": direction,
            "customer_visible": bool(value.get("customer_visible", False)),
            "customer_communication": {
                "suggested": bool(customer_communication.get("suggested", False)),
                "draft": _text(customer_communication.get("draft"), 2000),
            },
            "follow_up": _follow_up(value.get("follow_up")),
            "proposed_destinations": list(dict.fromkeys(destinations))[:8],
            "missing_fields": missing,
            "uncertainties": _bounded_list(value.get("uncertainties", [])),
            "warnings": _bounded_list(value.get("warnings", [])),
        }
    if capture_type == Capture.TYPE_QUICK_LEAD:
        allowed = {
            "schema_version", "person", "opportunity", "follow_up",
            "proposed_destinations", "missing_fields", "uncertainties", "warnings",
        }
        unknown = set(value) - allowed
        if unknown:
            raise CaptureSchemaError(f"Unsupported Quick Lead fields: {', '.join(sorted(unknown))}.")
        if value.get("schema_version") != "quick_lead.v1":
            raise CaptureSchemaError("Quick Lead schema_version must remain quick_lead.v1.")
        person = value.get("person")
        opportunity = value.get("opportunity")
        if not isinstance(person, dict) or set(person) - {"name", "phone", "email"}:
            raise CaptureSchemaError("Quick Lead person fields are invalid.")
        if not isinstance(opportunity, dict) or set(opportunity) - {
            "title", "summary", "project_type", "location_text"
        }:
            raise CaptureSchemaError("Quick Lead opportunity fields are invalid.")
        destinations = value.get("proposed_destinations", [])
        if not isinstance(destinations, list) or any(
            item not in {"customer", "opportunity"} for item in destinations
        ):
            raise CaptureSchemaError("Quick Lead proposed destinations are invalid.")
        name = _text(person.get("name"), 200)
        missing = [] if name else ["person.name"]
        return {
            "schema_version": "quick_lead.v1",
            "person": {
                "name": name,
                "phone": _text(person.get("phone"), 60),
                "email": _text(person.get("email"), 254),
            },
            "opportunity": {
                "title": _text(opportunity.get("title"), 200),
                "summary": _text(opportunity.get("summary"), 2000),
                "project_type": _text(opportunity.get("project_type"), 120),
                "location_text": _text(opportunity.get("location_text"), 300),
            },
            "follow_up": _follow_up(value.get("follow_up")),
            "proposed_destinations": list(dict.fromkeys(destinations))[:2],
            "missing_fields": missing,
            "uncertainties": _bounded_list(value.get("uncertainties", [])),
            "warnings": _bounded_list(value.get("warnings", [])),
        }
    if capture_type == Capture.TYPE_QUICK_NOTE:
        allowed = {
            "schema_version", "title", "body", "suggested_destination",
            "destination_candidates", "follow_up", "missing_fields",
            "uncertainties", "warnings",
        }
        unknown = set(value) - allowed
        if unknown:
            raise CaptureSchemaError(f"Unsupported Quick Note fields: {', '.join(sorted(unknown))}.")
        if value.get("schema_version") != "quick_note.v1":
            raise CaptureSchemaError("Quick Note schema_version must remain quick_note.v1.")
        destination = value.get("suggested_destination", "unassigned_note")
        candidates = value.get("destination_candidates", [])
        if destination not in DESTINATIONS or not isinstance(candidates, list) or any(
            item not in DESTINATIONS for item in candidates
        ):
            raise CaptureSchemaError("Quick Note destinations are invalid.")
        body = _text(value.get("body"), 5000)
        return {
            "schema_version": "quick_note.v1",
            "title": _text(value.get("title"), 200),
            "body": body,
            "suggested_destination": destination,
            "destination_candidates": list(dict.fromkeys(candidates))[:5],
            "follow_up": _follow_up(value.get("follow_up")),
            "missing_fields": [] if body else ["body"],
            "uncertainties": _bounded_list(value.get("uncertainties", [])),
            "warnings": _bounded_list(value.get("warnings", [])),
        }
    raise CaptureProcessingError("This Capture type cannot be reviewed.")


def _mask_email(value):
    value = _text(value, 254)
    if "@" not in value:
        return ""
    local, domain = value.split("@", 1)
    return f"{local[:1]}***@{domain}"


def _mask_phone(value):
    digits = normalize_customer_phone(value)
    return f"***-***-{digits[-4:]}" if len(digits) >= 4 else ""


def find_duplicate_candidates(capture):
    if capture.capture_type != Capture.TYPE_QUICK_LEAD:
        return []
    raw = capture.raw_text_payload or {}
    email = _text(raw.get("email"), 254).lower()
    phone = normalize_customer_phone(raw.get("phone"))
    name = _text(raw.get("name"), 200)
    rows = Homeowner.objects.filter(created_by=capture.contractor).order_by("-updated_at")[:250]
    candidates = []
    for row in rows:
        reason = ""
        strength = ""
        if email and _text(row.email, 254).lower() == email:
            reason, strength = "Exact email match", "exact"
        elif phone and normalize_customer_phone(row.phone_number) == phone:
            reason, strength = "Matching phone number", "strong"
        elif name:
            score = SequenceMatcher(None, name.casefold(), _text(row.full_name, 200).casefold()).ratio()
            if score >= 0.72:
                reason, strength = "Similar customer name", "advisory"
        if reason:
            candidates.append({
                "candidate_id": row.id,
                "display_name": _text(row.full_name, 200),
                "masked_email": _mask_email(row.email),
                "masked_phone": _mask_phone(row.phone_number),
                "reason": reason,
                "match_strength": strength,
            })
    order = {"exact": 0, "strong": 1, "advisory": 2}
    return sorted(candidates, key=lambda item: order[item["match_strength"]])[:8]


def review_envelope(capture):
    draft = capture.structured_draft or {}
    candidates = capture.duplicate_candidates or []
    decision = (capture.review_decisions or {}).get("duplicate")
    decision_required = any(
        row.get("match_strength") in {"exact", "strong"} for row in candidates
    ) and not decision
    missing = draft.get("missing_fields", []) if isinstance(draft, dict) else []
    return {
        "schema_version": draft.get("schema_version", ""),
        "structured_draft": draft,
        "missing_fields": missing,
        "uncertainties": draft.get("uncertainties", []),
        "warnings": draft.get("warnings", []),
        "duplicate_candidates": candidates,
        "duplicate_decision": decision,
        "duplicate_decision_required": decision_required,
        "can_approve": bool(draft) and not missing and not decision_required,
        "approved_snapshot": capture.approved_snapshot or {},
        "workspace": "capture_review",
    }


@transaction.atomic
def process_capture(capture, *, actor, expected_version, mode="deterministic", is_retry=False):
    started_at = time.monotonic()
    if mode not in {"deterministic", "provider", "manual"}:
        raise CaptureProcessingError("Processing mode is invalid.")
    if capture.capture_type not in SUPPORTED_TYPES:
        raise CaptureProcessingError("This Capture type cannot be processed.")
    if capture.status not in {Capture.STATUS_SAVED, Capture.STATUS_FAILED}:
        raise CaptureProcessingError("This Capture is not ready to process.")
    processing = transition_capture(
        capture,
        to_status=Capture.STATUS_PROCESSING,
        actor=actor,
        expected_version=expected_version,
        reason="Capture processing started",
        metadata={"workspace": "capture_review", "mode": mode},
    )
    if is_retry:
        processing.retry_count += 1
        processing.save(update_fields=["retry_count", "updated_at"])
    raw = processing.raw_text_payload or {}
    provider_draft = None
    if mode == "provider":
        provider = getattr(settings, "CAPTURE_REVIEW_PROVIDER", None)
        try:
            if not callable(provider):
                raise RuntimeError("Provider is unavailable.")
            provider_draft = provider(
                workspace="capture_review",
                capture_id=str(processing.id),
                capture_version=processing.version,
                capture_type=processing.capture_type,
                raw_payload=deepcopy(raw),
                project_context=(
                    {
                        "id": processing.project_id,
                        "title": processing.project.title,
                        "milestone_id": processing.milestone_id,
                        "milestone_title": (
                            processing.milestone.title if processing.milestone_id else ""
                        ),
                    }
                    if processing.project_id else None
                ),
            )
            provider_draft = validate_structured_draft(processing.capture_type, provider_draft)
        except Exception:
            processing.status = Capture.STATUS_FAILED
            processing.failure_details = {
                "code": "provider_unavailable",
                "message": "Project Assistant preparation is temporarily unavailable.",
                "retryable": True,
                "capture_saved": True,
            }
            processing.version += 1
            processing.save(update_fields=["status", "failure_details", "version", "updated_at"])
            CaptureEvent.objects.create(
                capture=processing, event_type="processing_failed",
                from_status=Capture.STATUS_PROCESSING, to_status=Capture.STATUS_FAILED,
                actor=actor, reason="Provider unavailable",
                metadata={
                    "capture_saved": True,
                    "manual_review_available": True,
                    "processing_duration_ms": round((time.monotonic() - started_at) * 1000),
                    "retry_count": processing.retry_count,
                },
            )
            logger.warning(
                "capture_processing_failed capture_id=%s retry_count=%s duration_ms=%s",
                processing.id,
                processing.retry_count,
                round((time.monotonic() - started_at) * 1000),
            )
            return processing
    draft = provider_draft or (
        build_quick_lead_draft(raw)
        if processing.capture_type == Capture.TYPE_QUICK_LEAD
        else build_quick_note_draft(raw)
        if processing.capture_type == Capture.TYPE_QUICK_NOTE
        else build_project_capture_draft(processing)
    )
    candidates = find_duplicate_candidates(processing)
    required_duplicate = any(
        row["match_strength"] in {"exact", "strong"} for row in candidates
    )
    if draft["missing_fields"]:
        target = Capture.STATUS_NEEDS_INFORMATION
    elif required_duplicate:
        target = Capture.STATUS_POSSIBLE_DUPLICATE
    else:
        target = Capture.STATUS_READY_FOR_REVIEW
    processing.structured_draft = validate_structured_draft(processing.capture_type, draft)
    processing.duplicate_candidates = candidates
    processing.processing_engine = (
        "manual" if mode == "manual"
        else "project_assistant" if mode == "provider"
        else "deterministic.v1"
    )
    processing.failure_details = {}
    processing.status = target
    processing.version += 1
    processing.save(update_fields=[
        "structured_draft", "duplicate_candidates", "processing_engine",
        "failure_details", "status", "version", "updated_at",
    ])
    CaptureEvent.objects.create(
        capture=processing, event_type="draft_prepared",
        from_status=Capture.STATUS_PROCESSING, to_status=target, actor=actor,
        metadata={
            "schema_version": draft["schema_version"],
            "mode": mode,
            "processing_duration_ms": round((time.monotonic() - started_at) * 1000),
            "retry_count": processing.retry_count,
        },
    )
    logger.info(
        "capture_processing_completed capture_id=%s status=%s retry_count=%s duration_ms=%s",
        processing.id,
        target,
        processing.retry_count,
        round((time.monotonic() - started_at) * 1000),
    )
    return processing


@transaction.atomic
def update_review(capture, *, actor, expected_version, draft, duplicate_decision=None):
    locked = Capture.objects.select_for_update().get(pk=capture.pk)
    check_expected_version(locked, expected_version)
    if locked.capture_type not in SUPPORTED_TYPES:
        raise CaptureProcessingError("This Capture type does not support review.")
    if locked.status not in {
        Capture.STATUS_READY_FOR_REVIEW, Capture.STATUS_NEEDS_INFORMATION,
        Capture.STATUS_POSSIBLE_DUPLICATE, Capture.STATUS_FAILED,
    }:
        raise CaptureProcessingError("This Capture is not editable.")
    validated = validate_structured_draft(locked.capture_type, draft)
    decisions = deepcopy(locked.review_decisions or {})
    if duplicate_decision is not None:
        if not isinstance(duplicate_decision, dict) or set(duplicate_decision) - {
            "decision", "candidate_id"
        }:
            raise CaptureSchemaError("Duplicate decision fields are invalid.")
        decision = duplicate_decision.get("decision")
        if decision not in DUPLICATE_DECISIONS:
            raise CaptureSchemaError("Duplicate decision is invalid.")
        candidate_id = duplicate_decision.get("candidate_id")
        if decision == "link_existing" and not any(
            str(row.get("candidate_id")) == str(candidate_id)
            for row in locked.duplicate_candidates or []
        ):
            raise CaptureSchemaError("Select a valid duplicate candidate.")
        decisions["duplicate"] = {
            "decision": decision,
            "candidate_id": candidate_id if decision == "link_existing" else None,
        }
    old_status = locked.status
    required_duplicate = any(
        row.get("match_strength") in {"exact", "strong"}
        for row in locked.duplicate_candidates or []
    ) and not decisions.get("duplicate")
    locked.status = (
        Capture.STATUS_NEEDS_INFORMATION if validated["missing_fields"]
        else Capture.STATUS_POSSIBLE_DUPLICATE if required_duplicate
        else Capture.STATUS_READY_FOR_REVIEW
    )
    locked.structured_draft = validated
    locked.review_decisions = decisions
    locked.version += 1
    locked.save(update_fields=[
        "structured_draft", "review_decisions", "status", "version", "updated_at"
    ])
    CaptureEvent.objects.create(
        capture=locked, event_type="review_updated", from_status=old_status,
        to_status=locked.status, actor=actor,
        metadata={"schema_version": validated["schema_version"], "duplicate_decision_recorded": bool(duplicate_decision)},
    )
    return locked


@transaction.atomic
def approve_review(capture, *, actor, expected_version):
    locked = Capture.objects.select_for_update().get(pk=capture.pk)
    check_expected_version(locked, expected_version)
    if locked.status not in {
        Capture.STATUS_READY_FOR_REVIEW,
        Capture.STATUS_NEEDS_INFORMATION,
        Capture.STATUS_POSSIBLE_DUPLICATE,
    }:
        raise CaptureProcessingError("This Capture is not ready for approval.")
    review = review_envelope(locked)
    if not review["can_approve"]:
        raise CaptureSchemaError("Resolve required information and duplicate decisions before approval.")
    snapshot = {
        "schema_version": locked.structured_draft["schema_version"],
        "structured_draft": deepcopy(locked.structured_draft),
        "review_decisions": deepcopy(locked.review_decisions or {}),
        "capture_version": locked.version,
        "approved_by_id": actor.id,
        "approved_at": timezone.now().isoformat(),
    }
    old_status = locked.status
    locked.status = Capture.STATUS_APPROVED
    locked.approved_snapshot = snapshot
    locked.approved_by = actor
    locked.approved_at = timezone.now()
    locked.version += 1
    locked.save(update_fields=[
        "status", "approved_snapshot", "approved_by", "approved_at", "version", "updated_at"
    ])
    CaptureEvent.objects.create(
        capture=locked, event_type="draft_approved", from_status=old_status,
        to_status=Capture.STATUS_APPROVED, actor=actor,
        metadata={"schema_version": snapshot["schema_version"], "approved_capture_version": snapshot["capture_version"]},
    )
    return locked
