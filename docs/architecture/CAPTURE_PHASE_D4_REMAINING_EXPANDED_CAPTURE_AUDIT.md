# Capture Phase D.4 — Remaining Expanded Capture Audit

**Status:** repository-grounded architecture recommendation

**Date:** 2026-07-26

**Scope:** read-only product prioritization and implementation design

**Governing rule:** Capture first; organize later; human approval before consequential application.

## 1. Executive summary

Phase D.4 should not add fourteen equal Capture types. The repository already has a
strong Capture lifecycle, review snapshot, atomic application service, receipts, Project
Issue classifications, an amendment-request workflow, equipment and warranty records,
tenant maintenance intake, work orders, assignments, expenses, and material Takeoff.
The safest plan is to add profiles and adapters only where an authoritative destination
already exists, and to create a bounded domain model before exposing any Capture whose
destination does not exist.

The smallest coherent first slice is **D.4.1 Project Field Findings**:

- keep `issue` as the Capture type;
- expose `punch_item` and a new `site_condition` profile/classification contextually;
- allow one parent Capture to propose independently reviewable Project Issues;
- never create a change request, notify a customer, or publish evidence automatically.

The strongest prelaunch enhancement is **D.4.2 Change Intake**. It should prepare an
`AmendmentRequest` draft through the existing amendment workflow. It must not alter an
agreement, amount, milestone, payment schedule, scope, or date.

Material requests, delivery records, and reusable inspections belong after those slices
because no authoritative request, delivery, or inspection record exists. Customer and
subcontractor evidence should primarily extend actor access to existing Capture types,
not create duplicate types. Safety and labor/time should be future specialized modules.
The minimum useful D.4 foundation before Phase E is D.4.1 plus the deterministic
Change Intake destination contract from D.4.2; conversation must route to known,
permission-checked workflows rather than invent business records.

## 2. Files inspected

The audit inspected the following representative sources and their directly related
serializers, views, routes, migrations, and tests:

- `AGENTS.md`
- `docs/architecture/MYHOMEBRO_ENGINEERING_PRINCIPLES.md`
- `docs/design-system/MYHOMEBRO_DESIGN_SYSTEM.md`
- `docs/architecture/CAPTURE_PHASE_D2_DESTINATION_AUDIT.md`
- `docs/architecture/CAPTURE_PHASE_D3_1_MEASUREMENT_FOUNDATION.md`
- `docs/architecture/CAPTURE_PHASE_D3_2_INTELLIGENT_TAKEOFF.md`
- `docs/architecture/CAPTURE_PHASE_D3_3A_BLUEPRINT_PDF_TAKEOFF.md`
- `docs/architecture/CAPTURE_PHASE_D3_3B_PHOTO_ASSISTED_MEASUREMENT.md`
- `docs/architecture/CAPTURE_PHASE_D3_3C_1_LASER_VENDOR_DEVICE_AUDIT.md`
- `docs/architecture/CAPTURE_PHASE_D3_3C_2_STABILA_LD530BT_SPIKE.md`
- `backend/projects/models_capture.py`
- `backend/projects/models_project_capture.py`
- `backend/projects/models_capture_warranty.py`
- `backend/projects/models_amendment_request.py`
- `backend/projects/models_customer_portal.py`
- `backend/projects/models_maintenance.py`
- `backend/projects/models_expense_request.py`
- `backend/projects/models_assignments.py`
- `backend/projects/models_takeoff.py`
- `backend/projects/models.py`
- `backend/projects/serializers/capture.py`
- `backend/projects/services/capture_processing.py`
- `backend/projects/services/capture_permissions.py`
- `backend/projects/services/capture_application.py`
- `backend/projects/services/capture_adapters/`
- `backend/projects/services/notification_center.py`
- `backend/projects/services/workflow_notifications.py`
- `backend/projects/views/capture.py`
- `backend/projects/views/customer_portal.py`
- `backend/projects/views/amendment_requests.py`
- `backend/projects/views/maintenance_work_orders.py`
- `backend/core/settings.py`
- `frontend/src/components/capture/CaptureLauncher.jsx`
- `frontend/src/lib/captureFlags.js`
- `frontend/src/api/captures.js`
- `backend/projects/tests_capture_*.py`
- `frontend/tests/capture-*.spec.js`
- relevant customer portal, amendment, expense, assignment, subcontractor, warranty,
  notification, maintenance, measurement, and Takeoff tests.

## 3. Existing Capture inventory

| Capture type | Current destination/readiness | D.4 implication |
|---|---|---|
| Quick Lead | Customer + Opportunity, optional follow-up | Complete reusable lifecycle |
| Quick Note | Unassigned or Customer note, optional follow-up | Complete reusable lifecycle |
| Photo | Saved artifact; not a general business destination | Use contextual typed profiles |
| Receipt | Launcher path exists; financial Expense is separate | Do not confuse with delivery |
| Opportunity | Model choice exists, but Quick Lead owns usable intake | Do not add a competing path |
| Project Update | Project note/activity/attachment/follow-up | Reuse for neutral observations |
| Progress Photo | Project attachment/activity | Reuse for subcontractor evidence |
| Issue | Project Issue/activity/follow-up | Reuse for punch and site conditions |
| Communication | Communication log/activity/follow-up | Reuse for informal decisions |
| Document | Project attachment/activity | Reuse for evidence and customer uploads |
| Equipment | Equipment record/attachment | Reuse for home inventory |
| Warranty Document | Warranty record/document | Existing destination |
| Warranty Concern | Warranty request/evidence/activity/follow-up | Existing destination |
| Measurement | Session, entries, adjustments, calculations, attachment/activity | Existing D.3 destination |

The lifecycle already supports draft, processing, needs-information, possible-duplicate,
review, approval, applying, applied, failure, retry, archive, immutable approved snapshots,
artifacts, application receipts, adapter versions, idempotency, and audit events. D.4
should extend this lifecycle rather than create a second intake engine.

## 4. Repository overlap findings

- `ProjectCaptureIssue` already includes `punch_item`, `customer_concern`,
  `potential_warranty`, `potential_change_request`, and `internal_note`. Punch is a
  specialized Issue, not a new top-level record.
- `AmendmentRequest` and its attachments own the customer/contractor change-request
  lifecycle. `AgreementAmendment` is not a Capture destination.
- `TenantMaintenanceRequest`, `PropertyWorkOrder`, and `MaintenanceWorkOrder` are
  distinct, actor- and context-specific records. They must not be merged.
- Equipment and property architecture already owns model/serial, warranty, documents,
  property linkage, and maintenance context. Home inventory is an Equipment profile.
- `MaterialLibraryItem`, assemblies, Takeoff sessions, and Takeoff items calculate
  requirements; they are not requests, purchases, inventory, or delivery records.
- `ExpenseRequest` and `Expense` concern reimbursement/cost. A material delivery receipt
  proves receipt of goods and is semantically distinct.
- Assignments and subcontractor milestone flows already own work authorization.
  Evidence Capture must not assign work or approve completion.
- Notifications have in-app records, smart customer preferences/rules/logs, and
  deduplication patterns, but there is no generic “notify on Capture” policy.
- No reusable Inspection, Inspection Observation, Material Request, Delivery Record,
  Safety Incident, or Labor Time Entry domain model was found. The `InspectionStatus`
  enum alone is not an inspection record.
- Current permissions cover contractor owners, supervisors, and assigned employee
  subaccounts. Customer, tenant, property-manager, public, and subcontractor Capture
  authorization are not general capabilities.
- The launcher already exposes nine base actions plus flagged measurement, equipment,
  and warranty actions. Adding one button per D.4 candidate would be unusable.

## 5. Candidate capability matrix

Scores are directional, 1–5, where **value/reuse/mobile** are higher-is-better and
**complexity/risk** are higher-is-harder.

| Candidate | Existing overlap | Authoritative destination | Value | Reuse | Mobile | Complexity | Risk | Recommendation |
|---|---|---|---:|---:|---:|---:|---:|---|
| Punch List | Strong | Project Issue (`punch_item`) | 5 | 5 | 5 | 2 | 2 | D.4.1 |
| Site Condition | Strong | Project Issue; optional later change draft | 5 | 5 | 5 | 2 | 3 | D.4.1 |
| Change Request | Strong | Amendment Request draft | 5 | 4 | 4 | 3 | 4 | D.4.2 |
| Subcontractor Evidence | Strong | Existing attachment/activity/issue | 4 | 5 | 5 | 3 | 3 | D.4.3 |
| Customer-Supplied | Partial | Existing context-specific destinations | 4 | 4 | 4 | 4 | 4 | D.4.3 |
| Material Request | Partial Takeoff | New bounded Material Request | 4 | 2 | 5 | 4 | 3 | D.4.4 |
| Delivery/Material Receipt | Expense overlap only | New Delivery Record | 4 | 2 | 5 | 4 | 3 | D.4.4 after requests |
| Inspection | Templates/issues only | New Inspection + Observation | 4 | 2 | 4 | 5 | 4 | D.4.5 |
| Customer Decision | Communication/amendment overlap | Depends on decision class | 4 | 3 | 4 | 4 | 5 | D.4.2 informal; later formal |
| Maintenance | Strong but fragmented | Actor-specific request/work order | 4 | 4 | 4 | 4 | 4 | D.4.6 |
| Home Inventory | Strong | Equipment record | 3 | 5 | 4 | 3 | 3 | D.4.6 |
| Safety | None | New specialized safety domain | 4 | 1 | 5 | 5 | 5 | Future module |
| Labor/Time | None | New time-entry domain | 4 | 1 | 5 | 5 | 5 | Future module |
| Additional: completion evidence | Strong | Existing milestone evidence/review | 4 | 5 | 5 | 3 | 4 | D.4.3 profile, not new type |

## 6. Inspection recommendation

A reusable inspection needs a bounded `Inspection` record and ordered `InspectionObservation`
children. Required concepts include project/property, inspection template/version, inspector,
inspection kind, performed time, overall state, observation category/severity, location,
description, artifacts, recommended follow-up, visibility, provenance, and immutable completion
history. A checklist template is not the completed inspection.

One Capture may propose one Inspection and multiple observations. Deficiencies may separately
propose Project Issues, but creating those issues requires per-child approval. Project
Assistant may extract observations and ask questions; it must not certify code, safety,
habitability, or compliance. Defer implementation until the domain model and permission
policy exist. Do not stretch `ProjectCaptureIssue` into the inspection source of truth.

## 7. Punch List recommendation

Punch List is a specialized **Issue profile**, not a distinct record or top-level Capture
type. Use `ProjectCaptureIssue.classification=punch_item`; add structured fields only if
needed for location, responsible party suggestion, due-date suggestion, milestone, and
verification evidence. Assignment and due-date application must remain explicit and use
the owning assignment/schedule services.

A walkthrough Capture may propose multiple punch items. Each item is independently
approvable and produces its own Issue receipt. The launcher should show “Punch items”
contextually on Project Detail and Milestone, with “Document an issue” remaining the
global action.

## 8. Safety recommendation

Defer Safety Capture to a specialized post-launch module. Safety observations, hazards,
incidents, near misses, injuries, corrective actions, witnesses, and regulatory reports
have different retention, access, notification, and legal requirements. A generic Issue
can document a non-emergency site concern today, with copy telling users to follow their
emergency process. Project Assistant must never determine emergency status, OSHA
compliance, causation, fault, medical status, or reportability. Safety records should be
private by default and excluded from ordinary customer publication and AI processing
unless an explicit policy permits it.

## 9. Labor recommendation

Defer labor/time to a specialized workforce module. The repository has assignments and
schedules, but no authoritative time-entry, break, correction, approval, payroll-export,
geofence, or wage-policy domain. Voice-extracted hours cannot become payable time.
Future Capture may prepare a draft time entry tied to worker, assignment, project,
milestone, work date, start/end/breaks, source, correction history, and supervisor
approval. It must not calculate payroll, approve time, or infer attendance. Labor data
requires employee self-access, supervisor boundaries, retention, and jurisdiction review.

## 10. Material Request recommendation

Create a bounded Material Request domain before adding Capture. A request should own
requester, contractor/project/milestone, needed-by date, delivery/pickup location, status,
approval state, notes, and item children with description, quantity, unit, SKU/product
snapshot, substitution permission, and optional Takeoff-item reference.

Takeoff linkage is optional provenance, never the request source of truth. Copying an item
must snapshot the relevant description/unit/quantity because Takeoff revisions are
versioned. Capture may extract several requested items, but it cannot approve a request,
select a vendor, promise availability, place an order, update inventory, or create an
Expense.

## 11. Delivery recommendation

A Delivery Record is distinct from a financial Receipt. It should follow Material Request
because it needs a stable item/request vocabulary. It should record supplier/carrier,
delivery time, project/location, receiver, packing-slip identifier, linked request/order
when present, delivered quantities, shortages, damage, rejection notes, artifacts, and
visibility. Financial receipts remain in Expense/reimbursement workflows.

One Capture may propose a delivery header plus item results and issue proposals for damage
or shortages. The delivery applies atomically; any Issue proposals apply independently.
No Capture should mark materials paid, approve an invoice, adjust inventory, or accept a
substitution automatically.

## 12. Subcontractor recommendation

Subcontractors should use existing `progress_photo`, `document`, `issue`, and
`communication` types through an actor-aware, assignment-scoped entry point. Add a
“completion evidence” profile rather than a new type. Access must be limited to the
invitation/assignment/milestone and artifacts the subcontractor submitted. A contractor
owner or supervisor reviews and applies evidence; existing milestone-completion review
remains authoritative. Capture must not approve work, release payment, satisfy compliance,
or expose pricing/customer-private material.

## 13. Customer Capture recommendation

Customer-supplied Capture should require an authenticated portal except for an explicitly
designed, token-scoped public intake such as QR lead capture. Customers may submit:

- project documents/photos to a private review queue;
- warranty concerns through the existing warranty route;
- equipment/home inventory details to an Equipment draft;
- maintenance requests through the actor-specific portal flow;
- change requests to an Amendment Request draft.

Customers view their own submission and the contractor-approved/public result, not
internal processing, duplicate candidates, pricing, labor, or notes. Submission does not
mutate a project or publish to the portal.

## 14. Change Request recommendation

Change Request is a high-value prelaunch enhancement. It should accept added/removed work,
changed conditions, substitutions, schedule-impacting requests, design changes, and
quantity changes, then prepare an `AmendmentRequest` draft with attachments and Capture
provenance. Project Assistant may categorize and summarize the request and identify
missing scope, price, or schedule information.

The human-reviewed adapter creates only the draft/request state accepted by the existing
amendment workflow. It must not create an `AgreementAmendment` directly or change an
agreement, amount, milestone, payment schedule, scope, date, signature, invoice, or
dispute. Customer-submitted requests require contractor review. Contractual effect occurs
only in the existing amendment approval/signature process.

## 15. Customer Decision recommendation

Use three explicit classes:

1. **Informal preference:** existing Communication with a `customer_preference` profile.
2. **Operational decision:** a future bounded Decision record or owning workflow action,
   with choices, decision-maker, deadline, acknowledgement, and history.
3. **Contractual/signature-required approval:** Amendment/signature workflow only.

Capture may prepare evidence of a message, but a message must never be promoted to binding
approval. Work acceptance remains in the existing milestone/review flow. Access permission
requires its owning property/project workflow. Do not build a generic “approved” checkbox.

## 16. Site Condition recommendation

Site Condition is an Issue profile. Add an explicit `site_condition` classification rather
than overloading `potential_change_request`. Suggested categories include hidden damage,
existing defect, access constraint, weather, utility, structural concern, code concern,
moisture, mold-like observation, pest evidence, occupancy constraint, and obstruction.
Use observational language; Project Assistant must not diagnose mold, engineering defects,
code violations, or responsibility.

The primary destination is Project Issue. The reviewer may separately approve a Project
Update and/or Change Request proposal. These are independent child applications; one Issue
must never silently create or imply a contract change, warranty decision, dispute position,
or safety determination.

## 17. Home Inventory recommendation

Home Inventory is an Equipment profile, not a second asset model. It should reuse the
existing Equipment record and property ownership boundary for appliances, systems,
fixtures, model/serial, installation date, warranty, manuals, receipts, photos, and service
context. Finish-only observations without an asset identity can remain property documents
or notes. Homeowners may submit drafts in the authenticated portal; contractor review is
required before creating or linking Equipment. Serial-number duplicate checks should be
contractor/property scoped and suggested, never silently merged.

## 18. Maintenance recommendation

Route maintenance by actor and context:

- active tenant/property context → `TenantMaintenanceRequest`;
- property manager/contractor triage → `PropertyWorkOrder`;
- agreement recurring-maintenance context → `MaintenanceWorkOrder`;
- warranty-eligible concern → suggest, but do not decide, `WarrantyRequest`;
- active construction defect → Project Issue;
- equipment preventive action → future equipment service/reminder record.

The user must see the selected destination before approval. Do not merge tenant, homeowner,
property-manager, and contractor permission policies. Completed maintenance and recurring
service need their owning workflow; Capture is intake, not completion certification.

## 19. Destination adapter map

All adapters use an approved schema snapshot, server authorization, `transaction.atomic`,
adapter versioning, idempotency key, application receipt, and append-only Capture events.
Duplicates pause application for a human decision. Core destination failure rolls back
that application; optional child applications remain unapplied and retryable.

| Profile/capability | Approved schema minimum | Destination | Side effects and visibility |
|---|---|---|---|
| Punch | project, summary, items[{title, detail, location, artifacts}] | Project Issues (`punch_item`) | No assignment/notification/publication by default |
| Site condition | project, observation, category, location, observed_at, artifacts | Project Issue (`site_condition`) | Optional separately approved update/change draft |
| Change request | agreement/project, requester, change_kind, requested_change, artifacts | Amendment Request draft | Existing workflow owns notifications and legal effect |
| Subcontractor evidence | assignment/milestone, evidence_kind, description, artifacts | Existing attachment/activity/issue | No completion approval or payment effect |
| Customer upload | authenticated customer, owning context, upload_kind, artifacts | Existing context destination | Private review queue; publish separately |
| Material request | project, requested_by, needed_by, items | New Material Request + items | No purchase, inventory, Expense, or vendor message |
| Delivery | project, supplier, received_at, items, artifacts | New Delivery Record + lines | Optional independently approved issues |
| Inspection | context, kind/template, performed_at, observations | New Inspection + observations | Deficiency Issues are separate child applications |
| Home inventory | property/customer, equipment facts, artifacts | Existing Equipment + attachment | Private until explicitly made customer-visible |
| Maintenance | actor/context, problem, location, urgency asserted by user, artifacts | Actor-specific existing request | Owning workflow controls work-order creation |

Notifications occur after successful application and only through the destination domain.
Portal publication is a separate explicit action. Receipts identify created/linked records,
warnings, actor, approved versions, and timestamps.

## 20. Multi-record application recommendation

Represent multi-record work as:

`Capture → approved structured draft → proposed applications[] → application receipts[]`.

Each proposed application needs a stable child key, destination, schema version, status,
review decision, adapter version, duplicate decision, and receipt. “Approve all” is
available only after every child is visible and valid; high-risk or mixed-destination
children require individual confirmation. Partial apply is explicit, not a hidden partial
transaction. Failure of one child does not undo earlier independently confirmed children,
but a single domain aggregate (delivery + lines, inspection + observations) is atomic.
Reprocessing creates a new Capture version and preserves prior proposals/receipts. Applied
children cannot be silently rewritten or re-applied.

## 21. Project Assistant processing design

Every profile should return `schema_version`, extracted fields with source evidence,
confidence, missing-information questions, proposed applications, duplicate suggestions,
warnings, and a plain-language summary. Evidence should point to transcript spans or
artifact identifiers without copying sensitive content into logs.

Project Assistant may extract, classify, structure, summarize, suggest, and ask. It may
not make legal or safety conclusions; approve time, expenses, changes, completion, or
warranty coverage; assign blame; commit dates; alter scope; notify external parties; or
publish records. Low confidence, conflicting project/customer identity, ambiguous
destination, or missing required context produces `needs_information`, not a guessed
record. Deterministic validation and server permissions run after AI output.

## 22. Capture Launcher recommendation

Keep global shortcuts limited to frequent, context-independent actions: Quick Lead, Quick
Note, Photo, Receipt, and Document an Issue. Existing project actions can remain while
usage is evaluated, but D.4 should add no new equal-priority global button.

- Punch, Site Condition, Change Request, Subcontractor Evidence, Maintenance, Home
  Inventory, Material Request, Delivery, and Inspection are contextual actions.
- A searchable **More capture types** drawer groups Project, Materials, Customer,
  Property, and Records actions behind feature and permission checks.
- Recent/favorite actions may reorder only within the drawer, never bypass authorization.
- Phase E may conversationally classify intent, but must show the resolved profile,
  context, and destination before saving.

## 23. Contextual entry-point map

| Entry point | Appropriate actions |
|---|---|
| Global launcher/mobile quick action | Lead, note, photo, receipt, generic issue; More drawer |
| Project Detail | update, progress, issue, site condition, document, change request |
| Milestone | progress evidence, punch item, issue, subcontractor evidence |
| Measurement/Takeoff | measurement; later material request from selected versioned items |
| Team Schedule/Assignment | evidence and issue; future time draft only in labor module |
| Customer Portal | own upload, change request, warranty, equipment draft, maintenance by context |
| Property | equipment/home inventory, property document, maintenance |
| Equipment | warranty document/concern, manual/photo; future service action |
| Warranty | concern and evidence |
| Dispute | existing dispute evidence workflow, not generic Capture application |
| Expense | financial receipt/reimbursement workflow |
| Material Request | delivery capture when that domain exists |
| Inspection workspace | inspection/punch observations when that domain exists |

## 24. Actor and permission matrix

Legend: C create, O view own, P view authorized project/context, R review, A approve
Capture draft, X apply, V publish, F assign follow-up, S sensitive artifacts. All checks
are server-side and object-scoped.

| Actor | Baseline D.4 capability |
|---|---|
| Contractor owner | C/O/P/R/A/X/archive/V/F/S for owned contractor, subject to domain rules |
| Supervisor | C/O/P/R/A/X/archive/V/F/S for owned contractor; QR management remains owner-only |
| Employee | C/O/P for assigned project/milestone; edit/archive own early draft; no X/V by default |
| Office staff | Explicit role capability required; usually C/O/P/R, no X/V unless supervisor-equivalent |
| Subcontractor | C/O only for invited assignment evidence; limited P; no R/A/X/V/F/S beyond own |
| Customer | C/O for authenticated owned context; view published result; no internal R/A/X/F/S |
| Property manager | C/O/P for managed property; domain triage by membership; no contractor-wide access |
| Tenant | C/O for active tenancy maintenance only; no project/internal records |
| Public/unauthenticated | No D.4 access; only separately token-scoped public intake |

Profile-specific restrictions override this baseline: safety and labor need dedicated
policies; contractual change application remains owner/supervisor; customer decisions use
the owning workflow; artifacts inherit both Capture and destination access. Archive never
deletes an applied destination or its receipt.

## 25. Portal visibility rules

- Contractor notes, processing data, duplicates, pricing, labor, safety, assignment
  internals, and unapproved artifacts are private.
- Project activity, issue, document, equipment, or maintenance content is customer-visible
  only through an explicit approved publication field/action.
- Customer and tenant submissions are visible to the submitter and authorized contractor
  reviewers; they do not become shared project timeline entries automatically.
- Subcontractor evidence is internal until the contractor publishes a suitable result.
- Change requests may show their workflow state to the submitting customer, while internal
  deliberation remains private.
- Contractual approval is displayed only from the amendment/signature source of truth.
- Public uploads require narrow token scope, expiry/revocation, size/type limits, malware
  controls, throttling, and a review quarantine. They are not recommended for D.4.

## 26. Duplicate/conflict design

Duplicates are suggestions, never silent merges. Candidate evidence includes contractor,
project/property, actor, time window, room/location, category, artifact checksum,
normalized text similarity, equipment serial/model, SKU, request/delivery identifier,
assignment/milestone, and target record.

- Issue/punch/site: same project + location + category + open state + similar text/image.
- Change: same agreement + requester + change kind + similar request within a time window.
- Material: same project + requester + needed-by + overlapping normalized items.
- Delivery: supplier + packing slip + date + artifact hash; never equate it to an Expense.
- Inspection: context + kind/template + performed time; observations also compare location/category.
- Equipment: normalized serial is strongest; model/location alone is only a suggestion.
- Maintenance: tenancy/property + location + symptom + open state.
- Evidence/labor: artifact hash or assignment/date/source import key.

Conflicting destinations or identity produce `needs_information`. Link-existing,
create-separate, or not-the-same decisions are recorded in the approved snapshot and
receipt.

## 27. Notification design

Capture save/process/review should default to no external notification. Use an in-app
review count/digest for owners and supervisors, deduplicated by Capture or proposal key.
Destination application may invoke that domain's existing notification service only
after its transaction commits.

- Change request: acknowledge submitter once accepted into the workflow; notify authorized
  contractor reviewer, not all staff.
- Customer/tenant submission: one acknowledgement plus status changes governed by portal
  preferences.
- Subcontractor evidence: notify the assigned reviewer at submission/ready-for-review,
  preferably digest unless the existing completion workflow requires immediate action.
- Material/delivery/inspection: define events with the new domain; avoid per-item spam.
- Punch/site condition: no customer notification until explicit publication.
- Safety: future fixed human-authored escalation policy; Project Assistant cannot decide
  emergencies.

All events need deterministic recipients, preference/consent handling, dedupe keys,
transaction-on-commit dispatch, retry/log visibility, safe links, and sanitized content.

## 28. Feature-flag recommendation

Use independent backend/frontend gates, default false:

- `CAPTURE_FIELD_FINDINGS_ENABLED` / `VITE_CAPTURE_FIELD_FINDINGS_ENABLED`
- `CAPTURE_CHANGE_REQUEST_ENABLED` / `VITE_CAPTURE_CHANGE_REQUEST_ENABLED`
- `CAPTURE_ACTOR_EVIDENCE_ENABLED` / `VITE_CAPTURE_ACTOR_EVIDENCE_ENABLED`
- `CAPTURE_CUSTOMER_UPLOAD_ENABLED` / `VITE_CAPTURE_CUSTOMER_UPLOAD_ENABLED`
- `CAPTURE_MATERIAL_REQUEST_ENABLED` / `VITE_CAPTURE_MATERIAL_REQUEST_ENABLED`
- `CAPTURE_DELIVERY_ENABLED` / `VITE_CAPTURE_DELIVERY_ENABLED`
- `CAPTURE_INSPECTION_ENABLED` / `VITE_CAPTURE_INSPECTION_ENABLED`
- `CAPTURE_HOME_INVENTORY_ENABLED` / `VITE_CAPTURE_HOME_INVENTORY_ENABLED`
- `CAPTURE_MAINTENANCE_ENABLED` / `VITE_CAPTURE_MAINTENANCE_ENABLED`

Safety and labor flags should be introduced only with their specialized modules. Server
flags are authoritative; frontend flags control discoverability only. Add organization
allowlists/entitlements through a server capability response rather than embedding
organization IDs in the client. Foundation/review/application flags remain prerequisites.

## 29. Prioritized candidate ranking

| Rank | Candidate | Directional priority / 100 | Reason |
|---:|---|---:|---|
| 1 | Punch List | 88 | Frequent, mobile, high reuse, low domain risk |
| 2 | Site Condition | 85 | Revenue/dispute protection using Issue |
| 3 | Change Request | 82 | High revenue protection; strong existing workflow |
| 4 | Subcontractor Evidence | 74 | High field value; mostly permissions and context |
| 5 | Customer-Supplied | 70 | Good experience; actor/privacy work required |
| 6 | Material Request | 66 | Frequent and mobile; new domain required |
| 7 | Delivery Receipt | 62 | Valuable proof; depends on material vocabulary |
| 8 | Inspection | 60 | Valuable but generic model and policy are substantial |
| 9 | Maintenance | 58 | Strong domains but routing/actor ambiguity |
| 10 | Home Inventory | 55 | Reuses Equipment; lower launch urgency |
| 11 | Customer Decision | 52 | Useful but legal semantics vary by decision |
| 12 | Labor/Time | 45 | High frequency, very high policy/payroll risk |
| 13 | Safety | 42 | Important, but highest legal/privacy/escalation risk |

Scores are prioritization aids, not estimates or claims of objective precision.

## 30. Recommended D.4 stages

### D.4.1 — Project Field Findings

Issue profiles for punch and site condition; multi-item proposals; contextual Project and
Milestone UI; existing Project Issue adapter extended; owner/supervisor apply; assigned
employee create. No new top-level record. Tests emphasize multi-item approval, scoping,
duplicates, artifacts, and no automatic visibility/change creation. **Smallest coherent
slice; optional prelaunch.**

### D.4.2 — Change Intake and Decision Boundary

Change Request Capture to `AmendmentRequest` draft; informal preference remains
Communication; authenticated customer submission; existing amendment workflow owns every
consequential step. Add adapter/provenance and permission tests. **Strong prelaunch
enhancement.**

### D.4.3 — Actor-Aware Project Evidence

Assignment-scoped subcontractor and customer entry points using existing progress,
document, issue, warranty, and milestone evidence destinations. New authorization policy
and portal review UX; no new generic evidence record. **Post-launch unless needed by the
launch customer cohort.**

### D.4.4 — Material Logistics

First introduce Material Request + items, then Delivery Record + lines. Optional immutable
Takeoff-item provenance. Contextual mobile UI, domain notifications, and granular
duplicates. **Post-launch; requires models/migrations/APIs.**

### D.4.5 — Reusable Inspection

Inspection/template-version/observation domain, inspection processing schema, deficiency
child proposals, contextual workspace, retention and visibility policy. **Post-launch;
larger architecture slice.**

### D.4.6 — Property Lifecycle

Home Inventory as Equipment profile and actor-routed Maintenance Capture. Reuse property,
tenant, work-order, warranty, and equipment sources of truth. **Post-launch.**

### Separate future modules

Safety and Labor/Time require dedicated architecture, privacy, policy, and release audits.
They should not be hidden at the end of D.4 or delegated to Phase E.

## 31. Prelaunch versus post-launch classification

| Capability | Classification |
|---|---|
| Change Request | Strong prelaunch enhancement |
| Punch List | Optional prelaunch |
| Site Condition | Optional prelaunch |
| Subcontractor Evidence | Post-launch / cohort-dependent |
| Customer-Supplied | Post-launch / cohort-dependent |
| Material Request | Post-launch |
| Delivery Receipt | Post-launch after Material Request |
| Inspection | Post-launch |
| Maintenance | Post-launch |
| Home Inventory | Post-launch |
| Customer Decision | Informal now; formal post-launch specialized design |
| Labor/Time | Future specialized module |
| Safety | Future specialized module |

No D.4 capability is a hard launch prerequisite for the already-approved Capture
foundation. Do not delay launch merely to complete the full candidate list.

## 32. Minimum scope before Phase E

Before conversational orchestration can safely advertise expanded Capture, implement:

1. D.4.1 deterministic profiles and multi-proposal review for punch/site condition.
2. D.4.2 deterministic Change Request schema and adapter to an Amendment Request draft.
3. A server capability registry that returns allowed profiles by actor, context, feature
   flag, and available destination.
4. A rule that Phase E can select only a registered profile and must show the selected
   context/destination for confirmation.

Phase E can proceed without material, delivery, inspection, safety, or labor support. It
must say a capability is unavailable rather than routing into a generic note as if the
business action occurred.

## 33. Test strategy

**Backend:** schema/version validation; processing fallbacks; contractor, actor, project,
assignment, tenancy, and customer scoping; artifact ownership; duplicate suggestions;
review/version conflicts; per-child approval; adapter preview; application receipt;
idempotent retry; atomic aggregate rollback; explicit partial apply; portal visibility;
notification recipient/dedupe/on-commit behavior; feature capabilities; no unrelated
business mutation.

**Frontend:** launcher and contextual visibility by flag/role; More drawer; responsive
typed/voice/artifact forms; needs-information recovery; review of extracted evidence;
multi-record selection and apply-all safeguards; duplicate resolution; partial failure
and retry; publication controls; accessibility names, focus, keyboard behavior, status,
and error announcements.

**Workflow:** Capture → process → review → approve → preview → confirm → apply → receipt →
destination. Assert no agreement, amount, milestone, payment, date, work approval,
customer publication, assignment, purchase, payroll, or safety determination changes
without its owning workflow.

**Regression:** existing Capture foundation/review/application, QR, Project Capture,
warranty, equipment, measurement, Takeoff, estimate preview, customer portal, team,
schedule, property management, disputes, expenses, amendments, notifications, and mobile
operation. Production validation remains non-destructive and authenticated only with an
approved session.

## 34. Security/privacy findings

- Private-by-default is mandatory for customer interiors, plans, receipts, serial numbers,
  tenant data, labor, safety, subcontractor compliance, and internal decisions.
- Strip GPS/EXIF unless explicitly required and consented; never use location as proof of
  attendance by implication.
- Validate ownership before artifact read, duplicate search, AI processing, notification,
  or destination preview. Cross-contractor matches are prohibited.
- Apply file type/size validation, malware scanning/quarantine policy, signed/private
  storage access, rate limits, and token expiry for any external intake.
- Minimize provider payloads; use redaction where feasible; keep raw artifacts, prompts,
  transcripts, health/injury facts, serials, and tenant details out of general logs and
  telemetry.
- Preserve immutable approvals, application receipts, and source provenance. Define
  retention and legally appropriate secure deletion separately from archive semantics.
- Notification copy and links must not leak project, customer, labor, safety, or property
  data to unauthorized recipients.
- Safety/injury and labor data require specialized access and retention reviews before
  implementation. This audit makes no legal, payroll, OSHA, code, or compliance claim.

## 35. Exact files likely to change

The following are likely implementation touchpoints; none are changed by this audit.

**Shared D.4 foundation:** `backend/projects/models_capture.py`,
`serializers/capture.py`, `services/capture_processing.py`,
`services/capture_permissions.py`, `services/capture_application.py`,
`services/capture_adapters/`, `views/capture.py`, Capture URLs, `backend/core/settings.py`,
`frontend/src/api/captures.js`, `frontend/src/lib/captureFlags.js`,
`frontend/src/components/capture/CaptureLauncher.jsx`, Capture review/inbox components,
`backend/projects/tests_capture_*.py`, and `frontend/tests/capture-*.spec.js`.

**D.4.1:** `backend/projects/models_project_capture.py`, Project Issue adapter, Project
Capture processing/serializer tests, Project Detail and Milestone contextual UI.

**D.4.2:** `backend/projects/models_amendment_request.py`,
`serializers_amendment_request.py`, `views/amendment_requests.py`,
`services/amendments.py`, a change-request Capture adapter, amendment/portal tests, and
contractor/customer amendment UI.

**D.4.3:** subcontractor work views/services, assignment models/services, customer portal
views/serializers, milestone evidence UI, and authorization tests.

**D.4.4:** new bounded material-request/delivery model, migration, serializers, services,
views, routes, tests, and pages; optional read-only linkage to `models_takeoff.py`.

**D.4.5:** new inspection model, migration, serializers, service, API, tests, and
inspection workspace; Project Issue adapter linkage.

**D.4.6:** `models_capture_warranty.py`, equipment adapters,
`models_customer_portal.py`, `models_maintenance.py`, maintenance/customer portal services,
serializers, views, tests, and Property/Equipment UI.

Notification changes should extend `models.py`/`models_customer_portal.py`,
`services/notification_center.py`, and domain notification services only when a stage
defines its events and recipients.

## 36. Open decisions with direct recommendations

| Decision | Recommendation |
|---|---|
| First D.4 implementation stage | D.4.1 Project Field Findings |
| Global shortcuts | Add none; retain generic Issue and use contextual actions/More drawer |
| Punch record shape | Specialized Project Issue |
| Generic Inspection model | Yes, before Inspection Capture; Inspection + observations |
| Change Request prelaunch | Yes, as a strong enhancement, not a launch blocker |
| Material Request / Takeoff | Optional reference plus immutable snapshot, never mandatory |
| Delivery vs financial Receipt | Distinct domains and records |
| Customer upload authentication | Require portal authentication; public only as a separately audited token flow |
| Subcontractor Capture | Existing types with assignment-scoped permissions |
| Safety | Defer to specialized module |
| Labor | Defer to specialized workforce/time module |
| Home Inventory | Equipment profile |
| Maintenance | Route by authenticated actor and property/project context |
| Minimum before Phase E | D.4.1 + deterministic Change Request adapter/capability registry |
| Site Condition | Issue profile with independent optional change/update proposals |
| Customer approval | Informal Communication, operational owning workflow, contractual Amendment/signature |

## 37. Risks and mitigations

| Risk | Mitigation |
|---|---|
| Launcher overload | Contextual actions and grouped More drawer |
| Duplicate domain records | Destination-first audit and profile reuse |
| AI creates authoritative facts | Untrusted structured draft + deterministic validation + human apply |
| Multi-record surprise | Visible child proposals, independent approval, explicit apply-all |
| Contract mutation from a request | Amendment Request draft only; owning workflow controls effect |
| Customer/internal data leakage | Private defaults, server object permissions, explicit publication |
| Actor privilege expansion | Capability registry and assignment/tenancy/customer object scoping |
| Notification spam/leakage | Destination-owned on-commit events, preferences, dedupe, sanitized copy |
| Material/receipt ambiguity | Separate Material Request, Delivery, and Expense semantics |
| Inspection treated as certification | Observational language and no compliance determination |
| Safety/labor liability | Separate modules and specialist policy review |
| Phase E routes to nowhere | Registered deterministic profiles only; honest unavailable state |
| Applied history changes on reprocess | Versioned proposals and immutable receipts |

## 38. Recommended next implementation prompt

> Implement Phase D.4.1 — Project Field Findings as the smallest coherent expansion of
> the approved Capture architecture. Read `AGENTS.md`,
> `MYHOMEBRO_ENGINEERING_PRINCIPLES.md`, all Capture architecture documents, and
> `CAPTURE_PHASE_D4_REMAINING_EXPANDED_CAPTURE_AUDIT.md` first.
>
> Keep `issue` as the Capture type. Add contractor-friendly Punch Item and Site Condition
> profiles that apply only to the existing Project Issue domain. Add an explicit
> `site_condition` classification if repository validation confirms it is absent. Support
> one parent Capture proposing multiple independently reviewable Project Issues with
> stable child keys, per-child duplicate decisions, explicit approve/apply selection,
> idempotent receipts, and atomic creation per selected Issue. Preserve existing
> single-record behavior and adapter contracts.
>
> Add contextual entry points on authorized Project Detail and Milestone surfaces; do not
> add a global launcher shortcut. Owners/supervisors may review and apply. Assigned
> employees may create within existing project/milestone scope but may not apply. Keep all
> issues and artifacts private by default. Do not assign work, set schedule commitments,
> notify customers, publish to the portal, create amendments, determine safety/code/legal
> conclusions, or mutate agreements, milestones, payments, disputes, warranty decisions,
> or completion state.
>
> Gate the feature independently on backend and frontend, default false. Add focused
> backend and Playwright tests for scoping, artifacts, processing validation,
> needs-information, multi-proposal review, duplicate handling, partial selection,
> idempotency, rollback, receipts, responsive UX, accessibility, and unchanged existing
> Capture workflows. Report migrations, files, commands, PASS/FAIL/BLOCKED/NEEDS
> REFINEMENT, and production-validation constraints.

## 39. Change confirmation

This audit adds only
`docs/architecture/CAPTURE_PHASE_D4_REMAINING_EXPANDED_CAPTURE_AUDIT.md`.
No executable code, migration, dependency, Capture type, model, API, route, feature flag,
permission, portal behavior, Project Assistant prompt, notification, test fixture, or
business workflow was changed.
