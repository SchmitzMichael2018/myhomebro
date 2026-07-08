# Team Workspace Architectural Audit

Date: July 7, 2026

Scope: Architectural, UX, data ownership, integration, and AI opportunity audit for the MyHomeBro Team Workspace. This audit does not implement behavior changes.

## Executive Summary

The current Team Workspace has a solid operational foundation: employees, subcontractors, assignments, scheduling, estimate availability, reviewer queues, role permissions, and advisory crew recommendations already exist. The main architectural issue is that Team is still a collection of related tools rather than a single workforce management system.

The cleanest long-term direction is to make Team the Workforce Command Center for every person and staffing decision connected to contractor operations. It should not replace Agreements, Estimates, Warranty, Property Management, or Expenses. Instead, it should provide a unified people, skills, availability, assignment, compliance, and capacity layer consumed by those workflows.

Recommended launch posture: keep existing models and workflows intact, then add a normalized workforce read layer before introducing larger model changes. This minimizes migration risk while creating a clear source of truth for staffing intelligence.

## Current Architecture

### Frontend Surface

Current Team-related pages and routes include:

- `frontend/src/pages/TeamOverviewPage.jsx`
- `frontend/src/pages/TeamPage.jsx`
- `frontend/src/pages/TeamEmployeeDetailPage.jsx`
- `frontend/src/pages/SubcontractorsPage.jsx`
- `frontend/src/pages/AssignmentsPage.jsx`
- `frontend/src/pages/TeamSchedule.jsx`
- `frontend/src/pages/EstimateAvailabilityPage.jsx`
- `frontend/src/pages/ReviewerQueuePage.jsx`
- `frontend/src/components/dashboard/hubTabsConfig.js`
- `frontend/src/routes/ProtectedRoutes.jsx`

The navigation already supports the core workforce areas: overview, members, assignments, schedule, subcontractors, and estimate availability. The shape is promising, but the pages still behave as separate modules.

### Backend Surface

Important backend objects and services include:

- `ContractorSubAccount`
- `EmployeeProfile`
- `Skill`
- `EmployeeCapability`
- `CrewAssignmentDraft`
- `AgreementAssignment`
- `MilestoneAssignment`
- `EmployeeWorkSchedule`
- `EmployeeScheduleException`
- `SubcontractorInvitation`
- `SubcontractorMilestoneAgreement`
- `SubcontractorQuoteRequest`
- `WarrantyWorkOrder`
- Maintenance and property-management work order services
- `crew_recommendations`
- `assignment_conflicts`
- `planning_validation`
- `project_activation`
- `subcontractor_compliance`

The backend has strong domain pieces, especially around agreements, milestones, subcontractors, scheduling, and advisory crew planning. The gap is normalization across work types and person types.

## Architectural Findings

### 1. Team Is Not Yet The Workforce Source Of Truth

Team currently aggregates several workforce features, but no single layer answers:

- Who is available?
- What can each person do?
- Who is assigned to what?
- What is the staffing risk across all active work?
- Which projects, estimates, warranty jobs, and maintenance work need people?

Those answers are distributed across assignment tables, schedules, subcontractor records, work orders, and planning services.

### 2. Assignment Data Is Fragmented

Assignments currently appear through multiple domain-specific paths:

- Agreement assignments
- Milestone assignments
- Crew assignment drafts
- Warranty work orders
- Maintenance work orders
- Property-management work orders
- Subcontractor milestone agreements
- Estimate availability and appointments
- Reviewer queue items

This is appropriate at the transaction level, but Team needs a normalized assignment view so the UI and AI can reason across all work without duplicating source records.

### 3. Employees And Subcontractors Are Parallel Silos

Employees and subcontractors are correctly different from a legal, payment, and permission standpoint. However, operationally they overlap:

- Skills
- Service areas
- Availability
- Certifications
- Compliance documents
- Assignment history
- Performance signals
- Project fit

The current architecture treats these as mostly separate experiences. Team should preserve those distinctions while giving contractors one workforce lens.

### 4. Skills Exist But Are Not Yet A Full Skills Matrix

`Skill` and `EmployeeCapability` provide the start of a skills framework. The next step is to make skills first-class across employees and subcontractors:

- Skill category
- Proficiency
- Years of experience
- Certification requirements
- Expiration dates
- Work-type fit
- Safety or license requirements
- Primary vs secondary skill

Without this, AI recommendations and planning validation can only be partially trusted.

### 5. Scheduling Is Useful But Not Yet Capacity Management

The schedule can show assigned work and availability, including warranty events. It does not yet fully answer:

- Who is overbooked?
- Which day has capacity?
- Which crew can take a project?
- Where are travel conflicts?
- Which project is at risk because no qualified person is available?
- Is a subcontractor needed?

The schedule should evolve from calendar display into capacity intelligence.

### 6. AI Recommendations Are Promising But Scattered

Crew recommendations, planning validation, activation preview, and conflict detection already point toward an intelligent staffing system. The issue is discoverability and consistency. AI should be surfaced as a neutral Project Assistant inside existing workflow moments, not as a separate destination or final decision-maker.

Recommended AI stance:

- Advisory only
- Evidence-based
- Explain why a person or crew is suggested
- Show missing data
- Require human approval before assignment
- Never assign, notify, or change payment state automatically

### 7. Permissions Need A More Granular Future

The current role and subaccount structure supports employee access, but Team will need more granular capabilities as it grows:

- Owner
- Admin
- Office manager
- Project manager
- Crew lead
- Employee
- Reviewer
- Subcontractor
- Property manager

Sensitive employee data, compliance documents, cost rates, and performance insights should not be visible to every team role.

## Recommended Architecture

### Team As Workforce Command Center

Team should own workforce operations, not project records themselves.

Recommended Team areas:

1. Overview
2. People
3. Skills Matrix
4. Assignments
5. Schedule and Capacity
6. Compliance and Documents
7. Estimate Availability
8. Workforce Insights

This keeps Team focused on people, availability, capability, staffing, and execution readiness.

### Team Should Own

- Employee profiles
- Subcontractor roster view
- Skills and capabilities
- Certifications and compliance status
- Labor cost visibility
- Availability and schedule exceptions
- Assignment visibility
- Capacity and workload
- Staffing recommendations
- Workforce documents
- Team communication context
- Non-punitive performance signals

### Team Should Consume

- Opportunities needing estimates
- Estimates needing staffing review
- Agreements needing crew assignment
- Milestones needing labor
- Warranty work orders
- Maintenance requests
- Property-management work orders
- Expense/reimbursement review tasks
- Dispute or resolution tasks when a staff owner is needed

### Team Should Not Own

- Agreement financial terms
- Payment release logic
- Customer-facing agreement status
- Warranty policy terms
- Property-management lease or tenant records
- Estimate pricing source of truth
- Project document versioning source of truth

Team should reference and staff those workflows, not duplicate them.

## Source Of Truth Recommendations

| Data Item | Owner | Team Role | Consumers |
| --- | --- | --- | --- |
| Employee identity | `ContractorSubAccount` | Owns operational profile | Auth, permissions, assignments |
| Employee HR/profile fields | `EmployeeProfile` | Owns | Team, planning, compliance |
| Employee skills | Skills capability layer | Owns or co-owns | Planning, estimates, assignments |
| Subcontractor identity | Subcontractor records | Displays and filters | Estimates, milestones, payments |
| Subcontractor compliance | Subcontractor compliance services | Displays status and alerts | Assignments, subcontractor agreements |
| Availability | Employee schedule and exceptions | Owns employee availability | Estimate booking, planning, schedule |
| Estimate slots | Estimate availability | Owns appointment availability | Public intake, opportunities, Team |
| Agreement assignments | Agreement assignment records | Consumes normalized view | Agreements, schedule, dashboard |
| Milestone assignments | Milestone assignment records | Consumes normalized view | Milestones, schedule, invoices |
| Warranty work assignments | Warranty work order records | Consumes normalized view | Warranty dashboard, Team schedule |
| Maintenance assignments | Maintenance/property work order records | Consumes normalized view | Customer portal, property management |
| Labor costs | Employee profile/capability data | Owns visibility by permission | Estimates, planning, profitability |
| Certifications | Compliance/document layer | Owns status view | Planning, assignments, audit |
| Performance metrics | Derived analytics | Displays carefully | Insights, staffing recommendations |
| Workforce documents | Document layer tagged to person | Owns access surface | Compliance, audit |

## Recommended Data Model Direction

### Short Term: Normalize With Services

Avoid replacing existing assignment models immediately. Add a read-layer service that returns a common workforce assignment shape:

- `source_type`
- `source_id`
- `member_type`
- `member_id`
- `contractor_id`
- `project_id`
- `agreement_id`
- `milestone_id`
- `customer_id`
- `scheduled_start`
- `scheduled_end`
- `status`
- `required_skills`
- `location`
- `priority`
- `financial_sensitivity`

This can power Team Overview, Schedule, Assignments, capacity checks, and AI recommendations without a risky migration.

### Medium Term: Add Workforce Abstractions

Consider introducing these only after the read-layer proves stable:

- `WorkforceMemberProfile`
- `WorkforceMemberSkill`
- `WorkforceDocument`
- `WorkforceComplianceRecord`
- `WorkforceAssignmentIndex`
- `CrewTemplate`

These should supplement, not erase, employee/subcontractor source models.

### Migration Impact

Low-risk path:

1. Create normalized query/service layer.
2. Backfill no data.
3. Update Team UI to consume normalized responses.
4. Add skills/compliance extensions.
5. Add materialized assignment index only if performance requires it.

High-risk path to avoid:

- Replacing agreement, milestone, warranty, and maintenance assignment tables in one migration.
- Moving subcontractor payment/compliance state into a generic team table.
- Making AI write directly into assignment or payment records.

## Integration Recommendations

### Opportunities

Opportunities should show whether the contractor has people available to estimate and eventually perform the work. Team should provide staffing hints without blocking opportunity review.

### Estimates

Estimates should consume:

- Available estimator slots
- Skill fit
- Labor cost guidance
- Subcontractor fit
- Capacity risk

The Estimate Workspace should be able to request a staffing recommendation from Team.

### Planning

Planning validation should consume Team data for:

- Skill coverage
- Availability conflicts
- Missing certifications
- Subcontractor dependencies
- Labor cost assumptions
- Crew size risk

### Active Projects

Active projects should write and update assignment records through existing domain models, while Team consumes a normalized view.

### Warranty Work

Warranty work should continue appearing in Team Schedule. Next step: recommend technicians based on original project team, skill match, callback history, and availability.

### Expenses

Expenses should connect to Team in two ways:

- Employee reimbursement workflows
- Labor and subcontractor cost visibility for profitability

Team should not own expense approval rules.

### Property Management

Property-management staff, vendors, and work orders should feed the Team assignment and schedule layer when they are part of the contractor organization.

### Project Assistant

Project Assistant should use Team context to explain:

- Best available crew
- Capacity risks
- Missing skills
- Assignment conflicts
- Compliance blockers
- Subcontractor recommendations

It should never auto-assign people or notify customers without confirmation.

## UI And UX Findings

### What Works

- Team has a clear hub concept.
- Assignments, schedule, and subcontractors are separate enough to be understandable.
- Estimate availability being inside Team is sensible.
- The current operational styling fits a contractor workflow better than a marketing-style layout.

### Confusing Or Incomplete Areas

- "Members" and "Subcontractors" feel separate even though contractors think about both as workforce resources.
- Assignment views do not clearly unify project, warranty, maintenance, and estimate work.
- Skills are present in the data model but not obvious as a contractor-facing matrix.
- Compliance and documents are not prominent enough for real-world workforce management.
- AI recommendations are not yet visible as a consistent assistant pattern across Team pages.
- Schedule is useful, but it needs clearer capacity and conflict indicators.

### Recommended Navigation

Recommended Team navigation:

- Overview
- People
- Skills
- Assignments
- Schedule
- Availability
- Compliance
- Subcontractors
- Insights

If this is too many top-level tabs, use:

- Overview
- People
- Workload
- Schedule
- Compliance
- Insights

Then place employees, subcontractors, skills, and documents inside People.

### Recommended Team Overview Widgets

- Today's schedule
- Unassigned work
- At-risk assignments
- Capacity by day
- Skill gaps
- Expiring documents
- Estimate availability
- Warranty work due
- Pending subcontractor responses
- Labor cost snapshot
- Project Assistant recommendations

## AI Opportunities

### Team Overview

AI can summarize workload risk:

- "Two milestones need flooring labor this week."
- "One warranty callback has no technician assigned."
- "The estimate calendar is open Tuesday but no estimator has matching service-area coverage."

### People

AI can detect missing profile data:

- Missing emergency contact
- Missing labor cost
- Missing capabilities
- Expired insurance
- Missing service area

### Skills Matrix

AI can identify gaps:

- Not enough LVP installation coverage
- No licensed electrical subcontractor in service area
- Concrete jobs rely on one person

### Assignments

AI can recommend crews with evidence:

- Skill match
- Schedule fit
- Location fit
- Prior project familiarity
- Compliance status

### Schedule

AI can explain conflicts and suggest alternatives:

- Same employee assigned to overlapping work
- Assignment outside normal hours
- Warranty task conflicts with milestone completion

### Subcontractors

AI can recommend which subcontractors to invite based on:

- Trade
- Compliance
- Past response time
- Quote history
- Location

### Guardrails

All AI staffing output should be labeled recommendation only. Humans must approve assignments, customer notifications, subcontractor invitations, and any payment-related action.

## Priority Ranking

### P0

1. Create a normalized workforce assignment service.
2. Add a source-of-truth map for all team, assignment, schedule, and compliance records.
3. Make Team Overview consume unified assignment and schedule data.
4. Preserve existing assignment tables and payment workflows.

### P1

5. Add a first-class Skills Matrix.
6. Add capacity indicators to Team Schedule.
7. Surface conflict and availability warnings consistently.
8. Show warranty, maintenance, estimate, agreement, and milestone work in one workload view.
9. Add compliance/document expiration status.
10. Improve assignment traceability back to source workflow.

### P2

11. Add crew templates.
12. Add non-punitive performance insights.
13. Add labor cost and profitability staffing signals.
14. Add AI staffing summaries across Team pages.
15. Add subcontractor fit recommendations.

### P3

16. Add advanced forecasting.
17. Add hiring gap recommendations.
18. Add workload balancing automation suggestions.
19. Add deeper communication history.
20. Add richer workforce analytics dashboards.

## Top 20 Improvements

1. Build a normalized workforce assignment read layer.
2. Create a unified Team Overview dashboard.
3. Add a Skills Matrix page.
4. Add profile completion indicators.
5. Add certification and insurance expiration alerts.
6. Expand Team Schedule into capacity management.
7. Include warranty and maintenance work in assignment summaries.
8. Connect estimate staffing recommendations to Team data.
9. Add source links from every assignment to its original record.
10. Unify employee and subcontractor search.
11. Add schedule-change notifications.
12. Add PTO and unavailable-date UX.
13. Add crew templates for repeat project types.
14. Track warranty callbacks by original crew carefully and neutrally.
15. Add non-ranking performance insights.
16. Add workforce document tagging.
17. Add manager and crew-lead permission granularity.
18. Improve mobile schedule and assignment cards.
19. Add Project Assistant summaries on Team pages.
20. Add migration documentation before changing assignment models.

## Risks

### Data Duplication

Adding new workforce tables too early could duplicate existing agreement, milestone, warranty, and subcontractor records. Use read-layer normalization first.

### Permission Leakage

Team will eventually contain sensitive labor costs, compliance records, performance signals, and personal information. Role-based visibility must be explicit.

### AI Trust

Crew recommendations can affect livelihoods and customer outcomes. AI must explain evidence, missing data, and uncertainty.

### Performance Metrics Misuse

Performance insights should help owners spot operational bottlenecks. Avoid punitive rankings or unexplained scoring.

### Schedule Complexity

Real scheduling requires travel time, job duration uncertainty, skill constraints, PTO, weather, and subcontractor availability. Avoid presenting schedule recommendations as certain.

### Migration Risk

Replacing domain-specific assignment tables would be risky. Keep source records where they belong and build a unified index or service around them.

## Launch Readiness

Current launch readiness as a full intelligent workforce management system: 6.5 out of 10.

The existing Team Workspace is useful for early launch operations. It can support employees, subcontractors, assignments, schedules, and estimate availability. It is not yet ready to be positioned as a complete intelligent workforce command center because assignment data, skills, compliance, and capacity are not fully unified.

Launch-ready with current scope:

- Employee roster
- Subcontractor roster
- Basic assignments
- Basic schedule
- Estimate availability
- Advisory crew recommendation foundation

Needs refinement before full positioning:

- Unified assignment source of truth
- Skills matrix
- Capacity view
- Compliance center
- AI recommendation consistency
- Cross-workflow workforce dashboard

## Suggested Implementation Roadmap

### Phase 0: Architecture Map

- Document all assignment-producing models and APIs.
- Define normalized workforce assignment response shape.
- Define member visibility and permission rules.

### Phase 1: Unified Read Layer

- Add workforce assignment service.
- Feed Team Overview, Assignments, and Schedule from the same normalized data.
- Keep source models unchanged.

### Phase 2: Skills And Staffing Intelligence

- Expand skills matrix.
- Support employee and subcontractor skills.
- Connect planning validation and crew recommendations to the skills matrix.

### Phase 3: Capacity And Conflict Management

- Add capacity indicators.
- Add conflict explanations.
- Add schedule risk widgets.
- Include warranty, maintenance, estimate, milestone, and agreement work.

### Phase 4: Compliance And Documents

- Add workforce document tagging.
- Add expiration reminders.
- Add compliance readiness states for subcontractors and employees.

### Phase 5: Project Assistant Integration

- Add Team-aware Project Assistant panels.
- Require human approval for all assignments and notifications.
- Track AI recommendations as advisory artifacts.

## Final Recommendation

Do not rebuild Team from scratch. The right path is to preserve existing employee, subcontractor, assignment, schedule, and planning functionality, then introduce a normalized workforce layer that makes Team the place where contractors answer:

- Who do I have?
- What can they do?
- Are they available?
- What work needs people?
- What is at risk?
- What should I do next?

That gives MyHomeBro a credible path from Team Workspace to intelligent workforce management without destabilizing agreements, payments, warranty, or project operations.
