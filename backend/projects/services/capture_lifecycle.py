from __future__ import annotations

from dataclasses import dataclass

from django.db import transaction
from django.utils import timezone

from projects.models import Capture, CaptureEvent


class CaptureLifecycleError(ValueError):
    code = "invalid_capture_transition"


class CaptureVersionConflict(CaptureLifecycleError):
    code = "capture_version_conflict"


ALLOWED_TRANSITIONS = {
    Capture.STATUS_DRAFT: {Capture.STATUS_SAVED, Capture.STATUS_ARCHIVED},
    Capture.STATUS_SAVED: {
        Capture.STATUS_PROCESSING,
        Capture.STATUS_READY_FOR_REVIEW,
        Capture.STATUS_ARCHIVED,
    },
    Capture.STATUS_PROCESSING: {
        Capture.STATUS_READY_FOR_REVIEW,
        Capture.STATUS_NEEDS_INFORMATION,
        Capture.STATUS_POSSIBLE_DUPLICATE,
        Capture.STATUS_FAILED,
    },
    Capture.STATUS_READY_FOR_REVIEW: {
        Capture.STATUS_SAVED,
        Capture.STATUS_APPROVED,
        Capture.STATUS_ARCHIVED,
    },
    Capture.STATUS_NEEDS_INFORMATION: {
        Capture.STATUS_SAVED,
        Capture.STATUS_PROCESSING,
        Capture.STATUS_ARCHIVED,
    },
    Capture.STATUS_POSSIBLE_DUPLICATE: {
        Capture.STATUS_READY_FOR_REVIEW,
        Capture.STATUS_ARCHIVED,
    },
    Capture.STATUS_APPROVED: {Capture.STATUS_APPLYING},
    Capture.STATUS_APPLYING: {Capture.STATUS_APPLIED, Capture.STATUS_APPLY_FAILED},
    Capture.STATUS_FAILED: {
        Capture.STATUS_PROCESSING,
        Capture.STATUS_READY_FOR_REVIEW,
        Capture.STATUS_ARCHIVED,
    },
    Capture.STATUS_APPLY_FAILED: {
        Capture.STATUS_APPLYING,
        Capture.STATUS_READY_FOR_REVIEW,
        Capture.STATUS_ARCHIVED,
    },
    Capture.STATUS_APPLIED: {Capture.STATUS_ARCHIVED},
    Capture.STATUS_ARCHIVED: set(),
}


def check_expected_version(capture: Capture, expected_version: int) -> None:
    if expected_version is None or int(expected_version) != capture.version:
        raise CaptureVersionConflict(
            f"Capture version changed. Expected {expected_version}; current version is {capture.version}."
        )


def validate_transition(capture: Capture, to_status: str) -> None:
    if to_status not in dict(Capture.STATUS_CHOICES):
        raise CaptureLifecycleError("Unknown Capture status.")
    if to_status not in ALLOWED_TRANSITIONS.get(capture.status, set()):
        raise CaptureLifecycleError(f"Capture cannot transition from {capture.status} to {to_status}.")


@transaction.atomic
def transition_capture(
    capture: Capture,
    *,
    to_status: str,
    actor,
    expected_version: int,
    reason: str = "",
    metadata: dict | None = None,
) -> Capture:
    locked = Capture.objects.select_for_update().get(pk=capture.pk)
    check_expected_version(locked, expected_version)
    validate_transition(locked, to_status)
    from_status = locked.status
    locked.status = to_status
    locked.version += 1
    update_fields = ["status", "version", "updated_at"]
    if to_status == Capture.STATUS_ARCHIVED:
        locked.archived_at = timezone.now()
        update_fields.append("archived_at")
    locked.save(update_fields=update_fields)
    CaptureEvent.objects.create(
        capture=locked,
        event_type="status_changed",
        from_status=from_status,
        to_status=to_status,
        actor=actor,
        reason=str(reason or "")[:255],
        metadata=metadata or {},
    )
    return locked


def retry_capture(capture: Capture, *, actor, expected_version: int) -> Capture:
    if capture.status not in {
        Capture.STATUS_FAILED,
        Capture.STATUS_NEEDS_INFORMATION,
        Capture.STATUS_APPLY_FAILED,
    }:
        raise CaptureLifecycleError("Only a failed or incomplete Capture can be retried.")
    target_status = (
        Capture.STATUS_APPLYING
        if capture.status == Capture.STATUS_APPLY_FAILED
        else Capture.STATUS_PROCESSING
    )
    retried = transition_capture(
        capture,
        to_status=target_status,
        actor=actor,
        expected_version=expected_version,
        reason="Retry requested",
    )
    Capture.objects.filter(pk=retried.pk).update(retry_count=retried.retry_count + 1)
    retried.refresh_from_db()
    return retried


def archive_capture(capture: Capture, *, actor, expected_version: int, reason: str = "") -> Capture:
    return transition_capture(
        capture,
        to_status=Capture.STATUS_ARCHIVED,
        actor=actor,
        expected_version=expected_version,
        reason=reason or "Archived",
    )
