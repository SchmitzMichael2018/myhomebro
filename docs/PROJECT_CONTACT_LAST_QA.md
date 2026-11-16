# Project-first public intake QA — November 16, 2026

## Scope
Remove the duplicate contact gate at /start-project. Visitors describe the project, review its snapshot/summary and project details, then provide contact information in the existing contact step before contractor selection. This updates the shared intake used by the San Antonio page and other Start a project entry points.

Released PR: https://github.com/SchmitzMichael2018/myhomebro/pull/39
Production code commit: 30b442d32acbe5643b0cba38bbba75b9f1c46f9e

## Files changed
- frontend/src/pages/StartProjectIntake.jsx — opens an anonymous intake immediately; preserves source, contractor/template context, legacy token handling and retry UI.
- frontend/src/components/intake/PublicIntakeWizard.jsx — late contact explanation, name/email validation, optional phone and explicit save before advancing; preserves inputs on failure.
- frontend/tests/public-intake-contact-last.spec.js — desktop/mobile flow, validation, save recovery, context and retry coverage.
- frontend/tests/public-intake-branching.spec.js — updates existing entry flow expectations.
- frontend/tests/intake-estimate-agreement-flow.spec.js — removes old contact gate; reads QA password from MHB_QA_PASSWORD, skipping when unavailable.

No backend API, schema or payment changes.

## Passed
- Local Vite production build completed in 38.79 seconds.
- JavaScript syntax checks passed for all three changed test files.
- Production build with Node 20.20.2 completed in 35.48 seconds.
- collectstatic completed: 214 copied, 176 unmodified, 1001 post-processed.
- Production source working tree clean after deployment; WSGI reload triggered.
- Direct live browser walkthrough from San Antonio Start a project opens Project Idea with no initial name/email/phone gate.
- Project idea, refinement, snapshot, summary and project details accessible before contact entry.
- Empty contact and malformed email prevent advancing.
- Valid name/email with blank optional phone saves and advances to Choose Local Contractors.
- Back navigation preserves contact, project description and location.
- Read-only database verification confirms saved contact, description and location, no linked customer account, no contractor assignment and no invitation path selected.
- Screenshot captured successfully: docs/qa/contact-last/project-first.jpg.

## Failed
No reproducible application failure remained in the successful live walkthrough. One initial refinement save attempt showed “Could not save intake”; retry succeeded with inputs retained.

## Blocked
Automated Playwright execution did not reach test actions: the isolated Windows browser process could not launch (Edge Elevator access denied / browser closed). Three new cases were attempted; none are claimed as passed. Mobile automation, simulated API failures and legacy-token regression coverage remain unverified by an executable browser suite.
Authenticated agreement/estimate end-to-end testing was not run; this change does not alter those flows.

## Needs refinement
Investigate intermittent draft-save latency separately if it recurs. This release does not claim to fix its underlying cause.
Full submission, customer-account creation, email delivery and contractor invitations were intentionally not executed during the live smoke check.
One clearly labeled QA-only intake was retained. Its public bearer token is omitted from this report.

## Commands
Local:
- node node_modules/vite/bin/vite.js build
- node --check frontend/tests/public-intake-contact-last.spec.js
- node --check frontend/tests/public-intake-branching.spec.js
- node --check frontend/tests/intake-estimate-agreement-flow.spec.js
- node node_modules/@playwright/test/cli.js test tests/public-intake-contact-last.spec.js --config=playwright.contact-qa.config.js --project=chromium --reporter=list --retries=0
The temporary local QA config used the installed Edge channel and direct Vite command; it is not part of the release.

Production:
- git pull --ff-only origin main
- export PATH=/home/myhomebro/.nvm/versions/node/v20.20.2/bin:$PATH
- cd /home/myhomebro/backend/frontend && npm run build
- /home/myhomebro/backend/venv/bin/python /home/myhomebro/backend/backend/manage.py collectstatic --noinput
- touch /var/www/www_myhomebro_com_wsgi.py
- git status --short
- Read-only Django shell query against the QA intake, printing boolean assertions only.

## URLs and authentication
Browser checks used the public unauthenticated intake flow:
- https://www.myhomebro.com/san-antonio/
- https://www.myhomebro.com/start-project?source=san_antonio_launch
- Resulting tokenized /start-project/ intake (bearer token withheld).

## Recovery
Revert PR 39, rebuild the frontend, collect static assets and reload WSGI. No migration rollback is needed.
