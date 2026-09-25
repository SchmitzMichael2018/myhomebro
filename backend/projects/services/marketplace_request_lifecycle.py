from __future__ import annotations

from dataclasses import dataclass
from datetime import timedelta

from django.conf import settings
from django.db import transaction
from django.db.models import Q
from django.utils import timezone

from projects.models import ContractorInvite, Notification, PublicContractorLead
from projects.models_contractor_discovery import (
    ContractorDirectoryDiscovery,
    ContractorDiscoveryInvite,
    ContractorOpportunity,
)
from projects.models_project_intake import ProjectIntake
from projects.services.notification_center import create_notification
from projects.services.smart_notifications import create_smart_notification
from projects.models_customer_portal import SmartNotificationEvent


ARCHIVE_REASON_UNANSWERED = "unanswered_timeout"
ARCHIVE_REASON_ADMIN = "admin_archived"

LIFECYCLE_OPEN = "open"
LIFECYCLE_REMINDER_DUE = "reminder_due"
LIFECYCLE_RESPONDED = "responded"
LIFECYCLE_ARCHIVE_DUE = "archive_due"
LIFECYCLE_ARCHIVED = "archived"
LIFECYCLE_PURGE_DUE = "purge_due"
LIFECYCLE_RETENTION_PROTECTED = "retention_protected"


@dataclass
class LifecycleCounts:
    examined: int = 0
    first_reminders: int = 0
    final_reminders: int = 0
    archived: int = 0
    customer_notices: int = 0
    purged: int = 0
    retention_protected: int = 0
    skipped: int = 0
    failed: int = 0


def _days(name: str, default: int) -> int:
    return max(0, int(getattr(settings, name, default)))


def lifecycle_policy() -> dict[str, int]:
    return {
        "first_reminder_days": _days("MARKETPLACE_FIRST_REMINDER_DAYS", 2),
        "final_reminder_days": _days("MARKETPLACE_FINAL_REMINDER_DAYS", 5),
        "archive_days": _days("MARKETPLACE_AUTO_ARCHIVE_DAYS", 14),
        "retention_days": _days("MARKETPLACE_ARCHIVE_RETENTION_DAYS", 90),
    }


def request_started_at(intake: ProjectIntake):
    return intake.submitted_at or intake.post_submit_flow_selected_at or intake.created_at


def meaningful_contractor_response(intake: ProjectIntake) -> bool:
    if intake.status == "converted" or intake.agreement_id or intake.converted_at:
        return True
    if ContractorInvite.objects.filter(
        source_intake=intake,
        accepted_at__isnull=False,
        accepted_by_contractor__isnull=False,
    ).exists():
        return True
    if ContractorDiscoveryInvite.objects.filter(public_intake=intake).filter(
        Q(status__in=(
            ContractorDiscoveryInvite.STATUS_CLAIMED,
            ContractorDiscoveryInvite.STATUS_RESPONDED,
        ))
        | Q(agreement__isnull=False)
    ).exists():
        return True
    if ContractorOpportunity.objects.filter(intake_request=intake).filter(
        Q(status__in=(
            ContractorOpportunity.STATUS_ACCEPTED,
            ContractorOpportunity.STATUS_CONVERTED,
        ))
        | Q(accepted_at__isnull=False)
        | Q(project__isnull=False)
        | Q(property_work_order__isnull=False)
        | Q(converted_agreement__isnull=False)
    ).exists():
        return True
    return PublicContractorLead.objects.filter(
        ai_analysis__source_intake_id=intake.id,
        status__in=(
            PublicContractorLead.STATUS_ACCEPTED,
            PublicContractorLead.STATUS_CONTACTED,
            PublicContractorLead.STATUS_QUALIFIED,
        ),
    ).exists()


def meaningful_response_intake_ids(intake_ids) -> set[int]:
    intake_ids = list(intake_ids)
    if not intake_ids:
        return set()
    responded = set(
        ProjectIntake.objects.filter(id__in=intake_ids).filter(
            Q(status="converted") | Q(agreement__isnull=False) | Q(converted_at__isnull=False)
        ).values_list("id", flat=True)
    )
    responded.update(
        ContractorInvite.objects.filter(
            source_intake_id__in=intake_ids,
            accepted_at__isnull=False,
            accepted_by_contractor__isnull=False,
        ).values_list("source_intake_id", flat=True)
    )
    responded.update(
        ContractorDiscoveryInvite.objects.filter(public_intake_id__in=intake_ids).filter(
            Q(status__in=(
                ContractorDiscoveryInvite.STATUS_CLAIMED,
                ContractorDiscoveryInvite.STATUS_RESPONDED,
            ))
            | Q(agreement__isnull=False)
        ).values_list("public_intake_id", flat=True)
    )
    responded.update(
        ContractorOpportunity.objects.filter(intake_request_id__in=intake_ids).filter(
            Q(status__in=(
                ContractorOpportunity.STATUS_ACCEPTED,
                ContractorOpportunity.STATUS_CONVERTED,
            ))
            | Q(accepted_at__isnull=False)
            | Q(project__isnull=False)
            | Q(property_work_order__isnull=False)
            | Q(converted_agreement__isnull=False)
        ).values_list("intake_request_id", flat=True)
    )
    responded.update(
        int(value)
        for value in PublicContractorLead.objects.filter(
            ai_analysis__source_intake_id__in=intake_ids,
            status__in=(
                PublicContractorLead.STATUS_ACCEPTED,
                PublicContractorLead.STATUS_CONTACTED,
                PublicContractorLead.STATUS_QUALIFIED,
            ),
        ).values_list("ai_analysis__source_intake_id", flat=True)
        if value is not None
    )
    return responded


def retention_protection_reason(intake: ProjectIntake) -> str:
    if intake.marketplace_hold_reason:
        return intake.marketplace_hold_reason
    if intake.agreement_id or intake.status == "converted" or intake.converted_at:
        return "Converted agreement history"
    if meaningful_contractor_response(intake):
        return "Meaningful contractor response"
    if intake.source_customer_requests.exists():
        return "Customer request history"
    if intake.classification_events.exists():
        return "Administrative audit history"
    if ContractorOpportunity.objects.filter(intake_request=intake).filter(
        Q(project__isnull=False)
        | Q(property_work_order__isnull=False)
        | Q(converted_agreement__isnull=False)
    ).exists():
        return "Project or property-management history"
    return ""


def lifecycle_state(intake: ProjectIntake, *, now=None, has_meaningful_response=None) -> dict:
    now = now or timezone.now()
    policy = lifecycle_policy()
    started_at = request_started_at(intake)
    age = now - started_at
    last_activity = (
        intake.converted_at
        or intake.analyzed_at
        or intake.final_marketplace_reminder_sent_at
        or intake.first_marketplace_reminder_sent_at
        or started_at
    )
    purge_eligible_at = (
        intake.marketplace_archived_at + timedelta(days=policy["retention_days"])
        if intake.marketplace_archived_at
        else None
    )
    protection_reason = ""
    if intake.marketplace_archived_at:
        protection_reason = retention_protection_reason(intake)
        if protection_reason:
            code = LIFECYCLE_RETENTION_PROTECTED
        elif purge_eligible_at and now >= purge_eligible_at:
            code = LIFECYCLE_PURGE_DUE
        else:
            code = LIFECYCLE_ARCHIVED
    elif (
        meaningful_contractor_response(intake)
        if has_meaningful_response is None
        else has_meaningful_response
    ):
        code = LIFECYCLE_RESPONDED
    elif intake.status == "draft" or intake.traffic_classification in {"test", "spam_fraud", "archived"}:
        code = LIFECYCLE_OPEN
    elif age >= timedelta(days=policy["archive_days"]):
        code = LIFECYCLE_ARCHIVE_DUE
    elif (
        not intake.final_marketplace_reminder_sent_at
        and age >= timedelta(days=policy["final_reminder_days"])
    ) or (
        not intake.first_marketplace_reminder_sent_at
        and age >= timedelta(days=policy["first_reminder_days"])
    ):
        code = LIFECYCLE_REMINDER_DUE
    else:
        code = LIFECYCLE_OPEN
    return {
        "code": code,
        "request_age_days": max(0, age.days),
        "last_meaningful_activity_at": last_activity,
        "purge_eligible_at": purge_eligible_at,
        "protection_reason": protection_reason,
    }


def _reminder_contractors(intake: ProjectIntake):
    contractor_ids = set(
        ContractorDiscoveryInvite.objects.filter(public_intake=intake)
        .exclude(status__in=(
            ContractorDiscoveryInvite.STATUS_CLAIMED,
            ContractorDiscoveryInvite.STATUS_RESPONDED,
            ContractorDiscoveryInvite.STATUS_DECLINED,
            ContractorDiscoveryInvite.STATUS_EXPIRED,
            ContractorDiscoveryInvite.STATUS_OPTED_OUT,
        ))
        .filter(contractor__isnull=False)
        .values_list("contractor_id", flat=True)
    )
    contractor_ids.update(
        ContractorOpportunity.objects.filter(
            intake_request=intake,
            status=ContractorOpportunity.STATUS_PENDING,
            directory_entry__claimed_by_contractor__isnull=False,
        ).values_list("directory_entry__claimed_by_contractor_id", flat=True)
    )
    from projects.models import Contractor

    return Contractor.objects.filter(id__in=contractor_ids).select_related("user")


def _send_reminder(intake: ProjectIntake, *, final: bool) -> int:
    event = (
        Notification.EVENT_MARKETPLACE_FINAL_REMINDER
        if final
        else Notification.EVENT_MARKETPLACE_FIRST_REMINDER
    )
    stage = "final" if final else "first"
    created = 0
    for contractor in _reminder_contractors(intake):
        _notification, was_created = create_notification(
            contractor=contractor,
            user=contractor.user,
            category=event,
            title="Final reminder: marketplace request" if final else "Marketplace request reminder",
            body="Review the request and respond if you are available. No response is required if the work is not a fit.",
            link="/app/opportunities",
            dedupe_key=f"marketplace-request:{intake.id}:{stage}:contractor:{contractor.id}",
        )
        created += int(was_created)
    return created


def _archive_customer_notice(intake: ProjectIntake) -> bool:
    email = str(intake.customer_email or getattr(intake.homeowner, "email", "") or "").strip().lower()
    if not email:
        return False
    before = intake.source_customer_requests.first()
    notification = create_smart_notification(
        event_type=SmartNotificationEvent.MARKETPLACE_REQUEST_ARCHIVED,
        recipient_email=email,
        homeowner=intake.homeowner,
        customer_request=before,
        action_url="/portal",
        context={"dedupe_key": f"marketplace-request:{intake.id}:archived"},
        title_override="Your unanswered request was archived",
        message_override=(
            "No contractor response was received during the response window. "
            "The request is closed in your history, and you can submit a new request if work is still needed."
        ),
    )
    return notification is not None


def archive_request(intake: ProjectIntake, *, now=None, reason=ARCHIVE_REASON_ADMIN) -> bool:
    now = now or timezone.now()
    updated = ProjectIntake.objects.filter(pk=intake.pk, marketplace_archived_at__isnull=True).update(
        marketplace_archived_at=now,
        marketplace_archive_reason=reason,
        marketplace_retention_protection_reason="",
        updated_at=now,
    )
    return bool(updated)


def restore_request(intake: ProjectIntake, *, now=None) -> bool:
    now = now or timezone.now()
    updated = ProjectIntake.objects.filter(pk=intake.pk, marketplace_archived_at__isnull=False).update(
        marketplace_archived_at=None,
        marketplace_archive_reason="",
        marketplace_restored_at=now,
        marketplace_retention_protection_reason="",
        updated_at=now,
    )
    return bool(updated)


def _purge_request(intake: ProjectIntake) -> None:
    ContractorInvite.objects.filter(source_intake=intake).delete()
    ContractorDiscoveryInvite.objects.filter(public_intake=intake).delete()
    ContractorDirectoryDiscovery.objects.filter(intake_request=intake).delete()
    ContractorOpportunity.objects.filter(
        intake_request=intake,
        status__in=(
            ContractorOpportunity.STATUS_PENDING,
            ContractorOpportunity.STATUS_DECLINED,
            ContractorOpportunity.STATUS_EXPIRED,
        ),
        project__isnull=True,
        property_work_order__isnull=True,
        converted_agreement__isnull=True,
    ).delete()
    PublicContractorLead.objects.filter(
        ai_analysis__source_intake_id=intake.id,
        status__in=(
            PublicContractorLead.STATUS_NEW,
            PublicContractorLead.STATUS_REJECTED,
            PublicContractorLead.STATUS_ARCHIVED,
        ),
        converted_agreement__isnull=True,
    ).delete()
    intake.delete()


def process_marketplace_request_lifecycle(*, now=None, limit=500, dry_run=False) -> LifecycleCounts:
    now = now or timezone.now()
    counts = LifecycleCounts()
    ids = list(
        ProjectIntake.objects.filter(
            Q(post_submit_flow="multi_contractor")
            | Q(contractor_invites__isnull=False)
            | Q(discovery_invites__isnull=False)
            | Q(contractor_opportunities__isnull=False)
        )
        .distinct()
        .order_by("id")
        .values_list("id", flat=True)[: max(1, min(int(limit), 5000))]
    )
    for intake_id in ids:
        counts.examined += 1
        try:
            with transaction.atomic():
                intake = ProjectIntake.objects.select_related("homeowner", "agreement").get(pk=intake_id)
                state = lifecycle_state(intake, now=now)
                code = state["code"]
                if code == LIFECYCLE_RETENTION_PROTECTED:
                    counts.retention_protected += 1
                    if not dry_run and intake.marketplace_retention_protection_reason != state["protection_reason"]:
                        ProjectIntake.objects.filter(pk=intake.pk).update(
                            marketplace_retention_protection_reason=state["protection_reason"],
                            updated_at=now,
                        )
                elif code == LIFECYCLE_PURGE_DUE:
                    if dry_run:
                        counts.purged += 1
                    else:
                        fresh = ProjectIntake.objects.get(pk=intake.pk)
                        protection = retention_protection_reason(fresh)
                        if protection:
                            ProjectIntake.objects.filter(pk=fresh.pk).update(
                                marketplace_retention_protection_reason=protection,
                                updated_at=now,
                            )
                            counts.retention_protected += 1
                        else:
                            _purge_request(fresh)
                            counts.purged += 1
                elif code == LIFECYCLE_ARCHIVE_DUE:
                    if dry_run:
                        counts.archived += 1
                    elif archive_request(intake, now=now, reason=ARCHIVE_REASON_UNANSWERED):
                        counts.archived += 1
                        intake.refresh_from_db()
                        counts.customer_notices += int(_archive_customer_notice(intake))
                elif code == LIFECYCLE_REMINDER_DUE:
                    policy = lifecycle_policy()
                    age = now - request_started_at(intake)
                    final = age >= timedelta(days=policy["final_reminder_days"])
                    field = "final_marketplace_reminder_sent_at" if final else "first_marketplace_reminder_sent_at"
                    if dry_run:
                        if final:
                            counts.final_reminders += 1
                        else:
                            counts.first_reminders += 1
                    elif ProjectIntake.objects.filter(pk=intake.pk, **{f"{field}__isnull": True}).update(
                        **{field: now, "updated_at": now}
                    ):
                        _send_reminder(intake, final=final)
                        if final:
                            counts.final_reminders += 1
                        else:
                            counts.first_reminders += 1
                else:
                    counts.skipped += 1
        except ProjectIntake.DoesNotExist:
            counts.skipped += 1
        except Exception:
            counts.failed += 1
    return counts
