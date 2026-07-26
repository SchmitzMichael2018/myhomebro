from projects.models import MeasurementAdjustment, MeasurementEvent
from projects.services.capture_adapters.base import CaptureAdapterError, CaptureDestinationAdapter


class MeasurementAdjustmentsAdapter(CaptureDestinationAdapter):
    name = "measurement_adjustments"

    def validate(self, context):
        if context.records.get("measurement_session") is None:
            raise CaptureAdapterError("Create the measurement session first.")

    def preview(self, context):
        rows = context.snapshot["structured_draft"]["adjustments"]
        return {"action": "create", "record_type": self.name, "label": f"{len(rows)} adjustment(s)", "fields": {"adjustments": rows}, "warnings": []}

    def apply(self, context, idempotency_key):
        self.validate(context)
        session = context.records["measurement_session"]
        output = []
        for item in context.snapshot["structured_draft"]["adjustments"]:
            row, created = MeasurementAdjustment.objects.get_or_create(
                session=session, client_key=item["client_key"],
                defaults={
                    "label": item["label"], "adjustment_type": item["adjustment_type"],
                    "source_entry_keys": item["source_entry_keys"],
                    "calculated_value": item.get("calculated_value", "0"),
                    "notes": item.get("notes", ""),
                },
            )
            output.append(row)
            if created:
                MeasurementEvent.objects.create(
                    session=session, event_type="adjustment_added", actor=context.actor,
                    session_version=session.version, metadata={"adjustment_id": row.id},
                )
        context.records[self.name] = output
        return output
