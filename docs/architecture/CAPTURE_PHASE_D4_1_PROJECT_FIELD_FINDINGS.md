# Capture Phase D.4.1 — Project Field Findings

## Product purpose

Project Field Findings turns a field walkthrough into independently reviewable Project
Issues without creating a second Issue system. It supports two contractor-friendly
profiles: Punch Item and Site Condition.

## Architecture

The workflow is:

`Issue Capture → Project Assistant/deterministic processing → field-findings.v1 draft →
human child decisions → selected child application → existing ProjectCaptureIssue →
immutable application receipt`.

It reuses Capture lifecycle state, artifacts, project permissions, approved snapshots,
events, idempotency, application records, and Project Issues. It does not create
assignments, activities, amendments, notifications, or portal publications.

## Profiles and relationship to Issue Capture

- `punch_item` maps to the existing `punch_item` Issue classification.
- `site_condition` maps to the new bounded `site_condition` Issue classification.
- The underlying Capture type remains `issue`.
- A regular Issue retains its existing `issue.v1` schema and application bundle.
- Field Findings is enabled only when its independent server flag is true.

The UI uses observational language. Site Condition is not a mold, structural, code,
safety, fault, responsibility, or warranty determination.

## Multi-finding model

One Capture may own up to 25 proposed findings. Each has a stable `child_key`, profile,
classification, title, description, location/area, observed time, trade, suggested
severity/blocking state/responsible party/due date, artifact IDs, confidence, warnings,
source evidence, missing fields, duplicates, review status, and application status.

`ProjectCaptureIssue.origin_capture` is a foreign key and
`(origin_capture, child_key)` is unique. Legacy single-Issue application uses
`child_key=legacy`. Suggestions never create assignments or schedule commitments.

## Processing schema

`field-findings.v1` is bounded to Punch Item and Site Condition. The server rejects
unknown root/child fields, duplicate or missing child keys, more than 25 findings,
unsupported classification/severity/decision values, mismatched project/milestone
context, and artifacts outside the parent Capture. Deterministic fallback treats each
non-empty input line as one observation. A provider response remains untrusted and passes
the same validation.

## Review behavior

Each finding is edited and marked pending, approved, excluded, or rejected. Approval of
the parent requires:

- no missing required data;
- no pending child;
- at least one approved child;
- no unresolved duplicate on an approved child.

Approve-all is available only when all children are valid and have no duplicate
suggestions. Rejected/excluded children remain in the approved snapshot for history.

## Application behavior

Only explicitly selected approved child keys are previewed and applied. Each Issue
creation/link runs in its own transaction. Successful earlier children remain recorded
if another child fails; failures are visible and retryable with a new idempotency key.
The receipt lists selected keys, created/linked records, failures, actor, versions, and
time. Unique Capture/child keys and request idempotency prevent duplicate creation.

The legacy application path is unchanged. Field Findings creates no Project Activity
because that would introduce an unreviewed extra record and the existing activity origin
is intentionally one-to-one.

## Duplicate handling

The schema supports per-child duplicate candidates and an explicit decision:
`link_existing`, `create_separate`, or `not_same`. Link targets are revalidated against
the same contractor and project during application. No Issue is silently merged.
Deterministic candidate generation compares similar open Issues within the same
contractor/project/classification and records the evidence as advisory or strong.

## Permissions

Owners and supervisors may create, review, approve, apply, archive, and resolve
duplicates in their contractor scope. Assigned employees may create within their
existing project/milestone scope and manage their early drafts; they cannot apply.
Office staff follow existing subaccount roles. Subcontractors, customers, tenants, and
public users are excluded.

## Visibility and notifications

Captures, artifacts, proposals, and Issues are private by default. D.4.1 has no customer
publication control and sends no customer or external notification during save,
processing, review, approval, or application. There is no new notification event; the
current Project Issue adapter has no external side effect.

## Audit

Existing Capture events record creation, processing, review decisions, approval,
application, retry, and archive. Field application events include the child key,
destination, adapter version, result, counts, and failure state without artifact content.
Approved snapshots and application receipts preserve actor and Capture version.

## Feature flags and capability response

- Backend: `CAPTURE_FIELD_FINDINGS_ENABLED=false`
- Frontend: `VITE_CAPTURE_FIELD_FINDINGS_ENABLED=false`

The frontend flag controls contextual discoverability. Server creation, processing, and
validation fail closed. Project-options returns server-resolved enablement, profiles,
actor capability, and project/milestone context availability for future Phase E reuse.

## APIs

Existing Capture endpoints are reused. Create sends `capture_type=issue` and a
`capture_profile`. Review edits the bounded structured draft. Existing approve, preview,
apply, receipt, artifact, and timeline endpoints are used. Preview/apply accept
`selected_child_keys`; no second API family was added.

## Responsive behavior and accessibility

Review uses stacked cards instead of a desktop table. Controls have explicit labels,
semantic finding headings, keyboard-operable selects/checkboxes, visible focus inherited
from shared primitives, non-color status/warning text, live review updates, and touch-sized
actions. Project and Milestone actions open the existing mobile Capture modal with
preselected context.

## Tests

Focused backend coverage includes disabled gating, legacy Issue compatibility, both
profiles, multi-finding processing, schema bounds, forged artifact denial, child review,
partial selection, receipt/idempotency behavior, assignment-scoped employee creation,
employee apply denial, and unchanged milestone state. Frontend coverage should continue
to verify contextual flag visibility, absence of global shortcuts, stacked cards,
selection, partial result messaging, keyboard behavior, and 320/375px layouts.

## Known limitations

- Deterministic splitting is line-based; richer provider extraction depends on configured
  Project Assistant processing.
- Duplicate comparison is text-based in this slice; artifact-checksum, time-window,
  room-specific, trade, and milestone weighting remain future refinements.
- Suggested responsible party, due date, trade, and milestone are review-only fields and
  are not written to the destination Issue.
- Field Findings does not create a Project Activity.
- Production validation requires a deployed flag and approved authenticated session.

## Deferred capabilities

Change Requests, customer/subcontractor intake, Inspection, Safety, Labor/Time, material
requests, delivery, maintenance, and formal customer decisions remain outside D.4.1.

## Rollback strategy

Disable both flags to hide contextual entry points and fail closed for new Field Findings.
Existing regular Issue Capture continues. Applied Issues and immutable receipts remain
auditable. If code rollback is required, keep migration 0271 applied because reverting the
foreign key would be destructive when one Capture owns multiple Issues; forward-fix the
application instead.
