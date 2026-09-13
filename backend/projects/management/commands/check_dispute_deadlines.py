# backend/projects/management/commands/check_dispute_deadlines.py
from __future__ import annotations

from django.core.management.base import BaseCommand
from django.utils import timezone

from projects.models_dispute import Dispute, DisputePaymentHold, DisputeReminderLog, ResolutionCaseTimelineEvent
from projects.services.dispute_notifications import email_contractor_status_update, notify_homeowner_qualification
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
                    delivery = notify_homeowner_qualification(dispute, "expiration_pending")
                    _log.email_status = "sent" if delivery.get("email_sent") else "failed"
                    sms = delivery.get("sms") or {}
                    _log.sms_status = "sent" if sms.get("ok") else ("no_recipient" if sms.get("reason_code") == "no_phone" else "failed")
                    _log.delivery_details = {"event": "expiration_pending"}
                    _log.save(update_fields=["email_status", "sms_status", "delivery_details"])
                    contractor = getattr(getattr(dispute.agreement, "contractor", None), "user", None)
                    if contractor and contractor.email:
                        email_contractor_status_update(
                            dispute,
                            contractor.email,
                            "Customer information grace period started",
                            "The customer missed the initial qualification deadline. The source-specific hold remains active for one final business-day grace period.",
                        )
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
                    delivery = notify_homeowner_qualification(dispute, "expired")
                    _log.email_status = "sent" if delivery.get("email_sent") else "failed"
                    sms = delivery.get("sms") or {}
                    _log.sms_status = "sent" if sms.get("ok") else ("no_recipient" if sms.get("reason_code") == "no_phone" else "failed")
                    _log.delivery_details = {"event": "expired", "money_moved": False}
                    _log.save(update_fields=["email_status", "sms_status", "delivery_details"])
                    contractor = getattr(getattr(dispute.agreement, "contractor", None), "user", None)
                    if contractor and contractor.email:
                        email_contractor_status_update(
                            dispute,
                            contractor.email,
                            "Temporary payment hold closed",
                            "The required claim information was not completed after the final grace period. The linked invoice may resume its normal review process; this is not a finding on the merits.",
                        )
                updated += 1

        # Overdue response deadline
        qs1 = Dispute.objects.filter(
            fee_paid=True,
            status="open",
            response_grace_due_at__isnull=False,
            response_grace_due_at__lt=now,
        )

        for d in qs1.iterator():
            # Decide who missed: if homeowner initiated, contractor is expected; else homeowner expected
            missed_by = "contractor" if d.initiator == "homeowner" else "homeowner"

            d.status = "under_review"
            d.deadline_missed_by = missed_by
            d.last_activity_at = now
            d.save(update_fields=["status", "deadline_missed_by", "last_activity_at", "updated_at"])
            record_timeline_event(
                d,
                ResolutionCaseTimelineEvent.EVENT_QUALIFICATION_UPDATED,
                "Final response deadline missed",
                description=(
                    f"The {missed_by} did not respond within four business days plus the one-business-day grace period. "
                    "No automatic finding was made. The case proceeds using the existing record, and any active source-specific payment hold remains unchanged."
                ),
                related_object=d,
                metadata={"deadline_missed_by": missed_by, "automatic_finding": False, "payment_hold_changed": False},
            )
            updated += 1

        # Overdue proposal decision deadline (homeowner decision)
        qs2 = Dispute.objects.filter(
            proposal_sent_at__isnull=False,
            proposal_grace_due_at__isnull=False,
            proposal_grace_due_at__lt=now,
            deadline_missed_by="",
        ).exclude(status__in=["resolved_contractor", "resolved_homeowner", "resolved_partial", "closed", "canceled", "cancelled"])

        for d in qs2.iterator():
            d.status = "under_review"
            d.deadline_missed_by = "homeowner"
            d.last_activity_at = now
            d.save(update_fields=["status", "deadline_missed_by", "last_activity_at", "updated_at"])
            record_timeline_event(
                d,
                ResolutionCaseTimelineEvent.EVENT_QUALIFICATION_UPDATED,
                "Final proposal decision deadline missed",
                description="The homeowner did not decide within four business days plus the one-business-day grace period. No allocation or finding occurred automatically; the case remains under review.",
                related_object=d,
                metadata={"deadline_missed_by": "homeowner", "automatic_finding": False, "money_moved": False},
            )
            updated += 1

        self.stdout.write(self.style.SUCCESS(f"check_dispute_deadlines: updated {updated} dispute(s)."))
