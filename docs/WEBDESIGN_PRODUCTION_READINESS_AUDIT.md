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

- `python scripts/check-website-dashboard.py` — PASS, 31 tests.
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
4. Confirm `STRIPE_SECRET_KEY` is a test key for pre-production verification, `STRIPE_WEBHOOK_SECRET` is set, `SUPPORT_EMAIL` is correct, and `WEBSITE_SERVICE_STRIPE_LIVE_ENABLED` remains unset/false.
5. Activate the production virtual environment and run `python manage.py migrate projects`.
6. Build the frontend from the lockfile, collect static files, and reload the application.
7. Verify `/webdesign`, all six demos, registration/login routing, an approved test project, proposal display, test checkout, signed webhook reconciliation, notification events, preview, change request, and final approval.
8. Confirm approval did not publish automatically, inspect logs/alerts, and record the deployed commit.

Rollback: restore the prior application/static revision and reload. Retain the additive website-service tables and private upload directory; do not reverse the migration after customer orders exist.
