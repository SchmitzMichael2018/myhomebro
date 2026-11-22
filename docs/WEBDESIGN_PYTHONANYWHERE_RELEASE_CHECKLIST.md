# Website service controlled release checklist

Use only after PR approval. Do not enable live website-service payments during the controlled release.

## Before changing production

- Record PR approval, approved merge commit, current production Git SHA, PythonAnywhere web-app configuration, and UTC start time.
- Confirm `WEBSITE_SERVICE_STRIPE_LIVE_ENABLED` is absent or false.
- Create and verify a timestamped database backup using the production database provider's supported tool.
- Create and verify a timestamped backup of `WEBSITE_MATERIAL_ROOT`, preserving permissions and paths. Do not place private files in a public web directory.
- Record the current frontend/static release location and ensure the prior application revision and static build remain available for rollback.
- Confirm disk capacity, virtual-environment path, Node/Python versions, and maintenance contact.

## Required configuration (verify presence, never print values)

- Django `SECRET_KEY`, database connection settings, allowed hosts, frontend/site URLs, and normal production security settings.
- `WEBSITE_MATERIAL_ROOT` points to a private, backed-up directory.
- `SUPPORT_EMAIL` is the approved staff recipient.
- Postmark server token and verified sender are configured; use approved test recipients for the first delivery.
- Stripe test secret key and test webhook signing secret are configured for the website-service test. Preserve all existing contractor milestone-payment configuration.
- `WEBSITE_SERVICE_STRIPE_LIVE_ENABLED=false` (or unset).

## Release steps

1. Fetch the approved revision, check out only the recorded merge commit, and verify `git rev-parse HEAD` exactly matches it.
2. Activate the production virtual environment and install locked backend requirements without exposing environment output.
3. Review the migration plan. Apply additive project migrations in repository order: `0335_website_service_checkout`, `0336_website_checkout_fingerprint`, then `0337_website_service_checkout_attempt`. Stop on any unexpected plan.
4. Build the frontend from its lockfile. Preserve the previous build until verification completes.
5. Run Django checks and collect static assets using the established PythonAnywhere command/path.
6. Reload the PythonAnywhere web application once. Record reload time and application log location.

## Production smoke tests

- Confirm `/webdesign`, desktop/mobile layout, and all six template preview URLs return successfully with no missing images or broken navigation.
- Confirm registration/login routing, but use only the approved test account and records.
- Create an isolated website project, edit/submit its brief, upload a harmless test image/PDF, and verify another test user cannot read it.
- Prepare an unmistakably test proposal, accept its displayed service/refund terms, and complete Stripe test-mode Checkout.
- Confirm the signed webhook targets the correct project, exact amount/currency/fingerprint match, payment becomes paid once, and replay creates no duplicate confirmation.
- Confirm approved Postmark customer/staff inboxes receive the expected messages and failed attempts remain visible in the event audit.
- Add a preview URL, submit/respond to a change request, and record final approval. Confirm no live URL is created and nothing publishes automatically.
- Reconfirm `WEBSITE_SERVICE_STRIPE_LIVE_ENABLED` remains false and record the deployed SHA.

## Rollback

1. Disable customer access to the newly affected path if integrity is uncertain; do not change existing milestone-payment settings.
2. Restore the prior recorded application revision and frontend/static build, then reload once.
3. Do not reverse additive migrations or delete private uploads after any customer record exists. Restore the database/private-file backup only under an incident plan that accounts for records created after backup.
4. Verify the prior public site and unrelated payment flows, preserve logs/webhook event IDs, and document the incident and final production SHA.
