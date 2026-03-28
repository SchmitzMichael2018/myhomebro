from __future__ import annotations

from django.core.management.base import BaseCommand

from projects.models import Agreement, ProjectEmailReportLog
from projects.services.project_email_reports import send_project_email_report


class Command(BaseCommand):
    help = "Send weekly project summary emails to configured report recipients."

    def handle(self, *args, **options):
        sent = 0
        skipped = 0
        for agreement in Agreement.objects.exclude(report_recipient_email="").select_related(
            "project",
            "contractor",
            "homeowner",
        ):
            result = send_project_email_report(
                event_type=ProjectEmailReportLog.EventType.WEEKLY_PROJECT_SUMMARY,
                agreement=agreement,
            )
            if result.get("sent"):
                sent += 1
            else:
                skipped += 1
        self.stdout.write(
            self.style.SUCCESS(
                f"Weekly project summary processing complete (sent={sent}, skipped={skipped})."
            )
        )
