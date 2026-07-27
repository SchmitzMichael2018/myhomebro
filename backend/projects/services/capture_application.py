from __future__ import annotations

import hashlib
import logging
import time
from copy import deepcopy

from django.db import transaction
from django.utils import timezone

from projects.models import Capture, CaptureApplication, CaptureEvent, ProjectCaptureIssue
from projects.services.capture_adapters import ADAPTERS
from projects.services.capture_adapters.base import AdapterContext, CaptureAdapterError
from projects.services.capture_lifecycle import CaptureVersionConflict, check_expected_version
from projects.services.capture_permissions import can_apply_capture


logger = logging.getLogger(__name__)


class CaptureApplicationError(ValueError):
    code = "capture_application_error"


class CaptureIdempotencyConflict(CaptureApplicationError):
    code = "capture_idempotency_conflict"


def _field_findings_snapshot(capture):
    snapshot = capture.approved_snapshot or {}
    draft = snapshot.get("structured_draft") or {}
    return snapshot, draft if draft.get("schema_version") == "field-findings.v1" else None


def _selected_findings(capture, payload):
    snapshot, draft = _field_findings_snapshot(capture)
    if not draft:
        return None, None
    keys = payload.get("selected_child_keys")
    if not isinstance(keys, list) or not keys or len(keys) != len(set(keys)):
        raise CaptureApplicationError("Select one or more unique field findings.")
    rows = {row.get("child_key"): row for row in draft.get("findings") or []}
    if any(key not in rows for key in keys):
        raise CaptureApplicationError("A selected field finding is unavailable.")
    selected = [rows[key] for key in keys]
    for row in selected:
        if row.get("review_status") != "approved":
            raise CaptureApplicationError("Only approved field findings can be applied.")
        if row.get("missing_fields"):
            raise CaptureApplicationError("Resolve required field finding information.")
        duplicates = row.get("duplicate_candidates") or []
        if duplicates and not row.get("duplicate_decision"):
            raise CaptureApplicationError("Resolve the field finding duplicate suggestion.")
    return snapshot, selected


def preview_field_findings(capture, *, actor, expected_version, payload):
    if _field_findings_snapshot(capture)[1] is None:
        return None
    if not can_apply_capture(actor, capture):
        raise CaptureApplicationError("You do not have permission to apply this Capture.")
    check_expected_version(capture, expected_version)
    snapshot, rows = _selected_findings(capture, payload)
    if rows is None:
        return None
    records = []
    for row in rows:
        decision = row.get("duplicate_decision") or {}
        records.append({
            "child_key": row["child_key"],
            "action": "link" if decision.get("decision") == "link_existing" else "create",
            "record_type": "project_issue",
            "label": row["title"],
            "fields": {
                "project": capture.project.title,
                "milestone": getattr(capture.milestone, "title", ""),
                "classification": row["classification"],
                "location": row.get("location") or row.get("room_or_area"),
                "description": row["description"],
            },
            "warnings": row.get("warnings") or [],
        })
    return {
        "capture_id": str(capture.id),
        "capture_version": capture.version,
        "approved_schema_version": snapshot.get("schema_version"),
        "records": records,
        "warnings": list(dict.fromkeys(
            warning for row in rows for warning in (row.get("warnings") or [])
        )),
        "permission": {"allowed": True},
        "valid": True,
        "adapter_versions": {"project_issue": ADAPTERS["project_issue"].version},
        "selected_child_keys": [row["child_key"] for row in rows],
    }


def apply_field_findings(capture, *, actor, expected_version, idempotency_key, payload):
    if _field_findings_snapshot(capture)[1] is None:
        return None
    if payload.get("confirmed") is not True:
        raise CaptureApplicationError("Confirm that the approved Issues should be created or linked.")
    key = str(idempotency_key or "").strip()
    if not key or len(key) > 120:
        raise CaptureApplicationError("A valid idempotency key is required.")
    locked = Capture.objects.select_for_update().get(pk=capture.pk)
    check_expected_version(locked, expected_version)
    snapshot, rows = _selected_findings(locked, payload)
    if rows is None:
        return None
    request_snapshot = {
        "approved_capture_version": snapshot.get("capture_version"),
        "approved_schema_version": snapshot.get("schema_version"),
        "selected_child_keys": [row["child_key"] for row in rows],
    }
    existing = CaptureApplication.objects.filter(capture=locked, idempotency_key=key).first()
    if existing:
        if existing.request_snapshot != request_snapshot:
            raise CaptureIdempotencyConflict(
                "This idempotency key was already used for a different field-finding selection."
            )
        return locked, existing, True
    application = CaptureApplication.objects.create(
        capture=locked, adapter="project_issue_children", adapter_version="1",
        idempotency_key=key, actor=actor, capture_version=snapshot.get("capture_version") or locked.version,
        request_snapshot=request_snapshot,
    )
    created, linked, failures = [], [], []
    for row in rows:
        decision = row.get("duplicate_decision") or {}
        try:
            with transaction.atomic():
                if decision.get("decision") == "link_existing":
                    issue = ProjectCaptureIssue.objects.filter(
                        pk=decision.get("candidate_id"),
                        project=locked.project,
                        project__contractor=locked.contractor,
                    ).first()
                    if not issue:
                        raise CaptureApplicationError("The approved duplicate Issue is unavailable.")
                    linked.append({
                        "type": "project_issue", "id": str(issue.id), "label": issue.title,
                        "child_key": row["child_key"], "url": f"/app/projects/{locked.project_id}",
                    })
                    result = "linked"
                else:
                    issue, was_created = ProjectCaptureIssue.objects.get_or_create(
                        origin_capture=locked,
                        child_key=row["child_key"],
                        defaults={
                            "project": locked.project, "milestone": locked.milestone,
                            "classification": row["classification"], "title": row["title"][:255],
                            "description": row["description"], "created_by": actor,
                        },
                    )
                    if not was_created:
                        result = "replayed"
                    else:
                        result = "created"
                    created.append({
                        "type": "project_issue", "id": str(issue.id), "label": issue.title,
                        "child_key": row["child_key"], "url": f"/app/projects/{locked.project_id}",
                    })
                CaptureEvent.objects.create(
                    capture=locked, event_type=f"field_finding_{result}", actor=actor,
                    metadata={
                        "child_key": row["child_key"], "destination": "project_issue",
                        "adapter_version": "1",
                    },
                )
        except Exception as exc:
            failures.append({
                "child_key": row["child_key"],
                "code": getattr(exc, "code", "field_finding_apply_failed"),
            })
            CaptureEvent.objects.create(
                capture=locked, event_type="field_finding_failed", actor=actor,
                reason="Field finding application failed safely",
                metadata={"child_key": row["child_key"]},
            )
    applied_at = timezone.now()
    receipt = {
        "application_id": str(application.id), "capture_id": str(locked.id),
        "approved_capture_version": application.capture_version,
        "approved_schema_version": snapshot.get("schema_version"),
        "adapters": ["project_issue"], "adapter_versions": {"project_issue": "1"},
        "selected_child_keys": request_snapshot["selected_child_keys"],
        "applied_by": {"id": actor.id, "email": getattr(actor, "email", "")},
        "applied_at": applied_at.isoformat(), "created_records": created,
        "linked_records": linked, "failed_children": failures,
        "warnings": [], "final_status": "partial" if failures else "applied",
    }
    application.status = (
        CaptureApplication.STATUS_FAILED if failures and not (created or linked)
        else CaptureApplication.STATUS_COMPLETED
    )
    application.created_records = created
    application.executed_at = applied_at
    application.receipt_payload = receipt
    application.failure_code = "field_finding_partial_failure" if failures else ""
    application.save(update_fields=[
        "status", "created_records", "executed_at", "receipt_payload", "failure_code",
    ])
    approved_keys = {
        row.get("child_key") for row in (snapshot.get("structured_draft") or {}).get("findings", [])
        if row.get("review_status") == "approved"
    }
    applied_keys = {
        record.get("child_key")
        for app in locked.applications.filter(status=CaptureApplication.STATUS_COMPLETED)
        for record in ((app.receipt_payload or {}).get("created_records", []) + (app.receipt_payload or {}).get("linked_records", []))
    }
    locked.status = Capture.STATUS_APPLIED if approved_keys.issubset(applied_keys) else Capture.STATUS_APPROVED
    locked.version += 1
    locked.save(update_fields=["status", "version", "updated_at"])
    CaptureEvent.objects.create(
        capture=locked, event_type="field_findings_application_completed", actor=actor,
        metadata={
            "application_id": str(application.id), "created_count": len(created),
            "linked_count": len(linked), "failed_count": len(failures),
        },
    )
    return locked, application, False


ALLOWED_OPTIONS = {
    "duplicate_resolution", "include_follow_up", "customer_id", "equipment_id",
}
SUPPORTED_DESTINATIONS = {
    Capture.TYPE_QUICK_LEAD: {"customer", "opportunity", "follow_up"},
    Capture.TYPE_QUICK_NOTE: {"unassigned_note", "customer_note", "follow_up"},
    Capture.TYPE_PROJECT_UPDATE: {
        "project_note", "project_activity", "project_attachment", "follow_up",
    },
    Capture.TYPE_PROGRESS_PHOTO: {"project_attachment", "project_activity"},
    Capture.TYPE_ISSUE: {"project_issue", "project_activity", "follow_up"},
    Capture.TYPE_COMMUNICATION: {"communication_log", "project_activity", "follow_up"},
    Capture.TYPE_DOCUMENT: {"project_attachment", "project_activity"},
    Capture.TYPE_EQUIPMENT: {"equipment_record", "equipment_attachment"},
    Capture.TYPE_WARRANTY_DOCUMENT: {"warranty_record", "warranty_document"},
    Capture.TYPE_WARRANTY_CONCERN: {
        "warranty_request", "warranty_evidence", "project_activity", "follow_up",
    },
    Capture.TYPE_MEASUREMENT: {
        "measurement_session", "measurement_entries", "measurement_adjustments",
        "measurement_calculations", "measurement_attachment", "project_activity",
    },
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
    elif capture.capture_type == Capture.TYPE_QUICK_NOTE:
        note_destinations = selected & {"unassigned_note", "customer_note"}
        if len(note_destinations) != 1:
            raise CaptureApplicationError("Choose either unassigned note or customer note.")
        if "follow_up" in selected and "customer_note" not in selected:
            raise CaptureApplicationError("A follow-up requires a Customer note destination.")
    else:
        approved_destinations = set(
            (snapshot.get("structured_draft") or {}).get("proposed_destinations") or []
        )
        required = approved_destinations - {"follow_up"}
        if not required.issubset(selected):
            raise CaptureApplicationError(
                "All approved Project Capture records must be included."
            )
        if "follow_up" in selected and not capture.project_id:
            raise CaptureApplicationError("A project is required for the follow-up.")
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
            "action", "customer_id", "equipment_id"
        }:
            raise CaptureApplicationError("Duplicate resolution fields are invalid.")
        mapping = {
            "link": "link_existing",
            "create_separate": "create_separate",
            "not_same_person": "not_same_person",
            "not_same_item": "not_same_item",
        }
        if not approved_decision or mapping.get(requested_resolution.get("action")) != approved_decision.get("decision"):
            raise CaptureApplicationError("Duplicate resolution does not match the approved review.")
        if approved_decision.get("decision") == "link_existing":
            selected_id = (
                requested_resolution.get("equipment_id")
                if capture.capture_type == Capture.TYPE_EQUIPMENT
                else requested_resolution.get("customer_id")
            )
            if str(selected_id) != str(approved_decision.get("candidate_id")):
                raise CaptureApplicationError("Selected record does not match the approved duplicate decision.")
    required_duplicate = any(
        row.get("match_strength") in {"exact", "strong"}
        for row in capture.duplicate_candidates or []
    )
    if required_duplicate and not approved_decision:
        raise CaptureApplicationError("Resolve the required customer duplicate before applying.")
    order = {
        "customer": 0,
        "customer_note": 0,
        "unassigned_note": 0,
        "project_note": 0,
        "project_issue": 0,
        "equipment_record": 0,
        "warranty_record": 0,
        "warranty_request": 0,
        "measurement_session": 0,
        "communication_log": 0,
        "project_attachment": 1,
        "equipment_attachment": 1,
        "warranty_document": 1,
        "warranty_evidence": 1,
        "measurement_entries": 1,
        "measurement_adjustments": 2,
        "measurement_calculations": 3,
        "measurement_attachment": 4,
        "opportunity": 1,
        "project_activity": 2,
        "follow_up": 3,
    }
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
    field_preview = preview_field_findings(
        capture, actor=actor, expected_version=expected_version, payload=payload
    )
    if field_preview is not None:
        return field_preview
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
    field_result = apply_field_findings(
        capture, actor=actor, expected_version=expected_version,
        idempotency_key=idempotency_key, payload=payload,
    )
    if field_result is not None:
        return field_result
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
