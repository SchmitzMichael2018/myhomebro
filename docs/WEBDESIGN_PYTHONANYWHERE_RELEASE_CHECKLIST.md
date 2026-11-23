# Website service controlled release checklist

Use only after PR approval. Do not enable live website-service payments during the controlled release.

## Isolated staging verification

- Deploy the candidate revision to a separate staging web app and URL. Use a separate database, private uploads directory, and staging-only accounts and records. Apply migrations in order and keep `WEBSITE_SERVICE_STRIPE_LIVE_ENABLED=false`.
- Configure `STRIPE_SECRET_KEY` with a restricted test key (`rk_test_`) that can create, retrieve, and expire Checkout sessions. A standard test secret key (`sk_test_`) is also supported. Register a Stripe test-mode endpoint at staging's `/api/payments/webhooks/stripe/` and set staging's `STRIPE_WEBHOOK_SECRET` to that endpoint's signing secret. Keep production credentials out of staging.
- Use a staging Postmark server and verified sender. Limit the test customer and `SUPPORT_EMAIL` to approved inboxes before exercising any email-producing workflow.
- Verify registration and login, brief submission, private upload ownership, proposal and terms acceptance, and Stripe-hosted test Checkout. Confirm the signed test webhook marks only the matching project paid after validating session, amount, currency, and proposal fingerprint.
- Confirm an invalid signature and unmatched session leave payment state unchanged. Replay the valid signed test event and verify the payment timestamp remains unchanged and no duplicate email is delivered. An HTTP 503 indicates a reconciliation error. After fixing the cause, confirm Stripe redelivery succeeds or resend the same event from Stripe's staging endpoint dashboard.
- Confirm approved Postmark customer and staff inboxes receive the expected emails and audit records reflect their delivery. Finish preview review, change requests, and final approval in staging. Verify final approval leaves the live URL empty.

## Before changing production

- Record PR approval, approved merge commit, current production Git SHA, PythonAnywhere web-app configuration, and UTC start time.
- Confirm `WEBSITE_SERVICE_STRIPE_LIVE_ENABLED=false` before starting the release and immediately before reload.
- Create and verify a timestamped database backup using the production database provider's supported tool.
- Create and verify a timestamped backup of `WEBSITE_MATERIAL_ROOT`, preserving permissions and paths. Do not place private files in a public web directory.
- Record the current frontend/static release location and ensure the prior application revision and static build remain available for rollback.
- Confirm disk capacity, virtual-environment path, Node/Python versions, and maintenance contact.

## Required configuration (verify presence, never print values)

- Django `SECRET_KEY`, database connection settings, allowed hosts, frontend/site URLs, and normal production security settings.
- `WEBSITE_MATERIAL_ROOT` points to a private, backed-up directory.
- Preserve the existing production `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, and `STRIPE_CONNECT_WEBHOOK_SECRET` and their endpoint configuration. Verify through the existing configuration without printing secret values.
- Preserve the production Postmark configuration and keep `WEBSITE_SERVICE_STRIPE_LIVE_ENABLED=false`.

## Release steps

1. Fetch the approved revision, check out only the recorded merge commit, and verify `git rev-parse HEAD` exactly matches it.
2. Activate the production virtual environment and install locked backend requirements without exposing environment output.
3. Review the migration plan. Apply additive project migrations in repository order: `0335_website_service_checkout`, `0336_website_service_payment_integrity.py`, then `0337_website_service_checkout_attempt`. Stop on any unexpected plan.
4. Build the frontend from its lockfile. Preserve the previous build until verification completes.
5. Run Django checks and collect static assets using the established PythonAnywhere command/path.
6. Reload the PythonAnywhere web application once. Record reload time and application log location.

## Production smoke tests

- Confirm `/webdesign`, desktop/mobile layout, and all six template preview URLs return successfully with no missing images or broken navigation.
- Confirm registration and login routes load. Inspect application health and existing contractor milestone and Connect webhook status through logs or dashboards.
- Keep production verification read-only. Perform test payments, webhook replay, and email inbox checks only in staging.
- Reconfirm `WEBSITE_SERVICE_STRIPE_LIVE_ENABLED` remains false and record the deployed SHA.

## Rollback

1. Disable customer access to the newly affected path if integrity is uncertain; do not change existing milestone-payment settings.
2. Restore the prior recorded application revision and frontend/static build, then reload once.
3. Do not reverse additive migrations or delete private uploads after any customer record exists. Restore the database/private-file backup only under an incident plan that accounts for records created after backup.
4. Verify the prior public site and unrelated payment flows, preserve logs/webhook event IDs, and document the incident and final production SHA.
