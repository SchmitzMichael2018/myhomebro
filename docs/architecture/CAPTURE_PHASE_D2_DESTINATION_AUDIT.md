# Capture Phase D.2 Destination Audit

Phase D.2 extends the existing Capture lifecycle and does not introduce a parallel
equipment or warranty domain.

## Canonical destinations

- Installed equipment uses `ContractorAsset` with `owner_type=customer_property_record`.
  It already supports contractor, customer, property, project, agreement, milestone,
  manufacturer, model, serial number, installation date, and Smart Capture provenance.
- Warranty information uses `AgreementWarranty`, the record already consumed by Warranty
  Management and the Customer Portal.
- Potential concerns use `WarrantyRequest` in its initial `submitted` state and
  `WarrantyRequestEvidence`. Existing warranty permissions and lifecycle remain authoritative.
- Project timeline entries and evidence use `ProjectCaptureActivity` and immutable
  `CaptureArtifact` records.
- Provider usage is recorded in the existing `AIUsageLedger`; Smart Capture sessions and
  workflows are not modified.

## Additive provenance

`origin_capture` links, explicit customer-visibility fields, maintenance notes, immutable
artifact link records, and append-only warranty change history are added where the canonical
models lacked Capture provenance. Existing equipment, warranties, requests, documents, and
Smart Capture records are not rewritten.

## Safety boundaries

Capture may prepare and submit records for review. It cannot approve or deny warranty
coverage, assign liability, authorize repairs, create payments, or create disputes.
Equipment matches are contractor-scoped and require an explicit link/create/not-same
decision. Warranty updates require explicit selection and retain prior values in history.
