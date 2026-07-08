# Admin Workspace Architectural Audit

Date: July 8, 2026

Scope: Architectural, UX, operations, marketplace, financial, permissions, platform-health, and AI opportunity audit for the MyHomeBro Admin Workspace. This audit does not implement behavior changes.

## Executive Summary

The current Admin Workspace already has a meaningful foundation for operating MyHomeBro: platform overview, contractor/customer/agreement/dispute lists, marketplace coverage, contractor directory enrichment, marketplace verification, location gating, saved marketplace request routing, reimbursement release operations, review moderation, maintenance operations, fee ledger, goals, templates, support, and admin agreement tools.

The main architectural gap is that Admin is still a collection of powerful tools rather than a single Marketplace Operations Center. The strongest area is marketplace operations. The weakest areas are platform health monitoring, granular admin permissions, unified financial operations, and cross-domain operational queues.

Recommended direction: preserve existing admin functionality, then organize it around platform operations domains:

- Is the marketplace healthy?
- What needs administrative attention?
- What risks exist?
- What should an admin investigate?
- What action should be taken today?

Project Assistant should eventually act as a Marketplace Operations Advisor. It should surface risks, explain evidence, and recommend investigation steps. It must never suspend accounts, release funds, refund payments, route requests, or perform administrative actions automatically.

## Current Architecture Review

### Frontend Surface

Primary admin frontend files reviewed:

- `frontend/src/pages/AdminDashboard.jsx`
- `frontend/src/pages/admin/AdminMarketplacePage.jsx`
- `frontend/src/pages/admin/AdminContractorDirectory.jsx`
- `frontend/src/pages/admin/AdminMaintenancePage.jsx`
- `frontend/src/pages/admin/AdminReimbursementsPage.jsx`
- `frontend/src/pages/admin/AdminReviewsPage.jsx`
- `frontend/src/pages/AdminTemplatesPage.jsx`
- `frontend/src/pages/SupportTicketsPage.jsx`
- `frontend/src/pages/DisputesPages.jsx`
- `frontend/src/components/AdminSidebar.jsx`
- `frontend/src/routes/ProtectedRoutes.jsx`

Current admin routes include:

- `/app/admin`
- `/app/admin/marketplace`
- `/app/admin/marketplace/analytics`
- `/app/admin/marketplace/verification`
- `/app/admin/marketplace/contractors`
- `/app/admin/marketplace/import`
- `/app/admin/marketplace/listings/:id`
- `/app/admin/maintenance`
- `/app/admin/reimbursements`
- `/app/admin/reviews`
- `/app/admin/contractor-directory`
- `/app/admin/agreements/:id`
- `/app/admin/templates`
- `/app/admin/disputes`
- `/app/support`

The routing is role-gated to `admin`, with support routes also available inside the admin role gate.

### Backend Surface

Primary backend files reviewed:

- `backend/adminpanel/urls.py`
- `backend/adminpanel/views.py`
- `backend/adminpanel/views_marketplace.py`
- `backend/adminpanel/marketplace_analytics.py`
- `backend/adminpanel/views_reimbursements.py`
- `backend/adminpanel/views_maintenance.py`
- `backend/adminpanel/maintenance_operations.py`
- `backend/adminpanel/views_goals.py`
- `backend/adminpanel/views_recommendations.py`
- `backend/adminpanel/permissions.py`
- `backend/projects/views/contractor_discovery.py`
- `backend/projects/views/support_tickets.py`
- `backend/projects/views/warranty.py`
- `backend/projects/views/dispute.py`

Current custom admin APIs include:

- `/api/projects/admin/overview/`
- `/api/projects/admin/goals/`
- `/api/projects/admin/contractors/`
- `/api/projects/admin/homeowners/`
- `/api/projects/admin/subcontractors/`
- `/api/projects/admin/agreements/`
- `/api/projects/admin/disputes/`
- `/api/projects/admin/geo/`
- `/api/projects/admin/fees/ledger/`
- `/api/projects/admin/reimbursements/`
- `/api/projects/admin/maintenance/`
- `/api/projects/admin/recommendations/`
- `/api/projects/admin/contractor-reviews/`
- `/api/projects/admin/marketplace/`
- `/api/projects/admin/marketplace/analytics/`
- `/api/projects/admin/marketplace/locations/`
- `/api/projects/admin/marketplace/route-intake/`
- `/api/projects/admin/marketplace/verification/`
- `/api/projects/admin/marketplace/contractors/`
- `/api/projects/admin/marketplace/import/`
- `/api/projects/admin/marketplace/listings/<id>/`
- `/api/projects/admin/marketplace/listings/<id>/invite/`
- `/api/projects/admin/contractor-directory/`
- `/api/projects/admin/contractor-search/`
- `/api/projects/admin/contractor-search/capture/`
- `/api/projects/admin/contractor-directory/import-preview/`
- `/api/projects/admin/contractor-directory/import-apply/`
- `/api/projects/admin/contractor-directory/<id>/claim-link/`
- `/api/projects/admin/contractor-directory/<id>/join-invite/`

### Current Permissions

Custom admin APIs use `IsAdminUserRole`, which allows:

- `user.is_superuser`
- `user.is_staff`
- `user.role in {"admin", "platform_admin"}`
- `user.user_type/type == "admin"`

This is suitable for early admin access, but it is not granular enough for marketplace, support, finance, compliance, and platform operations roles.

## Current Workflows

### Admin Overview

The overview pulls together counts, money, summary data, fee trends, top categories, top regions, insights, and operational queues. It includes tabs/views for:

- Overview
- Goals
- Contractors
- Customers
- Agreements
- Disputes
- Geo
- Fee audit
- User tools

Strength: broad platform snapshot and drilldowns.

Gap: it mixes CEO goals, platform operations, finance audit, customer records, and user tools into one page-level experience.

### Marketplace

The marketplace workspace supports:

- Marketplace overview
- Coverage by geography and service
- Saved marketplace requests
- Location gating
- Route saved intake after a location becomes enabled
- Verification queue
- Contractor status actions: verify, reject, suspend, unsuspend, mark preferred, remove preferred
- Marketplace analytics funnel
- City analytics
- Contractor analytics
- Contractor coverage
- Listing readiness
- Join invite and claim link flows

This is the strongest admin domain today and should be preserved.

### Contractor Directory

The contractor directory supports:

- Admin contractor search
- Capture selected search results
- CSV import preview/apply
- Enrichment editing
- Contact status
- Outreach status
- Claim readiness
- Claim link generation
- Join marketplace invite
- Archive/restore
- Manual outreach logging
- Filtering and pagination

Strength: rich operational tool for marketplace supply building.

Gap: directory editing and marketplace coverage are separate but adjacent. This is good architecturally, but navigation should make their relationship clearer.

### Financial Tools

Current financial admin tooling includes:

- Fee ledger
- Fee mismatch filter
- Reimbursement list/detail
- Manual reimbursement release recording
- Hold and clear hold
- Retry release
- Escrow ledger checks
- Dispute hold blockers
- Payout history in contractor-facing finance tools

Strength: reimbursement release has safety blockers and escrow awareness.

Gap: Admin does not yet have one unified Financial Operations center for Stripe, escrow, payouts, refunds, fees, disputes, held funds, failed transfers, and exports.

### Resolution Oversight

Current admin resolution visibility includes:

- Admin dispute list
- Active/all/archived filters
- Contractor/customer/project context
- Amount and updated time
- Archive terminal disputes
- Link to dispute workspace
- Dispute AI recommendation infrastructure exists elsewhere

Strength: admins can see disputes and terminal status.

Gap: no dedicated Resolution Oversight workspace showing evidence completeness, admin review queue, payment impact, average resolution time, warranty escalations, or human decision audit summary.

### Warranty Oversight

Warranty currently has a contractor dashboard and warranty APIs. Admin-specific warranty oversight is not first-class.

Admin should monitor warranty health without becoming involved in day-to-day warranty operations:

- Open warranty requests
- Escalated warranty requests
- Warranty trends
- Recurring contractor/project issues
- Completion rates
- Warranty-to-resolution escalations

### Maintenance And Property Operations

Admin maintenance operations exist and are backed by `build_maintenance_operations_payload`. They include:

- Maintenance contracts
- Work orders
- Property attention rows
- Property intelligence health
- High-priority property items
- Queues and available metrics

Strength: good foundation for property operations oversight.

Gap: this currently sits as a separate admin page rather than being part of a broader Marketplace Operations Center priority queue.

### Support

Support tickets exist as shared workspace and can be accessed by admin. Gmail sync management command exists.

Gap: support is not yet fully integrated into Admin overview as severity queues, SLA metrics, abuse reports, escalation paths, or account-risk signals.

## Marketplace Operations Assessment

### What Works

- Contractor verification states exist.
- Suspended and rejected contractors are excluded from marketplace routing.
- Preferred contractor ranking exists for verified contractors.
- Location gating prevents broadcasting in disabled markets.
- Admin can route saved requests after a market becomes enabled.
- Marketplace analytics expose funnel, city, contractor, zero-bid, and agreement conversion data.
- Contractor directory supports enrichment, outreach, claim links, and join invites.
- Tests cover key marketplace admin flows.

### Gaps

- Verification does not appear to distinguish license, insurance, identity, business, and Stripe readiness as separate review tracks.
- Fraud indicators are not first-class.
- Manual review and escalation queues are scattered.
- Platform announcements and marketplace messaging are not visible as admin operations.
- Marketplace health is not yet a single page that combines supply, demand, coverage, routing, verification, disputes, warranty, and support.

### Recommendation

Marketplace should become one Admin domain with subareas:

- Health
- Coverage
- Requests
- Contractor Verification
- Contractor Directory
- Routing
- Analytics
- Announcements
- Risk

Do not merge Directory editing into Marketplace analytics. Link them clearly.

## Financial Operations Assessment

### Current Strengths

- Fee ledger exists.
- Fee mismatch detection exists.
- Reimbursement release workflow includes escrow availability and dispute holds.
- Manual release recording captures transfer reference.
- Failed reimbursement release retry exists.
- Stripe-related fields and payout histories exist across contractor finance.

### Gaps

- No single admin view for all held funds.
- No unified failed Stripe/webhook/payment queue.
- Refund oversight is not clearly first-class.
- Platform fees and payout reports are spread across Business Dashboard, fee ledger, reimbursements, and payout pages.
- Manual adjustments need strict audit trails and role gating.
- Accounting exports are not consolidated.

### Recommendation

Create a Financial Operations admin area that consumes existing records:

- Escrow balances
- Pending releases
- Failed payouts
- Failed reimbursement releases
- Refund requests
- Disputed payments
- Platform fees
- Stripe account readiness
- Webhook health
- Accounting exports

Keep actual money movement behind explicit human confirmation and granular permissions.

## Resolution Oversight Assessment

Admin should oversee platform risk, not decide ordinary contractor/customer disagreements unless escalation requires platform review.

Recommended admin resolution metrics:

- Open cases
- Cases awaiting admin review
- Cases with payment impact
- Escalated warranty cases
- Average resolution time
- Evidence completeness
- Missing statements
- Cases near deadline
- Repeated dispute categories
- Cases with active escrow holds

Recommended admin actions:

- Open case
- Request more evidence
- Assign internal reviewer
- Mark platform review needed
- Record administrative note
- Escalate to external/legal process if applicable

AI must remain advisory and avoid legal conclusions.

## Warranty Oversight Assessment

Admin warranty oversight should monitor marketplace trust and quality signals:

- Open warranty requests
- Escalated requests
- Average resolution time
- Warranty completion rate
- Repeat issue categories
- Warranty requests by contractor
- Warranty requests by project type
- Warranty requests leading to resolution cases

Admin should not become the default warranty operator. Contractor workflows should remain responsible for day-to-day warranty work.

## Contractor Oversight Assessment

Current contractor oversight includes:

- Contractor list
- Marketplace verification
- Profile/service details
- Stripe readiness signals
- Directory claim state
- Preferred/suspended/rejected states
- Reviews moderation
- Marketplace performance analytics

Gaps:

- License and insurance verification need first-class status and evidence.
- Identity/business verification should be separate from marketplace readiness.
- Profile completeness should become an admin-visible readiness signal.
- Contractor suspension should require reason, audit event, scope, and possibly second confirmation.
- Performance signals should be explainable and non-punitive.

## Customer Oversight Assessment

Admin has homeowner/customer listing and support access, but customer operations are less mature than contractor operations.

Recommended customer admin capabilities:

- Customer account search
- Support history
- Abuse reports
- Property-management account type
- Account verification where needed
- Payment/warranty/resolution involvement
- Data export/deletion workflows if required

Customer management should remain separate from contractor management.

## Team Oversight Assessment

Admin should only see workforce information needed for platform administration:

- Organization membership count
- Owner/admin contact
- Contractor subaccounts tied to incidents
- Subcontractor compliance/risk where marketplace payment is involved
- Assignment context for support or dispute investigations

Admin should not become an HR workspace. Labor costs, employee performance, and internal contractor management should stay with contractor Team permissions unless needed for support, compliance, or financial audit.

## Platform Health Assessment

This is the largest launch gap.

Admin should surface:

- System alerts
- API failures
- Stripe webhook failures
- Payment intent/transfer failures
- Notification failures
- SMS/email provider failures
- PDF/document generation failures
- Background job failures
- Storage usage
- Queue health
- Support sync failures
- Audit log anomalies
- Error spikes by endpoint

Some management commands and logs exist, but the Admin Workspace does not yet appear to have a first-class Platform Health dashboard.

## Marketplace Growth Assessment

Current growth-supporting features:

- Contractor directory
- Google/local business capture
- Claim links
- Join invites
- Marketplace location gating
- Coverage analytics
- Marketplace funnel analytics
- Goals dashboard

Recommended growth additions:

- Supply vs demand by geography/service
- Enabled market readiness
- Contractor onboarding progress
- Referral tracking
- Feature rollout flags
- Platform announcements
- Internal campaign notes

Admin should operate marketplace growth, not replace the public marketing website or CRM.

## Recommended Dashboard Organization

Recommended Admin navigation:

1. Overview
2. Marketplace
3. Contractors
4. Customers
5. Financial Operations
6. Resolution
7. Warranty
8. Platform Health
9. Growth
10. Support
11. Settings

### Suggested Subsections

Marketplace:

- Health
- Coverage
- Requests
- Verification
- Directory
- Routing
- Analytics

Financial Operations:

- Escrow
- Payouts
- Reimbursements
- Refunds
- Fees
- Stripe
- Exports

Platform Health:

- Errors
- Webhooks
- Notifications
- Documents
- Background jobs
- Storage
- Audit logs

Settings:

- Admin roles
- Marketplace locations
- Feature flags
- Notification templates
- Risk thresholds

## Data Ownership Recommendations

| Data | Owner | Admin Role |
| --- | --- | --- |
| Contractor account | Contractor domain | Review, verify, suspend, support |
| Marketplace verification | Marketplace/admin domain | Owns status and audit trail |
| Contractor directory listing | Contractor discovery domain | Owns enrichment and outreach |
| Marketplace location | Marketplace/admin domain | Owns enablement and routing thresholds |
| Public intake | Intake domain | Admin routes only when marketplace gated/saved |
| Opportunity | Opportunity domain | Admin monitors routing/conversion |
| Agreement | Agreement domain | Admin investigates, downloads, support actions |
| Payment/escrow | Payments domain | Admin monitors, holds, investigates |
| Reimbursements | Expense/reimbursement domain | Admin releases/holds with audit |
| Dispute/resolution | Resolution domain | Admin oversight and escalation |
| Warranty | Warranty domain | Admin monitors trends/escalations |
| Support tickets | Support domain | Admin owns support workflow |
| Platform health events | Platform operations domain | Admin owns monitoring and triage |
| AI recommendations | AI/advisory artifact domain | Admin consumes, humans decide |

## AI Opportunities

Project Assistant should act as a Marketplace Operations Advisor.

### Overview

Summarize:

- Marketplace health
- Biggest operational risk
- Highest-priority queue
- Payment bottleneck
- Coverage gap
- Verification backlog

### Marketplace

Detect:

- Zero-bid requests
- Cities with demand but low supply
- Contractors repeatedly not responding
- Enabled markets below readiness thresholds
- Join invite failure spikes

### Financial Operations

Detect:

- Failed payouts
- Reimbursement releases blocked by disputes
- Fee mismatches
- Held funds aging
- Stripe readiness problems

### Resolution

Detect:

- Cases missing evidence
- Payment-impact cases
- Cases near deadline
- Recurring dispute categories
- Warranty escalations becoming disputes

### Warranty

Detect:

- Warranty request spikes
- Recurring issue types
- Contractors with unusual warranty volume
- Requests overdue for contractor response

### Platform Health

Detect:

- Webhook failures
- Email/SMS failures
- PDF generation failures
- Error spikes
- Background job backlog

### AI Guardrails

AI must:

- Explain evidence.
- Show confidence.
- Link to source records.
- Show missing data.
- Recommend investigation steps.

AI must not:

- Suspend accounts.
- Verify or reject contractors.
- Release, refund, or transfer payments.
- Route marketplace requests.
- Send announcements.
- Resolve disputes.
- Make legal conclusions.

## Priority Improvements

### P0

1. Define Admin as Marketplace Operations Center in navigation and terminology.
2. Add granular admin roles and permissions.
3. Create a Platform Health dashboard.
4. Consolidate financial operations queues.
5. Add admin audit events for sensitive admin actions.

### P1

6. Add Resolution Oversight dashboard.
7. Add Warranty Oversight dashboard.
8. Separate contractor verification tracks: business, insurance, license, identity, Stripe, profile.
9. Add unified admin attention queue.
10. Add marketplace risk signals and fraud indicators.

### P2

11. Add admin announcements and feature rollout controls.
12. Add support SLA and abuse-report queues.
13. Add customer/property-management oversight.
14. Add Marketplace Operations Advisor summaries.
15. Add accounting export center.

## Top 20 Improvements

1. Rename and position Admin as Marketplace Operations Center.
2. Add granular admin roles.
3. Add admin action audit log surfaced in UI.
4. Add Platform Health dashboard.
5. Add webhook/payment/email/SMS/PDF failure queues.
6. Add Financial Operations dashboard.
7. Consolidate fee ledger, reimbursements, payouts, refunds, and held funds.
8. Add Resolution Oversight dashboard.
9. Add Warranty Oversight dashboard.
10. Split contractor verification into distinct tracks.
11. Add insurance/license evidence review.
12. Add marketplace fraud/risk indicators.
13. Add global admin attention queue.
14. Add support SLA dashboard.
15. Add customer account oversight.
16. Add supply vs demand heatmap by service and geography.
17. Add feature rollout and marketplace location settings.
18. Add admin-safe AI operations recommendations.
19. Add stronger empty/loading/error states across admin pages.
20. Add performance/caching plan for broad admin queries.

## UI And UX Findings

### What Works

- Admin pages expose powerful operational tools.
- Marketplace pages are visually cohesive.
- Marketplace subroutes map to real workflows.
- Contractor Directory has rich filters and actions.
- Verification actions are clear and test-covered.
- Reimbursement workflows surface release blockers.

### Issues

- Admin navigation feels split between embedded tabs and separate routes.
- `Admin Control Panel` terminology is generic compared with Marketplace Operations Center.
- Goals, user tools, geo, fee audit, and disputes are mixed into one dashboard page.
- Marketplace and Contractor Directory relationship is not obvious enough.
- Dark/high-contrast admin styling is visually distinctive but can become dense in large tables.
- Some actions are powerful and need stronger confirmation/audit framing.
- Platform health is not visible enough.

### UX Recommendations

- Use one primary admin shell with domain navigation.
- Make Overview an attention queue first, analytics second.
- Use consistent terms: Marketplace, Contractor Verification, Financial Operations, Platform Health.
- Keep detailed tables, but add saved filters and queue-oriented summaries.
- Add confirmation modals for high-impact actions.
- Add field-level explanations for verification and suspension reasons.
- Make every queue row link to source records and audit history.

## Risks

### Overcentralization

Admin should operate the platform, not take over contractor workflows. Avoid turning Admin into a contractor CRM, HR system, or daily project manager.

### Permission Risk

Single admin permission is too broad for finance, support, compliance, and marketplace operations at scale.

### Financial Risk

Manual release, retry, refund, or hold actions need audit trails, confirmations, and separation of duties.

### Marketplace Trust Risk

Suspension, verification, preferred ranking, and routing affect contractor livelihoods. These actions must be explainable and auditable.

### Platform Health Blind Spots

Without webhook/job/email/PDF failure dashboards, admins may discover platform problems through customer complaints instead of proactive monitoring.

### AI Overreach

AI recommendations must never perform admin actions automatically.

## Launch Readiness

Current launch readiness as an internal admin tool: 7 out of 10.

Current launch readiness as a full Marketplace Operations Center: 5.5 out of 10.

Ready now:

- Marketplace verification
- Contractor directory enrichment
- Marketplace location gating
- Saved request routing
- Marketplace analytics
- Basic platform overview
- Fee audit
- Reimbursement release operations
- Review moderation
- Dispute listing
- Maintenance operations
- Support access

Needs refinement before full Marketplace Operations positioning:

- Granular admin permissions
- Platform Health dashboard
- Unified Financial Operations center
- Resolution Oversight
- Warranty Oversight
- Admin audit log surfaced in UI
- Unified attention queue
- AI Marketplace Operations Advisor

## Suggested Implementation Roadmap

### Phase 0: Admin Domain Map

- Document all admin actions and their risk level.
- Define admin role matrix.
- Define source-of-truth ownership for each admin metric and action.

### Phase 1: Navigation And Attention Queue

- Reorganize Admin into operations domains.
- Add unified attention queue to Overview.
- Preserve existing routes with redirects where needed.

### Phase 2: Permissions And Audit

- Add granular admin roles.
- Add audit events for verification, suspension, route intake, reimbursement release, holds, refunds, announcements, and support escalations.
- Add confirmation patterns for high-risk actions.

### Phase 3: Platform Health

- Add dashboards for webhooks, Stripe failures, email/SMS failures, document generation, background jobs, storage, and API errors.

### Phase 4: Financial, Resolution, Warranty

- Build Financial Operations dashboard from existing fee/reimbursement/payment data.
- Build Resolution Oversight dashboard.
- Build Warranty Oversight dashboard.

### Phase 5: Marketplace Operations Advisor

- Add advisory AI summaries with evidence, confidence, missing data, and source links.
- Keep all administrative actions human-approved.

## Final Recommendation

Do not rebuild Admin. The current Admin Workspace already contains valuable operational tools, especially for marketplace coverage, contractor directory management, verification, routing, reimbursements, and fee auditing.

The next architectural step is to make Admin feel like one operations center:

- Overview tells admins what needs attention today.
- Marketplace manages supply, demand, verification, routing, and coverage.
- Financial Operations monitors money risk.
- Resolution and Warranty track trust and escalation risk.
- Platform Health exposes system failures before users report them.
- Project Assistant explains patterns and recommends investigation, while humans make every administrative decision.
