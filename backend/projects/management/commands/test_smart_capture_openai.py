from __future__ import annotations

import json
from pathlib import Path

from django.core.files.uploadedfile import SimpleUploadedFile
from django.core.management.base import BaseCommand, CommandError
from django.test import override_settings

from projects.models import Contractor, ProjectAssistantSmartCaptureSession
from projects.services.project_assistant_smart_capture import (
    SMART_CAPTURE_NORMALIZER_VERSION,
    create_smart_capture_session,
    smart_capture_provider,
)


class Command(BaseCommand):
    help = "Safely test OpenAI Smart Capture extraction without creating Expense or Asset records."

    def add_arguments(self, parser):
        parser.add_argument("--file", required=True, help="Path to a local receipt or label image.")
        parser.add_argument("--type", required=True, choices=["receipt", "equipment_label", "product_label"], help="Smart Capture type.")
        parser.add_argument("--contractor-id", type=int, default=None, help="Optional contractor id for scoping.")
        parser.add_argument("--user-id", type=int, default=None, help="Optional user id recorded as creator.")
        parser.add_argument("--provider", default="openai", choices=["openai", "deterministic"], help="Provider to use for this verification run.")
        parser.add_argument("--force-refresh", action="store_true", help="Bypass Smart Capture extraction cache and make one new provider request.")

    def handle(self, *args, **options):
        path = Path(options["file"]).expanduser()
        if not path.exists() or not path.is_file():
            raise CommandError(f"File not found: {path}")

        contractor = self._contractor(options.get("contractor_id"))
        actor = contractor.user
        if options.get("user_id"):
            from django.contrib.auth import get_user_model

            actor = get_user_model().objects.filter(pk=options["user_id"]).first() or actor

        content_type = self._content_type(path)
        upload = SimpleUploadedFile(path.name, path.read_bytes(), content_type=content_type)
        with override_settings(SMART_CAPTURE_PROVIDER=options["provider"]):
            session = create_smart_capture_session(
                contractor=contractor,
                actor=actor,
                capture_type=options["type"],
                file_obj=upload,
                force_refresh=bool(options.get("force_refresh")),
            )

        payload = {
            "session_id": str(session.id),
            "status": session.status,
            "provider": session.extraction_provider or smart_capture_provider(),
            "model": session.extraction_model,
            "prompt_version": session.extraction_prompt_version,
            "normalizer_version": (session.audit_metadata or {}).get("normalizer_version", SMART_CAPTURE_NORMALIZER_VERSION),
            "cache_hit": bool((session.audit_metadata or {}).get("cache_hit")),
            "provider_request_id": (session.audit_metadata or {}).get("provider_request_id", ""),
            "provider_error_details": (session.audit_metadata or {}).get("provider_error_details", {}),
            "usage": (session.audit_metadata or {}).get("provider_usage", {}),
            "structured_payload": session.structured_payload,
            "field_confidence": session.field_confidence,
            "missing_fields": session.missing_fields,
            "warnings": session.warnings,
            "no_mutation": {
                "created_expense": session.created_expense_id,
                "created_asset": session.created_asset_id,
                "created_property_record": session.created_property_record_id,
            },
        }
        self.stdout.write(json.dumps(payload, indent=2, default=str))

    def _contractor(self, contractor_id):
        if contractor_id:
            contractor = Contractor.objects.select_related("user").filter(pk=contractor_id).first()
            if contractor:
                return contractor
            raise CommandError(f"Contractor not found: {contractor_id}")
        contractor = Contractor.objects.select_related("user").order_by("id").first()
        if not contractor:
            raise CommandError("No contractor exists. Seed or create a contractor first.")
        return contractor

    def _content_type(self, path: Path) -> str:
        suffix = path.suffix.lower()
        if suffix in {".jpg", ".jpeg"}:
            return "image/jpeg"
        if suffix == ".png":
            return "image/png"
        if suffix == ".webp":
            return "image/webp"
        if suffix == ".pdf":
            return "application/pdf"
        raise CommandError("Use a JPEG, PNG, WebP, or PDF file.")
