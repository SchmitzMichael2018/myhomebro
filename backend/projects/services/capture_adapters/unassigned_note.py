from projects.services.capture_adapters.base import CaptureAdapterError, CaptureDestinationAdapter


class UnassignedNoteAdapter(CaptureDestinationAdapter):
    name = "unassigned_note"

    def validate(self, context):
        if not str((context.snapshot.get("structured_draft") or {}).get("body") or "").strip():
            raise CaptureAdapterError("Approved note body is required.")

    def preview(self, context):
        self.validate(context)
        draft = context.snapshot["structured_draft"]
        return {
            "action": "retain",
            "record_type": "unassigned_note",
            "label": draft.get("title") or "Unassigned Capture note",
            "fields": {"body": draft.get("body", "")},
            "warnings": [],
        }

    def apply(self, context, idempotency_key):
        self.validate(context)
        context.linked_records.append({
            "type": "capture_note",
            "id": str(context.capture.id),
            "label": (context.snapshot["structured_draft"].get("title") or "Unassigned Capture note"),
            "url": f"/app/capture/{context.capture.id}",
        })
        return context.capture

