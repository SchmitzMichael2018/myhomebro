# backend/projects/management/commands/send_dispute_reminders.py
from __future__ import annotations

from datetime import timedelta
from django.core.management.base import BaseCommand
from django.utils import timezone

from projects.models_dispute import Dispute, DisputeReminderLog
from projects.services.dispute_notifications import (
    email_homeowner_proposal_sent,  # already exists and used elsewhere
    email_admin_dispute_update,
    email_contractor_status_update,
)
from projects.services.dispute_inapp import try_create_inapp_notification


class Command(BaseCommand):
    help = "Send dispute reminders (24h before due, and overdue) + create in-app notifications."

    def handle(self, *args, **options):
        now = timezone.now()
        soon = now + timedelta(hours=24)

        sent = 0
        skipped = 0

        # Admin email (optional)
        from django.conf import settings
        admin_email = getattr(settings, "DISPUTE_ADMIN_EMAIL", "") or ""

        # 1) Response due soon (open disputes)
        qs_response_soon = Dispute.objects.filter(
            fee_paid=True,
            status="open",
            response_due_at__isnull=False,
            response_due_at__lte=soon,
            response_due_at__gt=now,
        )

        for d in qs_response_soon.iterator():
            kind = "response_24h"
            if DisputeReminderLog.objects.filter(dispute=d, kind=kind).exists():
                skipped += 1
                continue

            missed_by = "contractor" if d.initiator == "homeowner" else "homeowner"
            title = f"Dispute #{d.id}: response due soon"
            msg = f"Response deadline is approaching for Dispute #{d.id}. Expected responder: {missed_by}."

            # Notify admin (optional)
            email_admin_dispute_update(d, admin_email, "Response due within 24h")

            # In-app (best-effort)
            if d.created_by:
                try_create_inapp_notification(d.created_by, title, msg, kind="dispute")

            DisputeReminderLog.objects.create(dispute=d, kind=kind)
            sent += 1

        # 2) Response overdue
        qs_response_overdue = Dispute.objects.filter(
            fee_paid=True,
            status="open",
            response_due_at__isnull=False,
            response_due_at__lte=now,
        )

        for d in qs_response_overdue.iterator():
            kind = "response_overdue"
            if DisputeReminderLog.objects.filter(dispute=d, kind=kind).exists():
                skipped += 1
                continue

            missed_by = "contractor" if d.initiator == "homeowner" else "homeowner"
            title = f"Dispute #{d.id}: response overdue"
            msg = f"Response deadline was missed for Dispute #{d.id}. Missed by: {missed_by}. Admin review recommended."

            email_admin_dispute_update(d, admin_email, "Response overdue")

            if d.created_by:
                try_create_inapp_notification(d.created_by, title, msg, kind="dispute")

            DisputeReminderLog.objects.create(dispute=d, kind=kind)
            sent += 1

        # 3) Proposal decision due soon (homeowner decision)
        qs_prop_soon = Dispute.objects.filter(
            proposal_sent_at__isnull=False,
            proposal_due_at__isnull=False,
            proposal_due_at__lte=soon,
            proposal_due_at__gt=now,
        ).exclude(status__in=["resolved_contractor", "resolved_homeowner", "canceled"])

        for d in qs_prop_soon.iterator():
            kind = "proposal_24h"
            if DisputeReminderLog.objects.filter(dispute=d, kind=kind).exists():
                skipped += 1
                continue

            email_admin_dispute_update(d, admin_email, "Proposal decision due within 24h")

            # Homeowner reminder (email decision link again)
            # This reuses your existing proposal-sent email content; safe to resend once.
            email_homeowner_proposal_sent(d)

            if d.created_by:
                try_create_inapp_notification(
                    d.created_by,
                    f"Dispute #{d.id}: homeowner decision due soon",
                    "Homeowner decision deadline is approaching (24h).",
                    kind="dispute",
                )

            DisputeReminderLog.objects.create(dispute=d, kind=kind)
            sent += 1

        # 4) Proposal overdue
        qs_prop_overdue = Dispute.objects.filter(
            proposal_sent_at__isnull=False,
            proposal_due_at__isnull=False,
            proposal_due_at__lte=now,
        ).exclude(status__in=["resolved_contractor", "resolved_homeowner", "canceled"])

        for d in qs_prop_overdue.iterator():
            kind = "proposal_overdue"
            if DisputeReminderLog.objects.filter(dispute=d, kind=kind).exists():
                skipped += 1
                continue

            email_admin_dispute_update(d, admin_email, "Proposal decision overdue")

            if d.created_by:
                try_create_inapp_notification(
                    d.created_by,
                    f"Dispute #{d.id}: homeowner decision overdue",
                    "Homeowner missed the proposal decision deadline. Admin review recommended.",
                    kind="dispute",
                )

            DisputeReminderLog.objects.create(dispute=d, kind=kind)
            sent += 1

        self.stdout.write(self.style.SUCCESS(f"send_dispute_reminders: sent={sent} skipped={skipped}"))
