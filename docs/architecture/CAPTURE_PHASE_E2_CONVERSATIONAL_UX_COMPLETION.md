# Capture Phase E.2 — Conversational UX Completion

## Purpose

Phase E.2 completes the contractor-side usability layer over the E.1 routing foundation. It remains a bounded Project Assistant workflow, not an open-ended chat and not a destination-domain engine.

The flow is:

1. Compose private source text and select local artifacts.
2. Route against the server-authorized profile registry.
3. Answer at most the existing bounded number of follow-up rounds.
4. Search and explicitly select authorized context where required.
5. Select or override an available profile.
6. Review source text, context, artifacts, destination, next step, and non-effects.
7. Explicitly confirm ordinary Capture creation or open an existing structured form.
8. Continue through existing Capture review, approved snapshot, adapter, application, and receipt boundaries.

## Repository audit and reused boundaries

E.1 already provided the `capture-profiles.v1` registry, `CaptureRoutingAttempt`, deterministic classification, optional constrained provider, versioned follow-up endpoint, confirmation endpoint, existing serializer-based Capture creation, and structured-form handoff.

The main E.2 gaps were:

- Follow-up question objects lacked the metadata needed for reliable rendering.
- The backend follow-up flow was not surfaced in the first UI.
- No dedicated permission-scoped context search API existed.
- Profile explanations were split between registry and routing responses.
- The client had no explicit state transition contract or final review step.
- Structured handoffs did not link the resulting Capture back to the routing attempt.
- Attachments were summarized only as a count.
- Voice capability and permission failure were not clearly distinguished.
- No stable local routing-quality corpus or evaluation command existed.

Existing explicit forms, upload validation, project permissions, review/application lifecycle, Field Findings, Change Intake, Measurement, Equipment, Warranty, and Capture events remain authoritative.

## State machine

The frontend state contract is implemented in `conversationalCaptureState.js`. It permits only bounded transitions among composing, routing, suggestion, needs-information, context selection, confirmation, creation/handoff, unsupported, and recoverable failure states.

Request sequencing rejects late initial-routing responses. Buttons disable during active mutations. Text, local files, answers, selected profile, and selected context remain in component state after recoverable errors. Confirmation remains idempotent on the server.

## Follow-up questions

Routing questions now include:

- stable key and type;
- user-facing prompt and help text;
- required state;
- allowed values;
- context type;
- maximum length and validation metadata;
- sensitive-data indicator.

The first E.2 renderer supports long text, profile selection, and permission-scoped project/agreement/milestone selection. The server validator retains a bounded answer allowlist, value sizes, question count, version check, and maximum follow-up rounds. Previously answered questions remain in the attempt history.

## Context search and selection

`GET /api/projects/captures/conversational/contexts/` accepts:

- `context_type`: `project`, `agreement`, or `milestone`;
- optional `q`, with a two-character minimum and 100-character maximum;
- optional `project_id` for agreement and milestone filtering.

Results are capped at ten and are derived from `visible_project_capture_projects`. Agreement and milestone queries additionally enforce the resolved contractor and visible-project set. Responses include safe labels, status/record identifiers, and project association only. They exclude agreement totals, pricing, full agreement content, private serials, and raw addresses.

The client debounces typed searches, exposes loading/empty/error states, never silently chooses the first result, and clears agreement/milestone IDs when the selected project changes.

Only context types needed by current registered profiles are exposed. Customer, opportunity, equipment, warranty, and measurement-session search are not added because no E.1 registered profile currently requires those types as its routing context.

## Profile presentation and manual choice

Registry metadata now includes:

- group;
- what happens next;
- consequence boundary;
- whether an explicit structured form is required.

Routing candidates reuse this authoritative metadata. The grouped manual chooser is populated only from the server registry for the current context. Internal adapter names and disabled/deferred profiles are not offered.

## Direct confirmation and structured handoff

Direct Capture confirmation shows the selected workflow, destination, source text, context, local artifact count, next step, privacy state, and consequence boundary before the existing confirmation API is called.

Structured handoffs preserve:

- raw source text;
- authorized project, agreement, and milestone IDs;
- extracted dimensions;
- bounded artifact metadata;
- local File objects in the current launcher session;
- routing-attempt identifier.

Quick Lead receives the source description. Manual Measurement receives extracted dimensions, source evidence, and files. Existing Project Capture forms receive source text and files. All suggested values remain editable.

After an existing structured form creates a Capture, the launcher calls the scoped completion endpoint to link that Capture to the handed-off routing attempt. The endpoint accepts only a Capture owned by the same contractor and created by the same actor. It does not apply the Capture or create another business record.

## Provider and injection boundary

`CAPTURE_CONVERSATIONAL_PROVIDER_ENABLED` independently controls provider use and defaults off. Deterministic routing and manual selection remain available when it is off.

The provider receives:

- bounded source text;
- the server-authorized profile-key allowlist;
- boolean context-presence signals;
- bounded artifact MIME types;
- an explicit policy forbidding tools, actions, policy changes, registry changes, and confirmation bypass.

It does not receive project, agreement, or milestone IDs, pricing, agreement text, customer records, file bodies, serial numbers, or storage locations. Provider output is untrusted, bounded, and rejected unless it names an available registry profile. Rejection, absence, or failure uses deterministic routing without exposing raw provider errors.

A production provider, timeout wrapper, and production model/version are not configured in this repository. Production-provider validation remains blocked.

## Voice and artifacts

Browser speech recognition is optional and capability detected. The microphone is user-started, non-continuous, stopped or cancelled on exit, and never submits automatically. The transcript remains editable. Unsupported browsers and denied permissions retain typed intake.

Before routing, artifacts remain local and private. The UI shows filename, size, pending state, and removal controls. Routing sends bounded metadata only. Actual upload occurs once during confirmation or an existing structured form and continues through existing MIME, signature, size, ownership, and hashing validation.

## Unsupported intent and recovery

Unsupported requests name the unavailable boundary, confirm that no record was created, and retain access to private Note and explicit Capture workflows. Network, stale-version, validation, provider, and context failures preserve the working draft and show curated errors.

## Evaluation

`projects.capture_routing_cases.CAPTURE_ROUTING_CASES` is a generated repository-local corpus of 120 explicit synthetic cases. It covers all registered profiles, ambiguous text, unsupported workflows, injection-shaped text, and project/agreement context expectations. It contains no real customer, address, agreement, project, or artifact data.

Run:

```bash
python manage.py evaluate_capture_routing
```

The command reports total cases, primary and acceptable matches, needs-information correctness, unsupported correctness, prohibited-profile safety, context expectation correctness, fallback usage, and deterministic latency. Provider evaluation skips cleanly when no configured provider is enabled.

## Security, customer boundary, and rollback

All APIs require authenticated contractor-side access. No public, customer, QR, or unauthenticated conversational endpoint was added. Context lookup fails closed through existing project visibility and contractor ownership. Routing never creates or applies a destination record.

Rollback is configuration-first:

1. Disable `CAPTURE_CONVERSATIONAL_PROVIDER_ENABLED` to force deterministic routing.
2. Disable `CAPTURE_CONVERSATIONAL_ENABLED` to remove conversational endpoints and UI.
3. Existing explicit forms and existing saved Captures remain usable.

No E.2 migration is required.

## Deferred

- Production provider configuration and live evaluation
- Rich extraction for lead contact fields, equipment serials, warranty dates, and Change Intake categories
- Multi-finding conversational decomposition
- Search for optional equipment/warranty/measurement-session context
- Persistent restoration after browser or modal teardown
- Deployed authenticated voice and mobile-browser validation
