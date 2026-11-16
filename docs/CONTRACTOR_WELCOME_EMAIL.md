# Contractor welcome email

Normal contractor accounts receive an HTML and plain-text welcome after both email
and phone verification complete. Branding uses PUBLIC_LOGO_URL, SITE_URL,
DEFAULT_FROM_EMAIL and SUPPORT_EMAIL through the existing Django/Postmark backend.
No new Postmark template or credential is needed. Existing accounts are not bulk
enrolled or emailed. Test, staff, suspicious, disabled and customer accounts are excluded.

Delivery records appear in Django admin under Contractor welcome emails. `sent`
means the backend accepted the message, not that the inbox received it. Check
Postmark for bounces and final delivery status.

With CELERY_NOTIFICATIONS_ENABLED enabled, restart Celery workers to discover
accounts.tasks.send_contractor_welcome. Failures retry up to three times. With the
flag disabled, delivery runs after commit through the existing mail backend;
delivery failure never undoes account activation. Use a bounded SMTP timeout.

Recover existing pending records:

    python manage.py send_pending_contractor_welcomes

Explicitly retry failed records:

    python manage.py send_pending_contractor_welcomes --retry-failed

The command never enrolls existing users. A `sending` record is not automatically
reclaimed: inspect Postmark before resetting it after a crash. SMTP cannot guarantee
exactly-once delivery: a network failure after acceptance may cause a duplicate on
retry. Normal repeated tasks and competing claims are deduplicated by the database.

Deployment: back up the active database, migrate accounts through 0007 before web
reload, verify PUBLIC_LOGO_URL returns an image, confirm sender/support mailbox,
and restart notification workers if enabled. Use an in-memory backend for any
production-side dry run; never bulk-send to existing contractors. Roll back code
while retaining the additive delivery table if necessary.
