from django.utils import timezone

from projects.models import MeasurementEntry, MeasurementEvent
from projects.services.capture_adapters.base import CaptureAdapterError, CaptureDestinationAdapter


class MeasurementEntriesAdapter(CaptureDestinationAdapter):
    name = "measurement_entries"

    def validate(self, context):
        if context.records.get("measurement_session") is None:
            raise CaptureAdapterError("Create the measurement session before its entries.")

    def preview(self, context):
        entries = context.snapshot["structured_draft"]["entries"]
        return {
            "action": "create", "record_type": "measurement_entries",
            "label": f"{len(entries)} measurement reading(s)",
            "fields": {"entries": entries}, "warnings": [],
        }

    def apply(self, context, idempotency_key):
        self.validate(context)
        session = context.records["measurement_session"]
        rows = []
        for sequence, item in enumerate(context.snapshot["structured_draft"]["entries"]):
            verified = item["verification_status"] in {"verified", "confirmed"}
            row, created = MeasurementEntry.objects.get_or_create(
                session=session, client_key=item["client_key"],
                defaults={
                    "reading_group": item.get("reading_group", ""),
                    "label": item["label"], "dimension_type": item["dimension_type"],
                    "normalized_value": item["normalized_value"],
                    "display_unit": item["display_unit"], "raw_value": item["raw_value"],
                    "source_method": item["source_method"],
                    "verification_status": item["verification_status"],
                    "confidence": item.get("confidence"),
                    "tool_description": item.get("tool_description", ""),
                    "selected_for_calculation": item.get("selected_for_calculation", True),
                    "selection_method": item.get("selection_method", ""),
                    "direction": item.get("direction", ""),
                    "sequence": sequence, "notes": item.get("notes", ""),
                    "measured_by": context.actor,
                    "verified_by": context.actor if verified else None,
                    "verified_at": timezone.now() if verified else None,
                },
            )
            rows.append(row)
            if created:
                MeasurementEvent.objects.create(
                    session=session, event_type="measurement_added", actor=context.actor,
                    session_version=session.version, metadata={
                        "entry_id": row.id, "client_key": row.client_key,
                        "verification_status": row.verification_status,
                    },
                )
        context.records["measurement_entries"] = rows
        return rows
