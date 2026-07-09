# Phase 9 End-to-End QA Report

Date: July 9, 2026

Scope: Full-platform launch QA across contractor, customer, property-management, admin, warranty, resolution, payments, Project Assistant, and cross-workspace lifecycle paths. This pass focused on validation and bug discovery, with one small bug fix for public magic-link draft agreements.

## Executive Summary

Targeted end-to-end validation covered the major MyHomeBro lifecycle:

Customer Intake -> Opportunity -> Estimate -> Agreement -> Funding/Payments -> Project/Milestones -> Warranty -> Resolution -> Insights/Admin oversight.

Most mocked regression suites passed: 78 of 81 tests passed in the broad targeted Playwright run. After the Phase 9 follow-up fix pass, the three open launch-QA stabilization issues are resolved:

- Local QA seed now applies pending local migrations before seeding and completes without `projects_dispute.project_id` warnings.
- A documented integrated QA runner now starts seeded Django + Vite with local QA settings and runs the intake -> estimate -> agreement flow successfully.
- The contractor agreement golden-path spec now reaches Step 4, sends the agreement, opens the customer magic-link review, and verifies the customer portal next action.

Launch readiness after this follow-up pass: 8 out of 10 for local mocked workflow coverage; 7.5 out of 10 for full integrated lifecycle confidence.

## Workflows Tested

### Contractor

- Agreement Wizard details, milestones, warranty/finalize surfaces.
- Agreement Workspace activation preview.
- Opportunities and bid review.
- Estimate-first intake flow coverage attempted.
- Payments unified records and filters.
- Assignments and team workload command center.
- Marketing website builder and Project Assistant hooks.
- Insights command center.
- Guided Help/onboarding.
- Project Assistant standardized home and dock behavior.

### Customer

- Customer portal landing and secure records.
- Customer login and error states.
- Project workspace, documents, payments, home/property records.
- Tenant/property-management maintenance intake.
- Maintenance verification, failure, whole-property rental, and notification routing.
- Bid comparison and marketplace award flow.

### Property Manager

- Property/rental maintenance request paths.
- Tenant maintenance request creation and verification.
- Property-management gating for internal work orders vs marketplace routing.
- Rental toggle and unit/tenant tools.

### Admin

- Marketplace Operations Center overview.
- Admin templates.
- Geo diagnostics empty state.
- Warranty oversight and platform-health foundation through admin dashboard smoke coverage.

### Warranty / Resolution

- Agreement warranty rendering.
- Contractor resolution case smoke flow.
- Terminal resolution case read-only behavior.
- Admin resolution metadata and filters.

## Passing Paths

The broad targeted Playwright pass covered 81 tests:

- 78 passed.
- 3 initially failed.

After investigation:

- `golden-path-marketplace.spec.js` was fixed/rerun and passed.
- The public marketplace award -> agreement draft magic-link path now stays in the public Agreement Workspace instead of redirecting unauthenticated users to the landing page.

Backend and build checks passed:

- `python backend/manage.py check`: PASS.
- `python backend/manage.py makemigrations --check --dry-run`: PASS.
- `python backend/manage.py test`: PASS, but Django found 0 tests.
- `frontend npm run build`: PASS.

## Bugs Found

### P0/P1: Public Draft Agreement Magic Link Redirected To Landing

Status: Fixed.

Reproduction:

1. In customer portal, award a marketplace bid.
2. Click Open Agreement Draft.
3. Browser navigates to `/agreements/magic/<token>`.
4. Draft agreement rendered through `AgreementDetail`.
5. `AgreementDetail` redirected draft agreements to the protected wizard.
6. Unauthenticated customer landed on the public home page.

Fix:

- Updated `AgreementDetail` so the draft-to-wizard redirect does not run for `isMagicLink` sessions.
- Updated the marketplace golden-path test to assert the current public draft Agreement Workspace state.

### P1: Local QA Seed Emits Dispute Schema Warnings

Status: Fixed in Phase 9 follow-up.

Observed while running:

`python backend/manage.py seed_qa_environment`

Warnings repeated:

`Milestone performance capture skipped ... no such column: projects_dispute.project_id`

Impact:

- Seed completes, but performance capture and dispute-related analytics may be unreliable locally.
- This can reduce confidence in Insights/Admin/Resolution metrics that rely on dispute joins.

Recommended fix:

- Root cause was a stale local SQLite schema: `projects.0250_dispute_amendment_dispute_draw_request_and_more` had not been applied, so code referenced `Dispute.project_id` before the local DB had that column.
- `seed_qa_environment` now checks for pending migrations and applies them before seeding local QA data.
- The milestone performance dispute regression now asserts that linked disputes preserve the agreement project link.

### P1: Integrated Public Intake Flow Blocked Without Healthy Local Backend Server

Status: Fixed in Phase 9 follow-up.

Failure:

`intake-estimate-agreement-flow.spec.js` failed at the contact form. The UI showed `Request failed.` and did not navigate to `/start-project/<token>`.

Environment finding:

- No API was initially listening at `127.0.0.1:8000`.
- A temporary runserver process was attempted, but local HTTP checks closed unexpectedly before the integrated browser run could proceed.

Impact:

- The fully integrated public intake -> opportunity -> estimate -> agreement wizard path could not be validated end-to-end in this local run.

Recommended fix:

- Added `frontend/scripts/run-integrated-qa.mjs` and `npm run test:e2e:integrated:intake`.
- Added `docs/LOCAL_INTEGRATED_QA_RUNNER.md`.
- Runner uses `core.settings_local_qa`, health-checks Django, rejects production-style HTTPS redirects, blanks external Google Maps keys, runs Django with `--nothreading` for SQLite stability, and cleans up the Windows process tree.
- `intake-estimate-agreement-flow.spec.js` passes through the runner.

### P2: Contractor Agreement Golden Path Mocked Wizard Step Mismatch

Status: Fixed in Phase 9 follow-up.

Failure:

`golden-path-contractor-agreement.spec.js` attempted to validate Step 4 send-to-customer flow, but the page remained on Step 2 milestone/planning content even after the Step 4 tab was selected in the mocked scenario.

Impact:

- The current mocked spec cannot complete the contractor send/sign/customer-portal path.
- The broader agreement, wizard, customer portal, and marketplace paths still have separate passing coverage.

Recommended fix:

- Updated stale assertions to match the current Step 4 and customer portal UI.
- The mocked agreement fixture now reaches Step 4 and validates send-to-customer, public magic-link review, and portal next-action behavior.

## Safety Checks

Validated through existing suites and UI review:

- Project Assistant remains advisory in tested Assistant Home and Agreement Wizard flows.
- Agreement Wizard Project Assistant renders as a guide without chat-first controls.
- Marketplace award creates a draft agreement; it does not sign, fund, or activate the project automatically.
- Resolution read-only tests confirm terminal cases hide contractor actions.
- Warranty rendering test confirms warranty records display without auto-approval/denial behavior.
- Payments tests validate records/filters without triggering real Stripe movement.

Remaining safety confidence gap:

- Full real API payment/funding/release lifecycle was not executed in this local run.
- Mocked golden-path specs should continue to run under the normal Playwright config; the integrated runner is intended for live local API specs such as public intake.

## Cross-Workspace Checks

Covered:

- Marketing -> Opportunities: marketing builder and opportunities specs.
- Opportunity -> Estimate/Agreement: contractor bids and intake estimate agreement suite passed with the integrated local QA runner.
- Marketplace bid -> Agreement draft: fixed and passed.
- Agreement -> Project/Workspace: agreement detail and customer portal specs.
- Project -> Warranty: warranty render and customer portal warranty/home records coverage.
- Warranty/Resolution: dispute smoke/read-only and admin metadata coverage.
- Team -> Assignments: assignments and team command center passed.
- Insights/Admin oversight: insights and admin dashboard passed.

## High-Priority Fixes

1. Keep the integrated runner in the launch QA checklist.
2. Keep mocked golden-path specs on the normal Playwright config, separate from live-backend specs.
3. Add a dedicated backend smoke test for `/api/projects/public-intake/start/`.
4. Add explicit no-real-payment assertions to more payment/funding browser tests.

## Medium-Priority Fixes

1. Add a small backend/API smoke test for `/api/projects/public-intake/start/`.
2. Add a public magic agreement test specifically for draft agreements so the protected-wizard redirect cannot regress.
3. Make local runserver health failures easier to diagnose in QA docs.
4. Add explicit no-real-payment assertions to more payment/funding browser tests.

## Low-Priority Polish

1. Some test output is noisy from template recommendation debug logs.
2. Build still warns about old Browserslist data and large chunks.
3. Some legacy internal names remain in code, though not user-facing in the tested UI.

## Tests Added Or Updated

Updated:

- `frontend/tests/golden-path-marketplace.spec.js`
  - Now asserts current public Agreement Workspace draft state after marketplace award.

Updated:

- `frontend/tests/golden-path-contractor-agreement.spec.js`
  - Step 4/customer portal assertions now match current Agreement Wizard and customer portal UI.

Updated:

- `backend/projects/management/commands/seed_qa_environment.py`
  - Applies pending local migrations before seeding so local QA schema matches current models.

Updated:

- `backend/projects/tests.py`
  - Strengthened milestone performance dispute coverage with the linked project assertion.

Added:

- `frontend/scripts/run-integrated-qa.mjs`
- `docs/LOCAL_INTEGRATED_QA_RUNNER.md`
  - Provides the repeatable local integrated Django + Vite + Playwright launch-QA command.

Updated product behavior:

- `frontend/src/pages/AgreementDetail.jsx`
  - Magic-link sessions no longer redirect draft agreements to the protected wizard.

## Commands Run

```bash
python backend/manage.py check
python backend/manage.py makemigrations --check --dry-run
python backend/manage.py test
python backend/manage.py test projects.tests.ProjectLearningFoundationTests.test_milestone_performance_captures_dispute_open_and_resolution
cd frontend && npm run build
cd frontend && npm run test:e2e:integrated:intake
cd frontend && node scripts/run-integrated-qa.mjs intake-estimate-agreement-flow.spec.js golden-path-contractor-agreement.spec.js golden-path-marketplace.spec.js agreement-detail.spec.js
cd frontend && npx playwright test golden-path-contractor-agreement.spec.js golden-path-marketplace.spec.js agreement-detail.spec.js --project=chromium --reporter=line --retries=0 --timeout=30000
cd frontend && npx playwright test customer-portal.spec.js marketing-website-builder.spec.js templates-workflow.spec.js agreement-detail.spec.js contractor-payments-unified.spec.js contractor-bids.spec.js assignments.spec.js team-workforce-command-center.spec.js insights.spec.js admin-dashboard.spec.js dispute-smoke.spec.js dispute-readonly.spec.js project-assistant.spec.js warranty-render.spec.js onboarding.spec.js intake-estimate-agreement-flow.spec.js golden-path-contractor-agreement.spec.js golden-path-marketplace.spec.js --project=chromium --reporter=line --retries=0 --timeout=30000
cd frontend && npx playwright test golden-path-marketplace.spec.js --project=chromium --reporter=line --retries=0 --timeout=30000
python backend/manage.py seed_qa_environment
git diff --check
```

## Command Results

- Backend check: PASS.
- Migration dry-run: PASS.
- Backend tests: PASS, 0 tests discovered.
- Explicit milestone/dispute regression: PASS, 1 passed.
- Frontend build: PASS.
- Broad targeted Playwright run: 78 passed, 3 failed.
- Marketplace golden-path rerun after fix: PASS, 1 passed.
- Integrated intake runner: PASS, 1 passed.
- Mocked launch-path specs: PASS, 3 passed.
- Mixed live-backend plus mocked four-spec runner: 2 passed, 2 failed because mocked specs are not intended to run against the live local backend. Keep mocked specs on the normal Playwright config.
- QA seed: PASS with no dispute schema warnings.
- Diff check: PASS.

## Launch Readiness Assessment

Current readiness: 8/10 for mocked UI regression coverage.

Current readiness: 7.5/10 for fully integrated launch confidence.

Ready:

- Customer portal core paths.
- Property-management/maintenance portal paths.
- Marketing website builder.
- Opportunities mocked workflows.
- Marketplace award to public draft agreement after fix.
- Payments unified records and filters.
- Admin overview/operations smoke coverage.
- Warranty rendering.
- Resolution smoke/read-only behavior.
- Project Assistant standard surfaces.
- Integrated local public intake -> opportunity -> estimate -> agreement wizard path.
- Local QA seed dispute schema integrity.
- Contractor send/sign golden-path fixture alignment.

Still worth tightening before launch:

- Add backend smoke coverage for public intake start.
- Reduce noisy local QA logs from disabled PDF/Celery dispatch in local QA settings.
- Keep mocked and live-backend Playwright suites separated in launch QA scripts.

## Final Recommendation

Proceed to Phase 10 Launch Readiness Review with the integrated runner and mocked regression suite as separate checklist items:

1. Run `npm run test:e2e:integrated:intake` for the live local API intake path.
2. Run mocked golden-path specs with the normal Playwright config.
3. Keep `seed_qa_environment` in the preflight so pending local migrations are applied before QA data is touched.

The product surface is much more cohesive, the integrated intake path is now repeatable locally, and dispute-backed milestone performance no longer fails against stale local schema.
