# backend/projects/management/commands/check_dispute_deadlines.py
from __future__ import annotations

from django.core.management.base import BaseCommand
from django.utils import timezone

from projects.models_dispute import Dispute, DisputePaymentHold, DisputeReminderLog, ResolutionCaseTimelineEvent
from projects.services.dispute_notifications import notify_homeowner_qualification
from projects.services.dispute_workflow import begin_hold_expiration, release_expired_hold
from projects.services.resolution_workspace import record_timeline_event


class Command(BaseCommand):
    help = "Process qualification holds and legacy response deadlines (never moves money)."

    def handle(self, *args, **options):
        now = timezone.now()
        updated = 0

        qualification_qs = Dispute.objects.filter(
            qualification_due_at__isnull=False,
            qualification_due_at__lte=now,
            payment_hold__status=DisputePaymentHold.STATUS_TEMPORARY,
        ).exclude(
            qualification_status__in=[Dispute.QUALIFICATION_QUALIFIED, Dispute.QUALIFICATION_URGENT_REVIEW]
        )
        for dispute in list(qualification_qs):
            if begin_hold_expiration(dispute, now=now):
                dispute.refresh_from_db()
                record_timeline_event(
                    dispute,
                    ResolutionCaseTimelineEvent.EVENT_HOLD_EXPIRATION_PENDING,
                    "Payment hold expiration pending",
                    description="The qualification deadline passed. A final grace period is active before the source-specific hold closes.",
                    related_object=dispute.payment_hold,
                )
                key = f"dispute:{dispute.id}:expiration_pending"
                _log, created = DisputeReminderLog.objects.get_or_create(
                    dedupe_key=key,
                    defaults={"dispute": dispute, "kind": "expiration_pending", "sent_to": "homeowner"},
                )
                if created:
                    notify_homeowner_qualification(dispute, "expiration_pending")
                updated += 1

        release_qs = Dispute.objects.filter(
            payment_hold__status=DisputePaymentHold.STATUS_EXPIRATION_PENDING,
            payment_hold__release_due_at__isnull=False,
            payment_hold__release_due_at__lte=now,
        )
        for dispute in list(release_qs):
            if release_expired_hold(dispute, now=now):
                dispute.refresh_from_db()
                record_timeline_event(
                    dispute,
                    ResolutionCaseTimelineEvent.EVENT_PAYMENT_HOLD_RELEASED,
                    "Temporary payment hold closed",
                    description=dispute.qualification_explanation,
                    related_object=dispute.payment_hold,
                    metadata={"money_moved": False, "warranty_rights_decided": False},
                )
                key = f"dispute:{dispute.id}:hold_expired"
                _log, created = DisputeReminderLog.objects.get_or_create(
                    dedupe_key=key,
                    defaults={"dispute": dispute, "kind": "hold_expired", "sent_to": "homeowner"},
                )
                if created:
                    notify_homeowner_qualification(dispute, "expired")
                updated += 1

        # Overdue response deadline
        qs1 = Dispute.objects.filter(
            fee_paid=True,
            status="open",
            response_due_at__isnull=False,
            response_due_at__lt=now,
        )

        for d in qs1.iterator():
            # Decide who missed: if homeowner initiated, contractor is expected; else homeowner expected
            missed_by = "contractor" if d.initiator == "homeowner" else "homeowner"

            d.status = "under_review"
            d.deadline_missed_by = missed_by
            d.last_activity_at = now
            d.save(update_fields=["status", "deadline_missed_by", "last_activity_at", "updated_at"])
            updated += 1

        # Overdue proposal decision deadline (homeowner decision)
        qs2 = Dispute.objects.filter(
            proposal_sent_at__isnull=False,
            proposal_due_at__isnull=False,
            proposal_due_at__lt=now,
        ).exclude(status__in=["resolved_contractor", "resolved_homeowner", "canceled"])

        for d in qs2.iterator():
            d.status = "under_review"
            d.deadline_missed_by = "homeowner"
            d.last_activity_at = now
            d.save(update_fields=["status", "deadline_missed_by", "last_activity_at", "updated_at"])
            updated += 1

        self.stdout.write(self.style.SUCCESS(f"check_dispute_deadlines: updated {updated} dispute(s)."))
