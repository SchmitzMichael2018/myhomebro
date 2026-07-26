from projects.models import WarrantyCaptureDocument
from projects.services.capture_adapters.base import CaptureAdapterError, CaptureDestinationAdapter


class WarrantyDocumentAdapter(CaptureDestinationAdapter):
    name = "warranty_document"

    def validate(self, context):
        if context.records.get("warranty") is None or not context.capture.artifacts.exists():
            raise CaptureAdapterError("A warranty and source document are required.")

    def preview(self, context):
        return {
            "action": "create",
            "record_type": "warranty_document",
            "label": f"{context.capture.artifacts.count()} preserved source file(s)",
            "fields": {"count": context.capture.artifacts.count()},
            "warnings": [],
        }

    def apply(self, context, idempotency_key):
        self.validate(context)
        draft = context.snapshot["structured_draft"]
        equipment = None
        if draft.get("equipment_id"):
            equipment = context.capture.contractor.assets.filter(id=draft["equipment_id"]).first()
            if equipment is None:
                raise CaptureAdapterError("Linked equipment is not available.")
        rows = []
        for artifact in context.capture.artifacts.all():
            row, created = WarrantyCaptureDocument.objects.get_or_create(
                artifact=artifact,
                defaults={
                    "warranty": context.records["warranty"],
                    "equipment": equipment,
                    "customer_visible": draft.get("customer_visible", False),
                    "approved_metadata": draft["warranty"],
                    "created_by": context.actor,
                },
            )
            rows.append(row)
            if created:
                context.created_records.append({
                    "type": "warranty_document", "id": row.id,
                    "label": artifact.original_filename, "url": "/app/warranties",
                })
        return rows
