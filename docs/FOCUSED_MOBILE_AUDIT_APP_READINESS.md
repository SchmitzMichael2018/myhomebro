# Focused Mobile Audit & App Readiness

Date: July 9, 2026

Scope: Mobile web usability, responsive layout coverage, customer/contractor/property-manager mobile workflows, Project Assistant mobile behavior, PWA readiness, and future native app readiness. This is an audit-only pass.

## Executive Summary

MyHomeBro is ready for limited beta as a mobile-responsive web app, especially for customer portal, public intake, quote/opportunity review, customer records, and agreement review flows. The strongest mobile surfaces are customer-facing: intake, portal access, property records, uploads, and customer records have direct mobile regression coverage and passed in this audit.

The contractor mobile experience is usable for field-adjacent work, but it is not yet a true field app. Contractors can review opportunities and move into agreement workflows on mobile, but dense operational workspaces like Agreement Workspace, Team Schedule, Payments, Insights, Marketing, and Admin still feel desktop-first and need a broader visual/device pass before they should be positioned as primary mobile workflows.

PWA readiness is partial. The repo has mobile icons and the `vite-plugin-pwa` dependency, but the Vite config does not register the PWA plugin, `index.html` does not link a web app manifest, and there is no active service-worker registration. MyHomeBro should launch mobile web first, add PWA install support next, and defer native apps until beta usage proves which workflows deserve app-store distribution.

## Recommendation

Launch strategy:

1. Mobile-responsive web app for limited beta.
2. Progressive Web App after launch-hardening.
3. Native mobile apps later for contractor field work, customer approvals, property/tenant maintenance, push notifications, and camera-first uploads.

Mobile readiness score: 7.3 out of 10.

Limited beta mobile web status: Ready with known constraints.

Broad public mobile launch status: Needs refinement.

PWA status: Not ready yet.

Native app status: Not ready and not recommended for launch.

## Validation Evidence

Fresh mobile-focused tests run:

```bash
cd frontend
npx playwright test login.spec.js public-intake-branching.spec.js customer-portal.spec.js customer-records.spec.js --project=chromium --reporter=line --retries=0 --timeout=30000 -g "mobile|landing page mobile layout"
# PASS, 8 passed

npx playwright test contractor-bids.spec.js business-dashboard-payouts.spec.js agreement-basic.spec.js --project=chromium --reporter=line --retries=0 --timeout=30000 -g "quote requests open the convert-to-agreement panel|dashboard charts handle empty datasets and mobile drilldown|agreement workspace.*mobile|mobile"
# PASS, 1 passed
```

Previously validated mobile-adjacent evidence reviewed:

- Integrated intake -> estimate -> agreement flow captures a mobile Agreement Wizard finalize screenshot.
- Customer portal suite includes mobile access page, mobile project list reload, and mobile upload session coverage.
- Customer records suite includes mobile no-overflow and card layout coverage.
- Public intake suite includes mobile compact progress/actions coverage.
- Contractor opportunities suite includes a mobile quote request -> agreement wizard path.
- Targeted QA follow-up captured tablet Insights and mobile customer/property-manager portal screenshots.

PWA/static review:

- `frontend/public` contains app icons.
- `frontend/package.json` includes `vite-plugin-pwa`.
- `frontend/vite.config.js` does not register `VitePWA`.
- `frontend/index.html` has viewport and favicon, but no manifest, theme color, apple touch icon link, or app-capable meta tags.
- `frontend/src/serviceWorker.js` and `frontend/src/swOFF.js` unregister service workers rather than enabling offline/install behavior.

## Workspace-By-Workspace Mobile Review

| Workspace | Mobile Status | Findings |
| --- | --- | --- |
| Login / landing | Ready for beta | Mobile overflow test passed at 390px. Login choices are reachable. |
| Public intake | Ready for beta | Mobile progress/actions compact test passed. Good first mobile customer entry point. |
| Dashboard | Usable, needs polish | Mobile shell exists, but dashboard density and card ordering need broader device review. |
| Opportunities | Ready for beta for review/response | Mobile quote request -> agreement wizard path passed. Detail drawers need continued no-overflow testing. |
| Estimates | Usable, needs focused pass | Integrated flow reaches estimate workspace; mobile-specific list/workspace coverage should be expanded. |
| Agreement Wizard | Ready for beta | Integrated flow captures mobile Step 4 finalize; estimate-prefill and handoff are stable. Long forms still need sticky-action review. |
| Agreement Workspace | Usable, desktop-leaning | Existing coverage checks mobile overflow in workspace. Milestones/PDFs/payments/documents remain dense on phone. |
| Customer Portal | Strongest mobile area | Mobile access, dashboard reload, uploads, property records, and customer cards have coverage. |
| Payments | Usable, high risk | Payment cards are customer-readable, but funding/release/refund flows need real mobile payment-method review. |
| Milestone approval | Needs dedicated mobile QA | Customer approval should be simple, but paid vs zero-dollar approval should get a phone-specific regression. |
| Warranty request | Usable, needs more device coverage | Warranty evidence/upload flow uses responsive patterns, but long forms and attachment previews need phone review. |
| Resolution Workspace | Usable, desktop-leaning | Recommendation cards are responsive enough conceptually, but evidence/COA/timeline density is high. |
| Team Schedule | Desktop-first | Schedule/calendar views are likely hard to use on phone. Best mobile use is “my schedule / today / assigned work,” not full team planning. |
| Marketing | Desktop-first for editing | Website Builder has a mobile preview mode, but editing campaigns/SEO/pages is too dense for core mobile use. |
| Insights | Tablet-friendly, phone-limited | Tablet screenshot coverage exists. Charts/tables need phone-specific card summaries and drilldown polishing. |
| Admin | Desktop-only for launch | Admin can remain desktop-first. Mobile admin is not a launch requirement. |
| Guided Help | Likely usable | Simple guidance content should work, but modal/long-card behavior should be checked on small screens. |
| Project Assistant | Mixed | Shared cards are responsive, but the dock is desktop-only at `xl`. Mobile needs an explicit bottom sheet or full-screen assistant pattern later. |

## Customer Mobile Findings

Customer mobile is beta-ready for core guided flows:

- Submit a project request.
- Log into Customer Portal.
- Review projects and agreements.
- Access records/documents.
- Upload home/property documents.
- View property and maintenance state.
- Reach payment and escrow history surfaces.

Customer mobile strengths:

- Public intake is direct and phone-friendly.
- Portal navigation uses horizontal tabs that work better than a desktop sidebar on mobile.
- Upload-session mobile coverage passed.
- Customer records mobile no-overflow coverage passed.
- The customer experience is more guided than administrative.

Customer mobile risks:

- Agreement PDF viewing may be awkward on small screens.
- Signature and payment flows need real-device review, especially with mobile browser payment sheets.
- Milestone approval needs dedicated phone coverage for paid and zero-dollar paths.
- Resolution cases can become information-dense with evidence, COAs, messages, and documents.
- Long property records/forms may need step-by-step mobile editing.

Customer mobile launch status: Ready for limited beta, with manual support nearby for payment/signature edge cases.

## Contractor Mobile Findings

Contractor mobile is useful for field checks, but not yet a full contractor app.

Contractor mobile strengths:

- Opportunity review and quote-request conversion work on a phone-sized viewport.
- Agreement Wizard can reach finalize on mobile.
- Mobile sidebar shell provides hamburger/overlay navigation for authenticated app pages.
- File/photo upload patterns exist across agreements, warranty, property records, and customer portal surfaces.
- Project Assistant can provide contextual guidance in page panels.

Contractor mobile risks:

- Agreement Workspace is dense: milestones, PDFs, payment activity, documents, disputes, assignments, and warranty all compete for vertical space.
- Team Schedule and workforce management are too complex for full phone administration.
- Payments and reimbursements should be reviewed on mobile before field contractors rely on them.
- Marketing/website editing is not a good primary phone workflow.
- Project Assistant dock is hidden until `xl`, so mobile users depend on inline panels rather than a mobile assistant drawer.

Contractor mobile launch status: Ready for light field use, not ready to market as a full mobile field app.

Best contractor beta mobile workflows:

- Check dashboard.
- Review/respond to opportunities.
- Open estimates.
- Review project/agreement state.
- Complete milestone basics.
- Upload photos.
- Check schedule.
- Review warranty request.
- Use inline Project Assistant guidance.

Desktop-first contractor workflows for now:

- Full agreement authoring.
- Complex milestone planning.
- Team capacity management.
- Detailed payment/reimbursement operations.
- Marketing/website builder.
- Insights analysis.

## Property Manager And Tenant Mobile Findings

Property/tenant workflows are a good candidate for mobile-first investment.

Strengths:

- Tenant/property maintenance flows are naturally mobile.
- Customer portal already contains property, unit, tenant, maintenance, document, payment, and notification areas.
- Prior targeted QA captured mobile property-manager portal screenshots.
- File/photo upload support aligns with maintenance use cases.

Risks:

- Property-manager mode sits inside the customer portal, so navigation labels must stay clear on small screens.
- Unit/tenant/property tables can become dense.
- Tenant maintenance status should be extremely simple: submit issue, photos, status, messages, next step.

Property/tenant mobile launch status: Ready for limited beta maintenance workflows; not yet a full property-management mobile app.

## Admin Mobile Recommendation

Admin should remain desktop-first at launch.

Reasons:

- Admin workflows involve high-risk actions: verification, suspension, routing, reimbursements, review moderation, resolution oversight, and financial operations.
- Admin pages are table-heavy and benefit from larger screens.
- Mobile admin increases risk of accidental actions.

Mobile admin should be limited to read-only alerts later:

- Critical platform health.
- Payment/webhook failures.
- Urgent support/resolution queue counts.
- Marketplace outage indicators.

Do not prioritize a full admin mobile app for launch.

## Project Assistant Mobile Review

Current state:

- Project Assistant inline panels work across several workspaces.
- Shared components support cards, evidence, confidence, missing information, and approval notices.
- Desktop dock is intentionally `xl:flex`, so it is hidden on mobile.

Mobile issue:

- There is no first-class mobile Project Assistant interaction pattern equivalent to the desktop dock.

Recommended mobile pattern:

- Bottom sheet or full-screen assistant route.
- Contextual “Ask Project Assistant” button in page headers or sticky action bars.
- Keep recommendations short and action-oriented.
- Use evidence accordions to avoid long scrolling.
- Never cover primary approve/sign/pay buttons without a clear close gesture.

Project Assistant mobile status: Inline guidance is beta-ready; dock-style assistant is desktop-only and should get a mobile bottom-sheet design later.

## PWA Readiness Assessment

Current PWA readiness: 3 out of 10.

What exists:

- Responsive web app foundation.
- Mobile icons in `frontend/public`.
- PWA plugin dependency installed.
- Mobile-safe React routing mostly works through SPA routes.

What is missing:

- Web app manifest.
- `VitePWA` plugin configuration.
- Service worker registration.
- Offline fallback page.
- App shell caching strategy.
- Install prompt UX.
- Theme color and mobile app meta tags.
- Push notification readiness.
- Background sync strategy.
- Clear authenticated-session behavior after install/reopen.

Recommendation:

Do not block limited beta on PWA. Add PWA support after launch-hardening, before native app.

Minimum PWA Phase 1:

- Add manifest with name, short name, icons, theme/background colors, display mode, and start URL.
- Register service worker with conservative caching.
- Add offline fallback that does not pretend protected data is available.
- Add install prompt only after mobile core flows are stable.
- Verify auth/session persistence after launching from installed icon.
- Keep payments/signatures online-only.

## Native App Readiness Assessment

Native app readiness: Not ready and not needed for launch.

Native app should be considered after beta when usage patterns are clear.

Contractor app later:

- Project dashboard.
- Today schedule.
- Assigned milestones.
- Milestone completion.
- Photo/video upload.
- Customer messaging.
- Payment request status.
- Warranty work orders.
- Project Assistant.
- Push notifications.

Customer app later:

- Project updates.
- Agreement review/signing.
- Approvals.
- Payments.
- Documents.
- Warranty requests.
- Messages.
- Resolution cases.
- Push notifications.

Property manager / tenant app later:

- Maintenance requests.
- Camera/photo upload.
- Status tracking.
- Unit/property records.
- Tenant messages.
- Document access.

Admin app:

- Not recommended at launch.
- Later read-only alert app may be enough.

## Top Mobile Blockers

No mobile blocker remains for limited beta.

Blockers before broad mobile-first launch:

1. No first-class mobile Project Assistant bottom sheet.
2. No active PWA manifest/service worker/install support.
3. Payment, signature, and PDF viewing need real-device validation.
4. Contractor field workflows are not yet optimized into quick mobile task flows.
5. Admin, Insights, Team Schedule, and Marketing remain desktop-first.

## P0 / P1 / P2 Mobile Fixes

### P0 Before Limited Beta

None found.

### P1 Before Broad Mobile Launch

1. Add dedicated mobile Playwright project using iPhone/Pixel device profiles.
2. Add phone-specific tests for customer signing, payment/funding, milestone approval, zero-dollar completion approval, warranty request, and resolution review.
3. Add mobile Project Assistant bottom sheet or full-screen assistant pattern.
4. Audit PDF viewing/download fallback on iOS Safari and Android Chrome.
5. Audit payment method/Stripe flow on mobile browsers.
6. Remove noisy `MobileSidebarShell` console logs before production-scale usage.
7. Add no-horizontal-overflow assertions for Agreement Workspace, Payments, Team Schedule, Marketing, Insights, Admin, Warranty, and Resolution.

### P2 After Beta

1. Add PWA manifest and install support.
2. Add offline fallback and app shell caching.
3. Add push notification architecture for approvals, schedule changes, warranty updates, resolution cases, and payment actions.
4. Convert dense tables to mobile card/list summaries.
5. Add field-worker quick actions: complete milestone, upload photos, request payment, view schedule.
6. Add customer mobile approval center.
7. Add property/tenant mobile maintenance status center.

### P3 Later

1. Native contractor app.
2. Native customer app.
3. Native property manager/tenant app.
4. Read-only admin alert app if operational demand exists.

## Suggested Implementation Roadmap

### Phase 1: Mobile Beta Hardening

- Add mobile Playwright project.
- Add phone-specific smoke tests for customer portal, agreement wizard, payments, milestone approval, warranty, resolution, and contractor opportunities.
- Fix any no-overflow failures.
- Review payment/signature/PDF flows on real iOS and Android devices.

### Phase 2: Mobile Workflow Simplification

- Add customer approval center.
- Add contractor field task center.
- Add property/tenant maintenance task center.
- Convert dense tables to mobile cards where phones are expected to be used.

### Phase 3: Project Assistant Mobile

- Add mobile bottom sheet or full-screen assistant.
- Add sticky contextual assistant triggers.
- Add compact evidence/confidence UI.
- Keep all AI actions human-approved.

### Phase 4: PWA

- Add manifest and service worker.
- Add install prompt.
- Add offline fallback.
- Verify auth persistence and protected-route behavior.
- Keep payments/signatures online-only.

### Phase 5: Native App Discovery

- Use beta analytics/support tickets to identify high-value native workflows.
- Prototype contractor field app first if field usage is high.
- Prototype customer approval/document app if customer mobile engagement is high.
- Keep admin desktop-first.

## Final Answer

Mobile web is ready for limited beta, with the best readiness in customer-facing flows and enough contractor mobile support for lead review and field-adjacent work. It is not yet ready to be positioned as a polished mobile-first product across every workspace.

MyHomeBro should not build a native app before launch. The right sequence is mobile-responsive web now, PWA next, native apps later after beta reveals the highest-value mobile workflows.
