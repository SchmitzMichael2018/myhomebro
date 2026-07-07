# Intake -> Estimate -> Agreement Flow QA

Date: 2026-07-06
Environment: local QA seed, Django API on `127.0.0.1:8000`, Vite/Playwright on `127.0.0.1:5173`

## Scope

Targeted end-to-end QA for the estimate-first sales workflow:

- Public/customer intake lead creation
- Seeded QA contractor routing and estimate appointment request
- Contractor Opportunities review
- Estimate Workspace creation, checklist completion, line items, incidentals reserve, and readiness
- Agreement Wizard conversion and estimate-prefill review

QA account used:

- Contractor: `info+contractor@myhomebro.com`
- Password: `MyHomeBroQA!2026`

Customer intake data created:

- Name: Taylor QA Intake
- Email: `info+intake-customer@myhomebro.com`
- Phone: `555-0199`
- Address: `4400 QA Lead Street, Austin, TX 78704`
- Project: Flooring / Remodel
- Description: old flooring removal, subfloor inspection, and LVP install in living room/hallway

## Files Changed

- `backend/core/settings_local_qa.py`
- `backend/projects/views/public_intake.py`
- `backend/projects/views/proposals.py`
- `backend/projects/tests.py`
- `frontend/src/pages/ProposalWorkspacePage.jsx`
- `frontend/tests/intake-estimate-agreement-flow.spec.js`
- `docs/INTAKE_ESTIMATE_AGREEMENT_FLOW_QA.md`
- `docs/audit-screenshots/intake-estimate-agreement-flow/*.png`

## Fixes Made

1. Fixed public intake `tentative_start_date` PATCH handling.
   - Root cause: the view assigned a raw string to a `DateField`, then serialized with `.isoformat()`, causing a 500.
   - Added date parsing and a regression test.

2. Hardened local QA settings.
   - Local QA now uses in-memory email and disables Stripe/Twilio/Postmark credentials.

3. Improved estimate-to-agreement customer handoff.
   - Proposal API now exposes `customer_id`/`homeowner_id` from the linked contractor opportunity.
   - Estimate Workspace now passes that id into the Agreement Wizard handoff.

4. Added Playwright E2E spec.
   - `frontend/tests/intake-estimate-agreement-flow.spec.js`
   - Uses live local QA seed APIs and screenshots.
   - Opens the exact opportunity using the contractor bids API row mapping to avoid old Taylor QA records.

## Screenshots

Stored under `docs/audit-screenshots/intake-estimate-agreement-flow/`:

1. `01-public-intake-contact.png`
2. `02-public-intake-wizard-open.png`
3. `03-public-intake-submitted-with-slot.png`
4. `04-contractor-opportunities-feed.png`
5. `05-opportunity-review-modal.png`
6. `06-estimate-workspace-created.png`
7. `07-estimate-create-agreement-disabled.png`
8. `08-estimate-photos-placeholder.png`
9. `09-estimate-documents-placeholder.png`
10. `10-estimate-line-items-and-totals.png`
11. `11-estimate-ready-for-agreement.png`
12. `12-agreement-wizard-step1-prefill.png`
13. `13-agreement-wizard-step1-review-form.png`
14. `14-agreement-wizard-save-next-failure.png`

## Test Results

PASS:

- `python backend/manage.py seed_qa_environment`
- `python backend/manage.py check`
- `python backend/manage.py makemigrations --check --dry-run`
- `python backend/manage.py test projects.tests.ContractorPublicPresenceApiTests.test_public_intake_accepts_tentative_start_date_without_serialization_error`
- `python backend/manage.py test projects.tests_agreements projects.tests_proposals projects.tests_workforce_capabilities`
- `cd frontend && npm run build`

FAIL:

- `cd frontend && npx playwright test intake-estimate-agreement-flow.spec.js --project=chromium --reporter=line`

Failure point:

- Agreement Wizard Step 1 creates/opens a draft but `Save & Next` does not advance to Step 2.
- UI toast: `Unable to save Step 1.`
- URL remains at `/app/agreements/<id>/wizard?step=1` or `/app/agreements/new/wizard?step=1`.

## Functional Bugs

1. Agreement Wizard Step 1 blocks estimate conversion.
   - After estimate prefill and Step 1 review, `Save & Next` fails.
   - This blocks validation of Step 2 milestones, planning simulation, Step 3 warranty, and Step 4 finalize.

2. AI setup reclassifies the estimate incorrectly.
   - LVP flooring/remodel estimate becomes `Concrete Slab`.
   - Screenshot: `14-agreement-wizard-save-next-failure.png`.
   - This risks overwriting correct estimate context with unrelated AI classification.

3. Step 1 is not review-first.
   - Initial Step 1 screen still asks for “Describe the job” and “Find Best Starting Point.”
   - This duplicates intake/estimate work instead of presenting the prefilled agreement for review.

## UX / Design Issues

- The Estimate Prefill summary is useful, but the primary action path still feels like a new agreement setup flow.
- The failure toast does not expose field-level validation or API details, leaving the contractor without a next action.
- Photos/documents placeholders are clear, but no lightweight placeholder/document stub action exists for QA-style estimate records.

## Duplicate Entry Issues

- Repeated QA runs can create multiple Taylor QA Intake opportunities.
- The spec now maps the exact opportunity id to the correct UI row, but the product UI search still makes duplicate Taylor records hard to distinguish.

## Missing Handoff Data

Fixed:

- Customer id now flows from proposal to wizard handoff.

Still problematic:

- Step 1 AI setup can overwrite project type/title/scope after handoff.
- Agreement save failure prevents confirmation that milestone generation receives estimate line items and incidentals reserve.

## Recommended Fixes

1. Make proposal-origin Agreement Wizard Step 1 review-first.
   - Bypass or collapse “Find Best Starting Point” when `assistantIntent === "proposal_to_agreement"`.
   - Preserve estimate project type/subtype/title unless contractor explicitly re-runs AI classification.

2. Surface Step 1 save errors inline.
   - Show API validation fields and failed payload context instead of only `Unable to save Step 1.`

3. Add disambiguation to Opportunities search results.
   - Show source id/reference and intake creation time prominently for duplicate QA/customer names.

4. Add a no-op document/photo placeholder option for estimate workspaces.
   - Useful for QA and for contractors who inspect documents outside the app before formal upload.

## Prioritized Backlog

P0:

- Fix Agreement Wizard Step 1 save failure for proposal-origin drafts.
- Stop AI setup from reclassifying estimate-prefilled projects unless explicitly requested.

P1:

- Convert proposal-origin Step 1 into a review/refinement screen.
- Preserve and display estimate line items, total, incidentals reserve, customer, address, and schedule before any AI/template action.

P2:

- Improve duplicate opportunity disambiguation.
- Add estimate placeholder attachments.
- Add a focused backend/API test for proposal `customer_id` serialization and handoff payload shape.
