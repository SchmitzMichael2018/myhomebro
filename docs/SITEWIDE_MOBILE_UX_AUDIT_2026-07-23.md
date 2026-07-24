# MyHomeBro Sitewide Mobile UX Audit

Date: 2026-07-23  
Scope: audit only; no production behavior or UI was changed.

## Executive summary

MyHomeBro is a usable responsive contractor web application on tablets and a
partially usable one on phones. The shared shell, theme system, card stacking,
and Project Assistant provide a sound foundation. It is not yet an appropriate
foundation for either native app without a purpose-built information
architecture.

Overall responsive-web rating:

- Phone (390–430 px): **Needs work**
- Tablet portrait (768 px): **Good**
- Tablet landscape (1024 px): **Good**
- Operational Dark/Light parity: **Good**
- Contractor mobile-product fit: **Needs a purpose-built field product**
- Customer mobile-product fit: **Needs a distinct, simpler customer product**

The highest-priority responsive defect is global: at phone widths the fixed
hamburger overlaps page titles on many authenticated routes. Dense workspaces
avoid document-level horizontal overflow, but several do so by clipping,
compressing, or retaining desktop-oriented rows. A zero-overflow metric must
not be interpreted as a mobile pass.

Project Assistant's full-screen Quick/Smart Capture treatment is the strongest
existing mobile pattern. It should become a contextual full-screen action layer
in the Contractor app, not a second assistant identity and not a permanent
floating panel over field work.

## Evidence and method

The audit inspected routing, the authenticated shell, appearance provider,
mobile sidebar, shared primitives, and existing deterministic Playwright
fixtures. A temporary extension of the existing contractor visual suite
captured 29 authenticated route/states at each required viewport:

- 390 × 844 Dark
- 430 × 932 Dark
- 768 × 1024 Dark
- 1024 × 768 Dark
- 390 × 844 Light (representative regression)

All 20 visual-audit test groups passed (145 route captures, plus dashboard
empty/loading/payment/assistant states). The retained evidence contains 175
files, including per-run manifests. No document-level horizontal overflow was
reported in the 145 route captures. Manual inspection found clipping and
compression that the document metric cannot detect.

Additional existing suites exercised Customer Portal, Public Intake, public
presence, appearance, and Quick/Smart Capture: 48 passed, 2 failed, and 1 was
flaky. The failures are recorded below and were not modified because this is an
audit-only task.

## Cross-cutting findings

### P0/P1

1. **Authenticated phone header collision — P1.** The 44 px menu trigger is
   fixed over the left edge of page headings. It obscures titles including
   Agreements, Payments, and Agreement Wizard. Reserve a consistent leading
   gutter in the mobile shell or place the trigger in a real mobile app bar.

2. **Phone navigation is responsive-web navigation only — P1.** The drawer
   exposes the desktop destination model but does not prioritize field work.
   It is acceptable for responsive web after the header defect is fixed. It is
   not the right Contractor- or Customer-app foundation. A Contractor app needs
   Today, Jobs, Capture, Messages, and More; a Customer app needs Home, Project,
   Messages, Payments, and More.

3. **Dense rows are visually clipped/compressed — P1.** Agreements and similar
   tables preserve desktop columns/actions inside phone cards. Status chips and
   row actions compete with primary content. Use summary-list + detail or
   transaction-history patterns; keep bulk selection and authoring on desktop.

4. **Touch targets are inconsistent — P1.** Automated sampling found the
   largest clusters of sub-44 px controls in Agreement Detail (34), Profile and
   Wizard steps 1–2 (29 each), Agreements (27), Account Settings (22),
   Resolution (18), and Customer Workspace (17). Many are visually small chips,
   row controls, or compact icon actions. Measure the actual hit box, not icon
   size, in follow-up work.

### P2

5. **Phone pages retain desktop density — P2.** Payments stacks KPI cards
   cleanly but makes the first actionable transaction expensive to reach.
   Insights becomes a long analytics feed. Customer Workspace risks an endless
   page. Mobile should surface a summary and route to focused detail.

6. **Themes are structurally consistent — P2.** Dark and Light retained the
   same hierarchy and no theme-specific overflow was observed. Existing tests
   confirm Dark default, Light persistence, System resolution, curated-light
   Marketing, and Project Assistant inheritance.

7. **Address integration emits noisy errors in deterministic/local runs —
   P2.** Missing Google Maps configuration logs repeated console errors from
   `AddressAutocomplete`. The manual fallback must remain fully usable and the
   unavailable state should be intentional rather than a raw console failure.

8. **Insights emits React key warnings — P2.** `ScorecardMetric` receives a
   spread `key` prop in `BusinessDashboard`. This is not a responsive failure
   but pollutes mobile performance/error evidence and should be cleaned up.

9. **Safe-area and keyboard evidence is incomplete — P2/BLOCKED.** Chromium
   viewport emulation validates geometry but not a physical iOS/Android virtual
   keyboard, camera picker, browser chrome, or notch behavior. Device testing
   remains required before release.

## Workspace blueprint

| Workspace | Responsive web | Refinement | Contractor app | Customer app / boundary |
|---|---|---|---|---|
| Dashboard | Needs work | Mobile app bar; compress Quick Actions; keep first screen task-led | Purpose-built home: jobs today, priorities, schedule, messages, capture | Not applicable |
| Opportunities / Estimates | Needs work | Prioritized cards, compact filter sheet, summary/detail | Essential lead inbox and estimate follow-up | Request status only |
| Agreements list/detail | Needs work | Summary cards, stable status/action hierarchy, defer PDF | View, signature/funding monitoring, minor safe updates | View, approve/sign/pay through focused safe flows |
| Agreement Wizard | Needs work on phone; Good on tablet | Step bar, keyboard-safe actions, milestone card editing | Desktop-first full authoring; phone draft capture/review only | Not applicable |
| Templates | Poor on phone; Good on tablet | Library cards and duplicate/use action | View/use on mobile; author on tablet/desktop | Not applicable |
| Projects / Milestones | Good | Field-first cards, sticky safe action, photo progress | Core native surface: directions, check-in, status, photo/voice evidence | Active-project timeline and approvals |
| Awaiting Review | Good | Prioritized review cards | Essential review queue | Approval requests only |
| Customers / Workspace | Needs work | Overview/tabs; Call, Message, Directions; avoid endless page | Core CRM summary/detail and timeline | Not applicable |
| Team / Assignments | Needs work | Mobile assignment sheet and conflict summary | Field assignment useful; deep workforce admin desktop-first | Not applicable |
| Schedule | Needs work | Agenda default, day/week switch, touch date controls | Core Today/Jobs surface with directions | Milestone dates/read-only |
| Marketing | Poor on phone; Good on tablet | Compact step navigation and upload flows | Photo upload, review request, hours/status useful | Responsive public destination |
| Marketing authoring / SEO | Poor | Do not squeeze builder onto phone | Desktop-first composition, SEO, long-form editing, publish review | Not applicable |
| Insights | Needs work | KPI summary, alerts, collapsible sections | KPI cards and alerts only | Not applicable |
| Payments | Good for viewing | Bring transaction list earlier; card/history pattern | View essential; approval/release needs dedicated high-assurance flow | View/pay/approve in focused flow |
| Payout History | Good | Transaction-history rows and compact pagination | Mobile essential view | Not applicable |
| Expenses | Needs work | Camera-first receipt entry and keyboard-safe confirmation | Mobile essential create/view | Reimbursement status only where applicable |
| Disputes | Needs work | Thread/evidence model; persistent but safe composer | Alert, reply, upload evidence, propose rework | Alert, reply, upload evidence |
| Resolution / arbitration | Poor on phone | Preserve advisory AI and explicit confirmation | Desktop preferred for final resolution | Desktop/web preferred for consequential resolution |
| Notifications | Good | Ensure deep-link context and 44 px actions | Essential native inbox/push destination | Essential |
| Support | Good | Keyboard-safe composer and attachments | Essential | Essential |
| Profile / Settings | Needs work | Group sections; enlarge chips/controls | Essential identity/availability; complex finance settings desktop | Basic account/preferences |
| Onboarding | Needs work | Short sections and saved progress | Useful, except Stripe onboarding remains hosted/safe flow | Customer onboarding should be separate and simpler |
| Project Assistant | Good | Full-screen presentation; preserve context and focus | Contextual full-screen action layer | Contextual help, not contractor-density assistant |
| Quick / Smart Capture | Good | Preserve explicit review/confirm/receipt | Primary dashboard shortcut or central Capture action | Voice/photo intake and evidence only |
| Customer Portal | Good | Simplify navigation and action hierarchy | Not applicable | Strong responsive foundation; native home should foreground next milestone, messages, approval/payment due |
| Public Intake | Good | Maintain compact progress, retained values, review before submit | Lead handoff only | Reuse core flow but add saved draft, voice/photo intake |
| Public profile / website | Good | Performance/image review and prominent contact actions | Preview/deep link only | Responsive-web deep-link destination |
| Admin / bulk operations | Blocked/not fully audited | No phone expansion recommended | Desktop only | Not applicable |

## Tables and dense-list policy

- Agreements, customers, assignments, disputes: **summary list + detail**.
- Payments, payouts, expenses: **mobile transaction-history model** with amount,
  status, counterparty/project, date, then disclosure.
- Milestones, opportunities, notifications, support: **card/list** with one
  obvious primary action and overflow for low-frequency actions.
- Reports and advanced Insights tables: **desktop-only or horizontal-scroll
  table on tablet**, never clipped on phone.
- Bulk selection, column sorting, CSV export, template authoring, deep agreement
  editing, reconciliation, and arbitration: **desktop-first**.
- Shared pagination fits better than ad-hoc controls, but phone controls must
  retain 44 px hit areas and announce current page.

## Overlay findings

- Project Assistant / Quick / Smart Capture: full-screen phone behavior is the
  preferred pattern; the captured surface kept input, capture choices, and
  close control visible without horizontal overflow.
- Global dropdowns and account/appearance/notifications controls fit, but three
  large circular actions consume substantial header space at 390 px.
- Agreement, assignment, review, PDF, and confirmation overlays require focused
  device testing for keyboard avoidance, focus restoration, body scroll lock,
  landscape, and safe areas. Static route captures cannot prove these behaviors.
- PDF preview should offer a readable summary and open/download option on phone;
  full document inspection remains tablet/desktop-first.

## Mobile-native recommendations tied to work

Contractor:

- Camera: progress/before-after photos, receipts, warranty/dispute/inspection
  evidence.
- Voice: field notes, milestone updates, customer messages, expense description,
  and material lists.
- Location: directions, optional arrival/check-in, mileage capture with explicit
  consent.
- Scanning: receipts/invoices, equipment serial/product labels, warranty
  documents.

Customer:

- Camera/voice intake to create a saved project draft, not auto-submit it.
- Photo evidence for requests/disputes and maintenance.
- Push/deep links for messages, approvals, payment due, and milestone changes.
- Avoid continuous/background location; offer directions or address assistance
  only when the workflow needs it.

Every AI-assisted mutation must retain Prepare → Preview → Validate → Confirm →
Apply → Receipt. No capture output should become authoritative automatically.

## Accessibility and performance observations

- Do not claim WCAG compliance from this audit.
- Heading presence was broadly stable, but the fixed menu visibly obscures
  headings on phone.
- Statuses generally include text, not color alone.
- Touch-target density is the largest measurable accessibility concern.
- Full-page height is misleading because the authenticated shell uses internal
  scrolling; automated audits must inspect the active scroll container too.
- Insights is the longest captured phone route (about 1,844 px in the document
  metric, before internal-scroll considerations) and risks becoming an
  analytics dump.
- Repeated Maps errors and React key warnings should be removed before using
  console cleanliness as a release gate.
- Physical-device checks are still needed for 200% text, zoom, forced colors,
  reduced motion, orientation changes, virtual keyboard, camera/file pickers,
  and touch tooltips.

## Test failures and blocked coverage

Failed existing tests:

1. `public-presence.spec.js`: expected obsolete/missing Marketing copy
   (`Business Growth Center`) while the UI now reads `Build Your Foundation`.
2. `public-presence.spec.js`: expected the legacy leads-handoff element, which
   was absent.

Flaky:

1. Customer Portal tenant-maintenance attachment verification initially did not
   capture the request payload and passed on retry.

Blocked or incomplete:

- Production validation was not performed; the request specified deterministic
  audit fixtures and no safe production session was provided.
- Real payments, signatures, publication, deletion, refunds, dispute
  resolution, invitation acceptance, and Stripe onboarding were not executed.
- Physical-device keyboard, camera, notch/safe-area, and OS integration checks.
- Complete admin and authorization-sensitive dispute variants without an
  approved deterministic state.

## Prioritized follow-up

1. Fix the authenticated phone app-bar/title collision and regression-test every
   route at 390 px.
2. Establish shared phone patterns: summary list + detail, transaction history,
   filter bottom sheet, and keyboard-safe sticky action.
3. Remediate sub-44 px control clusters, beginning with agreements, profile,
   wizard, disputes, customers, and assignments.
4. Define distinct Contractor and Customer app navigation/product charters.
5. Prototype Contractor Today/Jobs/Capture and Customer Home/Project/Messages.
6. Device-test Project Assistant, upload/camera, autocomplete, composers, and
   confirmations on iOS and Android.
7. Update or investigate the two public-presence failures and the maintenance
   upload flake.
8. Add an audit harness that measures the active scroll container, clipped
   descendants, overlays, keyboard geometry, console errors, and failed
   requests—not document width alone.

## Evidence index

Screenshots and manifests:
`docs/audit-screenshots/sitewide-mobile-ux-audit/`

Representative evidence:

- `390x844-dark/contractor-dashboard-390x844.png`
- `390x844-dark/agreements-list.png`
- `390x844-dark/payments-page.png`
- `390x844-dark/wizard-step-2.png`
- `390x844-dark/contractor-dashboard-assistant-open.png`
- `390x844-light/`
- `430x932-dark/`
- `768x1024-dark/`
- `1024x768-dark/`
