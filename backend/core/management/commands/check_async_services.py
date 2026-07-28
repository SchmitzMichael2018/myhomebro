from __future__ import annotations

import json
from io import BytesIO

from django.conf import settings
from django.core.management.base import BaseCommand, CommandError
from reportlab.pdfgen import canvas

from core.async_readiness import readiness_report


class Command(BaseCommand):
    help = "Validate Redis, Celery worker, and queued PDF readiness without customer data."

    def add_arguments(self, parser):
        parser.add_argument(
            "--mode",
            choices=("configuration", "broker", "worker", "pdf"),
            default="configuration",
        )
        parser.add_argument("--timeout", type=float, default=5.0)
        parser.add_argument("--json", action="store_true", dest="as_json")
        parser.add_argument(
            "--force",
            action="store_true",
            help="Probe optional async infrastructure even when async PDF is disabled.",
        )

    def handle(self, *args, **options):
        mode = options["mode"]
        timeout = max(0.5, min(float(options["timeout"]), 30.0))
        force_optional = bool(options["force"])
        report = readiness_report(
            connect_broker=mode in {"broker", "worker", "pdf"},
            check_worker=mode in {"worker", "pdf"},
            write_test=mode == "pdf" and (
                bool(getattr(settings, "PDF_ASYNC_ENABLED", False)) or force_optional
            ),
            force_optional=force_optional,
        )

        async_active = bool(getattr(settings, "PDF_ASYNC_ENABLED", False))
        celery_active = bool(
            async_active
            or getattr(settings, "CELERY_SCHEDULED_JOBS_ENABLED", False)
            or getattr(settings, "CELERY_NOTIFICATIONS_ENABLED", False)
            or force_optional
        )
        if mode in {"worker", "pdf"} and report.get("ready") and celery_active:
            from projects.tasks import pdf_readiness_probe

            try:
                result = pdf_readiness_probe.apply_async(
                    kwargs={"pdf_smoke": mode == "pdf" and async_active},
                    queue=str(getattr(settings, "PDF_QUEUE_NAME", "pdf")),
                )
                report["round_trip"] = result.get(timeout=timeout, propagate=True)
            except Exception as exc:
                report["ready"] = False
                report["round_trip"] = {
                    "status": "failed",
                    "error": type(exc).__name__,
                }

        if mode == "pdf" and (async_active or force_optional):
            report["local_pdf_smoke"] = self._local_pdf_smoke()
            report["ready"] = bool(report["ready"] and report["local_pdf_smoke"]["valid"])
        elif mode == "pdf":
            report["queued_pdf_smoke"] = {"status": "disabled", "attempted": False}

        if options["as_json"]:
            self.stdout.write(json.dumps(report, sort_keys=True))
        else:
            self.stdout.write(
                f"Async services readiness: {'PASS' if report['ready'] else 'FAIL'} "
                f"(mode={mode}, async_pdf="
                f"{'enabled' if getattr(settings, 'PDF_ASYNC_ENABLED', False) else 'disabled'})"
            )
            self.stdout.write(json.dumps(report, indent=2, sort_keys=True))

        if not report["ready"]:
            raise CommandError(
                "Async services are not ready. Verify the broker URL, Redis package, "
                "worker queue, result backend, and MEDIA_ROOT permissions."
            )

    @staticmethod
    def _local_pdf_smoke():
        try:
            buffer = BytesIO()
            document = canvas.Canvas(buffer)
            document.drawString(72, 720, "MyHomeBro local PDF readiness")
            document.save()
            payload = buffer.getvalue()
            return {"valid": payload.startswith(b"%PDF"), "bytes": len(payload)}
        except Exception as exc:
            return {"valid": False, "error": type(exc).__name__}
