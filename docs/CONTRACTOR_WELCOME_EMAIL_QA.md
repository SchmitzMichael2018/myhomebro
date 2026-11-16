# Contractor welcome email — QA report

Released November 16, 2026. Implementation: PR #37, merge commit 86711ac88765f75e8bfb80d973009f970b84ea1f.

## Scope
Automatically welcome normal contractor accounts after email and phone verification. Branded HTML/plain-text tips, dashboard link, support reply-to, durable delivery records and recovery.

## Files changed
- backend/accounts/models.py, admin.py and migrations/0007_contractorwelcomeemail.py: delivery record and read-only admin status.
- backend/accounts/services/verification.py and services/welcome.py: post-commit trigger, eligibility, atomic claim, templates and SMTP delivery.
- backend/accounts/tasks.py: bounded Celery retries when notifications are enabled.
- backend/accounts/management/__init__.py, management/commands/__init__.py and management/commands/send_pending_contractor_welcomes.py: recovery of existing pending/failed records.
- backend/accounts/tests_welcome.py: nine behavior tests.
- backend/templates/emails/contractor_welcome.html and contractor_welcome.txt: logo and getting-started instructions.
- docs/CONTRACTOR_WELCOME_EMAIL.md and contractor_welcome_sample.html: operations notes and sample.

## Passed
- 39 welcome/account-verification tests passed locally using isolated in-memory data, no external email or SMS. The full URL configuration and an account-scoped URL configuration both passed.
- Nine deployed welcome tests passed on PythonAnywhere against an isolated in-memory test database; all email stayed in memory.
- Accounts migration drift check passed.
- Production database backup completed before deployment; accounts migration 0007 applied successfully.
- Production configuration logo corrected from a 404 address to https://www.myhomebro.com/static/myhomebro_logo.png (HTTP 200, image/png).
- Production template and admin registration verified; zero existing welcome records after rollout, no bulk enrollment.
- Production source checkout clean after deployment and WSGI reload.
- Unauthenticated https://www.myhomebro.com/register loaded its role selector.
- Unauthenticated GET https://www.myhomebro.com/api/auth/login/ returned expected HTTP 405 in 0.113 seconds (reachability only, not authenticated login).
- Python compilation and whitespace checks passed.

## Failed
No unresolved feature-test failures. Early test setup failures caused by a stale local checkout and a test-database options override were corrected before the successful runs.

## Blocked
Actual Postmark delivery/inbox rendering is not verified: no real recipient was emailed. Authenticated live signup was not performed. Screenshots were not captured; live checks used DOM/console observations.

## Needs refinement
Production currently has CELERY_NOTIFICATIONS_ENABLED=False, so delivery runs after commit through existing SMTP with a 15-second timeout. Failures are recorded and recoverable with the management command; automatic background retries require notification workers. Sent status means provider acceptance, not inbox delivery. SMTP can duplicate a message after an ambiguous network failure; inspect provider history before replaying a stuck sending record.

## Commands
- python -m compileall -q backend/accounts
- python manage.py makemigrations accounts --check --dry-run --skip-checks --settings=core.settings_local_qa
- Django test runner: accounts.tests_welcome accounts.tests_verification (isolated memory database, schema synchronization; 39 passed)
- python backend/manage.py backup_sqlite_database --output-dir /home/myhomebro/backups/pre-welcome-email --skip-checks
- git pull --ff-only origin main
- python backend/manage.py migrate accounts --noinput --skip-checks
- Deployed Django test runner: accounts.tests_welcome (isolated memory database and in-memory mail; nine passed)
- WSGI reload and read-only template/admin/HTTP checks.
