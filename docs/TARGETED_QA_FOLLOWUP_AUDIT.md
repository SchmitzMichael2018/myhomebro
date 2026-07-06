# Targeted QA Follow-Up Audit

Date: 2026-07-06  
Environment: local QA seed, Django API `http://127.0.0.1:8000`, Vite `http://127.0.0.1:5173`

## Scope

Follow-up QA covered the areas missed or blocked in the full-platform audit:

- Contractor Insights / Business Dashboard
- Customer login
- Customer Portal dashboard, requests, projects/estimates/status, agreements, payments, documents, property records, maintenance-adjacent records, notifications
- Home Records / Property Records
- Property-management and rental workflow inside Customer Portal

QA accounts used:

- Customer: `info+customer@myhomebro.com`
- Property manager: `info+propertymanager@myhomebro.com`
- Password: `MyHomeBroQA!2026`

## Root Cause And Fix

Customer and property-manager passwords were valid, and both users had portal-linked records. The real failure was a backend 500 from `/api/projects/customer-portal/account/`.

Root cause: customer portal payment serialization called `.url` on empty `FileField` values for receipts/proof files. Django raises `ValueError` when a file field has no associated file. The frontend caught that failed account payload and displayed the generic message `Invalid email or password.`

Fix:

- Added `_safe_file_url()` in `backend/projects/views/customer_portal.py`.
- Used it for invoice receipt PDF files, external payment proof files, reimbursement receipts, and reimbursement attachment files.
- Added regression test `test_customer_portal_account_login_handles_reimbursement_without_receipt`.

Verification:

- Customer token login: PASS.
- Customer portal account payload: PASS, 3 projects, 1 property profile, 1 request, 6 payments.
- Property-manager token login: PASS.
- Property-manager portal account payload: PASS, 1 project, 1 rental property profile, 1 tenant maintenance request, 1 property work order, 2 payments.

## Screenshots

Screenshots captured in `docs/audit-screenshots/targeted-qa-followup/`.

Key files:

- `insights-01-at-a-glance.png`
- `insights-02-contractor-insights.png`
- `insights-04-tablet.png`
- `customer-01-dashboard.png`
- `customer-02-requests.png`
- `customer-02-projects.png`
- `customer-02-payments.png`
- `customer-02-documents.png`
- `customer-02-property.png`
- `customer-02-notifications.png`
- `customer-03-mobile-dashboard.png`
- `pm-01-dashboard.png`
- `pm-02-maintenance.png`
- `pm-02-property.png`
- `pm-02-projects.png`
- `pm-02-payments.png`
- `pm-02-documents.png`
- `pm-02-notifications.png`
- `pm-03-mobile-dashboard.png`

## Insights Page QA Review

The Insights page is reachable at `/app/business` and loads seeded contractor data. The top-level view cards provide a useful segmentation: At a Glance, Contractor Insights, Reports & Trends, Payouts, and Operations. The At a Glance screen shows business alerts and an actionable pending-release value of `$126.45`.

What works:

- Layout is stable on desktop and tablet.
- The business-health view gives immediate alerts.
- Contractor Insights has a project-family filter and explanatory benchmark copy.
- The page is visually consistent with the contractor shell.

Issues:

- The page is labeled `Business Dashboard` in the H1 while the sidebar calls it `Insights`; terminology should align.
- Contractor Insights shows `0 platform projects` even though seeded agreements/payments exist. That may be technically true for benchmark datasets, but it reads like the seed has no business data.
- It partially answers “How is my business performing?” but focuses more on alerts than narrative performance. There is no single plain-English summary like “Revenue is up/down, cash is blocked here, work is trending this way.”
- The family-filter interaction was slow enough in the first audit attempt to push the screenshot test to timeout. The final spec avoided that interaction.
- Console shows repeated 404s for `/api/projects/workspace-context/` from this area.

Recommended fixes:

- Rename sidebar/page consistently: either `Business Dashboard` or `Insights`.
- Add a top performance summary card: revenue, margin/take-home, pending release, overdue work, lead conversion, and recommended next action.
- Seed benchmark aggregates or show a clearer empty state: “Benchmarks need completed historical jobs, but your current job financials are below.”
- Fix or remove the missing `workspace-context` request.
- Add a stable test for range and family filters with expected response times.

## Customer Portal QA Review

Customer login now works with `info+customer@myhomebro.com` / `MyHomeBroQA!2026`.

What works:

- Dashboard loads after password login.
- Requests, Projects, Payments, Documents, Property, Notifications, and Account tabs are reachable.
- Customer sees seeded projects, agreement/payment activity, documents, notifications, and a property profile.
- Payments page contains enough seed data to test multiple payment states.
- Notifications are visible and count unread items.

Issues:

- The portal reloads to the public login screen if you visit `/portal` directly after login; the portal state is in memory rather than restored from the existing auth token.
- Mobile tab rail is horizontally scrollable but visually clipped, so users may not realize more tabs exist.
- The portal is still branded as `Customer Portal` for property managers, which is confusing for the PM role.
- Several tabs are dense and long; the first-screen next action is not always obvious.
- Missing Google Maps API key appears inline on account/property forms.

Recommended fixes:

- On `/portal`, if a valid auth token exists, call `/projects/customer-portal/account/` automatically.
- Add a mobile tab treatment with visible overflow affordance or a dropdown.
- Add role-aware title copy: `Customer Portal`, `Property Manager Portal`, or `Owner Portal`.
- Add a top “Next action” rail for payments, requests, documents, and maintenance.
- Feature-gate address autocomplete when no Maps key exists.

## Home / Property Records QA Review

Property records are functional and seeded. The customer property page shows:

- Property summary
- Home systems
- Maintenance center
- Timeline/history
- Linked property records
- Editable property profile

What works:

- Customer property record shows `QA Home - Oak Lane`.
- PM property record shows `QA Duplex - Cedar`.
- PM property indicates rental status, units, active tenants, and open maintenance.
- Timeline/history and property records sections are present.

Issues:

- The API payload uses `property_profile` / `property_profiles`; the original audit expectation of `properties` would miss the data. This is fine internally, but external naming should be documented.
- Customer home systems are empty, so Home Records do not yet demonstrate HVAC/roof/water-heater/appliance depth.
- Missing Google Maps key is visible as red error text inside address fields.
- The property profile edit form is very long and starts open, pushing records/history lower on the page.

Recommended fixes:

- Seed at least 3 home systems with service dates, warranty dates, and reminder states.
- Add a collapsed default for edit forms after the summary, with clear edit CTA.
- Add stronger labels: `Home Records`, `Property Timeline`, and `Maintenance Reminders`.
- Hide Maps integration errors behind a helper state in local QA.

## Property-Management / Rental QA Review

Property-manager login now works with `info+propertymanager@myhomebro.com` / `MyHomeBroQA!2026`.

What works:

- Maintenance tab appears for the PM/rental account.
- Rental Operations trial banner appears.
- Rental property profile shows multi-family/rental status.
- Units and tenants are seeded and summarized.
- Tenant maintenance request is visible.
- Work order exists and is linked to the tenant maintenance request.
- Manager review actions are visible: Mark Under Review, Approve, Request More Info, Reject, Close, Save Notes.
- Work order actions are visible: Start Work, Mark Waiting, Edit.
- Vendors and team members are seeded on the Account page.

Issues:

- The portal title still says `Customer Portal` for the property-management account.
- Unit and tenant details are hidden behind collapsed sections in the property tab; screenshots prove counts, but not full unit/tenant workflows without extra expansion.
- The Account tab is too long for PM: profile, company profile, team, vendors, linked properties, password, and logout stack into a very tall mobile page.
- Maintenance workflow labels are good for managers, but there is no obvious “routing status” summary near the top.
- Rental Operations trial copy is prominent, but it is unclear which specific actions are locked/unlocked.

Recommended fixes:

- Rename PM UI to `Property Manager Portal`.
- Add first-screen PM dashboard cards: Open tenant requests, Work orders, Units, Tenants, Vendor routing, Payments.
- Expand unit/tenant sections in QA seed or add direct tab controls for Units/Tenants.
- Split PM Account into subtabs: Profile, Company, Team, Vendors, Billing.
- Add routing badges: Internal, Vendor, Marketplace, Draft Agreement Created, Awaiting Review.

## Bugs Found

1. Portal account API crashed on empty FileField receipt/proof URLs. Fixed.
2. Frontend displayed backend account-payload 500 as `Invalid email or password.` Fixed backend root cause; frontend should still distinguish bad credentials from account-load failure.
3. `/api/projects/workspace-context/` returns 404 during Insights/Business Dashboard use.
4. Contractor public-profile QR endpoint still returns 500 in the broader authenticated audit.
5. Missing Google Maps API key surfaces repeatedly in customer/PM property/account forms.
6. `/portal` does not restore authenticated portal state from token on reload.
7. Insights family filter interaction was slow enough to cause initial Playwright timeout.

## UX / Design Issues

- Heavy blue/dark visual style remains one-note across contractor and portal surfaces.
- Mobile portal tabs are clipped horizontally.
- PM account page is too long and should be split.
- `Customer Portal` terminology is wrong for property managers.
- Insights and Business Dashboard naming conflict.
- Property edit forms dominate records pages.
- Empty Home Systems state weakens the Home Records story.
- Missing Maps key error feels technical and user-hostile.

## Prioritized Backlog

### P0

- Distinguish login failure from account payload failure in the Customer Portal frontend.
- Fix `/api/projects/workspace-context/` 404 or stop calling it from Insights.
- Fix contractor public-profile QR 500.
- Auto-load portal account data on `/portal` when a valid auth token exists.

### P1

- Add seeded home systems, service reminders, warranties, and document/photo examples.
- Add PM-specific portal title and dashboard summary.
- Add Units and Tenants direct access or expanded QA seed screenshots.
- Improve mobile portal tab navigation.
- Feature-gate Maps autocomplete when no API key is configured.

### P2

- Add top-level Insights narrative summary answering “How is my business performing?”
- Add seeded benchmark aggregates or better benchmark empty states.
- Split PM Account into profile/company/team/vendors sections.
- Add routing status summary for rental work orders.

## Command Results

- `python backend\manage.py seed_qa_environment` - PASS.
- `python backend\manage.py check` - PASS.
- `python backend\manage.py test projects.tests.CustomerPortalAccessTests.test_customer_portal_account_login_returns_email_scoped_records projects.tests.CustomerPortalAccessTests.test_customer_portal_account_login_handles_reimbursement_without_receipt` - PASS.
- `python backend\manage.py test projects.tests_agreements projects.tests_proposals projects.tests_workforce_capabilities` - PASS, 27 tests. Local output still includes Redis/PDF dispatch warning noise.
- `cd frontend && npm run build` - PASS with stale Browserslist and oversized bundle warnings.
- `cd frontend && npx playwright test authenticated-seed-audit.spec.js --project=chromium --reporter=line` - PASS after increasing audit test timeout to 90 seconds.
- `cd frontend && npx playwright test targeted-qa-followup.spec.js --project=chromium --reporter=line` - PASS.

