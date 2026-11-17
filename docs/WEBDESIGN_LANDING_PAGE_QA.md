# Web design landing page QA

## Scope
New public /webdesign page for contractor and restaurant website services.

## Files changed
- frontend/src/pages/WebDesignPage.jsx — page, template switcher, contact-last email inquiry.
- frontend/src/pages/WebDesignPage.css — scoped responsive styling.
- frontend/src/routes/PublicRoutes.jsx — lazy route.
- frontend/src/lib/seoMetadata.js — browser metadata.
- backend/core/seo.py — server metadata and indexable route.
- frontend/tests/webdesign.spec.js — desktop inquiry and mobile smoke tests.
- docs/WEBDESIGN_LANDING_PAGE_QA.md — this report.

## Passed
- Node syntax checks for the page and metadata.
- Python AST parsing of server SEO module.
- React server rendering of the initial page.
- Initial inquiry step does not contain contact inputs.
- No tentative $50 credit claim; proposed credits explicitly unavailable.
- /webdesign and /webdesign/ resolve to the same canonical metadata.
- Full Vite production build in an isolated PythonAnywhere worktree: 34.75 seconds.
- Existing SEO regression suite: 4/4 tests passed.

## Failed
No observed implementation failures in completed checks.

## Blocked
- Automatic approval review rejected marking PR 42 ready and merging it because production-branch changes need explicit user approval.
- No merge, production pull, static publication, or web-app reload was performed.
- Production Playwright tests and live desktop/mobile inspection await deployment.
- Local file preview navigation was denied by browser URL policy; no workaround was attempted.
- No browser screenshots were captured.

## Needs refinement
- Final development prices, maintenance scope, and website-credit program terms.
- Website credits are described as proposed and unavailable; no rewards are issued by this page.
- Inquiry delivery uses a reviewed mailto link, not automatic server submission.
- Template examples are illustrative concepts, not client portfolio work.

## Commands
Local:
- Get-Content frontend/src/pages/WebDesignPage.jsx -Raw | node --check --input-type=module
- Get-Content frontend/src/lib/seoMetadata.js -Raw | node --check --input-type=module
- Python ast.parse on backend/core/seo.py
- node work/verify-webdesign.mjs (temporary render and metadata verifier)

PythonAnywhere isolated checkout /home/myhomebro/webdesign-check-7978484:
- npm run build
- npm run test:unit -- src/lib/seoMetadata.test.js

After authorized deployment, run:
- WEB_DESIGN_BASE_URL=https://www.myhomebro.com npx playwright test tests/webdesign.spec.js with a production-only Playwright config that does not start a local server.
- Verify https://www.myhomebro.com/webdesign unauthenticated on desktop and mobile.
- Inspect email links without sending test email.

## Release and rollback
Implementation commit: 797848439dd090e15568e2b915a9c7ebca054541.
PR: https://github.com/SchmitzMichael2018/myhomebro/pull/42.
No schema or payment changes.
After approval: merge the reviewed PR, pull the exact main revision on PythonAnywhere, publish the validated build assets, collect static files, reload the app, and perform read-only browser checks.
Rollback: revert this landing-page change and republish frontend assets; retain old hashed assets during the transition.
