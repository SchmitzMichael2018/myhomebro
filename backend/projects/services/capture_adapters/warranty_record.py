from django.utils.dateparse import parse_date

from projects.models import AgreementWarranty, WarrantyCaptureChange
from projects.services.capture_adapters.base import CaptureAdapterError, CaptureDestinationAdapter


class WarrantyRecordAdapter(CaptureDestinationAdapter):
    name = "warranty_record"

    def _agreement(self, context):
        return getattr(context.capture.project, "agreement", None)

    def validate(self, context):
        if self._agreement(context) is None:
            raise CaptureAdapterError("A project agreement is required for warranty information.")

    def preview(self, context):
        self.validate(context)
        draft = context.snapshot["structured_draft"]
        return {
            "action": "update" if draft.get("update_warranty_id") else "create",
            "record_type": "warranty",
            "label": draft["warranty"].get("product_name") or "Warranty information",
            "fields": draft["warranty"],
            "warnings": draft.get("uncertainties", []),
        }

    def apply(self, context, idempotency_key):
        self.validate(context)
        draft = context.snapshot["structured_draft"]
        values = draft["warranty"]
        warranty_id = draft.get("update_warranty_id")
        before = {}
        if warranty_id:
            warranty = AgreementWarranty.objects.filter(
                id=warranty_id, contractor=context.capture.contractor,
                agreement=self._agreement(context),
            ).first()
            if warranty is None or not draft.get("explicit_update"):
                raise CaptureAdapterError("The approved warranty update is unavailable.")
            before = {
                "title": warranty.title, "start_date": str(warranty.start_date or ""),
                "end_date": str(warranty.end_date or ""),
                "coverage_details": warranty.coverage_details,
            }
            warranty.title = values.get("product_name") or warranty.title
            warranty.start_date = parse_date(str(values.get("start_date") or "")) or warranty.start_date
            warranty.end_date = parse_date(str(values.get("expiration_date") or "")) or warranty.end_date
            warranty.coverage_details = values.get("parts_coverage") or warranty.coverage_details
            warranty.manufacturer_notes = values.get("labor_coverage") or warranty.manufacturer_notes
            warranty.customer_visible = draft.get("customer_visible", False)
            warranty.full_clean()
            warranty.save()
            action = "update"
        else:
            warranty, created = AgreementWarranty.objects.get_or_create(
                origin_capture=context.capture,
                defaults={
                    "agreement": self._agreement(context),
                    "contractor": context.capture.contractor,
                    "title": values.get("product_name") or "Manufacturer warranty",
                    "coverage_details": values.get("parts_coverage", ""),
                    "manufacturer_notes": values.get("labor_coverage", ""),
                    "start_date": parse_date(str(values.get("start_date") or "")),
                    "end_date": parse_date(str(values.get("expiration_date") or "")),
                    "customer_visible": draft.get("customer_visible", False),
                },
            )
            if created:
                warranty.full_clean()
                context.created_records.append({
                    "type": "warranty", "id": warranty.id, "label": warranty.title,
                    "url": "/app/warranties",
                })
            action = "create"
        WarrantyCaptureChange.objects.get_or_create(
            warranty=warranty, origin_capture=context.capture,
            defaults={
                "before_values": before, "approved_values": values,
                "action": action, "actor": context.actor,
            },
        )
        context.records["warranty"] = warranty
        return warranty
