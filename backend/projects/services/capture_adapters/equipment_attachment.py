from projects.models import EquipmentCaptureAttachment
from projects.services.capture_adapters.base import CaptureAdapterError, CaptureDestinationAdapter


class EquipmentAttachmentAdapter(CaptureDestinationAdapter):
    name = "equipment_attachment"

    def validate(self, context):
        if context.records.get("equipment") is None:
            raise CaptureAdapterError("Apply the equipment record before its attachments.")

    def preview(self, context):
        return {
            "action": "create",
            "record_type": "equipment_attachment",
            "label": f"{context.capture.artifacts.count()} source file(s)",
            "fields": {"count": context.capture.artifacts.count()},
            "warnings": [],
        }

    def apply(self, context, idempotency_key):
        self.validate(context)
        visible = context.snapshot["structured_draft"].get("customer_visible", False)
        records = []
        for artifact in context.capture.artifacts.all():
            row, created = EquipmentCaptureAttachment.objects.get_or_create(
                artifact=artifact,
                defaults={
                    "equipment": context.records["equipment"],
                    "customer_visible": visible,
                    "created_by": context.actor,
                },
            )
            records.append(row)
            if created:
                context.created_records.append({
                    "type": "equipment_attachment", "id": row.id,
                    "label": artifact.original_filename,
                    "url": f"/app/projects/{context.capture.project_id}",
                })
        return records
