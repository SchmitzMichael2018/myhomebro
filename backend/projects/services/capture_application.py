from __future__ import annotations

import hashlib
import logging
import time
from copy import deepcopy

from django.db import transaction
from django.utils import timezone

from projects.models import Capture, CaptureApplication, CaptureEvent
from projects.services.capture_adapters import ADAPTERS
from projects.services.capture_adapters.base import AdapterContext, CaptureAdapterError
from projects.services.capture_lifecycle import CaptureVersionConflict, check_expected_version
from projects.services.capture_permissions import can_apply_capture


logger = logging.getLogger(__name__)


class CaptureApplicationError(ValueError):
    code = "capture_application_error"


class CaptureIdempotencyConflict(CaptureApplicationError):
    code = "capture_idempotency_conflict"


ALLOWED_OPTIONS = {"duplicate_resolution", "include_follow_up", "customer_id"}
SUPPORTED_DESTINATIONS = {
    Capture.TYPE_QUICK_LEAD: {"customer", "opportunity", "follow_up"},
    Capture.TYPE_QUICK_NOTE: {"unassigned_note", "customer_note", "follow_up"},
}


def _validate_request(capture, payload, *, require_confirmation=False):
    if capture.status not in {
        Capture.STATUS_APPROVED,
        Capture.STATUS_APPLY_FAILED,
        Capture.STATUS_APPLIED,
    }:
        raise CaptureApplicationError("Only an approved Capture can be applied.")
    snapshot = capture.approved_snapshot or {}
    if not snapshot or not snapshot.get("structured_draft"):
        raise CaptureApplicationError("The approved Capture snapshot is missing.")
    if capture.capture_type not in SUPPORTED_DESTINATIONS:
        raise CaptureApplicationError("This Capture type cannot be applied.")
    if require_confirmation and payload.get("confirmed") is not True:
        raise CaptureApplicationError("Confirm that the approved records should be created or linked.")
    destinations = payload.get("destinations")
    if not isinstance(destinations, list) or not destinations:
        raise CaptureApplicationError("Select at least one supported destination.")
    if len(destinations) != len(set(destinations)):
        raise CaptureApplicationError("Destinations must not be repeated.")
    unknown = set(destinations) - SUPPORTED_DESTINATIONS[capture.capture_type]
    if unknown:
        raise CaptureApplicationError(f"Unsupported destination: {', '.join(sorted(unknown))}.")
    selected = set(destinations)
    if capture.capture_type == Capture.TYPE_QUICK_LEAD:
        if not {"customer", "opportunity"}.issubset(selected):
            raise CaptureApplicationError("Quick Lead application requires Customer and Opportunity.")
    else:
        note_destinations = selected & {"unassigned_note", "customer_note"}
        if len(note_destinations) != 1:
            raise CaptureApplicationError("Choose either unassigned note or customer note.")
        if "follow_up" in selected and "customer_note" not in selected:
            raise CaptureApplicationError("A follow-up requires a Customer note destination.")
    options = payload.get("application_options") or {}
    if not isinstance(options, dict) or set(options) - ALLOWED_OPTIONS:
        raise CaptureApplicationError("Application options contain unsupported fields.")
    include_follow_up = bool(options.get("include_follow_up"))
    if ("follow_up" in selected) != include_follow_up:
        raise CaptureApplicationError("Follow-up destination and selection must agree.")
    versions = payload.get("adapter_versions")
    if not isinstance(versions, dict) or set(versions) != selected:
        raise CaptureApplicationError("Provide an adapter version for every selected destination.")
    for destination in destinations:
        if versions.get(destination) != ADAPTERS[destination].version:
            raise CaptureApplicationError(f"Unsupported {destination} adapter version.")
    approved_decision = (snapshot.get("review_decisions") or {}).get("duplicate")
    requested_resolution = options.get("duplicate_resolution")
    if requested_resolution is not None:
        if not isinstance(requested_resolution, dict) or set(requested_resolution) - {
            "action", "customer_id"
        }:
            raise CaptureApplicationError("Duplicate resolution fields are invalid.")
        mapping = {
            "link": "link_existing",
            "create_separate": "create_separate",
            "not_same_person": "not_same_person",
        }
        if not approved_decision or mapping.get(requested_resolution.get("action")) != approved_decision.get("decision"):
            raise CaptureApplicationError("Duplicate resolution does not match the approved review.")
        if approved_decision.get("decision") == "link_existing" and str(
            requested_resolution.get("customer_id")
        ) != str(approved_decision.get("candidate_id")):
            raise CaptureApplicationError("Selected customer does not match the approved duplicate decision.")
    required_duplicate = any(
        row.get("match_strength") in {"exact", "strong"}
        for row in capture.duplicate_candidates or []
    )
    if required_duplicate and not approved_decision:
        raise CaptureApplicationError("Resolve the required customer duplicate before applying.")
    order = {"customer": 0, "customer_note": 0, "unassigned_note": 0, "opportunity": 1, "follow_up": 2}
    destinations = sorted(destinations, key=lambda value: order[value])
    return destinations, versions, options, snapshot


def _request_snapshot(capture, destinations, versions, options):
    return {
        "approved_capture_version": (capture.approved_snapshot or {}).get("capture_version"),
        "approved_schema_version": (capture.approved_snapshot or {}).get("schema_version"),
        "destinations": destinations,
        "adapter_versions": versions,
        "application_options": options,
    }


def _application_envelope(capture, application):
    receipt = application.receipt_payload or {}
    return {
        "capture_id": str(capture.id),
        "application": {
            "id": str(application.id),
            "status": "applied" if application.status == CaptureApplication.STATUS_COMPLETED else application.status,
            "adapter_versions": receipt.get("adapter_versions", {}),
            "created_records": receipt.get("created_records", application.created_records or []),
            "linked_records": receipt.get("linked_records", []),
            "warnings": receipt.get("warnings", []),
            "applied_at": receipt.get("applied_at"),
            "applied_by": receipt.get("applied_by", {}),
        },
        "receipt": receipt,
    }


def preview_application(capture, *, actor, expected_version, payload):
    if not can_apply_capture(actor, capture):
        raise CaptureApplicationError("You do not have permission to apply this Capture.")
    check_expected_version(capture, expected_version)
    destinations, versions, options, snapshot = _validate_request(capture, payload)
    context = AdapterContext(
        capture=capture,
        snapshot=deepcopy(snapshot),
        actor=actor,
        options=deepcopy(options),
    )
    records = []
    warnings = []
    for destination in destinations:
        adapter = ADAPTERS[destination]
        adapter.authorize(context)
        item = adapter.preview(context)
        records.append(item)
        warnings.extend(item.get("warnings", []))
    return {
        "capture_id": str(capture.id),
        "capture_version": capture.version,
        "approved_schema_version": snapshot.get("schema_version"),
        "records": records,
        "warnings": list(dict.fromkeys(warnings)),
        "permission": {"allowed": True},
        "valid": True,
        "adapter_versions": versions,
    }


@transaction.atomic
def apply_capture(capture, *, actor, expected_version, idempotency_key, payload):
    started_at = time.monotonic()
    locked = Capture.objects.select_for_update().get(pk=capture.pk)
    if not can_apply_capture(actor, locked):
        raise CaptureApplicationError("You do not have permission to apply this Capture.")
    key = str(idempotency_key or "").strip()
    if not key or len(key) > 120:
        raise CaptureApplicationError("A valid idempotency key is required.")
    destinations, versions, options, snapshot = _validate_request(
        locked, payload, require_confirmation=True
    )
    request_snapshot = _request_snapshot(locked, destinations, versions, options)
    existing = CaptureApplication.objects.filter(capture=locked, idempotency_key=key).first()
    if existing:
        if existing.request_snapshot != request_snapshot:
            raise CaptureIdempotencyConflict(
                "This idempotency key was already used for a different application request."
            )
        return locked, existing, True
    completed = CaptureApplication.objects.filter(
        capture=locked,
        status=CaptureApplication.STATUS_COMPLETED,
    ).exclude(receipt_payload={}).first()
    if completed:
        return locked, completed, True
    if locked.status == Capture.STATUS_APPLIED:
        raise CaptureApplicationError("This Capture was already applied.")
    check_expected_version(locked, expected_version)
    preflight = AdapterContext(
        capture=locked,
        snapshot=deepcopy(snapshot),
        actor=actor,
        options=deepcopy(options),
    )
    for destination in destinations:
        adapter = ADAPTERS[destination]
        adapter.authorize(preflight)
        adapter.preview(preflight)
    application = CaptureApplication.objects.create(
        capture=locked,
        adapter="capture_bundle",
        adapter_version="1",
        idempotency_key=key,
        status=CaptureApplication.STATUS_PENDING,
        actor=actor,
        capture_version=snapshot.get("capture_version") or locked.version,
        request_snapshot=request_snapshot,
    )
    from_status = locked.status
    locked.status = Capture.STATUS_APPLYING
    locked.version += 1
    locked.save(update_fields=["status", "version", "updated_at"])
    CaptureEvent.objects.create(
        capture=locked,
        event_type="application_started",
        from_status=from_status,
        to_status=Capture.STATUS_APPLYING,
        actor=actor,
        metadata={"application_id": str(application.id), "destinations": destinations},
    )
    context = AdapterContext(
        capture=locked,
        snapshot=deepcopy(snapshot),
        actor=actor,
        options=deepcopy(options),
    )
    try:
        with transaction.atomic():
            for destination in destinations:
                adapter = ADAPTERS[destination]
                adapter.authorize(context)
                adapter.apply(context, key)
    except Exception as exc:
        application.status = CaptureApplication.STATUS_FAILED
        application.failure_code = getattr(exc, "code", "adapter_failure")[:80]
        application.save(update_fields=["status", "failure_code"])
        locked.status = Capture.STATUS_APPLY_FAILED
        locked.version += 1
        locked.save(update_fields=["status", "version", "updated_at"])
        CaptureEvent.objects.create(
            capture=locked,
            event_type="application_failed",
            from_status=Capture.STATUS_APPLYING,
            to_status=Capture.STATUS_APPLY_FAILED,
            actor=actor,
            reason="Capture application failed safely",
            metadata={
                "application_id": str(application.id),
                "failure_code": application.failure_code,
                "apply_duration_ms": round((time.monotonic() - started_at) * 1000),
                "application_count": locked.applications.count(),
                "failure_count": locked.applications.filter(
                    status=CaptureApplication.STATUS_FAILED
                ).count(),
            },
        )
        logger.warning(
            "capture_application_failed capture_id=%s application_id=%s failure_code=%s duration_ms=%s",
            locked.id,
            application.id,
            application.failure_code,
            round((time.monotonic() - started_at) * 1000),
        )
        return locked, application, False
    applied_at = timezone.now()
    safe_key_reference = hashlib.sha256(key.encode("utf-8")).hexdigest()[:16]
    receipt = {
        "application_id": str(application.id),
        "capture_id": str(locked.id),
        "approved_capture_version": application.capture_version,
        "approved_schema_version": snapshot.get("schema_version"),
        "adapters": destinations,
        "adapter_versions": versions,
        "selected_destinations": destinations,
        "applied_by": {"id": actor.id, "email": getattr(actor, "email", "")},
        "applied_at": applied_at.isoformat(),
        "created_records": context.created_records,
        "linked_records": context.linked_records,
        "duplicate_decision": (snapshot.get("review_decisions") or {}).get("duplicate"),
        "follow_up_included": bool(options.get("include_follow_up")),
        "warnings": list(dict.fromkeys(context.warnings)),
        "attribution": deepcopy(locked.attribution_metadata or {}),
        "source_category": locked.source_category,
        "source_detail": locked.source_detail,
        "idempotency_reference": safe_key_reference,
        "final_status": "applied",
    }
    application.status = CaptureApplication.STATUS_COMPLETED
    application.created_records = context.created_records
    application.executed_at = applied_at
    application.receipt_payload = receipt
    application.failure_code = ""
    application.save(update_fields=[
        "status", "created_records", "executed_at", "receipt_payload", "failure_code"
    ])
    locked.status = Capture.STATUS_APPLIED
    locked.version += 1
    locked.save(update_fields=["status", "version", "updated_at"])
    CaptureEvent.objects.create(
        capture=locked,
        event_type="application_completed",
        from_status=Capture.STATUS_APPLYING,
        to_status=Capture.STATUS_APPLIED,
        actor=actor,
        metadata={
            "application_id": str(application.id),
            "destinations": destinations,
            "apply_duration_ms": round((time.monotonic() - started_at) * 1000),
            "application_count": locked.applications.count(),
            "failure_count": locked.applications.filter(
                status=CaptureApplication.STATUS_FAILED
            ).count(),
        },
    )
    logger.info(
        "capture_application_completed capture_id=%s application_id=%s duration_ms=%s",
        locked.id,
        application.id,
        round((time.monotonic() - started_at) * 1000),
    )
    return locked, application, False


def application_response(capture, application):
    return _application_envelope(capture, application)
