from projects.models import CustomerCommunicationLog, Homeowner
from projects.services.capture_adapters.base import CaptureAdapterError, CaptureDestinationAdapter


class CustomerNoteAdapter(CaptureDestinationAdapter):
    name = "customer_note"

    def _customer(self, context):
        customer_id = context.options.get("customer_id")
        customer = Homeowner.objects.filter(
            created_by=context.capture.contractor,
            pk=customer_id,
        ).first()
        if customer is None:
            raise CaptureAdapterError("Selected customer was not found.")
        return customer

    def validate(self, context):
        body = str((context.snapshot.get("structured_draft") or {}).get("body") or "").strip()
        if not body:
            raise CaptureAdapterError("Approved note body is required.")
        self._customer(context)

    def preview(self, context):
        self.validate(context)
        customer = self._customer(context)
        context.records["customer"] = customer
        draft = context.snapshot["structured_draft"]
        return {
            "action": "create",
            "record_type": "customer_note",
            "label": draft.get("title") or "Customer note",
            "customer_id": customer.id,
            "customer_label": customer.full_name,
            "fields": {"title": draft.get("title", ""), "body": draft.get("body", "")},
            "warnings": [],
        }

    def apply(self, context, idempotency_key):
        self.validate(context)
        customer = self._customer(context)
        draft = context.snapshot["structured_draft"]
        note = CustomerCommunicationLog.objects.create(
            contractor=context.capture.contractor,
            customer=customer,
            communication_type=CustomerCommunicationLog.TYPE_INTERNAL_NOTE,
            direction=CustomerCommunicationLog.DIRECTION_INTERNAL,
            visibility=CustomerCommunicationLog.VISIBILITY_INTERNAL_ONLY,
            subject=str(draft.get("title") or "Capture note")[:255],
            body=str(draft.get("body") or ""),
            origin_capture=context.capture,
            created_by=context.actor,
        )
        context.records["customer"] = customer
        context.records["customer_note"] = note
        context.created_records.append({
            "type": "customer_note",
            "id": note.id,
            "label": note.subject,
            "url": f"/app/customers/{customer.id}",
        })
        context.linked_records.append({
            "type": "customer",
            "id": customer.id,
            "label": customer.full_name,
            "url": f"/app/customers/{customer.id}",
        })
        return note
