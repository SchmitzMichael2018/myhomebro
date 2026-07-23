# MyHomeBro Engineering Principles

This document is the canonical engineering, product, UX, design, AI, security, testing, and release constitution for MyHomeBro. It defines durable decision principles rather than current implementation details.

All contributors and coding agents should follow these principles unless a task explicitly overrides one. When a specialized architecture document conflicts with this constitution, resolve the conflict explicitly rather than silently choosing one.

## Product Philosophy

- Build for contractors managing real customers, commitments, work, documents, and money.
- Make the next safe action obvious. Reduce administrative effort without hiding consequential decisions.
- Preserve trust through clear ownership, explicit state, traceable history, and predictable outcomes.
- Treat agreements, amendments, signatures, milestones, invoices, payments, disputes, and generated documents as connected lifecycle records.
- Prefer an understandable, dependable workflow over novelty or unnecessary abstraction.
- Use contractor-friendly language. Product copy should describe the user's work, not the software's internals.
- Protect completed, signed, paid, archived, or audited records from accidental reinterpretation or overwrite.

## UX Principles

- Favor clarity, predictability, accessible controls, consistent navigation, and one primary action per decision point.
- Keep primary actions visually and semantically distinct from secondary, destructive, and advisory actions.
- Avoid duplicate actions, competing assistant identities, developer terminology, and unnecessary complexity.
- Give users enough context to understand what will happen before they commit.
- Preserve user input across validation errors and recoverable failures.
- Make loading, empty, success, unavailable, and error states intentional and useful.
- Keep responsive behavior task-oriented. Mobile interfaces may reflow or simplify presentation, but must preserve capability, context, and safe decision-making.
- Use concise copy, progressive disclosure, and meaningful defaults instead of dense instruction blocks.
- Never use visual polish to obscure risk, cost, permissions, or irreversible consequences.

## Design System Principles

- Standardize component behavior and structure before attempting broad visual restyling.
- Shared standards apply to buttons, cards, forms, tables, dialogs, navigation, loading states, empty states, status badges, spacing, typography, Project Assistant interactions, and AI review/apply flows.
- Equivalent components should share interaction states, keyboard behavior, accessible names, focus treatment, density, and semantic hierarchy.
- Use shared tokens for spacing, typography, color, borders, radius, elevation, motion, and responsive behavior where practical.
- Color communicates hierarchy and state; it is not a substitute for labels, icons, or accessible text.
- Do not pursue cross-workspace color uniformity as a design-system objective.
- New components should earn their existence through a distinct reusable behavior, not minor visual variation.

## Operational Theme Principles

- Operational workspaces intentionally use a dark, business-oriented interface. This is a product decision, not technical debt.
- Do not recommend converting operational workspaces to the Marketing appearance.
- UX reviews of operational pages should focus on component consistency, interaction consistency, spacing, typography, accessibility, Project Assistant consistency, AI consistency, workflow consistency, and shared components.
- Color-palette discussions are out of scope unless implementing a true Appearance system.
- A future Appearance system should support Follow System, Light, and Dark modes through shared semantic design tokens.
- Until such a system exists, preserve the intentional dark operational presentation.

## Marketing Principles

- Marketing intentionally uses a lighter presentation because it represents public-facing branding and website creation.
- Marketing is the UX benchmark for hierarchy, workflow clarity, accessibility, component quality, and Project Assistant integration, but not necessarily for color palette.
- Marketing workflows should help contractors publish credible, accurate representations of their businesses without requiring design or marketing expertise.
- Preview, review, and publication states must be clearly distinguished.
- Generated or imported public content remains reviewable and under contractor control.
- Public-facing claims, reviews, portfolio work, contact information, and visibility settings must respect consent, ownership, and privacy.

## Project Assistant Principles

- Project Assistant is the only AI product identity in MyHomeBro. Do not introduce additional assistant brands.
- Quick Capture and Smart Capture are tools used by Project Assistant; they are not separate assistants.
- Project Assistant should be workspace-aware, context-aware, entity-aware, safe, reviewable, and deterministic where appropriate.
- It should inherit only context the current user is authorized to access and make the inherited context understandable.
- Project Assistant may explain, organize, draft, compare, summarize, and prepare actions. It must not impersonate the user's judgment or authority.
- Assistance should occur in the correct workspace whenever possible. Cross-workspace guidance should route users to the owning workflow rather than duplicate it.
- Recommendations must communicate their basis, limitations, confidence where useful, and required human decision.
- Project Assistant must not sign, fund, release payment, refund, publish, resolve disputes, assign work, schedule commitments, or send external messages without the workflow's explicit authorization and confirmation.

## AI Principles

- Use AI where interpretation, drafting, summarization, or contextual guidance adds real value. Use deterministic logic where rules are sufficient.
- AI-generated mutations follow one lifecycle: **Prepare → Preview → Validate → Confirm → Apply → Receipt**.
- Generated content should not auto-save, auto-send, auto-publish, or otherwise become authoritative unless the workflow explicitly and safely defines that behavior.
- Users must be able to review, edit, reject, regenerate, or override advisory output.
- Validate AI output against product rules, permissions, data constraints, and prohibited actions before application.
- Separate provider output from trusted application state. Provider responses are untrusted input.
- Do not present AI as a legal, financial, safety, payment, or dispute decision-maker.
- Degrade gracefully when AI is slow, unavailable, malformed, or unconfigured. Core deterministic workflows should remain usable where possible.
- Do not expose provider names, raw provider errors, prompts, secrets, or internal model mechanics to end users unless explicitly useful and safe.
- Preserve provenance and receipts for consequential AI-assisted changes.
- Consult [MyHomeBro AI Architecture](../MYHOMEBRO_AI_ARCHITECTURE.md) for specialized AI architecture guidance that remains consistent with this constitution.

## Security Principles

- Enforce authentication, role authorization, and object-level ownership on the server for every protected operation.
- Validate ownership before retrieving or processing sensitive objects, building derived context, reading caches, or invoking providers.
- Apply least privilege to users, services, integrations, credentials, queries, and background work.
- Prefer non-enumerating responses for unauthorized object access where appropriate.
- Treat client state, identifiers, uploaded files, webhook payloads, provider output, and external callbacks as untrusted.
- Make consequential mutations idempotent or otherwise safely repeatable.
- Maintain auditability: record who acted, what changed, when it changed, and the relevant source or approval.
- Protect secrets and sensitive customer, financial, agreement, dispute, and identity data in storage, transit, logs, errors, exports, and support tooling.
- Never expose raw provider errors, credentials, internal traces, or sensitive payloads to users.
- Preserve signed and archived artifacts, amendment history, document versions, and financial traceability.
- Fail closed when authorization or ownership cannot be established.

## Shared Component Principles

- Prefer shared components for behavior that is genuinely equivalent across workspaces.
- Keep domain-specific policy in its owning domain; do not hide business rules inside generic UI components.
- Shared components must support accessibility, predictable state, responsive behavior, and testability by default.
- Extend an established component when the behavior is the same. Create a new component when semantics or workflow meaning differ.
- Avoid broad shared-component changes without checking every known consumer.
- Preserve clear component contracts and minimize implicit global behavior.
- Shared page surfaces and layout shells should not be modified as a side effect of a feature-specific task.

## Development Standards

- Read the relevant code, data model, routes, permissions, tests, and existing guidance before changing behavior.
- Make the smallest coherent change that fully solves the problem.
- Follow established Django, React, API, state-management, and styling patterns unless there is a documented reason to change them.
- Keep domain boundaries explicit. Business rules belong on the server and must not rely solely on client enforcement.
- Preserve API compatibility unless a deliberate migration is part of the task.
- Avoid unrelated refactors, speculative abstractions, duplicate sources of truth, and silent behavior changes.
- Design mutations for validation, authorization, idempotency, traceability, and recovery.
- Use clear names based on product concepts rather than temporary implementation mechanics.
- Document durable architectural decisions; avoid documentation that merely repeats code.
- Treat warnings, partial failures, stale tests, and unexpected states as evidence to investigate, not noise to bypass.

## Testing Standards

- Test meaningful user and domain workflows, especially authorization boundaries and consequential state transitions.
- Validate behavior rather than implementation details.
- Prefer stable `data-testid` selectors for key workflow interactions and accessible roles or names when they form a stable product contract.
- Avoid brittle text selectors, arbitrary sleeps, incidental DOM structure, and excessive mocking of the behavior under test.
- Include positive, negative, ownership, permission, validation, error, retry, and idempotency cases in proportion to risk.
- Use unit tests for deterministic logic, integration tests for API and persistence boundaries, and Playwright for critical UI workflows.
- Test loading, empty, success, failure, disabled, and unavailable states when they affect usability or safety.
- Keep fixtures stable, representative, privacy-safe, and explicit about generated or mocked data.
- Run targeted tests during development and the broader relevant regression suite before release.
- A stale test should be updated only after verifying the current product contract; do not weaken assertions merely to make a suite pass.

## Review Standards

- Review changes for product intent, workflow ownership, security boundaries, accessibility, failure behavior, and regression risk—not only code style.
- Verify that the implementation has one clear source of truth and does not create a competing route, component, assistant identity, or business rule.
- Inspect all consumers when changing shared components or shared services.
- Require explicit reasoning for changes involving payments, signatures, documents, disputes, permissions, publication, notifications, or AI-assisted mutations.
- Confirm that copy is contractor-friendly and that actions accurately describe their effects.
- Review evidence from tests, visual validation, and production preflight in proportion to risk.

## Release Standards

- Release the smallest safe, reviewable unit with a documented validation result and rollback approach.
- Major features should receive an architecture audit, desktop UX audit, AI audit where applicable, mobile audit, and production preflight before production release.
- Critical flows require regression validation: authentication, agreements, templates, signatures, milestones, invoices, payments, disputes, refunds, and PDF generation/versioning.
- Schema, API, configuration, integration, and background-job changes require compatibility and deployment-order review.
- Never use real financial or customer-impacting actions as casual production verification.
- Do not claim readiness when required authentication, configuration, credentials, migrations, monitoring, or external dependencies remain unverified.
- Record known limitations and distinguish PASS, FAIL, BLOCKED, and NEEDS REFINEMENT outcomes.

## Production Preflight

Before a production release, verify the applicable items below.

### Security

- Authentication, roles, object ownership, least privilege, CSRF/CORS, secure cookies, secrets, file handling, rate limits, and sensitive-data exposure have been reviewed.
- Unauthorized cross-account and cross-role access is covered by tests.
- Logs and user-facing errors do not expose secrets, provider payloads, or private records.

### Payments

- Environment and account modes are correct; webhook signatures, idempotency, retries, reconciliation, amounts, currency, fees, refunds, releases, and payout states are verified.
- No test-mode assumptions or unsafe manual actions can affect live money.

### Notifications

- Recipients, consent, templates, links, deduplication, retries, failure handling, and environment routing are verified.
- Test or staging notifications cannot reach unintended production recipients.

### Project Assistant and AI

- Identity and terminology are consistent with Project Assistant.
- Context and object ownership are enforced before retrieval or provider invocation.
- Prepare, Preview, Validate, Confirm, Apply, and Receipt behavior is present where mutations occur.
- Provider availability, timeout, malformed output, unavailable state, safety boundaries, and deterministic fallback behavior are verified.
- No generated content becomes authoritative without the workflow's intended human control.

### Performance

- Critical pages, APIs, queries, background tasks, bundles, files, and third-party calls meet acceptable latency and resource expectations.
- High-volume queries avoid obvious N+1 behavior and unbounded reads.

### Monitoring and Logging

- Health checks, structured logs, error reporting, alert ownership, job visibility, webhook visibility, and meaningful operational signals are active.
- Logging is sufficient for diagnosis without exposing sensitive content.

### Integrations

- Credentials, scopes, callback URLs, webhooks, API versions, sandbox/live modes, retries, failure handling, and ownership are verified for every affected integration.

### Backups and Recovery

- Database and file backups are current, restorable, retained appropriately, and protected.
- Migration rollback or forward-recovery steps are understood.
- Critical documents and audit records are included in recovery planning.

### Production Configuration

- Debug settings, allowed hosts, origins, domains, email/SMS senders, storage, queues, scheduled jobs, feature flags, secrets, encryption, and environment variables are correct.
- Required migrations and static assets are ready and compatible with the deployment order.

### Deployment

- The release artifact and commit are identified; required approvals and maintenance considerations are complete.
- Deployment, migration, smoke-test, rollback, and owner communication steps are documented.
- Post-deployment checks cover authentication, critical workflows, errors, jobs, integrations, and monitoring without destructive production actions.

## Recommended Prompt Preamble

> Follow the engineering principles defined in `MYHOMEBRO_ENGINEERING_PRINCIPLES.md` unless this task explicitly overrides a principle.
