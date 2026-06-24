# Contractor Portal Audit Before Website Builder

Date: 2026-06-24

Scope: Contractor Dashboard, Opportunities/Bids, Customers/Records, Projects/Agreements, Templates, Schedule, Team, Subcontractors, Assignments, Reviews/Public Presence, Payments, Profile/Billing, Support, contractor settings/onboarding, and Website Builder readiness.

This audit is based on the current React/Django code, including:

- Contractor routing and nav: `frontend/src/routes/ProtectedRoutes.jsx`, `frontend/src/components/Sidebar.jsx`
- Core contractor pages: dashboard, bids, customers, agreements, templates, team, subcontractors, assignments, schedule, payments, profile, support
- Public presence data model/API: `ContractorPublicProfile`, `ContractorGalleryItem`, `ContractorReview`, `PublicContractorLead`, and public presence serializers/views
- Existing Playwright coverage for contractor pages, public presence, bids, customer records, assignments, team, subcontractors, and payments

No large feature changes should be made before this cleanup pass is complete. The recommended direction is to make the portal feel smaller by grouping related workflows, improving empty states, and turning the existing Public Presence area into the foundation for the future Website Builder.

## Executive Summary

The Contractor Portal has the right building blocks, but the navigation currently exposes too many adjacent concepts as top-level pages. This makes a future Website Builder feel like "one more thing" instead of a natural upgrade from the existing Public Presence/Profile system.

The strongest existing foundation is `Public Presence`: it already owns public profile copy, branding, QR code, gallery, reviews, lead intake, AI-generated profile copy, public routes, and contractor lead handling. Website Builder should extend this surface rather than introduce a separate primary nav item at first.

The highest-risk cleanup areas before launch are:

- Duplicate and overlapping navigation entries, especially `Invoices` appearing twice and `Calendar` vs `Team Schedule`.
- Overlapping lead/customer workflows across `Bids`, `Public Presence > Public Leads`, `Customers`, and `Customer Records`.
- A very large `ContractorDashboard.jsx` with disabled `{false ? ...}` UI blocks and stale visual test expectations.
- Deprecated billing/AI entitlement models that should not become the source of truth for Website Builder plans.
- Profile data split between `Contractor`, `ContractorPublicProfile`, onboarding setup, reviews, gallery, compliance, and billing without a clear "website data contract."

## Findings

### Critical Before Launch

1. Duplicate primary nav: `Invoices` is listed in both Operations and Finance for contractor owners.
   - Impact: Contractors see repeated destinations and cannot tell whether "money workflow" is invoice-specific or payment-wide.
   - Recommendation: Keep one primary `Payments` nav item. Put invoices, draws, payout history, expenses, and disputes under Finance.

2. Opportunities are split between `Bids` and `Public Presence > Public Leads`.
   - Impact: Leads from public profile, QR, marketplace opportunities, manual leads, and property work orders are not discoverable as one pipeline.
   - Recommendation: Rename `Bids` to `Opportunities` and make it the primary lead pipeline. Move the Public Presence lead tab into this flow or cross-link only as a secondary "leads from website/profile" view.

3. Customer workflows are duplicated between `Customers` and `Customer Records`.
   - Impact: `Customers` is relationship/contact management; `Customer Records` is an aggregate dashboard for requests, bids, agreements, and payments. Both appear as separate primary nav items.
   - Recommendation: Keep `Customers` primary. Merge `Customer Records` as a `Records` tab or customer detail subview.

4. Dashboard contains multiple disabled UI blocks and stale expectations.
   - Evidence: `ContractorDashboard.jsx` has several `{false ? (...) : null}` sections, while `frontend/tests/contractor-pages-visual.spec.js` still waits for "Quick Actions".
   - Impact: Dead UI and brittle visual tests will make Website Builder cleanup harder and hide regressions.
   - Recommendation: Remove or explicitly backlog disabled sections; update visual tests to assert current dashboard sections.

5. Production-facing debug logging remains in auth and agreement list paths.
   - Evidence: `AuthenticatedLayout.jsx`, `ProtectedRoutes.jsx`, and `AgreementList.jsx` log render/mount/load details.
   - Impact: Noisy console output, harder production debugging, and possible leakage of route/role context.
   - Recommendation: Remove or gate behind a development flag.

6. Website Builder monetization lacks a current subscription source of truth.
   - Evidence: `ContractorBillingProfile` and `ContractorAIEntitlement` are marked deprecated or historical; active AI access no longer depends on them.
   - Impact: Adding Website Builder gates to deprecated models will create a second billing truth.
   - Recommendation: Add a current contractor plan/feature entitlement layer before building paid Website Builder controls.

7. Website Builder should not create a parallel public identity system.
   - Evidence: `ContractorPublicProfile`, gallery, reviews, public leads, QR, and public profile APIs already exist.
   - Impact: A separate Website Builder profile would duplicate profile, branding, SEO, reviews, and lead intake.
   - Recommendation: Treat Website Builder as a plan-gated expansion of Public Presence.

### Important

1. Navigation is too broad for a contractor's daily mental model.
   - Current primary-level concepts include dashboard, AI workspace, business dashboard, team overview, agreements, templates, milestones, review queue, invoices, team, subcontractors, assignments, schedule, customers, records, calendar, expenses, disputes, public presence, profile, Stripe onboarding, and support.
   - Recommendation: Group into `Work`, `Opportunities`, `Customers`, `Team`, `Finance`, `Marketing`, and `Settings`.

2. `Calendar` and `Team Schedule` overlap.
   - `Calendar` is general upcoming work/deadlines; `Team Schedule` configures working days/exceptions and operational schedule.
   - Recommendation: Keep `Schedule` primary with tabs: `Calendar`, `Team Availability`, `Exceptions`.

3. `Team Overview`, `Team`, `Assignments`, and `Subcontractors` are over-separated.
   - Recommendation: Keep one primary `Team` nav item with tabs: `Overview`, `Employees`, `Subcontractors`, `Assignments`, `Schedule`.

4. Reviews live inside Public Presence, not as a discoverable trust/reputation workflow.
   - Recommendation: In the new `Marketing` area, include `Reviews` as a tab/subpage with review requests, moderation, visibility, and Website Builder reuse.

5. Profile and Billing are named together but Stripe onboarding is still a separate nav item.
   - Recommendation: Rename to `Settings`; include `Business Profile`, `Public Profile`, `Billing & Plan`, `Stripe/Payouts`, `Team Permissions`, `Notifications`, and `Support`.

6. Empty states are uneven.
   - Good examples: Customers, Team Overview, Subcontractors, Customer Records.
   - Weak examples: Agreements only says "No agreements found"; Payments says "No payment records match"; Opportunities says "No opportunities match your current filters."
   - Recommendation: Use intent-aware empty states with 1-2 contractor actions: clear filters, create agreement, add customer, connect Stripe, publish profile, invite subcontractor.

7. Public Presence is already too broad for its label.
   - It includes profile, gallery, reviews, public leads, QR, branding, and AI profile generation.
   - Recommendation: Rename current page to `Marketing` or `Website & Leads`; keep free profile as default and Website Builder as a gated tab.

8. Onboarding discoverability is fragmented.
   - Evidence: onboarding form, dashboard activation guide, Stripe onboarding, public presence setup, contractor/me, activation summary, profile completeness helpers.
   - Recommendation: Add a unified setup checklist surfaced on Dashboard and Settings, with tasks grouped by "Get Paid", "Get Found", "Win Work", and "Bring Your Team".

9. Mobile responsiveness risk is high in operational tables.
   - Pages such as Agreements, Payments, Customers, Assignments, Subcontractors, and Support rely on wide tables or dense multi-column controls.
   - Recommendation: Keep mobile nav but audit each primary page for card/list fallback, horizontal scroll containment, sticky action drawers, and filter wrap behavior.

10. Public profile data is reusable, but not yet complete enough for a full website.
    - Existing reusable data: business name, tagline, bio, logo, cover/hero image, brand colors, font/theme, city/state/service area, website URL, phone/email visibility, specialties, work types, license visibility, reviews, gallery, public intake, SEO title/description.
    - Gaps: custom domain, page sections/order, navigation labels, service pages, testimonial curation, portfolio grouping, analytics, SEO metadata per page, publish/version history.

11. Portfolio/project photo reuse is underdeveloped.
    - Existing `ContractorGalleryItem` is manual. Intake/work-order photos exist elsewhere, but there is no curated "promote project photos to portfolio" workflow.
    - Recommendation: Add a curated gallery source field and optional links to agreement/project/milestone/photo origin later.

12. API shapes vary across pages.
    - Examples: list endpoints return arrays or `{results}`, some pages use `/projects/...` and others `/api/projects/...`, invoices fallback between `/projects/invoices/` and `/invoices/`.
    - Recommendation: Standardize frontend API helpers for list normalization and canonical `/projects/...` paths before adding Website Builder endpoints.

13. Tests are broad but brittle in places.
    - Existing coverage is valuable, especially `public-presence.spec.js`, `contractor-bids.spec.js`, `customer-records.spec.js`, `assignments.spec.js`, `team-section.spec.js`, and `contractor-payments-unified.spec.js`.
    - Recommendation: Update tests around the new nav labels and reduce text-coupled assertions where sections are intentionally renamed.

### Nice to Have

1. Rename `AI Workspace` to `Assistant` or put it behind a dashboard action if it is not daily-primary.
2. Replace `Business Dashboard` with `Insights` under Finance or Dashboard.
3. Rename `Public Presence` to `Website & Leads` when Website Builder MVP begins.
4. Add `data-testid` coverage for nav groups, settings tabs, website plan gates, and empty state CTAs.
5. Add first-run tours only for high-value workflows: create agreement, publish public profile, connect Stripe, respond to opportunity.
6. Add mobile screenshots to visual QA for the new primary pages.
7. Add feature flags for Website Builder rollout: `website_builder_enabled`, `custom_domain_enabled`, `ai_website_copy_enabled`, `analytics_enabled`.

## Page-by-Page Cleanup Recommendations

| Area | Current issue | Recommendation | Priority |
| --- | --- | --- | --- |
| Dashboard | Huge component, disabled sections, overlapping stats/actions | Keep as command center: next actions, setup checklist, opportunities, money alerts, recent activity | Critical Before Launch |
| Opportunities/Bids | Bids and public leads are split | Rename to `Opportunities`; unify marketplace, profile, QR, manual, and property leads | Critical Before Launch |
| Customers | Contact list is useful | Keep primary; add tabs/details for records instead of separate Records nav | Important |
| Customer Records | Duplicates Customers | Merge into Customers as `Records` or `Activity` | Critical Before Launch |
| Projects | No obvious primary Projects nav; project state is spread through agreements/milestones | Avoid new primary Projects page now; use Agreements as project container until project dashboard is mature | Important |
| Agreements | Core workflow, but list has many filters/actions | Keep primary under Work; improve empty state and preserve PDF/versioning guardrails | Important |
| Templates | Valuable but not daily for everyone | Keep under Work for now; consider submenu after nav grouping | Important |
| Schedule/Calendar | Calendar and Team Schedule split | Merge under `Schedule`; use tabs for calendar and availability | Important |
| Team | Team Overview, Team, Assignments, Subcontractors all primary | Merge into `Team` hub with tabs | Critical Before Launch |
| Subcontractors | Useful but should be a Team tab | Move under Team; keep attention badge on Team | Important |
| Assignments | Useful but should be a Team tab | Move under Team or Work depending role | Important |
| Reviews | Hidden inside Public Presence | Move under Marketing/Website as `Reviews` | Important |
| Payments | Route says invoices but page title says Payments | Rename route/nav to `Payments`; move payout history/expenses/disputes under Finance | Critical Before Launch |
| Profile/Billing | Mixes settings concepts; Stripe is separate | Convert to `Settings` with grouped tabs | Critical Before Launch |
| Support | Fine as utility | Keep in Settings/help area; not primary for most users | Nice to Have |
| Onboarding | Fragmented across setup/profile/Stripe/dashboard | Unified setup checklist in Dashboard and Settings | Important |

## Proposed Contractor Navigation

Primary nav:

1. Dashboard
2. Opportunities
3. Work
4. Customers
5. Team
6. Finance
7. Marketing
8. Assistant
9. Settings

Suggested grouping:

- Dashboard
  - Next actions
  - Setup checklist
  - Work/money/opportunity alerts

- Opportunities
  - New leads
  - Follow-up
  - Bids/drafts
  - Archived/declined

- Work
  - Agreements
  - Milestones
  - Templates
  - Schedule
  - Awaiting Review

- Customers
  - Directory
  - Requests
  - Records/activity
  - Documents

- Team
  - Overview
  - Employees
  - Subcontractors
  - Assignments
  - Availability/Schedule

- Finance
  - Payments
  - Invoices
  - Draw requests
  - Payout history
  - Expenses
  - Disputes

- Marketing
  - Free Public Profile
  - Website Builder
  - Gallery/Portfolio
  - Reviews
  - Leads/QR
  - SEO/Analytics

- Assistant
  - Keep primary only if it remains a cross-workflow entry point; otherwise expose from Dashboard and creation flows.

- Settings
  - Business Profile
  - Billing & Plan
  - Stripe/Payouts
  - Public visibility defaults
  - Team permissions
  - Notifications
  - Support

## Primary vs Submenu

Keep primary:

- Dashboard
- Opportunities
- Work
- Customers
- Team
- Finance
- Marketing
- Settings

Move to submenu/tabs:

- Agreements, Milestones, Templates, Awaiting Review under Work
- Team Overview, Team, Subcontractors, Assignments, Team Schedule under Team
- Invoices, Payout History, Expenses, Disputes under Finance
- Public Presence, Gallery, Reviews, QR, Website Builder under Marketing
- Profile, Billing, Stripe Onboarding, Support under Settings

Hide behind setup or conditional visibility:

- Stripe onboarding: show in setup checklist and Finance/Settings until connected
- Awaiting Review: show only when counts > 0 or reviewer role enabled
- Team/Subcontractors: show as setup suggestion until first employee/subcontractor exists
- Website Builder: show as Marketing tab with plan-gated card before release, not as a separate primary nav item
- Custom domain/analytics/AI content: Growth-only gated controls

## Website Builder Architecture Proposal

### Reuse Existing Data

Use `ContractorPublicProfile` as the public identity and base website content source:

- Identity: `business_name_public`, `tagline`, `bio`, `slug`
- Branding: `brand_primary_color`, `brand_accent_color`, `brand_font_theme`, `profile_theme`, `logo`, `cover_image`, `hero_image`
- Location/service area: `city`, `state`, `service_area_text`
- Contact visibility: `phone_public`, `email_public`, `show_phone_public`, `show_email_public`
- Services: `specialties`, `work_types`, plus `Contractor.skills`
- Trust: `show_license_public`, compliance/trust indicators from `projects.services.compliance`
- Reviews: `ContractorReview`
- Portfolio: `ContractorGalleryItem`
- Lead intake: `PublicContractorLead`, `ProjectIntake`, quote request endpoints
- SEO baseline: `seo_title`, `seo_description`

Also reuse:

- `Contractor` fields for business name, phone, address, city/state/zip, service radius, skills, license, insurance, logo, ratings, and marketplace status
- `ContractorOnboardingSetup` and `ContractorWorkspaceContext` for preferred work style and project-family defaults
- Agreement/milestone/customer data only for optional portfolio curation, never auto-publish without contractor approval

### New Models Only Where Needed

Add only these MVP models:

1. `ContractorWebsite`
   - `contractor` one-to-one
   - `public_profile` one-to-one/foreign key
   - `status`: draft, published, paused
   - `template_key`: starter, services, portfolio, premium
   - `homepage_layout`: JSON section order/config
   - `published_at`, `updated_at`
   - `published_snapshot`: JSON for rollback/audit

2. `ContractorWebsitePage`
   - `website` foreign key
   - `page_type`: home, services, gallery, reviews, contact, custom
   - `slug`, `title`, `seo_title`, `seo_description`
   - `content_blocks`: JSON
   - `is_published`, `sort_order`

3. `ContractorWebsiteDomain` Growth tier only
   - `website` foreign key
   - `domain`
   - `status`: pending, verifying, active, failed
   - DNS verification fields
   - `verified_at`

4. `ContractorWebsiteAnalyticsEvent` or provider-backed aggregate
   - Minimal MVP can defer raw events and store daily aggregate counts instead.

Do not add new review/gallery/profile models for MVP.

### MVP Endpoints

Contractor-authenticated:

- `GET /api/projects/contractor/website/`
  - Return plan gates, profile summary, website draft, pages, publish status, and missing setup items.

- `PATCH /api/projects/contractor/website/`
  - Update template, layout, section visibility, and draft settings.

- `POST /api/projects/contractor/website/publish/`
  - Validate required profile fields, create published snapshot, mark published.

- `GET /api/projects/contractor/website/preview/`
  - Return resolved website payload exactly as public renderer will consume.

- `POST /api/projects/contractor/website/ai-copy/`
  - Growth gate. Generate advisory copy suggestions only; contractor must accept.

- `GET /api/projects/contractor/website/domains/`
- `POST /api/projects/contractor/website/domains/`
- `PATCH /api/projects/contractor/website/domains/<id>/`

Public:

- `GET /api/projects/public/websites/<slug>/`
- `GET /api/projects/public/websites/<slug>/<page_slug>/`
- Continue supporting `/contractors/<slug>` as free profile route or redirect to the website home when published.

### React Structure

Add under `frontend/src/pages/WebsiteBuilderPage.jsx` and `frontend/src/components/website/`:

- `WebsiteBuilderPage`
  - shell under Marketing tab
  - plan gate banner
  - setup checklist
  - preview/publish actions

- `WebsiteBuilderTabs`
  - Setup
  - Design
  - Pages
  - Portfolio
  - Reviews
  - SEO
  - Domain
  - Analytics

- `WebsitePreviewFrame`
  - Uses the same resolved payload as public website renderer.

- `WebsiteSectionEditor`
  - Reorders/toggles hero, services, portfolio, reviews, trust, contact/quote CTA.

- `WebsitePlanGate`
  - Free, Pro, Growth feature messaging.

- `PublicWebsiteRenderer`
  - Public route renderer for published website pages.

Keep `ContractorPublicPresencePage` during migration, but gradually split its profile/galleries/reviews/leads sections into reusable components consumed by both Public Presence and Website Builder.

## Subscription Gating Recommendations

Free:

- Public profile page at `/contractors/<slug>`
- Basic logo/hero image, business info, service area, contact visibility
- Reviews display
- Gallery up to a small limit
- Quote request form
- QR code

Pro:

- Website Builder with multi-section homepage
- More gallery/portfolio items
- Services section customization
- Theme/layout presets
- Publish preview
- Review curation
- Basic SEO title/description

Growth:

- Custom domain
- Advanced SEO per page
- AI content generation for pages/services/FAQs
- Analytics dashboard
- More/custom pages
- Lead source attribution and conversion insights
- Advanced portfolio/service pages

Implementation note: do not use deprecated `ContractorBillingProfile` or historical `ContractorAIEntitlement` as-is. Create a current `ContractorPlan`/feature entitlement service or extend the existing active billing architecture if one exists outside the deprecated models.

## Recommended Implementation Phases

### Phase 0: Audit Cleanup Before Builder

- Remove duplicate `Invoices` nav.
- Rename `Bids` to `Opportunities`.
- Merge `Customer Records` into Customers.
- Merge Team-related pages into a Team hub.
- Rename `Public Presence` to `Marketing` or `Website & Leads`.
- Remove/gate debug logs.
- Remove or document disabled dashboard sections.
- Update visual tests to match current dashboard.

### Phase 1: Data Contract and Settings

- Define a `website_profile_payload` service that resolves contractor, public profile, trust indicators, reviews, gallery, and capabilities.
- Add setup checklist items for public profile completeness, gallery, reviews, service area, license/insurance, and Stripe.
- Add current plan entitlement service for Website Builder gates.

### Phase 2: Website Builder MVP

- Add `ContractorWebsite` and `ContractorWebsitePage`.
- Add authenticated draft/preview/publish endpoints.
- Add Marketing > Website Builder tab.
- Build section editor and preview from existing public profile data.
- Public route renders profile-based homepage.

### Phase 3: Pro/Growth Expansion

- Add services/custom pages.
- Add Growth domain verification.
- Add analytics events/aggregates.
- Add AI content suggestion endpoint with explicit accept/apply flow.
- Add portfolio promotion from completed projects or milestone/customer photos.

### Phase 4: Polish and Monetization

- Plan upgrade prompts in gated controls.
- Stripe subscription lifecycle integration.
- SEO metadata polish.
- Mobile Website Builder QA.
- Migration from `/contractors/<slug>` free profile to published website route, preserving backwards compatibility.

## Test Plan

Because this audit does not change app behavior, no automated tests are required for the report itself. For the cleanup changes, run targeted Playwright and unit tests:

### Navigation Cleanup

- Update and run:
  - `cd frontend && npm run test:e2e -- contractor-pages-visual.spec.js`
  - `cd frontend && npm run test:e2e -- login.spec.js`
  - `cd frontend && npm run test:e2e -- dashboard-screenshot.spec.js`
- Verify desktop and mobile sidebar links resolve correctly for contractor owner, employee/subaccount, subcontractor, and admin.

### Opportunities/Leads Merge

- Run:
  - `cd frontend && npm run test:e2e -- contractor-bids.spec.js`
  - `cd frontend && npm run test:e2e -- public-presence.spec.js`
- Verify public profile, QR, manual, quote request, marketplace, and property work-order leads land in the unified Opportunities flow.

### Customers Merge

- Run:
  - `cd frontend && npm run test:e2e -- customer-records.spec.js`
- Add or update tests for Customers tabs if records move under Customers.

### Team Hub

- Run:
  - `cd frontend && npm run test:e2e -- team-section.spec.js`
  - `cd frontend && npm run test:e2e -- subcontractors-page.spec.js` if renamed, update script/file name accordingly
  - `cd frontend && npm run test:e2e -- assignments.spec.js`

### Finance Rename

- Run:
  - `cd frontend && npm run test:e2e -- contractor-payments-unified.spec.js`
  - Any payout/history tests touched by route/nav changes.

### Website Builder MVP

- Add focused Playwright tests:
  - Free profile remains publicly accessible.
  - Pro-gated builder controls show upgrade state for free plan.
  - Pro plan can edit layout and preview.
  - Publish creates a public website payload without mutating signed agreements or archived artifacts.
  - Growth-only domain/SEO/AI/analytics controls are gated.
  - Mobile preview does not overflow and CTA remains reachable.

### Backend

- Add Django tests for:
  - Website payload reuses `ContractorPublicProfile`, gallery, reviews, trust indicators, and capabilities.
  - Publish creates a snapshot.
  - Plan gates reject Pro/Growth actions without entitlement.
  - Public routes only expose published/allowed content.
  - Quote intake source attribution is preserved.

## QA Report

### Scope

Static repo audit of contractor portal navigation, UX structure, empty states, onboarding/discoverability, mobile risk, monetization boundaries, Website Builder readiness, and technical debt.

### Passed

- Existing Public Presence data model and APIs are strong enough to serve as Website Builder foundation.
- Existing tests cover many relevant flows: public presence, bids/opportunities, customer records, team, assignments, subcontractors, payments.
- Many pages already use `ContractorPageSurface`, stable test IDs, and meaningful empty states.

### Failed

- Current navigation is too broad and contains duplicate/overlapping destinations.
- Dashboard has dead disabled blocks and stale visual-test expectations.
- Billing/entitlement source of truth is not ready for Website Builder monetization.

### Blocked

- Production UI validation was not performed because this task was an audit and no production credentials/session were provided.
- Exact subscription implementation could not be finalized because current billing source of truth appears deprecated in the inspected models.

### Needs Refinement

- Decide whether `Marketing`, `Website & Leads`, or `Public Profile` is the final nav label.
- Decide whether `Assistant` remains primary nav or becomes contextual.
- Define current plan/feature entitlement model before implementing paid gates.

### Commands

- `Get-ChildItem -Force`
- `rg --files`
- `git status --short`
- Targeted `Get-Content` and `rg` reads across frontend routes/nav/pages, backend public presence models/serializers/views, billing/AI entitlement models, and Playwright tests.
