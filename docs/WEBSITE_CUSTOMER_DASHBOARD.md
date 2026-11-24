# Website customer workspace

Customers use `/webdesign/dashboard` and their existing MyHomeBro credentials. The paid-service workspace is separate from the contractor self-service website builder and is available to any authenticated account without creating a contractor profile.

Customers can save a website brief, choose any of the six gallery designs, upload private materials, submit the brief for review, see progress and preview/live links, and send questions or change requests. After staff posts a complete proposal, the customer can review the price, deliverables, service terms, and refund terms, explicitly accept them, and continue to a separate website-service Stripe Checkout. A paid customer can approve a final preview; approval never publishes automatically. Customers cannot set production status, publication links, staff responses, proposal terms, payment state, or another owner's project.

Staff manage **Website service projects** in Django admin: filter by project/payment status, write proposals, update next steps, add preview/live links, download private materials, and answer/complete customer requests inline. Notification attempts and delivery results are retained with the project. Events include submissions, uploads, requests, proposals, payment confirmation, preview availability, staff responses, and final approval.

## Deployment

1. Run `python scripts/check-website-dashboard.py` using the production virtualenv from an isolated checkout. It configures an in-memory SQLite database and offline mail/SMS/payment providers; it does not operate on production records.
2. Build frontend with the supported Node version; run template-export regression tests.
3. Apply migration `0333_website_service_workspace`, collect static assets, reload the app, and verify the customer and admin entry points.
4. Private materials default to `<repository>/private_website_materials`, outside MEDIA_ROOT/static roots. Optionally set the Django setting `WEBSITE_MATERIAL_ROOT` to an absolute private directory. Do not create a public web-server mapping. Back up this directory together with the database; it contains customer originals. JPG/PNG/WebP images are decoded and checked; PDFs require a PDF header. Files are served only as attachments after owner or admin permission checks. This is not an antivirus scanning service.

Rollback: restore the previous application/frontend commit and reload, retaining the additive tables and private file directory. Do not reverse the migration once customer projects exist.

## Scope still to build

Website-specific registration wording beyond the universal customer registration flow, downloadable invoices/receipts, maintenance subscriptions, earned website credits, traffic/error reporting, antivirus scanning, and a richer staff dashboard. Existing customers/contractors can use their current credentials now. This dashboard is a project handoff and collaboration tool; website code changes continue through Codex/GitHub/hosting.

## QA commands

`python scripts/check-website-dashboard.py`

`node --test scripts/website-templates.test.mjs`

`cd frontend` then `npm run build`

Targeted browser test: `npx playwright test tests/website-customer-dashboard.spec.js` against the configured deployment. Requires Playwright's installed browser. Signed-in read-only coverage requires an approved storage-state fixture; no production mutation is part of the spec.
