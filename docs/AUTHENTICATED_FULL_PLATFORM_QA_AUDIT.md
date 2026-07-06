# Authenticated Full-Platform QA Audit

Date: 2026-07-06  
Branch: `qa/full-platform-walkthrough`  
Environment: local QA seed, Django API at `http://127.0.0.1:8000`, Vite app at `http://127.0.0.1:5173`  
Seed command: `python backend\manage.py seed_qa_environment`

## QA Credentials

Password for every seeded account: `MyHomeBroQA!2026`

- Contractor: `info+contractor@myhomebro.com`
- Customer: `info+customer@myhomebro.com`
- Property manager: `info+propertymanager@myhomebro.com`
- Employee: `info+employee@myhomebro.com`
- Subcontractor: `info+subcontractor@myhomebro.com`

No production data, real email/SMS, or real Stripe payments were used.

## Seeded Data Verified

- Users: 5
- Contractors: 1
- Customers: 2
- Properties: 2
- Agreements: 4
- Milestones: 12
- Opportunities: 1
- Tenant requests: 1
- Work orders: 1

Seeded agreement states include draft, sent, signed, and funded examples. The seed also includes workforce capabilities, labor costs, subcontractor invitations, estimate availability, estimate checklists, expenses, incidentals reserve examples, property-management examples, documents, and photo placeholders.

## Screenshot Evidence

Screenshots were captured in `docs/audit-screenshots/authenticated-full-platform/`.

- Contractor: dashboard, opportunities, estimate workspace, agreement wizard, funded agreement workspace, team, employees/labor, subcontractors, schedule, estimate availability, expenses, payments, templates, marketing/docs/photos.
- Customer: returning-customer login failure.
- Property manager: returning-customer login failure.
- Employee: dashboard, agreements, milestones, calendar, mobile dashboard.
- Subcontractor: assigned work and invitation acceptance.

## Executive Readiness Score

Overall authenticated product readiness: **67/100**

MyHomeBro has a large amount of contractor-side workflow built and reachable with the QA seed. The main readiness drag is not lack of feature surface; it is reliability, role completion, and workflow continuity. Contractor, employee, and subcontractor views load, but customer/property-manager authenticated portal access is blocked through password login, the marketing public-profile setup throws a load error, the Playwright suite is too slow/flaky for reliable regression confidence, and several flows still feel like connected modules rather than one guided operating system.

## Highest Priority Findings

1. **Customer and property-manager password login fails for seeded QA users.**  
   Evidence: `customer-00-login-failed.png`, `property-manager-00-login-failed.png`. The users exist and share the documented QA password, but `/portal` returns `Invalid email or password.` This blocks complete authenticated customer and property-manager QA through the normal returning-user path.

2. **Contractor marketing/public profile fails to load settings.**  
   Evidence: `contractor-14-marketing-docs-photos.png`. The UI shows `Could not load public profile settings.` During automation, `/api/projects/contractor/public-profile/qr/` returned HTTP 500. This breaks online presence setup and QR readiness.

3. **Full Playwright regression run timed out.**  
   `cd frontend && npx playwright test` did not finish within the 5 minute command timeout. The app needs a reliable smoke/regression split so a QA seed can prove baseline health quickly.

4. **Default Django test discovery returned zero tests.**  
   `python backend\manage.py test` completed with `Ran 0 tests`. Targeted app tests exist, but the default test command does not discover them, which can create false confidence.

5. **Incidentals reserve state is contradictory in Expenses.**  
   Evidence: `contractor-11-expenses.png`. The page shows pending incidentals and spent incidentals, but both original and remaining reserve say `Not configured` / `--`. This is confusing and may point to a serializer/data-source mismatch.

6. **Google Maps API key missing in local QA creates address-autocomplete console errors.**  
   This degrades address and property entry workflows in estimate/agreement setup. It should be feature-gated or downgraded gracefully in QA.

7. **Employee mobile dashboard has header crowding and clipped title.**  
   Evidence: `employee-05-mobile-dashboard.png`. The menu button, title, assistant button, and notification button occupy the same first row awkwardly; the title begins off-screen/under the menu area.

8. **Seeded customer/PM portal gap limits end-to-end proof of payments, documents, warranties, maintenance, and property records.**  
   The portal landing UI exists, but authenticated portal dashboards could not be reached via the documented credentials.

9. **Important action buttons can be disabled without clear reason.**  
   Evidence: `contractor-03-estimate-workspace.png`, `contractor-05-funded-agreement-workspace.png`. Examples include `Create Agreement from Estimate` and several agreement workspace actions. Users need the blocking reason inline.

10. **Navigation surface is broad and visually heavy.**  
    The contractor app exposes many modules at once. It is powerful, but the daily path from lead to estimate to agreement to funded work to payout is not yet obvious enough.

## UX And Workflow Audit

### Contractor

The contractor experience has the strongest coverage. Dashboard, opportunity intake, estimate readiness, agreement workspace, staffing, expenses, payments, templates, and marketing are all reachable. The core issue is continuity: each module looks like a serious tool, but the handoff between modules is still too manual.

The largest duplicated-entry risk is the path from opportunity/intake to estimate checklist to agreement wizard. Customer, address, scope, schedule, line items, photos, documents, and reserve context can appear in multiple places. The product should treat the accepted estimate as the source of truth and allow the agreement wizard to confirm or amend, not re-enter.

The `AI Operations Manager` is directionally useful, but it needs clearer prioritization. It should answer: what needs doing today, who owns it, what blocks it, and what money is at risk. Right now it competes with Quick Actions and dense dashboard sections.

### Customer

The portal landing page has a clear promise: projects, payments, documents, warranties, and property records in one place. The failure is operational: seeded password login cannot reach the portal. Until this works, customer-facing QA cannot validate milestone approval, payments, documents, warranties, and property history through the normal authenticated flow.

### Property Manager

The seed includes property-management examples, tenant request, work order, rental property, and manager customer. The normal returning-user login still fails, so the role cannot be validated as a real property-management operator. This is a blocker for proving multi-property, tenant-request, vendor, and maintenance workflows.

### Employee

Employee pages load and show assigned work, milestones, agreements, and calendar. This is promising. The mobile experience needs refinement: the header layout is cramped, and work cards should lead with schedule, location, role, and the next action. A field employee should be able to answer "where am I going, what am I doing, and what proves completion?" in under five seconds.

### Subcontractor

Assigned work loads, and the invitation acceptance page correctly shows an accepted invitation state. This role needs stronger next actions after acceptance: scope, dates, location, insurance/document requirements, contact method, and invoice/payment expectations.

## UI And Visual Audit

- The dark contractor shell is recognizable and branded, but the app is visually dominated by blue gradients and glass panels.
- Card density is high. Several pages use cards inside card-like regions, making hierarchy harder to scan.
- Buttons and pills often have similar visual weight, so primary versus secondary actions are not always obvious.
- Large section headers inside operational pages consume vertical space that could be used for job-critical details.
- Mobile employee layout needs an explicit compact header pattern.
- Toasts are useful but sometimes reveal technical failures without a path to fix.
- Marketing setup switches to a white content panel inside the dark contractor shell; that may be intentional, but it feels visually disconnected from adjacent modules.

## Architecture And Source-Of-Truth Risks

- Customer identity appears split across Django users, portal access links, customer records, and property-manager examples. The seed exposes a password-login mismatch.
- Project data may be represented across opportunity, proposal, agreement, property, checklist, milestone, and payment models. Without a clear canonical handoff, duplicate entry and stale fields are likely.
- Incidentals reserve appears in proposal, agreement, funding, customer portal, and expense logic. The expenses screenshot suggests the UI may not be resolving one consistent reserve summary.
- Public profile setup and QR generation should degrade gracefully if a contractor has no profile/settings yet.
- Test discovery and e2e runtime should be treated as architecture issues because they directly affect release confidence.

## Missing Functionality Or Automation

- Accepted estimate should create or update a draft agreement with field mapping and a visible diff.
- Estimate readiness should explain exactly why an action is disabled.
- Agreement workspace should have one "next best action" rail that survives across tabs.
- Customer portal should support seeded password login and secure-link login as separate, tested flows.
- Property manager role needs first-class multi-property dashboards, tenant requests, work orders, and owner/vendor communications.
- Incidentals reserve should have one ledger with original, pending, approved, spent, remaining, and refund status.
- Documents/photos placeholders need visible upload/download/version states in the QA seed.
- Payments and funding states need a test-mode ledger that never calls live Stripe but still validates user flows.
- Workforce assignment should recommend crew based on capabilities, schedule, labor cost, and conflicts.
- Employee and subcontractor views need completion proof workflows: photos, notes, materials used, customer signoff, and issue escalation.

## Duplicate Entry Risks

- Customer name/email/phone between intake, estimate, agreement, and portal.
- Property address between address autocomplete, property profile, estimate, and agreement wizard.
- Scope and line items between proposal checklist and agreement terms.
- Schedule windows between estimate availability, agreement milestones, employee schedule, and customer portal.
- Incidentals reserve between proposal line items, agreement funding, and expense requests.
- Documents/photos between estimate evidence, agreement records, marketing gallery, and customer property records.
- Subcontractor scope between agreement assignment, subcontractor invitation, and assigned-work page.

## Top 50 Recommendations

1. Fix seeded customer password login.
2. Fix seeded property-manager password login.
3. Add tests for customer portal returning-login authentication.
4. Add tests for secure-link portal authentication.
5. Fix public-profile QR endpoint 500.
6. Make public-profile settings creation lazy and safe for new contractors.
7. Feature-gate Google Maps autocomplete when no API key is configured.
8. Create a `qa-smoke` Playwright project under 2 minutes.
9. Split full Playwright into smoke, workflow, and visual suites.
10. Fix Django default test discovery or document the canonical targeted command.
11. Add a seed verification command or `--verify-only` mode.
12. Add seeded IDs/tokens to seed command output for e2e automation.
13. Give disabled buttons inline blocking reasons.
14. Add an estimate-to-agreement field mapping review screen.
15. Add a visible diff when estimate data changes after agreement draft creation.
16. Make agreement workspace next action persistent across tabs.
17. Add a customer-facing payment/funding test-mode ledger.
18. Unify incidentals reserve summary across expenses, funding, and portal.
19. Add reserve refund state to the UI.
20. Add reserve overage prevention messaging before submission.
21. Build property-manager dashboard for properties, tenants, work orders, vendors, and payments.
22. Add tenant-request to estimate/opportunity conversion.
23. Add work-order status timeline.
24. Add customer portal document and warranty smoke tests.
25. Add property records smoke tests.
26. Add employee mobile layout regression screenshots.
27. Redesign employee mobile header to avoid title clipping.
28. Put location, due date, and proof requirements first on employee work cards.
29. Add subcontractor post-acceptance next action.
30. Add subcontractor scope confirmation.
31. Add subcontractor insurance/document placeholders to the seed.
32. Add crew recommendation explanations using capability, availability, and cost.
33. Add schedule conflict warnings to assignment flows.
34. Add payment-state labels that explain direct pay versus escrow.
35. Add Stripe test-mode badges anywhere funding/payment actions appear.
36. Add no-real-email/SMS guardrails to QA settings.
37. Add mock email/SMS outbox views for QA.
38. Add stable `data-testid` coverage to key portal tabs.
39. Reduce contractor dashboard visual noise by grouping daily actions.
40. Normalize button hierarchy across dashboard, estimate, and agreement pages.
41. Replace technical failure toasts with actionable recovery states.
42. Add empty-state CTAs for marketing/public-profile setup.
43. Add seeded photo/document thumbnails that prove media flows render.
44. Add audit trail visibility for agreement state changes.
45. Add PDF version smoke test with a seeded signed agreement.
46. Add milestone completion proof smoke test.
47. Add invoice creation and approval smoke test.
48. Add dispute creation smoke test with non-destructive seed data.
49. Add a QA matrix mapping seeded objects to workflows.
50. Track release readiness from seed, backend checks, frontend build, smoke e2e, and authenticated role audit.

## Suggested Backlog

### P0

- Fix customer/property-manager seeded portal authentication.
- Fix public-profile QR/settings endpoint failure.
- Fix incidentals reserve summary mismatch.
- Create a reliable seeded smoke suite that completes quickly.

### P1

- Add disabled-action explanations.
- Add estimate-to-agreement mapping review.
- Improve employee mobile header and field-work card hierarchy.
- Add customer and property-manager portal tab smoke tests.

### P2

- Reduce dashboard and workspace visual density.
- Add QA mock email/SMS outbox.
- Add seeded media thumbnails and document version examples.
- Add richer subcontractor acceptance and assigned-work steps.

## Daily Frustration Answer

The most frustrating daily issue for a real contractor would be not knowing the single next place to work. The platform has many useful modules, but the user still has to interpret which estimate, agreement, milestone, expense, payment, or assignment needs attention and why. A persistent job command center should show the next action, blocker, owner, due date, money at risk, and one primary button for every active job.

## Command Results

- `python backend\manage.py seed_qa_environment` - PASS.
- Seed verification via Django shell counts - PASS.
- `python backend\manage.py check` - PASS.
- `python backend\manage.py test` - NEEDS REFINEMENT: command completed but discovered 0 tests.
- `python backend\manage.py test projects.tests_agreements projects.tests_proposals projects.tests_workforce_capabilities` - PASS: 27 tests. Local output included repeated PDF task dispatch warnings because Redis is not available in this test context.
- `python backend\manage.py makemigrations --check --dry-run` - PASS.
- `cd frontend && npm run build` - PASS with warnings: stale Browserslist database and a large bundle chunk around 4.75 MB minified.
- `cd frontend && npx playwright test` - FAIL/NEEDS REFINEMENT: command timed out after roughly 5 minutes.
- `cd frontend && npx playwright test dashboard.spec.js contractor-bids.spec.js customer-portal.spec.js assignments.spec.js --project=chromium` - FAIL/NEEDS REFINEMENT: command timed out after roughly 5 minutes and left partial Playwright artifacts without a final status file.
- `cd frontend && npx playwright test authenticated-seed-audit.spec.js --project=chromium --reporter=line` - PASS; screenshots captured.

## Blocked

- Complete authenticated customer portal workflow via documented password credentials.
- Complete authenticated property-manager workflow via documented password credentials.
- Full-suite Playwright regression confidence because the full suite did not complete within the command timeout.
