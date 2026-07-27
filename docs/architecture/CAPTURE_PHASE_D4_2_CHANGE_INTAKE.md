# Capture Phase D.4.2 — Change Intake

## Product purpose

Change Intake turns a contractor or authenticated customer description of proposed project work into a reviewable Capture. Applying an approved Capture creates only a non-binding `AmendmentRequest`; it never changes an agreement or authorizes work.

## Architecture

The implementation reuses Capture ownership, lifecycle, review, approved snapshots, duplicate review, adapters, receipts, events, artifacts, and project context. `AmendmentRequest` remains the sole destination model. The `communication` Capture type and `change_request` profile avoid a competing top-level type.

`CAPTURE_CHANGE_REQUEST_ENABLED` and `VITE_CAPTURE_CHANGE_REQUEST_ENABLED` default off and require the existing foundation, inbox, review, and application chain. The capability response advertises eligible agreements, categories, permissions, related-issue support, and the required agreement context.

## Change Intake profile and categories

Categories are add/remove scope, material substitution, design change, quantity change, changed condition, schedule impact, access/sequence, customer revision, contractor scope concern, and other. Required information is an eligible project/agreement, immutable requester identity, category, and an eight-character change description. Optional fields include title, reason, location, timing, priority, stated price/schedule expectations, related milestone/issue, and private artifacts.

The deterministic `change-intake.v1` draft stores bounded fields, source evidence, warnings, missing fields, actor identity, context IDs, artifact IDs, boundary, and proposed destination. User statements about price or timing remain assertions; they are not calculations or contract values.

## Decision boundary

An explicit proposed change routes to `amendment_request`. An informal preference is held for reviewer confirmation and may be retained as a communication record. Language that appears to approve price, payment, a contract, or authorization is classified as `formal_approval` and cannot be approved through Change Intake. Formal decisions remain in the existing amendment, signature, and approval workflows.

## Workflows

Contractors launch **Request a Change** from project context, select the agreement/category, add optional evidence, process the Capture, review every field, resolve duplicates, inspect the application preview, and explicitly confirm application.

Authenticated customers submit to `/api/projects/captures/customer-change-intake/`. Ownership is matched to the project homeowner email and cross-project agreement IDs fail closed. Customers receive a safe acknowledgement and can read a deliberately small status projection at `/api/projects/captures/customer-change-intake/{capture_id}/`; internal drafts, review notes, candidates, receipts, and private artifacts are not returned. The legacy token portal is not wired to this authenticated-only API.

## Destination, safe status, and duplicates

Adapter version `1` creates an `AmendmentRequest` in `OPEN` / `PENDING` state. Category maps conservatively to the model's existing change type. The record stores the source Capture, actor type, category, approved Capture/schema/adapter versions, and artifact links. No project activity or notification is emitted by application, avoiding false claims that an agreement changed.

Open requests on the same agreement and category are compared deterministically. Strong/advisory candidates require normal Capture duplicate review; reviewers may link the existing open request or create a separate request. A one-to-one source-Capture constraint and Capture application idempotency prevent repeated creation.

The preview explicitly states that scope, total, milestones, payment schedule, dates, signatures, invoices, and work authorization remain unchanged. A related Site Condition or Project Issue is linked by ID only and is never mutated.

## Attachments, permissions, audit, and security

Uploads use existing count, type, size, hash, ownership, visibility, and retention behavior. The destination references active Capture artifacts rather than publishing or copying them. Contractor owners/supervisors may review/apply; ordinary employee permissions remain governed by existing Capture policy. Customer submission requires Django authentication and matching project ownership. IDs are re-resolved server-side within the project and contractor boundary.

Capture events record submission, processing, review, approval, and application. Approved snapshots and application receipts preserve what was reviewed, adapter version, actor, created/linked record, and warnings.

## Responsive behavior and accessibility

The contextual launcher uses the existing responsive sheet/dialog and stacked form controls, with labels, native selects, file input, keyboard focus behavior, and a visible non-binding disclaimer. The review workspace uses the existing mobile stacking and accessible form primitives. No horizontal-only decision control is introduced.

## APIs

- `GET /api/projects/captures/project-options/`
- `POST /api/projects/captures/`
- Existing Capture process/review/approve/preview/apply endpoints
- `POST /api/projects/captures/customer-change-intake/`
- `GET /api/projects/captures/customer-change-intake/{capture_id}/`

## Tests

Focused backend coverage verifies flags, context isolation, contractor lifecycle, customer authentication/scoping, safe status, formal-boundary blocking, provenance, and unchanged agreement/milestone/amendment/invoice state. Frontend flag tests cover the full dependency chain. Existing Capture, field-finding, amendment, portal, and build suites provide regression coverage.

## Known limitations and deferred capabilities

The customer UI awaits an authenticated customer workspace integration; the public token portal remains on its existing endpoint. Change Intake does not estimate price, calculate quantities, schedule work, request signatures, create invoices, issue notifications, or represent acceptance. Formal decision capture, negotiated revisions, signatures, pricing, scheduling, and authorization remain deferred to their existing domain workflows.

## Rollback strategy

Disable both feature flags to remove entry points and fail new requests closed. Existing Captures and AmendmentRequests retain audit provenance. The additive nullable fields and join table do not alter legacy rows; migration rollback is possible after confirming no retained provenance depends on them.
