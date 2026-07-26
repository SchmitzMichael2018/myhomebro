from projects.models import MeasurementCalculatedResult, MeasurementEvent
from projects.services.capture_adapters.base import CaptureAdapterError, CaptureDestinationAdapter


class MeasurementCalculationsAdapter(CaptureDestinationAdapter):
    name = "measurement_calculations"

    def validate(self, context):
        if context.records.get("measurement_session") is None:
            raise CaptureAdapterError("Create the measurement session first.")

    def preview(self, context):
        rows = context.snapshot["structured_draft"]["calculations"]
        return {"action": "create", "record_type": self.name, "label": f"{len(rows)} deterministic result(s)", "fields": {"results": rows}, "warnings": []}

    def apply(self, context, idempotency_key):
        self.validate(context)
        session = context.records["measurement_session"]
        output = []
        for item in context.snapshot["structured_draft"]["calculations"]:
            row, created = MeasurementCalculatedResult.objects.get_or_create(
                session=session, result_type=item["result_type"], revision=session.version,
                defaults={
                    "label": item["label"], "normalized_value": item["normalized_value"],
                    "normalized_unit": item["normalized_unit"],
                    "display_value": item["display_value"], "display_unit": item["display_unit"],
                    "formula_key": item["formula_key"],
                    "calculation_version": item["calculation_version"],
                    "source_entry_keys": item["source_entry_keys"],
                    "adjustment_keys": item["adjustment_keys"],
                    "verification_status": item["verification_status"],
                    "lineage": item["lineage"],
                },
            )
            output.append(row)
        if output:
            MeasurementEvent.objects.get_or_create(
                session=session, event_type="calculation_regenerated",
                session_version=session.version,
                defaults={"actor": context.actor, "metadata": {"result_count": len(output)}},
            )
        context.records[self.name] = output
        return output
