# backend/projects/management/commands/send_dispute_reminders.py
from __future__ import annotations

from datetime import timedelta
from django.core.management.base import BaseCommand
from django.contrib.auth import get_user_model
from django.utils import timezone

from projects.models_dispute import Dispute, DisputeReminderLog
from projects.services.dispute_notifications import (
    email_homeowner_proposal_sent,  # already exists and used elsewhere
    email_admin_dispute_update,
    email_contractor_status_update,
    email_homeowner_response_deadline,
    notify_homeowner_qualification,
)
from projects.services.dispute_inapp import try_create_inapp_notification


def _contractor_user(dispute):
    contractor = getattr(getattr(dispute, "agreement", None), "contractor", None)
    return getattr(contractor, "user", None)


def _homeowner_user(dispute):
    homeowner = getattr(getattr(dispute, "agreement", None), "homeowner", None)
    direct_user = getattr(homeowner, "user", None)
    if direct_user:
        return direct_user
    email = str(getattr(homeowner, "email", "") or "").strip()
    return get_user_model().objects.filter(email__iexact=email).first() if email else None


def _status(result, *, attempted=True):
    return "sent" if bool(result) else ("failed" if attempted else "no_recipient")


def _record_delivery(log, *, email=None, sms=None, in_app=None, details=None):
    if email is not None:
        log.email_status = _status(email)
    if sms is not None:
        sms_ok = sms.get("ok") if isinstance(sms, dict) else sms
        log.sms_status = _status(sms_ok, attempted=not (isinstance(sms, dict) and sms.get("reason_code") == "no_phone"))
    if in_app is not None:
        log.in_app_status = _status(in_app)
    log.delivery_details = details or {}
    log.save(update_fields=["email_status", "sms_status", "in_app_status", "delivery_details"])


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

        # Qualification reminders are source-specific and fee-free. Send one
        # reminder near 48 hours or the final reminder near 24 hours.
        qualification_soon = Dispute.objects.filter(
            qualification_status__in=[Dispute.QUALIFICATION_PENDING, Dispute.QUALIFICATION_INFORMATION_NEEDED],
            qualification_due_at__isnull=False,
            qualification_due_at__gt=now,
            qualification_due_at__lte=now + timedelta(hours=48),
            urgent_review=False,
        )
        for d in list(qualification_soon):
            hours_left = (d.qualification_due_at - now).total_seconds() / 3600
            event = "reminder_24h" if hours_left <= 24 else "reminder_48h"
            kind = "qualification_24h" if hours_left <= 24 else "qualification_48h"
            key = f"dispute:{d.id}:{kind}"
            _log, created = DisputeReminderLog.objects.get_or_create(
                dedupe_key=key,
                defaults={"dispute": d, "kind": kind, "sent_to": "homeowner"},
            )
            if not created:
                skipped += 1
                continue
            delivery = notify_homeowner_qualification(d, event)
            _record_delivery(_log, email=delivery.get("email_sent"), sms=delivery.get("sms"), details={"event": event})
            sent += 1

        # 1) Response due soon (open disputes)
        qs_response_soon = Dispute.objects.filter(
            fee_paid=True,
            status="open",
            response_due_at__isnull=False,
            response_due_at__lte=soon,
            response_due_at__gt=now,
        )

        # Materialize each candidate set before delivery work.  Keeping a SQLite
        # iterator cursor open while email/in-app delivery runs can retain a read
        # lock for the full network operation and block unrelated writes such as
        # milestone attachment uploads.
        for d in list(qs_response_soon):
            kind = "response_24h"
            if DisputeReminderLog.objects.filter(dispute=d, kind=kind).exists():
                skipped += 1
                continue

            missed_by = "contractor" if d.initiator == "homeowner" else "homeowner"
            title = f"Dispute #{d.id}: response due soon"
            msg = f"Response deadline is approaching for Dispute #{d.id}. Expected responder: {missed_by}."

            # Notify admin (optional)
            email_admin_dispute_update(d, admin_email, "Response due within 24h")

            contractor_user = _contractor_user(d)
            email_sent = None
            if missed_by == "contractor" and contractor_user:
                email_sent = email_contractor_status_update(d, contractor_user.email, "Response due within 24h", msg)
            elif missed_by == "homeowner":
                email_sent = email_homeowner_response_deadline(d, "Response due within 24 hours", msg)

            # In-app (best-effort)
            recipient = contractor_user if missed_by == "contractor" else _homeowner_user(d)
            in_app_sent = try_create_inapp_notification(recipient, title, msg, kind="dispute") if recipient else False

            log = DisputeReminderLog.objects.create(dispute=d, kind=kind, sent_to=missed_by)
            _record_delivery(log, email=email_sent, in_app=in_app_sent, details={"expected_responder": missed_by})
            sent += 1

        # 2) Initial response deadline passed: the one-business-day grace period starts.
        qs_response_grace = Dispute.objects.filter(
            fee_paid=True,
            status="open",
            response_due_at__isnull=False,
            response_due_at__lte=now,
            response_grace_due_at__gt=now,
        )

        for d in list(qs_response_grace):
            kind = "response_grace_started"
            if DisputeReminderLog.objects.filter(dispute=d, kind=kind).exists():
                skipped += 1
                continue

            missed_by = "contractor" if d.initiator == "homeowner" else "homeowner"
            title = f"Dispute #{d.id}: final response grace period"
            msg = f"The four-business-day response deadline passed. {missed_by.title()} has one final business-day grace period to respond."

            email_admin_dispute_update(d, admin_email, "Response grace period started")
            contractor_user = _contractor_user(d)
            email_sent = None
            if missed_by == "contractor" and contractor_user:
                email_sent = email_contractor_status_update(d, contractor_user.email, "Final response grace period", msg)
            elif missed_by == "homeowner":
                email_sent = email_homeowner_response_deadline(d, "Final response grace period", msg)

            recipient = contractor_user if missed_by == "contractor" else _homeowner_user(d)
            in_app_sent = try_create_inapp_notification(recipient, title, msg, kind="dispute") if recipient else False

            log = DisputeReminderLog.objects.create(dispute=d, kind=kind, sent_to=missed_by)
            _record_delivery(log, email=email_sent, in_app=in_app_sent, details={"expected_responder": missed_by})
            sent += 1

        # 3) Final response deadline passed.
        qs_response_overdue = Dispute.objects.filter(
            fee_paid=True,
            status="open",
            response_grace_due_at__isnull=False,
            response_grace_due_at__lte=now,
        )

        for d in list(qs_response_overdue):
            kind = "response_overdue"
            if DisputeReminderLog.objects.filter(dispute=d, kind=kind).exists():
                skipped += 1
                continue
            missed_by = "contractor" if d.initiator == "homeowner" else "homeowner"
            title = f"Dispute #{d.id}: final response deadline missed"
            msg = f"The four-business-day response period and one-business-day grace period ended without a response from {missed_by}."
            email_admin_dispute_update(d, admin_email, "Final response deadline missed")
            contractor_user = _contractor_user(d)
            email_sent = None
            if missed_by == "contractor" and contractor_user:
                email_sent = email_contractor_status_update(d, contractor_user.email, "Final response deadline missed", msg)
            elif missed_by == "homeowner":
                email_sent = email_homeowner_response_deadline(d, "Final response deadline missed", msg)
            recipient = contractor_user if missed_by == "contractor" else _homeowner_user(d)
            in_app_sent = try_create_inapp_notification(recipient, title, msg, kind="dispute") if recipient else False
            log = DisputeReminderLog.objects.create(dispute=d, kind=kind, sent_to=missed_by)
            _record_delivery(log, email=email_sent, in_app=in_app_sent, details={"expected_responder": missed_by, "automatic_finding": False})
            sent += 1

        # 4) Proposal decision due soon (homeowner decision)
        qs_prop_soon = Dispute.objects.filter(
            proposal_sent_at__isnull=False,
            proposal_due_at__isnull=False,
            proposal_due_at__lte=soon,
            proposal_due_at__gt=now,
        ).exclude(status__in=["resolved_contractor", "resolved_homeowner", "resolved_partial", "closed", "canceled", "cancelled"])

        for d in list(qs_prop_soon):
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

        # 5) Proposal grace period starts after four business days.
        qs_prop_grace = Dispute.objects.filter(
            proposal_sent_at__isnull=False,
            proposal_due_at__isnull=False,
            proposal_due_at__lte=now,
            proposal_grace_due_at__gt=now,
        ).exclude(status__in=["resolved_contractor", "resolved_homeowner", "resolved_partial", "closed", "canceled", "cancelled"])

        for d in list(qs_prop_grace):
            kind = "proposal_grace_started"
            if DisputeReminderLog.objects.filter(dispute=d, kind=kind).exists():
                skipped += 1
                continue

            email_admin_dispute_update(d, admin_email, "Proposal decision grace period started")
            email_homeowner_proposal_sent(d)

            if d.created_by:
                try_create_inapp_notification(
                    d.created_by,
                    f"Dispute #{d.id}: final decision grace period",
                    "The four-business-day decision deadline passed. One final business-day grace period remains.",
                    kind="dispute",
                )

            DisputeReminderLog.objects.create(dispute=d, kind=kind, sent_to="homeowner")
            sent += 1

        # 6) Final proposal decision deadline missed.
        qs_prop_overdue = Dispute.objects.filter(
            proposal_sent_at__isnull=False,
            proposal_grace_due_at__isnull=False,
            proposal_grace_due_at__lte=now,
        ).exclude(status__in=["resolved_contractor", "resolved_homeowner", "resolved_partial", "closed", "canceled", "cancelled"])

        for d in list(qs_prop_overdue):
            kind = "proposal_overdue"
            if DisputeReminderLog.objects.filter(dispute=d, kind=kind).exists():
                skipped += 1
                continue
            email_admin_dispute_update(d, admin_email, "Final proposal decision deadline missed")
            if d.created_by:
                try_create_inapp_notification(
                    d.created_by,
                    f"Dispute #{d.id}: final customer decision deadline missed",
                    "The four-business-day decision period and one-business-day grace period ended without a decision.",
                    kind="dispute",
                )
            DisputeReminderLog.objects.create(dispute=d, kind=kind, sent_to="homeowner")
            sent += 1

        self.stdout.write(self.style.SUCCESS(f"send_dispute_reminders: sent={sent} skipped={skipped}"))
