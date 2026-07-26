from projects.models_contractor_discovery import ContractorDirectoryEntry, ContractorOpportunity
from projects.services.capture_adapters.base import CaptureAdapterError, CaptureDestinationAdapter


def directory_entry_for(contractor):
    entry = ContractorDirectoryEntry.objects.filter(
        claimed_by_contractor=contractor
    ).order_by("-claimed", "id").first()
    if entry:
        return entry
    business_name = contractor.business_name or contractor.user.email or "Contractor"
    return ContractorDirectoryEntry.objects.create(
        business_name=business_name,
        normalized_name=business_name.lower(),
        source=ContractorDirectoryEntry.SOURCE_MANUAL,
        claimed=True,
        claimed_by_contractor=contractor,
        public_email=contractor.user.email or "",
        has_public_email=bool(contractor.user.email),
    )


class OpportunityAdapter(CaptureDestinationAdapter):
    name = "opportunity"

    def _draft(self, context):
        return (context.snapshot.get("structured_draft") or {}).get("opportunity") or {}

    def validate(self, context):
        if context.records.get("customer") is None:
            raise CaptureAdapterError("A customer is required for the Opportunity.")
        if not str(self._draft(context).get("summary") or "").strip():
            raise CaptureAdapterError("Approved Opportunity scope is required.")

    def preview(self, context):
        draft = self._draft(context)
        return {
            "action": "create",
            "record_type": "opportunity",
            "label": str(draft.get("title") or "New opportunity").strip(),
            "fields": {
                "title": str(draft.get("title") or "").strip(),
                "summary": str(draft.get("summary") or "").strip(),
                "project_type": str(draft.get("project_type") or "").strip(),
                "location": str(draft.get("location_text") or "").strip(),
            },
            "warnings": [],
        }

    def apply(self, context, idempotency_key):
        self.validate(context)
        customer = context.records["customer"]
        draft = self._draft(context)
        opportunity = ContractorOpportunity.objects.create(
            directory_entry=directory_entry_for(context.capture.contractor),
            customer=customer,
            origin_capture=context.capture,
            homeowner_name=customer.full_name,
            homeowner_email=customer.email or None,
            homeowner_phone=customer.phone_number or None,
            project_address=str(draft.get("location_text") or "").strip()[:255] or None,
            project_type=str(draft.get("project_type") or "").strip()[:120] or None,
            project_title=str(draft.get("title") or "").strip()[:255] or "New opportunity",
            project_description=str(draft.get("summary") or "").strip(),
            status=ContractorOpportunity.STATUS_PENDING,
            selected_by_homeowner=False,
            conversion_notes="Created from an explicitly applied approved Capture.",
        )
        context.records["opportunity"] = opportunity
        context.created_records.append({
            "type": "opportunity",
            "id": opportunity.id,
            "label": opportunity.project_title,
            "url": f"/app/opportunities/{opportunity.id}",
        })
        return opportunity

