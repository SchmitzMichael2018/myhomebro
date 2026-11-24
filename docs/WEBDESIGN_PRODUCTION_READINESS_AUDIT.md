# Web design production-readiness audit

Audit date: 2026-11-22  
GitHub baseline: `origin/main` at `a8a8dbbe`  
Production URL: `https://www.myhomebro.com/webdesign`

## Production comparison

Production returned HTTP 200 from PythonAnywhere with the expected web-design SEO title, description, canonical URL, and current frontend bundle. All six deployed template demo URLs returned HTTP 200. The website-service API correctly returned HTTP 401 without authentication. Browser checks were unauthenticated and non-destructive; no forms were submitted and no production records or payments were created.

The production site reflects the gallery/dashboard implementation currently on GitHub main, but the changes on `codex/webdesign-production-readiness` are not deployed. An authenticated production dashboard review is blocked until an approved test session is supplied. Deployment must not be inferred from a GitHub commit.

## Implementation status before this branch

### Fully implemented

- Public `/webdesign` landing page with contractor/restaurant filtering and a three-step, contact-last inquiry.
- Six deployed, noindex template demos with working navigation and safe demo forms.
- Authenticated customer workspace preserving website project records.
- Website brief creation/editing, template selection, private JPG/PNG/WebP/PDF upload/download, project status, preview/live links, and change requests.
- Server-side owner isolation for project reads, edits, uploads, downloads, submissions, and requests.
- Staff management through Django admin.
- Portable static export for all six templates, overwrite/traversal protection, customer configuration, no automatic publishing, and restaurant menu-feed support.
- Visually distinct showcase, local-service, and premium contractor layout variants; all demo claims and imagery are labeled illustrative.

### Partially implemented

- Account access: existing login and universal registration existed, but the website workspace did not offer a direct create-account path.
- Project review: preview links and requests existed, but there was no explicit final customer approval record.
- Administration: staff could update projects and requests, but no proposal/payment fields or notification audit existed.
- Contractor templates: layouts are meaningfully different and responsive, but specialized roofing, mechanical trades, landscaping, and custom-home content variants remain future work. Maps, verified credentials, testimonials, and before/after modules must be populated only from customer-supplied evidence.

### Missing or launch-blocking before this branch

- Written price, deliverables, service terms, and refund terms in the customer workspace.
- Website-service checkout isolated from contractor/homeowner milestone payments.
- Stripe webhook reconciliation and duplicate-payment protection for website orders.
- Notifications for submissions, uploads, requests, proposals, payment, previews, responses, and final approval.
- Final approval that is distinct from publication.
- Regression coverage for those payment/approval/notification boundaries.

## P0 improvements on this branch

- Added staff-authored proposal fields and customer-visible price, deliverables, service terms, and refund terms.
- Checkout remains disabled until the proposal is complete and the customer explicitly accepts all displayed terms.
- Added a website-service-only Stripe Checkout session with dedicated metadata and a test-mode safety gate. Live keys are rejected unless `WEBSITE_SERVICE_STRIPE_LIVE_ENABLED=1` is deliberately configured after approval.
- Integrated idempotent website-payment completion into the existing signed Stripe webhook; repeated events do not duplicate payment confirmation.
- Webhook reconciliation locates projects by the stored unique Checkout session and independently verifies project metadata, approved USD amount, currency, and a proposal-content fingerprint before marking payment complete. Stale or cross-project sessions fail closed.
- Added auditable notification attempts for customer and staff events without allowing email failures to lose project changes.
- Deferred transactional notifications with `transaction.on_commit`; delivery failures are recorded after commit and cannot roll back customer submissions or approvals.
- Added final customer approval after a paid preview. Approval records a timestamp and never publishes or sets a live URL automatically.
- Added direct customer-registration routing from the website workspace.
- Extended Django admin with proposal/payment visibility, event audit, preview notifications, and customer request-response notifications.
- Added migration `0335_website_service_checkout` and regression tests for field forgery, terms gating, ownership, checkout separation, webhook idempotency, and non-publishing final approval.

## Test evidence

- `python scripts/check-website-dashboard.py` — PASS, 38 tests (including signed-webhook, concurrency, session-expiry, stale-proposal, upload, isolation, notification-recipient, and transaction cases).
- `node --test scripts/website-templates.test.mjs` — PASS, 4 tests.
- `npm.cmd run build` — PASS (isolated build copy using the repository lockfile).
- `npx.cmd playwright test tests/webdesign.spec.js tests/website-template-gallery.spec.js` — PASS, 9 production tests covering desktop/mobile landing behavior and all six deployed demos.
- Production availability checks — PASS: `/webdesign` and all six demo URLs returned 200; unauthenticated website-service API returned 401.

Contractor screenshots are stored in `qa-artifacts/webdesign/`.

## Remaining launch blockers

- Review and approve the proposal/terms copy and refund policy with the business owner or counsel.
- Configure and verify a Stripe test-mode product flow and signed webhook in the target environment. Do not enable live website charges during development.
- Supply an approved test customer session for authenticated production dashboard verification.
- Confirm Postmark sender/support recipient configuration and run a controlled notification delivery test.
- Complete an antivirus/malware-scanning decision for customer uploads; current validation checks format, size, and ownership but is not antivirus scanning.
- Add specialized contractor starting points and evidence-driven modules (P1) after the P0 workflow is approved.
- Do not merge, deploy, migrate, or reload PythonAnywhere until the pull request is approved.

## Deployment procedure after approval

1. Merge the approved pull request and record the merge commit.
2. On PythonAnywhere, create a database and private-material backup and confirm the rollback revision.
3. Pull the approved commit only; verify the checked-out SHA.
4. Preserve the existing production Stripe API key and both webhook signing secrets. Confirm `WEBSITE_SERVICE_STRIPE_LIVE_ENABLED=false` before reload.
5. Activate the production virtual environment and run `python manage.py migrate projects`.
6. Build the frontend from the lockfile, collect static files, and reload the application.
7. Verify `/webdesign`, all six demos, and registration/login routing with read-only production checks. Inspect logs and record the deployed commit.
8. Complete Stripe test Checkout, signed test webhook reconciliation, and Postmark inbox verification only in isolated staging using the release checklist.

Rollback: restore the prior application/static revision and reload. Retain the additive website-service tables and private upload directory; do not reverse the migration after customer orders exist.

## Final P0 verification (2026-11-22)

### Payment integrity

- Checkout creation now reserves a project row before calling Stripe. A second request cannot create a competing session while the five-minute reservation is active.
- Every attempt has a unique token and Stripe idempotency key. A session that loses the post-create comparison is expired best-effort and is never stored on the project.
- An abandoned reservation may be safely superseded after five minutes. The new attempt uses a new idempotency key, avoiding reuse of an unknown orphan.
- Open, unpaid sessions for the unchanged proposal are reused. Completed/paid sessions wait for the signed webhook rather than creating another charge opportunity.
- Stripe `checkout.session.expired` and `checkout.session.async_payment_failed` events invalidate only the exact stored, unpaid session with matching project and proposal metadata. A later completion for the invalidated session cannot mark the project paid.
- Completion still requires exact stored session ID, project ID, amount, USD currency, paid state, and current approved-proposal fingerprint. Duplicate completion returns idempotently and creates no additional confirmation events.
- Staff proposal changes clear the stored session, fingerprint, and active attempt reservation. The customer must reaccept the revised proposal.

### Controlled provider verification

The isolated development process has no `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, or `POSTMARK_SERVER_TOKEN`; `WEBSITE_SERVICE_STRIPE_LIVE_ENABLED` is unset and therefore false. No real or production charge and no external email was attempted.

Automated verification used Stripe test-shaped objects and the real signed-webhook application path with `stripe.Webhook.construct_event` isolated at the provider boundary. It verified correct-project payment, amount/currency/fingerprint enforcement, duplicate suppression, and post-commit notification records. A real Stripe-hosted Checkout and Postmark inbox delivery remain controlled-environment gates. Required configuration is: a restricted Stripe test secret key (`rk_test_`), or a standard test secret key (`sk_test_`), a test-mode endpoint signing secret for `/api/payments/webhooks/stripe/`, an approved test customer email, a Postmark server token/sender authorized for approved test recipients, and `SUPPORT_EMAIL` set to the approved staff test inbox. Secret values must never be committed or printed.

### Notification review

The following events are wired through the shared post-commit notification service: new submission and customer confirmation, customer upload, change request, proposal availability, payment confirmation (customer and staff), preview availability, staff request response, and final approval (customer and staff). Recipient selection is limited to the project owner's email for customer events and configured `SUPPORT_EMAIL` for staff events. Delivery attempts are audited; exceptions are caught after commit and cannot undo customer work. Payment notification uniqueness derives from the locked paid-state transition and event-type check.

### Authenticated workflow and isolation

Isolated API tests cover authentication enforcement, project creation/editing, template validation, brief submission, private upload/download, proposal and explicit terms acceptance, checkout creation, signed-webhook payment, preview/change/final-approval rules, and cross-customer denial. Final approval records consent but leaves `live_url` empty and performs no publication. Production was not mutated; authenticated workflow verification belongs in isolated staging.

### Upload security

Uploads are limited to 5 MB, 20 files per project, and JPG/JPEG/PNG/WebP/PDF extensions. Images are decoded with Pillow, format-matched, and decompression-bomb warnings fail closed. PDFs are structurally parsed with `pypdf`, must be unencrypted with 1–200 pages, and reject catalog auto-actions, JavaScript name trees, and embedded files. Files use private storage outside public static/media paths, are downloaded only through owner/staff authorization, and responses use attachment disposition, `no-store`, and `nosniff`.

This is defense in depth, not antivirus. The affordable next step is a quarantine/scanning worker using ClamAV on infrastructure where a daemon can run; PythonAnywhere web workers should not synchronously scan large files. A current 1 GiB DigitalOcean Basic VM is USD $6/month ([official pricing](https://www.digitalocean.com/pricing/droplets)); validate memory under actual ClamAV signatures before purchase. ClamAV documents `clamd` as a long-running scanner and warns that its TCP socket is not encrypted or authenticated ([official protocol guidance](https://docs.clamav.net/manual/Usage/ClamdProtocol.html)), so expose it only over a private authenticated tunnel/network. Until approved, staff should treat uploads as untrusted and never open them with macros or privileged desktop software. Retention/deletion periods require business and privacy approval before automation.

### Business-owner approval checklist

- Approve price structure, taxes/fees, and when work is considered started.
- Approve the exact deliverables, exclusions, revision count, and out-of-scope change pricing.
- Approve customer deadlines and responsibility for lawful text, images, trademarks, and credentials.
- Decide domain registrant, DNS access, hosting account ownership, portability/export, and transfer assistance.
- Approve maintenance/security/update terms and recurring fees, if any.
- Obtain counsel/business approval for cancellation, refund, chargeback, and abandoned-project terms.
- Approve delivery estimates, dependencies, delay handling, acceptance window, and publication authorization.
- Replace any placeholder proposal language before accepting payment; no policy is activated by this code.

### Recommendation

**Blocked for payment launch, technically ready for controlled provider testing.** Code-level P0 integrity and isolated tests pass, but merge/deployment/payment acceptance should wait for business/legal terms approval, real Stripe test-mode signed-webhook verification, approved-recipient Postmark delivery, and an approved authenticated deployment smoke test.
