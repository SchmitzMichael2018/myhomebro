from decimal import Decimal

from projects.models import MeasurementAnnotation, MeasurementAttachment, MeasurementEvent
from projects.services.capture_adapters.base import CaptureAdapterError, CaptureDestinationAdapter


class MeasurementAttachmentAdapter(CaptureDestinationAdapter):
    name = "measurement_attachment"

    def validate(self, context):
        if context.records.get("measurement_session") is None:
            raise CaptureAdapterError("Create the measurement session first.")

    def preview(self, context):
        return {
            "action": "create", "record_type": self.name,
            "label": f"{context.capture.artifacts.count()} reference photo(s)",
            "fields": {"annotations": context.snapshot["structured_draft"].get("annotations", [])},
            "warnings": ["Photos do not supply dimensions without an entered reference."],
        }

    def apply(self, context, idempotency_key):
        self.validate(context)
        session = context.records["measurement_session"]
        attachments = {}
        for artifact in context.capture.artifacts.all():
            row, _ = MeasurementAttachment.objects.get_or_create(
                artifact=artifact,
                defaults={"session": session, "created_by": context.actor},
            )
            attachments[str(artifact.id)] = row
        for item in context.snapshot["structured_draft"].get("annotations", []):
            attachment = attachments.get(str(item.get("artifact_id")))
            if attachment:
                MeasurementAnnotation.objects.get_or_create(
                    attachment=attachment, label=item.get("label", ""),
                    defaults={
                        "line": item.get("line") or {},
                        "entry_client_key": item.get("entry_client_key", ""),
                        "known_reference_value": (
                            Decimal(str(item["known_reference_value"]))
                            if item.get("known_reference_value") is not None else None
                        ),
                    },
                )
        MeasurementEvent.objects.get_or_create(
            session=session, event_type="photo_attached", session_version=session.version,
            defaults={"actor": context.actor, "metadata": {"count": len(attachments)}},
        )
        return list(attachments.values())
