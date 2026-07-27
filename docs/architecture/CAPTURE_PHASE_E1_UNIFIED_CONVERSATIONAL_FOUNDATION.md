# Capture Phase E.1 — Unified and Conversational Foundation

## Product purpose

Conversational Capture adds a Project Assistant orchestration layer over the existing Capture lifecycle. An authorized contractor describes what happened, optionally attaches private evidence, reviews a bounded workflow suggestion, and explicitly confirms either ordinary Capture creation or a handoff to an existing structured form.

It is not a business-record engine. Routing creates no customer, opportunity, issue, amendment request, measurement, warranty record, notification, application, or other destination.

## Architecture and relationship to Capture

The flow is:

1. Resolve server-authorized profiles and context.
2. Store a bounded `CaptureRoutingAttempt`.
3. Apply deterministic constraints and optional Project Assistant classification.
4. Validate every candidate against the server registry again.
5. Ask bounded follow-up questions or show an honest unsupported state.
6. Require explicit profile/context confirmation.
7. Create an ordinary `Capture` in `saved` status or hand off to an existing form.
8. Continue through existing processing, review, approved snapshot, preview, adapter, application, and receipt behavior.

The supporting routing model is not a second Capture lifecycle. It stores only the bounded exchange required before an ordinary Capture exists: text, safe artifact metadata, authorized context IDs, candidates, answers, selection, classifier/fallback provenance, audit events, version, and resulting Capture link.

## Feature flags

- `CAPTURE_PROFILE_REGISTRY_ENABLED`
- `CAPTURE_CONVERSATIONAL_ENABLED`
- `VITE_CAPTURE_CONVERSATIONAL_ENABLED`

All default off. The registry can be exposed independently for authenticated internal clients. Conversational endpoints additionally require the Capture foundation. Existing launcher forms and Capture endpoints do not depend on these flags.

## Server profile registry

`capture-profiles.v1` is the single routing inventory. Entries are immutable data definitions with profile key, existing Capture type/schema, display copy, required/optional context, feature prerequisites, existing destination, artifact/voice support, review mode, risk level, priority, handoff boundary, and explicit non-effects.

Registered profiles:

| Profile | Context | Outcome |
|---|---|---|
| Quick Lead | Global | Existing lead form handoff |
| Note | Global | Ordinary Quick Note Capture |
| Photo | Global/project optional | Private artifact Capture |
| Project Update | Project | Existing project review |
| Progress Photo | Project | Existing project review |
| Project Issue | Project | Existing project issue review |
| Punch Item | Project | Field Findings review |
| Site Condition | Project | Field Findings review |
| Communication | Project | Communication review |
| Project Document | Project | Project attachment review |
| Equipment | Project | Existing equipment form handoff |
| Warranty Document | Project | Existing warranty form handoff |
| Warranty Concern | Project | Existing concern form handoff |
| Manual Measurement | Project | Existing measurement form handoff |
| Change Request | Project + agreement | Change Intake review |

Receipt was evaluated but is not registered because the ordinary Capture creation contract currently rejects the Receipt type and the existing receipt experience is Smart Capture. PDF/photo measurement, Material Request, Delivery, Inspection, Safety, labor/time, LiDAR, Bluetooth laser, purchasing, and formal customer approval remain unsupported.

## Capability and context resolution

Profiles are filtered by backend feature flags, registered adapters, contractor identity, role, visible/assigned projects, milestone ownership, agreement/project consistency, and required context. No frontend flag grants permission.

Context candidates come only from `visible_project_capture_projects`. Current route context is preferred; an explicit project-title match may be suggested, never silently selected. Results are bounded to five and use non-enumerating errors for unauthorized IDs.

## Routing schema and strategy

Responses use `capture-routing.v1`:

- `suggested`, `needs_information`, or `unsupported`
- bounded summary and up to four registered candidates
- evidence-based `low`, `medium`, or `high` routing confidence
- authorized context candidates
- missing information and up to three bounded questions
- safe fallback profiles
- classifier and fallback state

Deterministic routing uses current context, explicit profile choice, bounded keywords, attachment MIME metadata, flags, permissions, and destination availability. An optional `CAPTURE_ROUTING_PROVIDER` may suggest only from the supplied allowlist. Unregistered, malformed, unavailable, or failing provider output is discarded and deterministic routing remains operational. Artifact content is treated as data and cannot alter policy or execute actions.

Unsupported intent is never silently converted into a note. Safety, labor/time, payroll, LiDAR, and laser requests receive an honest unavailable state.

## Ambiguity and needs information

Equal-strength candidates produce a profile-choice question. Missing text/artifact, profile, project, agreement, or milestone produces bounded questions. Answers are preserved and rerouted for at most two rounds. Optimistic versions reject stale answers or confirmation.

## Confirmation and explicit-form handoff

The confirmation surface shows the profile, description, destination, routing confidence category, evidence, context, and important non-effects. Users can override among returned candidates, edit their description, cancel, or choose an explicit form.

Quick Lead, Equipment, Warranty, and Manual Measurement return a handoff payload with profile, authorized context, original text, and bounded extracted values. Manual rectangle dimensions are prefilled in the existing measurement editor. Directly compatible profiles create an ordinary saved Capture with routing provenance; no processing or application runs automatically.

## Artifacts, security, and privacy

Routing receives only bounded filename, MIME type, and size metadata. Actual files remain in the browser until confirmation and then pass existing count, size, MIME, hashing, contractor ownership, retention, and private artifact behavior. Routing never reads another contractor’s files or records.

Provider calls receive only the submitted description, registered allowlist, authorized context IDs, and artifact MIME types. General logs and analytics contain no raw text, transcripts, images, agreement content, serials, or customer data.

Public/token actors and customer conversational workflows are excluded. Existing authenticated customer APIs do not imply an E.1 customer UI.

## Audit and analytics

Routing attempts retain bounded events for start, routing request/completion, provider failure/fallback, follow-up answers, confirmation, handoff, and Capture creation. Capture creation adds a normal append-only `CaptureEvent` and `audit_metadata` with routing attempt, orchestration/classifier versions, selected profile, and confirmation.

Privacy-safe operational fields support counts for starts, route status, fallback, candidate/confirmed profile, follow-up rounds, handoffs, cancellation when implemented, and completion. Raw content is excluded from metric metadata.

## APIs

- `GET /api/projects/captures/profiles/`
- `POST /api/projects/captures/conversational/route/`
- `POST /api/projects/captures/conversational/follow-up/`
- `POST /api/projects/captures/conversational/confirm/`
- `POST /api/projects/captures/conversational/cancel/`

All require authentication, flags, strict serializers, contractor/context resolution, bounded request sizes, and optimistic versions. Confirmation is idempotent after a Capture link exists.

## Responsive behavior and accessibility

The launcher retains all explicit actions and adds **What happened?** as a feature-flagged primary choice. Its existing mobile full-height sheet supports 320px and 375px layouts; candidate cards and actions stack on narrow screens, confirmation stays reachable, and text/files remain in local state during review.

Inputs have explicit labels, voice has a text fallback, profile choices are native radios, touch targets meet the existing control sizes, focus is visible, confidence is textual, and an `aria-live` region announces routing, fallback, selection, handoff, creation, and errors.

## Tests

Backend coverage includes disabled behavior, registry allowlisting, feature/context/employee scoping, unsupported intent, no routing-time mutation, unregistered provider rejection, deterministic fallback, needs information, stale version rejection, confirmation idempotency, ordinary Capture creation, and structured-form handoff.

Frontend unit coverage verifies the independent flag chain. The production build validates component integration. Existing Capture processing/application, Field Findings, Change Intake, Measurement, permissions, artifacts, and receipts remain regression targets.

## Known limitations and Phase E.2

- The provider integration is an injectable bounded contract; no production provider is configured by this phase.
- The first UI supports description revision and candidate override; richer context search and multi-question inline follow-up can expand in E.2.
- Voice uses the existing browser transcript service and does not upload raw audio.
- A cross-device routing resume screen is deferred.
- Receipt remains in Smart Capture until its ordinary Capture contract is production-compatible.
- Customer and public conversational routing remain excluded.

E.2 may add authorized context search, richer bounded questions, tested provider prompts/parsers, resume/cancel management, usage analytics dashboards, and further explicit-form prefills without changing destination authority.

## Rollback

Disable the frontend and backend conversational flags. Existing explicit forms and Capture processing remain unchanged. Routing attempts and created Captures retain provenance. The additive model can remain dormant or be removed only after retention review confirms no audit dependency.
