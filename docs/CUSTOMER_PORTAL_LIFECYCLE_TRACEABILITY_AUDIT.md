# Customer Portal Lifecycle Traceability Audit

## Before

`CustomerRequest` exists as the homeowner request record, but downstream work can drift away from it:

`CustomerRequest -> ProjectIntake -> ContractorOpportunity / ContractorDiscoveryInvite -> Agreement -> Project`

Maintenance-specific records are partially connected:

`PropertyHomeSystem -> CustomerRequest`

`MaintenanceWorkOrder -> Agreement / Milestone / PropertyProfile`

Important gaps:

- `CustomerRequest` has `source_intake` and `converted_project`, but conversion paths did not reliably update `converted_project` or request status.
- `PropertyHomeSystem` can point at one `linked_customer_request` and one `linked_agreement`, but agreement conversion did not reliably populate `linked_agreement`.
- `MaintenanceWorkOrder` had no direct home-system link, so completed contractor service could not safely update the relevant system's `last_service_date`.
- Home-system reminder state was computed from the system record. Creating a service request linked the request, but correctly did not mark service complete.
- Homeowner-facing lifecycle state was derived from several separate sources and could not always express `Service Requested`, `Sent to Contractors`, `Agreement Created`, `Scheduled`, `In Progress`, and `Completed`.

## After

Customer Portal request remains the origin record where possible:

`CustomerRequest -> ProjectIntake -> ContractorOpportunity / ContractorDiscoveryInvite -> Agreement -> Project -> Milestone / Invoice / Payment`

Maintenance traceability adds:

`CustomerRequest -> PropertyHomeSystem`

`MaintenanceWorkOrder -> PropertyHomeSystem`

`PropertyHomeSystem -> CustomerRequest / Agreement`

Lifecycle derivation rules:

- `Dismissed`: home-system reminder is paused with `dismissed_until` in the future.
- `Service Requested`: active linked customer request exists.
- `Sent to Contractors`: linked request has routed marketplace opportunities/invites/leads.
- `Agreement Created`: linked request/intake produced an agreement.
- `Scheduled`: linked agreement has scheduled maintenance work.
- `In Progress`: linked work order is in progress.
- `Completed`: linked work order is completed, or homeowner manually marked the system serviced.
- `Overdue`: reminder engine says overdue/due and no stronger active lifecycle exists.

## Remaining Risks

- Legacy agreements not created from a `CustomerRequest` can still lack a request origin.
- Admin-created agreements need either explicit origin selection or best-effort linking by property/customer.
- `CustomerRequest` is still request-level history, not a full event-sourced lifecycle ledger.
- Future analytics would benefit from immutable lifecycle event rows rather than deriving all states from current object fields.
