# Guide-to-planner review handoff

## Scope

San Antonio now leads with published bathroom guides while preserving direct project intake. A published homeowner project guide can open a public planning page, collect project answers, preview an advisory plan, and retain that reviewed preview in the current browser tab during signup or login. Explicit confirmation saves the signed plan into the existing private DIY workspace. The homeowner then chooses DIY or prepares a professional-help request using existing workflows. Saving never contacts a contractor.

No guides were published, no production data was changed, and no deployment was performed. Existing bathroom drafts still require editorial review and publication before they appear. No database migration is required for this feature.

## Safety and recovery

- Only active published templates can generate previews; save rechecks publication.
- Preview inputs and plans are bounded, normalized and signed for 24 hours.
- Save rejects tampering, expiry, unreviewed overrides and unowned properties.
- Owner-specific project IDs make retries idempotent. Creation and task application are transactional.
- Anonymous preview requests are limited to six per hour by REMOTE_ADDR. **Before release, verify the production proxy supplies a trusted per-client REMOTE_ADDR. Otherwise users behind the same ingress share a bucket. Raw forwarded headers are deliberately ignored.** Use a shared cache for multi-worker rate-limit enforcement.
- Preview answers remain tab-scoped; they are not put into URLs. Email verification in another tab points users back to the original tab. The original tab offers a verified-account resume action.
- Unavailable guides, failed requests, disabled storage, cancellation and retries have explicit recovery paths. Disabled storage leaves a copyable plan on screen instead of navigating away.
- AI output remains advisory and editable after saving. No live provider call was required for automated validation.

## QA status

- PASS: production frontend build.
- PASS: full frontend unit suite, 83 files / 530 tests.
- PASS: targeted ESLint for changed source and tests, zero errors. Three existing-pattern warnings remain (two component-export warnings; one verification-page effect dependency warning).
- PASS: 15 relevant Playwright tests discovered successfully across guide preview, private save, DIY planner and San Antonio suites.
- BLOCKED: executing those browser flows. Browser package download returned an invalid archive; installed Chromium then failed to create its required local socket with `Operation not permitted`, including after an approved execution escalation. This is not a browser pass. No screenshots or mobile visual verification are claimed.
- PASS: final backend code, 41 tests (20 new public-planning tests plus existing DIY and public-library tests), using an isolated SQLite schema synchronized from current models.
- PASS: earlier migration-backed regression, 48 tests, including the complete historical migration chain and editorial seed checks; this preceded the final token-limit and throttle fixes.
- A broader final synchronized-schema run passed 49/51 tests; two editorial seed tests failed because that accelerated setup intentionally skipped historical data migrations. They passed in the migration-backed run. The 41-test final focused suite excludes those seed-dependent editorial tests.
- PASS: Django system checks, Python compilation and `makemigrations --check --dry-run` (no model changes).

## Commands

- `cd frontend && npm ci --ignore-scripts --cache /tmp/myhomebro-npm-cache`
- `npm run build`
- `npm run test:unit`
- `npm exec -- eslint <changed JS/JSX source and test files>`
- `npm exec -- playwright test --list tests/public-guide-planning.spec.js tests/public-plan-save.spec.js tests/san-antonio-launch.spec.js tests/diy-project-planner.spec.js`
- Backend final: `python manage.py test projects.tests_public_improvement_planner projects.tests_diy_planner projects.tests_public_improvements.PublicImprovementLibraryTests --settings=myhomebro_journey_fast_test_settings --noinput`, using temporary isolated test settings, SQLite, dummy credentials, no production .env, and no live AI provider.
- Attempted local Chromium execution with a temporary test configuration and the development server; blocked as described above.

## Before merge or release

Run the Playwright suites in a browser-capable environment and verify real signup/email/mobile verification, existing-user login, same-tab recovery, provider timeout/fallback and published-guide visibility with safe test accounts. Confirm proxy identity and shared-cache settings for rate limits. Review and publish the intended bathroom guide separately. Keep this change in draft review until these checks and editorial decisions are complete.
