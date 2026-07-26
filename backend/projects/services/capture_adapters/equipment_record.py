from django.utils.dateparse import parse_date

from projects.models import ContractorAsset, PropertyProfile
from projects.services.capture_adapters.base import CaptureAdapterError, CaptureDestinationAdapter


class EquipmentRecordAdapter(CaptureDestinationAdapter):
    name = "equipment_record"

    def validate(self, context):
        draft = context.snapshot["structured_draft"]
        if not context.capture.project_id or not draft.get("equipment", {}).get("category"):
            raise CaptureAdapterError("Project and equipment category are required.")

    def authorize(self, context):
        if context.capture.contractor_id != context.capture.project.contractor_id:
            raise CaptureAdapterError("Equipment project access is not authorized.")

    def find_conflicts(self, context):
        return context.capture.duplicate_candidates or []

    def preview(self, context):
        self.validate(context)
        draft = context.snapshot["structured_draft"]
        decision = (context.snapshot.get("review_decisions") or {}).get("duplicate") or {}
        return {
            "action": "link" if decision.get("decision") == "link_existing" else "create",
            "record_type": "equipment",
            "label": draft["equipment"].get("manufacturer") or draft["equipment"]["category"],
            "fields": draft["equipment"],
            "warnings": draft.get("uncertainties", []),
        }

    def apply(self, context, idempotency_key):
        self.validate(context)
        self.authorize(context)
        draft = context.snapshot["structured_draft"]
        values = draft["equipment"]
        property_profile = PropertyProfile.objects.filter(
            homeowner=context.capture.customer,
            **({"id": draft["property_id"]} if draft.get("property_id") else {}),
        ).order_by("-is_primary", "-updated_at").first()
        decision = (context.snapshot.get("review_decisions") or {}).get("duplicate") or {}
        if decision.get("decision") == "link_existing":
            asset = ContractorAsset.objects.filter(
                contractor=context.capture.contractor,
                id=decision.get("candidate_id"),
            ).first()
            if asset is None:
                raise CaptureAdapterError("The approved equipment match is unavailable.")
            context.linked_records.append({
                "type": "equipment", "id": asset.id, "label": asset.name,
                "url": f"/app/projects/{context.capture.project_id}",
            })
        else:
            asset, created = ContractorAsset.objects.get_or_create(
                origin_capture=context.capture,
                defaults={
                    "contractor": context.capture.contractor,
                    "owner_type": ContractorAsset.OWNER_CUSTOMER_PROPERTY,
                    "customer": context.capture.customer,
                    "property": property_profile,
                    "project": context.capture.project,
                    "agreement": getattr(context.capture.project, "agreement", None),
                    "asset_type": values["category"],
                    "name": values.get("description") or values.get("model") or values["category"],
                    "manufacturer": values.get("manufacturer", ""),
                    "model_number": values.get("model", ""),
                    "serial_number": values.get("serial_number", ""),
                    "installation_date": parse_date(str(values.get("installation_date") or "")),
                    "notes": values.get("description", ""),
                    "maintenance_notes": draft.get("maintenance", {}).get("notes", ""),
                    "customer_visible": draft.get("customer_visible", False),
                    "created_by": context.actor,
                },
            )
            if created:
                context.created_records.append({
                    "type": "equipment", "id": asset.id, "label": asset.name,
                    "url": f"/app/projects/{context.capture.project_id}",
                })
        context.records["equipment"] = asset
        return asset
