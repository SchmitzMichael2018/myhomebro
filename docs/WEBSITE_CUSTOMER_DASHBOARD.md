# Website customer workspace

Customers use `/webdesign/dashboard` and their existing MyHomeBro credentials. The paid-service workspace is separate from the contractor self-service website builder and is available to any authenticated account without creating a contractor profile.

Customers can save a website brief, choose any of the six gallery designs, upload private materials, submit the brief for review, see progress and preview/live links, and send questions or change requests. Customers cannot set production status, publication links, staff responses, or another owner's project. No site is published automatically.

Staff manage **Website service projects** in Django admin: filter by status, update next steps, add preview/live links, download private materials, and answer/complete customer requests inline. Django admin records staff changes through its normal log. Check this queue regularly; this release does not send email or SMS notifications.

## Deployment

1. Run `python scripts/check-website-dashboard.py` using the production virtualenv from an isolated checkout. It configures an in-memory SQLite database and offline mail/SMS/payment providers; it does not operate on production records.
2. Build frontend with the supported Node version; run template-export regression tests.
3. Apply migration `0333_website_service_workspace`, collect static assets, reload the app, and verify the customer and admin entry points.
4. Private materials default to `<repository>/private_website_materials`, outside MEDIA_ROOT/static roots. Optionally set the Django setting `WEBSITE_MATERIAL_ROOT` to an absolute private directory. Do not create a public web-server mapping. Back up this directory together with the database; it contains customer originals. JPG/PNG/WebP images are decoded and checked; PDFs require a PDF header. Files are served only as attachments after owner or admin permission checks. This is not an antivirus scanning service.

Rollback: restore the previous application/frontend commit and reload, retaining the additive tables and private file directory. Do not reverse the migration once customer projects exist.

## Scope still to build

Website-specific new-customer registration (including restaurant wording), checkout/invoices, maintenance subscriptions, earned website credits, automated notifications, traffic/error reporting, and a richer staff dashboard. Existing customers/contractors can use their current credentials now. This dashboard is a project handoff and collaboration tool; website code changes continue through Codex/GitHub/hosting.

## QA commands

`python scripts/check-website-dashboard.py`

`node --test scripts/website-templates.test.mjs`

`cd frontend` then `npm run build`

Targeted browser test: `npx playwright test tests/website-customer-dashboard.spec.js` against the configured deployment. Requires Playwright's installed browser. Signed-in read-only coverage requires an approved storage-state fixture; no production mutation is part of the spec.
