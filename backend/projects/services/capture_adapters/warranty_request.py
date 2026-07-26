from projects.models import (
    AgreementWarranty, PropertyProfile, WarrantyRequest,
    WarrantyRequestStatusHistory,
)
from projects.services.capture_adapters.base import CaptureAdapterError, CaptureDestinationAdapter


class WarrantyRequestAdapter(CaptureDestinationAdapter):
    name = "warranty_request"

    def _warranty(self, context):
        agreement = getattr(context.capture.project, "agreement", None)
        return AgreementWarranty.objects.filter(
            agreement=agreement, contractor=context.capture.contractor,
        ).first()

    def validate(self, context):
        if self._warranty(context) is None:
            raise CaptureAdapterError("An existing project warranty is required for concern intake.")

    def preview(self, context):
        self.validate(context)
        draft = context.snapshot["structured_draft"]
        return {
            "action": "create",
            "record_type": "warranty_request",
            "label": "Warranty review requested — coverage not yet determined",
            "fields": {"title": draft["title"], "urgency": draft["urgency"]},
            "warnings": ["This does not approve coverage or authorize repair."],
        }

    def apply(self, context, idempotency_key):
        self.validate(context)
        draft = context.snapshot["structured_draft"]
        warranty = self._warranty(context)
        property_profile = PropertyProfile.objects.filter(
            homeowner=context.capture.customer,
            **({"id": draft["property_id"]} if draft.get("property_id") else {}),
        ).order_by("-is_primary", "-updated_at").first()
        request, created = WarrantyRequest.objects.get_or_create(
            origin_capture=context.capture,
            defaults={
                "warranty": warranty,
                "agreement": warranty.agreement,
                "project": context.capture.project,
                "contractor": context.capture.contractor,
                "homeowner": context.capture.customer,
                "property_profile": property_profile,
                "title": draft["title"],
                "description": draft["description"],
                "date_noticed": draft.get("date_first_noticed"),
                "severity": draft["urgency"],
                "urgency": draft["urgency"],
                "status": WarrantyRequest.STATUS_SUBMITTED,
                "coverage_decision": "",
                "customer_notes": draft.get("customer_summary", ""),
                "contractor_response": draft.get("internal_notes", ""),
                "submitted_by": context.actor,
                "submitted_by_email": getattr(context.actor, "email", ""),
                "source_context": {
                    "origin": "capture",
                    "coverage_not_determined": True,
                    "equipment_id": draft.get("equipment_id"),
                },
            },
        )
        if created:
            WarrantyRequestStatusHistory.objects.create(
                warranty_request=request, to_status=WarrantyRequest.STATUS_SUBMITTED,
                note="Warranty review requested. Coverage not yet determined.",
                actor=context.actor, actor_email=getattr(context.actor, "email", ""),
                metadata={"origin_capture_id": str(context.capture.id)},
            )
            context.created_records.append({
                "type": "warranty_request", "id": request.id,
                "label": request.title, "url": "/app/warranties",
            })
        context.records["warranty_request"] = request
        return request
