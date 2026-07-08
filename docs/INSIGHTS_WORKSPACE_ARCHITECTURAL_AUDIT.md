# Insights Workspace Architectural Audit

Date: July 8, 2026

Scope: Architectural, UX, business intelligence, data-source, integration, permissions, and AI opportunity audit for the MyHomeBro Insights Workspace. This audit does not implement behavior changes.

## Executive Summary

The current Insights Workspace is implemented primarily as the contractor Business Dashboard at `/app/business`, backed by `/api/projects/business/contractor/summary/`, chart drilldowns, CSV exports, payout history APIs, and benchmark-style contractor insights. It already has useful pieces: financial summaries, operational alerts, payout visibility, revenue and fee charts, overdue milestone trends, completed jobs by category, exports, and drilldown modals.

The main architectural opportunity is to evolve Insights from a reporting page into the business owner's daily command center. Today it answers several reporting questions, but it does not yet consistently answer:

- What happened?
- What needs my attention?
- What decision should I make today?
- Why?

Recommended direction: keep the existing Business Dashboard foundation, rename and organize it consistently as Insights, then add a normalized business intelligence layer that consumes finance, projects, estimates, team, warranty, resolution, property, customer, and marketing signals. Project Assistant should become an Operations Analyst that explains patterns and recommends next actions, while remaining advisory only.

## Current Architecture Review

### Frontend Surface

Primary files reviewed:

- `frontend/src/pages/BusinessDashboardPage.jsx`
- `frontend/src/components/BusinessDashboard.jsx`
- `frontend/src/components/dashboard/ContractorInsightsSection.jsx`
- `frontend/src/components/dashboard/InsightSummaryCard.jsx`
- `frontend/src/components/dashboard/InsightComparisonRow.jsx`
- `frontend/src/components/dashboard/InsightRecommendationCard.jsx`
- `frontend/src/routes/ProtectedRoutes.jsx`
- `frontend/src/components/Sidebar.jsx`
- `frontend/src/api.js`

Current route:

- `/app/business`

Current naming:

- Sidebar contains both `Business Dashboard` and `Insights` references depending on layout/context.
- Prior QA noted that the page H1 and sidebar terminology are inconsistent.

Current visible dashboard views in `BusinessDashboard.jsx`:

- At a Glance
- Contractor Insights
- Reports & Trends
- Payouts
- Operations

Current UI capabilities:

- Date range filtering
- Project-family filtering for contractor benchmark insights
- KPI cards
- Business alert cards
- Financial trend chart
- Revenue, fee, payout, and overdue-work charts
- Chart drilldown modal
- Report exports
- Payout snapshot
- Operational health cards
- Contractor benchmark insights

### Backend Surface

Primary files reviewed:

- `backend/projects/views/business_dashboard.py`
- `backend/projects/services/business_insights.py`
- `backend/projects/services/business_dashboard_insights.py`
- `backend/projects/views/contractor_operations.py`
- `backend/projects/views/warranty.py`
- `backend/projects/urls.py`

Current API routes include:

- `/api/projects/business/contractor/summary/`
- `/api/projects/business/contractor/drilldown/`
- `/api/projects/business-dashboard/export/revenue/`
- `/api/projects/business-dashboard/export/fees/`
- `/api/projects/business-dashboard/export/payouts/`
- `/api/projects/business-dashboard/export/jobs/`
- `/api/projects/dashboard/operations/`
- `/api/projects/warranty/dashboard/`
- `/api/projects/payouts/history/`
- `/api/projects/payouts/history/export/`

### Current Data Sources

The current Insights implementation uses or relates to:

- `Invoice`
- `DrawRequest`
- `ExpenseRequest`
- `Milestone`
- `MilestonePayout`
- `Agreement`
- `Project`
- `ProjectIntake`
- `ProjectOutcomeSnapshot`
- Payout history service/query helpers
- Contractor benchmark insight services
- Warranty dashboard API
- Contractor operations dashboard API

### Current KPIs And Reports

Current or partially current metrics include:

- Gross revenue
- Net paid
- Platform fees
- Pending release total
- On-hold total
- Paid invoice revenue
- Paid project count
- Average project value
- Award-to-paid rate
- Escrow pending
- Open disputes from invoice flags
- Overdue milestones
- Completed jobs by category
- Category average revenue
- Category average completion days
- Subcontractor payouts paid, ready, failed, and pending
- Contractor benchmark pricing, pace, milestone style, and reliability signals

### Current Drilldown

The existing drilldown model is a strength. Charts can open underlying records for:

- Revenue
- Fees
- Payouts
- Overdue milestone workflow

This should be extended rather than replaced. Insights should avoid dead-end dashboards.

## Business Intelligence Assessment

### What The Current Workspace Answers

The current page partially answers:

- How much money came in?
- What cash is approved but pending release?
- What payouts need attention?
- Are there overdue milestones?
- Which categories produced completed jobs?
- How does my project pricing or pace compare to benchmark data?
- Which financial records support a chart bucket?

### What It Does Not Yet Answer Well

Key gaps:

- Am I making money after labor, materials, warranty, and subcontractor costs?
- Which jobs are most profitable?
- Where am I losing money?
- What should I focus on today?
- Which customers need attention?
- Which estimates are likely to convert?
- Which leads are stale?
- Which warranties are costing me the most?
- Which crews are overloaded?
- Which project types have the best margin?
- Which payment bottlenecks threaten cash flow?
- What changed since last week or last month?
- What is the next best action?

The existing dashboard is strongest at financial reporting and short operational alerts. It is weaker as a decision workspace.

## Financial Insights Review

### Current Strengths

- Combines invoices, draw requests, and expense requests in financial summaries.
- Distinguishes gross revenue, platform fees, net paid, pending release, and on-hold totals.
- Includes payout reporting for subcontractor cash movement.
- Provides CSV exports for bookkeeping and tax prep.
- Has chart drilldowns to underlying records.

### Current Gaps

- Profit and margin are not first-class.
- Labor costs are not clearly included.
- Material costs are only indirectly represented through expenses.
- Warranty costs are not integrated into financial summaries.
- Cash-flow projection is missing.
- Invoice aging is not first-class.
- Outstanding balances and receivables need clearer owner-facing language.
- Escrow, direct pay, draws, reimbursement/expense requests, and payout states need a unified financial vocabulary.

### Recommendation

Launch financial KPIs should focus on small-contractor clarity:

- Revenue collected
- Net paid to contractor
- Pending release
- On hold or disputed
- Outstanding receivables
- Invoice aging
- Gross margin estimate
- Labor/material/subcontractor cost estimate
- Warranty cost
- Cash expected in next 7/30/60 days

Use plain labels. For example, "Money waiting on customer approval" is more useful than only "pending release."

## Operational Insights Review

### Current Strengths

- Overdue milestone trend exists.
- Operational health cards exist.
- Business alerts prioritize review, payout, and cash-flow items.
- Contractor operations API separately provides today, tomorrow, this week, and recent activity.

### Current Gaps

- The operations dashboard is separate from Insights rather than fully integrated.
- Active project risk is not summarized as a first-class KPI.
- Estimate pipeline and opportunity conversion are not sufficiently central.
- Project duration, completion rate, and schedule conflict metrics need stronger surfacing.
- Customer response time is not visible.
- Maintenance, warranty, and resolution workloads are not integrated into one operations lens.

### Recommendation

Insights should consume the contractor operations API or a shared operations summary service. The owner should see one daily command panel:

- Today's decisions
- Work at risk
- Money blocked
- Customers waiting
- Team capacity risks
- Warranty and resolution escalations
- Recommended next action

## Workforce Insights Review

Insights should consume Team data, but Team should remain the source of truth for people, skills, availability, compliance, and assignments.

Recommended workforce metrics:

- Available workforce this week
- Capacity by day
- Overbooked employees
- Unassigned work
- Warranty workload
- Skill gaps
- Certification expirations
- Crew utilization
- Subcontractor usage
- Labor distribution by project type
- Labor cost vs estimate

Do not rank employees punitively. Workforce insights should help owners prevent bottlenecks, not score people without context.

## Customer Insights Review

Current customer metrics are stronger in the customer records area than in Insights. Insights should consume customer summary data rather than duplicate CRM screens.

Recommended customer metrics:

- Repeat customers
- Customer lifetime value
- Average project value
- Open customer requests
- Customers waiting on contractor response
- Pending reviews
- Response time
- Warranty history by customer
- Property portfolio growth for property-management accounts

Customer Insights should answer: "Which relationships need attention?"

## Marketing Insights Review

Marketing Insights should be operational, not a duplicate Website Builder analytics suite.

Recommended launch metrics:

- Lead sources
- Public profile leads
- Website leads
- QR leads
- Opportunity conversion
- Estimate acceptance
- Review requests pending
- Review rating trend
- Referral source when available

Do not duplicate future Website Builder reporting. Website Builder can own page-level analytics, SEO configuration, publishing, and content performance. Insights should consume a small set of business outcomes from Marketing:

- Leads generated
- Leads converted
- Cost or effort if available
- Revenue influenced
- Follow-up needed

## Warranty Insights Review

Warranty now has a dedicated dashboard with:

- Active warranties
- Open warranty requests
- Repairs scheduled
- Repairs in progress
- Expiring soon
- Expired
- Warranty risk
- Assistant summary

Insights should consume this summary and add business context:

- Warranty cost
- Average resolution time
- Recurring issue categories
- Callback rate by project type
- Warranty work by crew or subcontractor, handled carefully
- Requests likely to become resolution cases
- Open warranty requests blocking customer satisfaction

Warranty should own detailed warranty operations. Insights should show the business impact.

## Resolution Insights Review

Resolution and dispute workflows should feed Insights with owner-level signals:

- Open resolution cases
- Average resolution time
- Common dispute types
- Payment impact
- Missing evidence count
- Recommended next human action
- Recurring issues by project type

Insights must avoid legal language. AI should summarize resolution trends as operational risk, not blame or liability.

## Property Insights Review

Property-management and home records data should be represented in Insights when contractors or property managers are using those features.

Recommended property metrics:

- Properties managed
- Units managed
- Tenant maintenance requests
- Open property work orders
- Recurring maintenance categories
- System aging
- Upcoming service recommendations
- Document completeness
- Property portfolio growth

Property records and Customer Portal should remain the source of truth. Insights should summarize trends and next actions.

## Recommended Dashboard Organization

Recommended Insights structure:

1. Overview
2. Financial
3. Operations
4. Projects
5. Team
6. Customers
7. Warranty
8. Resolution
9. Property
10. Growth

### Launch-Friendly Version

To avoid overbuilding, launch with:

- Overview
- Financial
- Operations
- Growth

Then progressively add:

- Team
- Customers
- Warranty
- Resolution
- Property

### Current Comparison

Current views map roughly as:

- At a Glance -> Overview
- Contractor Insights -> Benchmark/Growth
- Reports & Trends -> Financial plus reporting
- Payouts -> Financial
- Operations -> Operations

This is directionally good. The missing step is to make Overview the daily decision surface rather than just a collection of alert and KPI cards.

## Launch KPI Recommendations

### P0 Launch KPIs

- Revenue collected
- Net paid
- Pending release
- On-hold/disputed amount
- Outstanding receivables
- Open projects
- Overdue milestones
- Estimate pipeline
- Opportunity conversion
- Ready subcontractor payouts
- Failed payouts
- Customer requests waiting
- Open warranty requests

### P1 KPIs

- Gross profit estimate
- Project margin
- Average project value
- Average completion time
- Estimate acceptance rate
- Invoice aging
- Cash projection
- Team utilization
- Unassigned work
- Warranty cost
- Resolution rate
- Repeat customer rate

### P2 KPIs

- Customer lifetime value
- Marketing ROI
- SEO/website conversion
- Referral source performance
- Warranty callback trend
- Property portfolio growth
- Crew capacity forecast
- Service-type profitability

## Drilldown Experience

Current chart drilldowns are a strong foundation. Expand this pattern to every KPI:

- Open Projects -> Project list -> Project -> Milestone -> Payment
- Pending Release -> Invoice/draw list -> Request -> Agreement
- Outstanding Receivables -> Aging list -> Customer -> Project
- Overdue Milestones -> Milestone list -> Assignment -> Schedule
- Warranty Requests -> Warranty dashboard -> Request -> Evidence/work order
- Resolution Cases -> Resolution workspace -> Evidence/COAs/payment impact
- Team Utilization -> Team schedule -> Assignment -> Source record
- Lead Conversion -> Opportunity list -> Estimate -> Agreement

No KPI should end at a number without a path to the records behind it.

## AI Opportunities

Project Assistant should act as an Operations Analyst inside Insights.

### Overview

Assistant should summarize:

- What changed this week
- What needs attention today
- Highest-risk project
- Biggest cash-flow blocker
- Best next action

Example:

"Based on the current business data, $4,200 is waiting on customer approval, two milestones are overdue, and one warranty request has been open for more than seven days. The most useful next action is to review pending customer approvals."

### Financial

Assistant should identify:

- Revenue changes
- Margin pressure
- Cash-flow risk
- Fee changes
- Aging receivables
- High-dependency projects

### Operations

Assistant should identify:

- Delayed projects
- Bottleneck milestones
- Customer response delays
- Stale estimates
- Schedule conflicts

### Team

Assistant should identify:

- Capacity risk
- Skill gaps
- Compliance expirations
- Overbooked employees
- Subcontractor dependency

### Customers

Assistant should identify:

- Customers needing follow-up
- Repeat customer opportunities
- Review opportunities
- High-value relationship risks

### Warranty

Assistant should identify:

- Recurring warranty categories
- Cost spikes
- Work orders at risk
- Requests likely to escalate

### Resolution

Assistant should identify:

- Cases missing evidence
- Cases with payment impact
- Repeated dispute themes
- Suggested human next action

### Growth

Assistant should identify:

- Best lead sources
- Stale leads
- Service types with strong conversion
- Marketing channels that need follow-up

### AI Guardrails

- Advisory only.
- Explain supporting evidence.
- Show missing data.
- Show confidence.
- Link to source records.
- Do not trigger payments, notifications, assignments, refunds, or dispute outcomes automatically.

## Data Source Recommendations

### Create A Business Metrics Layer

Add a shared service layer, not necessarily new tables first, that normalizes:

- Financial events
- Operational events
- Project lifecycle events
- Customer events
- Workforce events
- Warranty events
- Resolution events
- Marketing events
- Property events

Recommended shape:

- `metric_key`
- `metric_label`
- `domain`
- `value`
- `comparison_value`
- `trend`
- `period_start`
- `period_end`
- `source_records`
- `severity`
- `recommended_action`
- `confidence`

### Consider An Event Ledger Later

If performance or auditability becomes difficult, consider materialized tables:

- `BusinessMetricSnapshot`
- `BusinessInsightArtifact`
- `BusinessEventLedger`
- `KpiDrilldownIndex`

Start with services. Materialize only after metric definitions stabilize.

## Integration Recommendations

### Dashboard

Contractor Dashboard should show the most urgent two or three Insights cards, then link to Insights for detail.

### Opportunities And Estimates

Insights should consume:

- Lead volume
- Opportunity status
- Estimate readiness
- Estimate acceptance
- Stale opportunities
- Service-type conversion

### Agreements And Projects

Insights should consume:

- Active agreements
- Completion status
- Milestone progress
- Change/amendment frequency
- Payment status
- Project duration

### Payments And Expenses

Insights should consume:

- Invoices
- Draw requests
- Expense requests
- Subcontractor payouts
- Platform fees
- Escrow/direct-pay states
- Refunds if applicable

### Team

Insights should consume normalized Team capacity and assignment data, not duplicate Team records.

### Warranty

Insights should consume warranty dashboard summaries and cost/work-order data.

### Resolution

Insights should consume resolution case status, evidence completeness, and payment impact.

### Marketing

Insights should consume high-level lead and conversion outcomes from Marketing and Website Builder, not page-builder configuration.

### Property Management

Insights should consume property, unit, tenant request, maintenance, and work-order summaries for property-management accounts.

## UI And UX Findings

### What Works

- Existing top-level view selector makes the large data set more approachable.
- At-a-glance alerts are useful.
- Charts include empty states.
- CSV exports support real bookkeeping needs.
- Drilldowns avoid some dead-end dashboard behavior.
- Contractor Insights explains benchmark source and confidence.

### Issues

- Naming conflict between `Business Dashboard` and `Insights`.
- Page is dense and can feel like reports first, decisions second.
- Overview lacks a single plain-English business health narrative.
- Some charts are useful but secondary to daily owner decisions.
- Financial terminology can be too system-oriented.
- Benchmark empty states can read like the business has no data.
- Operations data exists but is not fully integrated with the Insights mental model.
- Mobile/tablet behavior has been adequate in QA, but the page is dense enough to require careful regression coverage.

### UX Recommendations

- Rename the page consistently to `Insights`.
- Add a top "Business Health" narrative card.
- Group KPIs by decision, not backend object.
- Use owner language: "Money waiting", "Work at risk", "Customers waiting", "Leads to follow up."
- Make every KPI clickable.
- Keep exports under Financial or Reports.
- Move benchmark comparisons below immediate operational health.
- Add clear empty states that explain what data is needed.

## Permissions Review

Recommended access:

- Owner: full Insights.
- Administrator: full or nearly full Insights, configurable.
- Office Manager: operations, customers, estimates, invoices, non-sensitive financial summaries.
- Project Manager: projects, milestones, customers, team workload, warranty, resolution status, limited financial data.
- Employee: no contractor Insights by default; use employee dashboard instead.
- Subcontractor: no contractor Insights.
- Customer: no contractor Insights.

Sensitive fields:

- Net paid
- Labor costs
- Profit and margin
- Tax/export data
- Employee performance
- Dispute/payment impact
- Customer lifetime value

These should be permission-gated before Insights becomes more powerful.

## Risks

### Metric Inconsistency

Revenue, net paid, pending release, payout, expense, draw, and escrow states can easily be counted differently across pages. Define metric contracts before adding more dashboards.

### Duplicated Reporting

Warranty, Team, Marketing, Customer Records, and Property Management each have their own dashboards. Insights should consume summaries, not duplicate detailed workflows.

### Overloaded Overview

If every domain adds cards to Overview, it will become noisy. Use severity, recency, and business impact to prioritize.

### AI Overreach

Project Assistant must explain business data and recommend actions, not make financial, staffing, payment, or dispute decisions automatically.

### Performance

Business dashboard queries are already broad. Adding more domains without caching or snapshots could slow page load and tests.

### Permissions

More valuable Insights means more sensitive data. Permission rules need to be explicit before exposing margin, labor, or employee performance.

## Launch Readiness

Current launch readiness as a reporting dashboard: 7.5 out of 10.

Current launch readiness as an intelligent business operations workspace: 5.5 out of 10.

Ready now:

- Financial snapshot
- Revenue and fee reporting
- Subcontractor payout reporting
- Operational alert foundation
- Contractor benchmark insight foundation
- Drilldown foundation
- CSV exports

Needs refinement before positioning as a daily command center:

- Consistent `Insights` naming
- Plain-English business health summary
- Unified metric definitions
- Broader operational/customer/team/warranty/resolution/property integration
- More complete profit and margin model
- Every KPI drilldown
- Project Assistant Operations Analyst layer

## Top 20 Improvements

1. Rename `Business Dashboard` consistently to `Insights`.
2. Add a top business health summary answering "How is my business doing?"
3. Define canonical metric contracts for revenue, net paid, pending release, on hold, profit, and receivables.
4. Make every KPI drill down to source records.
5. Add invoice aging and receivables.
6. Add cash-flow projection.
7. Add gross profit and margin estimates.
8. Integrate estimate pipeline and opportunity conversion.
9. Integrate customer follow-up and response-time metrics.
10. Integrate Team capacity and unassigned work metrics.
11. Integrate warranty cost and callback trends.
12. Integrate resolution case and payment-impact metrics.
13. Integrate property-management metrics for property accounts.
14. Add service-type profitability.
15. Add stale lead and stale estimate alerts.
16. Improve benchmark empty states.
17. Add Project Assistant Operations Analyst recommendations.
18. Add metric source explanations and confidence.
19. Add role-based permission controls for sensitive metrics.
20. Add performance snapshots or caching if query cost grows.

## Suggested Implementation Roadmap

### Phase 0: Metric Contracts

- Document each existing metric.
- Define source records and inclusion/exclusion rules.
- Align frontend labels with backend definitions.
- Fix naming consistency.

### Phase 1: Overview As Command Center

- Add business health narrative.
- Prioritize daily decisions.
- Link every top card to records.
- Pull operations dashboard summary into Insights.

### Phase 2: Financial Clarity

- Add receivables, aging, cash projection, gross margin, labor/material/subcontractor cost estimates.
- Improve small-contractor wording.
- Keep exports stable.

### Phase 3: Cross-Domain Operations

- Add Team, warranty, resolution, property, and customer summaries through shared services.
- Avoid duplicating detailed dashboards.

### Phase 4: Growth And Marketing Outcomes

- Add lead source, conversion, review, QR, website lead, and referral outcome metrics.
- Keep Website Builder analytics separate for page-level reporting.

### Phase 5: Project Assistant Operations Analyst

- Generate advisory insight artifacts with evidence, source records, confidence, and missing data.
- Keep all actions human-approved.

## Final Recommendation

Do not rebuild Insights. The existing Business Dashboard has meaningful reporting infrastructure, drilldowns, exports, and benchmark cards. The next architecture step is to make Insights the daily operating layer across MyHomeBro.

The best version of Insights is not a wall of charts. It is a business owner's command center that says:

- Here is what happened.
- Here is what changed.
- Here is what needs attention.
- Here is the evidence.
- Here is the recommended next action.

Project Assistant should become the Operations Analyst that explains those patterns, while the contractor remains the decision-maker.
