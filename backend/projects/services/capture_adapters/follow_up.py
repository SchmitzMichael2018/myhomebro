from django.utils.dateparse import parse_datetime

from projects.models import CustomerCommunicationLog
from projects.services.capture_adapters.base import CaptureAdapterError, CaptureDestinationAdapter


class FollowUpAdapter(CaptureDestinationAdapter):
    name = "follow_up"

    def _follow_up(self, context):
        return (context.snapshot.get("structured_draft") or {}).get("follow_up") or {}

    def _due_at(self, context):
        value = self._follow_up(context).get("due_at")
        due_at = parse_datetime(str(value)) if value else None
        if value and due_at is None:
            raise CaptureAdapterError("Approved follow-up date is invalid.")
        return due_at

    def validate(self, context):
        if not context.options.get("include_follow_up"):
            raise CaptureAdapterError("Follow-up was not explicitly selected.")
        if self._due_at(context) is None:
            raise CaptureAdapterError("An approved follow-up date is required.")
        if context.records.get("customer") is None:
            raise CaptureAdapterError("A customer is required for the follow-up.")

    def preview(self, context):
        self.validate(context)
        follow_up = self._follow_up(context)
        return {
            "action": "create",
            "record_type": "follow_up",
            "label": follow_up.get("subject") or "Capture follow-up",
            "fields": {"due_at": follow_up.get("due_at")},
            "warnings": [],
        }

    def apply(self, context, idempotency_key):
        self.validate(context)
        due_at = self._due_at(context)
        existing_note = context.records.get("customer_note")
        if existing_note:
            existing_note.follow_up_at = due_at
            existing_note.save(update_fields=["follow_up_at", "updated_at"])
            follow_up = existing_note
        else:
            values = self._follow_up(context)
            follow_up = CustomerCommunicationLog.objects.create(
                contractor=context.capture.contractor,
                customer=context.records["customer"],
                opportunity=context.records.get("opportunity"),
                communication_type=CustomerCommunicationLog.TYPE_INTERNAL_NOTE,
                direction=CustomerCommunicationLog.DIRECTION_INTERNAL,
                visibility=CustomerCommunicationLog.VISIBILITY_INTERNAL_ONLY,
                subject=str(values.get("subject") or "Capture follow-up")[:255],
                body=str(values.get("source_phrase") or ""),
                follow_up_at=due_at,
                origin_capture=context.capture,
                created_by=context.actor,
            )
            context.created_records.append({
                "type": "follow_up",
                "id": follow_up.id,
                "label": follow_up.subject,
                "url": f"/app/customers/{context.records['customer'].id}",
            })
        context.records["follow_up"] = follow_up
        return follow_up
