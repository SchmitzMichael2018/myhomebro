# Owner signup SMS alerts

Public contractor, homeowner and property-manager registrations create one owner
alert after the account and acquisition record are saved. Pending verification is
explicit in the text; the contractor welcome email still waits for verification.
Honeypot submissions, validation failures, duplicate-email attempts, staff, test,
fraud and suspicious accounts do not create alerts. There is no historical backfill.

Set ADMIN_SIGNUP_SMS_ENABLED=true and ADMIN_SIGNUP_SMS_TO to the owner's E.164
number in the server environment. The number is never accepted from signup data
and is never committed to source. Record the owner's explicit consent with the
existing SMSConsent mechanism at activation. STOP/START uses the existing Twilio
inbound handling. Changing the destination requires fresh consent; old pending
records are not redirected automatically.

Texts contain only account type, internal account ID, verification status and a
staff-authenticated Django admin URL, not names, email addresses or phone numbers.
AdminSignupSMS records expose attempts, provider acceptance SID and safe reason
codes. Provider acceptance does not mean carrier delivery. Normal repeat tasks
are deduplicated; ambiguous provider failures still require reconciliation.

With CELERY_NOTIFICATIONS_ENABLED=false, alerts send after commit using the current
SMS service. With workers enabled, accounts.tasks.send_admin_signup_sms retries
failed sends up to three times. Recover pending/failed records manually with:

    python manage.py send_pending_signup_alerts --retry-failed

This never enrolls historical accounts or retries opted-out/blocked records. A
stuck sending record requires provider inspection before manual recovery.

Release: back up the database, apply accounts migration 0008, configure the owner
destination and consent, reload WSGI, restart notification workers if enabled,
and send one clearly labeled sample to the owner. No real signup is needed for
deployment testing. Disable ADMIN_SIGNUP_SMS_ENABLED to pause.
