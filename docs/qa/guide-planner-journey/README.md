# Guide-to-planner review handoff

## Scope

San Antonio now leads with published bathroom guides while preserving direct project intake. A published homeowner project guide can open a public planning page, collect project answers, preview an advisory plan, and retain that reviewed preview in the current browser tab during signup or login. Explicit confirmation saves the signed plan into the existing private DIY workspace. The homeowner then chooses DIY or prepares a professional-help request using existing workflows. Saving never contacts a contractor.

No guides were published, no production data was changed, and no deployment was performed. Existing bathroom drafts still require editorial review and publication before they appear. Migration `0333_public_improvement_plan_slot` is required before public preview requests can run. It creates only rate-limit admission slots, not project content. An unavailable admission table fails closed before provider invocation.

## Safety and recovery

- Only active published templates can generate previews; save rechecks publication.
- Preview inputs and plans are bounded, normalized and signed for 24 hours.
- Save rejects tampering, expiry, unreviewed overrides and unowned properties.
- Owner-specific project IDs make retries idempotent. Creation and task application are transactional.
- Anonymous preview requests are limited to six per hour by REMOTE_ADDR. **Before release, verify the production proxy supplies a trusted per-client REMOTE_ADDR. Otherwise users behind the same ingress share a bucket. Raw forwarded headers are deliberately ignored.** Admission now uses shared database slots, with unique inserts and conditional updates enforcing the limit atomically across workers; a shared cache alone was not sufficient.
- Preview answers remain tab-scoped; they are not put into URLs. Email verification in another tab points users back to the original tab. The original tab offers a verified-account resume action.
- Unavailable guides, failed requests, disabled storage, cancellation and retries have explicit recovery paths. Disabled storage leaves a copyable plan on screen instead of navigating away.
- AI output remains advisory and editable after saving. No live provider call was required for automated validation.

## QA status

- PASS: production frontend build.
- PASS: full frontend unit suite, 84 files / 540 tests.
- PASS: targeted ESLint for changed source and tests, zero errors. Existing component-export, effect-dependency and unused-variable warnings remain; the review-fix lint pass reports nine warnings and zero errors.
- PASS: 18 relevant Playwright tests discovered successfully across guide preview, private save, DIY planner and San Antonio suites.
- BLOCKED: executing those browser flows. Browser package download returned an invalid archive; installed Chromium then failed to create its required local socket with `Operation not permitted`, including after an approved execution escalation. This is not a browser pass. No screenshots or mobile visual verification are claimed.
- PASS: final backend code, 48 tests (20 public-planning tests, seven atomic-admission tests, plus existing DIY and public-library tests), using an isolated SQLite schema synchronized from current models.
- PASS: earlier migration-backed regression, 48 tests, including the complete historical migration chain and editorial seed checks; this preceded the final token-limit and throttle fixes.
- A broader final synchronized-schema run passed 49/51 tests; two editorial seed tests failed because that accelerated setup intentionally skipped historical data migrations. They passed in the migration-backed run. The final focused suite excludes those seed-dependent editorial tests.
- PASS: Django system checks, Python compilation and `makemigrations --check --dry-run` (no migration drift beyond committed migration 0333).

## Commands

- `cd frontend && npm ci --ignore-scripts --cache /tmp/myhomebro-npm-cache`
- `npm run build`
- `npm run test:unit`
- `npm exec -- eslint <changed JS/JSX source and test files>`
- `npm exec -- playwright test --list tests/public-guide-planning.spec.js tests/public-plan-save.spec.js tests/san-antonio-launch.spec.js tests/diy-project-planner.spec.js`
- Backend final: `python manage.py test projects.tests_public_plan_admission projects.tests_public_improvement_planner projects.tests_diy_planner projects.tests_public_improvements.PublicImprovementLibraryTests --settings=myhomebro_atomic_test_settings --noinput --keepdb`, using temporary isolated test settings, SQLite, dummy credentials, no production .env, and no live AI provider.
- Attempted local Chromium execution with a temporary test configuration and the development server; blocked as described above.

## Before merge or release

Run the Playwright suites in a browser-capable environment and verify real signup/email/mobile verification, existing-user login, same-tab recovery, provider timeout/fallback and published-guide visibility with safe test accounts. Apply migration 0333 and confirm trusted proxy identity for database-backed rate limits. Review and publish the intended bathroom guide separately. Keep this change in draft review until these checks and editorial decisions are complete.

## Independent-review corrections

- Current reviewed planning intent now overrides an older account registration continuation, including an empty continuation. Both email-pending and phone-pending customer logins expose a verification resume link; verified-state and phone-confirmation paths return to the same private-plan review.
- Replaced non-atomic DRF cache history with database-enforced six-slot admission. Concurrent contenders cannot share the last available slot. Provider calls fail closed if admission storage is unavailable.
- Verified forced 12-connection races: exactly one admission into the last unused slot, one into the last expired slot, and six from an empty bucket.
- Added ten frontend unit cases and three browser regressions for interrupted existing-account verification. Browser execution remains blocked as above.
- Migration 0333 was independently applied, uniqueness-checked, rolled back and reapplied in isolated SQLite.
- A separate 12-process probe admitted one request and rejected eleven after five prior admissions.
