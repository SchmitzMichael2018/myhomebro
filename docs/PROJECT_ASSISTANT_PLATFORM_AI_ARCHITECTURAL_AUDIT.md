# Project Assistant Platform-Wide AI Architectural Audit

Date: July 8, 2026

Scope: Platform-wide architectural review of Project Assistant across MyHomeBro. This audit covers current AI architecture, workspace opportunities, safe action boundaries, source data, guardrails, UX patterns, risks, launch readiness, and roadmap. This audit does not implement behavior changes.

## Executive Summary

MyHomeBro already has many strong AI and intelligence foundations: global Project Assistant dock, Assistant Home, deterministic assistant orchestration, agreement AI drafting, project classification, template recommendation, milestone suggestions, pricing guidance, intake analysis, crew recommendations, planning validation, warranty AI review, dispute/resolution recommendations, contractor insights, dashboard insight cards, and Website Builder AI hooks.

The main architectural issue is consistency. AI currently appears as a mix of:

- Global Project Assistant dock.
- Agreement Wizard AI panel.
- Intake AI recommendation panel.
- Dispute AI advisor/recommendation panel.
- Warranty AI review payload.
- Planning validation and crew recommendation services.
- Business/contractor insights cards.
- Website Builder AI copy hooks.
- Admin recommendations and operational analytics.

These should become one product identity: Project Assistant.

Recommended direction:

- Keep one AI identity: Project Assistant.
- Adapt its label by context, such as Opportunity Assistant, Estimate Assistant, Agreement Assistant, Resolution Assistant, Marketing Advisor, Operations Analyst, and Marketplace Operations Advisor.
- Standardize every AI output around summary, evidence, missing information, risks, recommendations, prepared actions, confidence, and human approval.
- Treat all irreversible, customer-facing, financial, legal, marketplace, staffing, and publishing actions as human-only.
- Persist important AI artifacts when decisions, disputes, payments, warranties, or customer-facing documents may rely on them.

Launch readiness today:

- Core AI capability foundation: 7 out of 10.
- Platform-wide Project Assistant consistency: 5 out of 10.
- Launch-safe advisory guardrail posture: 6.5 out of 10.

## Current AI Architecture Review

### Frontend Surfaces Reviewed

- `frontend/src/components/AssistantDock.jsx`
- `frontend/src/pages/AIAssistantPage.jsx`
- `frontend/src/components/StartWithAIAssistant.jsx`
- `frontend/src/lib/projectAssistantActions.js`
- `frontend/src/lib/aiContext.js`
- `frontend/src/lib/assistantReasoning.js`
- `frontend/src/lib/agreementWizardAiPanel.js`
- `frontend/src/components/intake/IntakeAiRecommendationPanel.jsx`
- `frontend/src/components/ai/DisputeAIAdvisor.jsx`
- `frontend/src/components/ai/DisputeAIRecommendationPanel.jsx`
- `frontend/src/components/dashboard/ContractorInsightsSection.jsx`
- `frontend/src/components/dashboard/InsightRecommendationCard.jsx`
- `frontend/src/components/website/WebsiteBuilderWizard.jsx`

### Backend Surfaces Reviewed

- `backend/projects/api/ai_agreement_views.py`
- `backend/projects/services/ai_orchestrator.py`
- `backend/projects/services/ai/project_understanding.py`
- `backend/projects/services/ai/project_classifier.py`
- `backend/projects/services/ai/project_drafter.py`
- `backend/projects/services/ai/evidence_context.py`
- `backend/projects/services/ai/dispute_summary.py`
- `backend/projects/ai/agreement_description_writer.py`
- `backend/projects/ai/agreement_milestone_writer.py`
- `backend/projects/ai/disputes_recommendation.py`
- `backend/projects/services/planning_validation.py`
- `backend/projects/services/crew_recommendations.py`
- `backend/projects/services/warranty_management.py`
- `backend/projects/services/resolution_workspace.py`
- `backend/projects/services/contractor_insights.py`
- `backend/projects/services/business_dashboard_insights.py`
- `backend/projects/services/website_builder.py`
- `backend/projects/models_ai_artifacts.py`

### Existing Strengths

- `AssistantDock` gives the product a global Project Assistant entry point.
- `workspaceModeForRoute` already adapts Assistant copy by route.
- `AIAssistantPage` frames Project Assistant as a single AI identity with contextual behavior.
- `/api/projects/assistant/orchestrate/` returns deterministic orchestration without mutating data.
- `ai_orchestrator.py` already uses routines for lead intake, agreement builder, template recommendation, estimation, compliance, subcontractor assignment, maintenance contract preview, onboarding, and navigation.
- Orchestrator responses include confidence, confidence reasoning, warnings, missing fields, available actions, proposed actions, and confirmation-required actions.
- Agreement AI endpoints return project understanding, classification, clarification questions, warnings, and milestone/pricing guidance.
- Dispute AI artifacts are persisted, versioned, digest-based, and auditable.
- Resolution Workspace explicitly states AI is advisory only and humans decide outcomes.
- Warranty AI review includes advisory-only flag, missing information, evidence considered, confidence level, and a boundary statement.
- Planning validation is advisory and does not create assignments or schedules.
- Crew recommendations use source records and include advisory notices.
- Website Builder AI hooks are gated and require user acceptance.

### Current Gaps

- AI surfaces are not visually or structurally consistent across workspaces.
- Some AI panels are deterministic intelligence rather than true assistant interactions, but the UI language does not always make that distinction clear.
- Project Assistant context is route-aware but not yet fully record-aware across every workspace.
- Evidence, source citations, confidence, and missing-data patterns are not standardized.
- Prepared actions and executed actions need a universal schema and audit model.
- AI artifact persistence exists for disputes but not consistently for agreements, estimates, warranty recommendations, team recommendations, or admin recommendations.
- Some domains still use “AI,” “Copilot,” “Advisor,” and “Assistant” inconsistently.
- Customer-facing Project Assistant behavior is less mature than contractor-facing behavior.
- Admin AI recommendations are not yet clearly separated by marketplace, finance, support, risk, and platform health domains.

## Recommended Behavior Model

Project Assistant should use one shared behavior model everywhere.

### Standard Assistant Output

Every Project Assistant result should be able to return:

- `summary`
- `current_state`
- `risks`
- `missing_information`
- `recommendations`
- `recommended_next_action`
- `safe_prepared_actions`
- `human_only_actions`
- `evidence`
- `source_records`
- `confidence`
- `confidence_reasoning`
- `assumptions`
- `audit_metadata`

### Standard Recommendation Structure

Each recommendation should include:

- Title.
- Plain-language explanation.
- Priority.
- Evidence used.
- Missing evidence.
- Confidence.
- Risk level.
- Suggested next action.
- Whether it can be prepared.
- Whether it requires approval.
- Source record links.

### Standard Action Classes

| Action Class | Examples | AI May Do | Human Required |
| --- | --- | --- | --- |
| Navigate | Open agreement, open estimate, open dispute | Prepare/open route | No, if read-only route |
| Draft | Scope, milestones, email copy, warranty note | Prepare draft | Yes before save/send |
| Validate | Check readiness, missing fields, conflicts | Run/read result | Human reviews |
| Compare | Template match, price benchmark, staffing options | Present comparison | Human chooses |
| Recommend | COA, next task, crew, SEO improvement | Recommend with evidence | Human decides |
| Mutate internal draft | Apply draft fields, update non-final wizard fields | Prepare/apply after explicit click | Yes |
| Customer-facing communication | Email, SMS, notification | Draft only | Yes before send |
| Financial action | Release, refund, transfer, charge | Never execute | Always human/system-gated |
| Legal/binding action | Sign, finalize agreement, close resolution | Never execute | Always human |
| Marketplace/admin action | Verify, suspend, route, reject | Never execute | Always human |
| Publishing action | Publish website, campaign, public profile | Draft/audit only | Always human |
| Staffing action | Assign team/subcontractor | Recommend only | Always human |

## Shared AI Interaction Patterns

Project Assistant should use these patterns across the platform:

- Summary card: current state and what matters now.
- Recommendation card: one or more recommended next steps.
- Risk warning: visible when money, legal, schedule, warranty, dispute, or customer trust is affected.
- Missing information checklist: field-level and evidence-level gaps.
- Suggested next action: one primary action with reason.
- Draft generation: user reviews before applying.
- Validation panel: readiness, blockers, warnings, assumptions.
- Comparison table: options with pros/cons/evidence.
- Timeline summary: important lifecycle events.
- Evidence summary: source records and attachments considered.
- Confidence indicator: high/medium/low with explanation.
- Source citation links: direct links to agreement, estimate, milestone, invoice, dispute, document, photo, message, lead, or profile records.
- Human approval step: required for any meaningful mutation or external action.

## Workspace-By-Workspace AI Opportunity Map

### Dashboard

Current AI behavior:

- Assistant Dock has dashboard context.
- Assistant Home fetches agreements, milestones, leads, and templates.
- Dashboard insight cards and next-best-action concepts exist.

Recommended AI behavior:

- Summarize what needs attention today.
- Detect overdue milestones, unsigned agreements, unfunded agreements, new leads, payment blockers, disputes, warranty requests, and missing setup.
- Recommend one prioritized daily queue.

Source data:

- Agreements, opportunities, estimates, milestones, invoices, disputes, warranty requests, public leads, notifications, assignments, Stripe readiness.

Safe prepared actions:

- Open workspace.
- Draft customer follow-up.
- Prepare checklist.

Human-only actions:

- Send messages, request payment, release funds, assign work, close work.

Priority: P0.

### Opportunities

Current AI behavior:

- Intake analysis and public lead AI analysis exist.
- Orchestrator has lead intake routine.
- Public leads can be analyzed and converted.

Recommended AI behavior:

- Summarize lead quality, customer need, scope clarity, urgency, and missing information.
- Recommend accept/reject/follow-up only as advisory.
- Route toward Estimate Workspace before Agreement when estimate-first flow applies.

Source data:

- Public lead, ProjectIntake, customer contact, project description, photos, estimate availability, contractor service areas, past similar leads, opportunities.

Safe prepared actions:

- Draft intake follow-up questions.
- Prepare estimate checklist.
- Prepare opportunity summary.

Human-only actions:

- Accept/reject lead, send customer message, schedule appointment, create agreement.

Priority: P0.

### Estimates

Current AI behavior:

- Estimate workspace exists, with estimate-first flow tested previously.
- Orchestrator has estimation routine using deterministic project intelligence.
- Pricing and contractor insights services exist.

Recommended AI behavior:

- Summarize estimate readiness.
- Detect missing measurements, photos, scope, line items, clarifications, incidentals reserve, schedule assumptions, and customer constraints.
- Compare line items to similar work and contractor history.
- Prepare an Agreement Wizard handoff while preserving estimate facts.

Source data:

- Proposal/estimate records, opportunity, customer, property, checklist, line items, photos, docs, incidentals reserve, availability, contractor benchmarks.

Safe prepared actions:

- Draft line items.
- Draft clarification questions.
- Prepare Create Agreement payload.
- Suggest reserve amount.

Human-only actions:

- Send estimate, approve pricing, create/send agreement, notify customer.

Priority: P0.

### Agreement Wizard

Current AI behavior:

- Agreement Step 1 AI description/classification exists.
- Step guide and Project Assistant actions exist.
- Milestone generation, pricing refresh, template recommendations, and project draft endpoints exist.
- Recent work fixed estimate-origin Step 1 handoff concerns.

Recommended AI behavior:

- Act as Agreement Assistant.
- Preserve source facts from lead/estimate.
- Improve scope and milestones only when explicitly requested.
- Explain classification, template choice, pricing confidence, and missing fields.
- Warn when AI would overwrite contractor or estimate-origin edits.

Source data:

- Lead, estimate, agreement draft, selected template, taxonomy, milestones, pricing guidance, clarifications, warranty settings, documents.

Safe prepared actions:

- Draft scope.
- Draft milestones.
- Draft clarifications.
- Draft warranty text.
- Prepare template match.

Human-only actions:

- Save final agreement fields if overwriting user edits without confirmation, send agreement, sign agreement, collect funds.

Priority: P0.

### Agreement Workspace

Current AI behavior:

- Assistant Dock has agreement context.
- Agreement details, milestones, invoices, amendments, and PDFs are available.
- Signed snapshots and PDF versioning exist.

Recommended AI behavior:

- Summarize agreement status, signatures, funding, milestones, amendments, invoices, disputes, documents, and next blockers.
- Detect mismatches between scope, milestones, invoices, amendments, and payment state.
- Prepare amendment drafts and customer update drafts.

Source data:

- Agreement, signed snapshot, PDF versions, amendments, milestone statuses, invoices, payments, disputes, messages, documents.

Safe prepared actions:

- Draft amendment.
- Draft customer update.
- Prepare milestone checklist.

Human-only actions:

- Send amendment, sign, release funds, refund, cancel, close agreement.

Priority: P0.

### Planning Validation

Current AI behavior:

- Deterministic planning validation checks date range, committed agreements, capability requirements, overlaps, warnings, blockers, and advisory notice.

Recommended AI behavior:

- Act as Planning Assistant.
- Explain conflicts, missing dates, capacity gaps, skill gaps, and suggested timeline alternatives.
- Show confidence based on schedule completeness and assignment data.

Source data:

- Agreement, milestones, planning assumptions, assignments, team capabilities, committed work, dates.

Safe prepared actions:

- Suggest timeline.
- Prepare staffing checklist.
- Prepare conflict explanation.

Human-only actions:

- Assign team, commit schedule, notify customer, change milestone dates.

Priority: P0.

### Project Activation Preview

Current AI behavior:

- Planning validation and activation preview concepts exist around agreement readiness.

Recommended AI behavior:

- Summarize whether the project is ready to activate.
- Detect missing signature, funding, schedule, assignments, documents, warranty, customer responsibilities, and risk acknowledgements.

Source data:

- Agreement, signatures, funding, milestones, planning validation, assignments, documents, customer/contractor responsibilities.

Safe prepared actions:

- Prepare activation checklist.
- Draft kickoff message.

Human-only actions:

- Activate project, send kickoff message, assign work, request payment.

Priority: P0.

### Active Projects

Current AI behavior:

- Project detail and milestone/payment data exist; global Assistant can load route context.

Recommended AI behavior:

- Summarize current project state, schedule, open decisions, customer blockers, payment blockers, and upcoming milestones.
- Detect scope drift, delayed milestones, missing photos, unpaid invoices, overdue approvals, and dispute risk.

Source data:

- Project, agreement, milestones, assignments, invoices, payments, messages, documents, photos, expenses, disputes.

Safe prepared actions:

- Draft update.
- Prepare punch list.
- Suggest next milestone.

Human-only actions:

- Mark complete, request approval, send customer update, assign team, release funds.

Priority: P1.

### Milestones

Current AI behavior:

- Agreement Wizard milestone assistant actions exist.
- Milestone performance intelligence is described in existing AI architecture.
- Milestone detail and workflow exist.

Recommended AI behavior:

- Summarize milestone readiness, completion evidence, invoice readiness, assigned labor, and approval blockers.
- Detect missing photos, zero-dollar completion path, unclear criteria, payment/funding mismatch, and dispute risk.

Source data:

- Milestone, agreement, assignments, invoice, completion evidence, documents, customer approval, payout status.

Safe prepared actions:

- Draft completion summary.
- Draft invoice description.
- Prepare approval request.

Human-only actions:

- Submit milestone, approve milestone, create invoice, release funds, mark paid.

Priority: P0.

### Payments

Current AI behavior:

- Payment/invoice Assistant copy exists in route mode.
- Fee, reimbursement, escrow, direct pay, payout, and invoice services exist.

Recommended AI behavior:

- Summarize payment state and blockers.
- Detect funding gaps, failed payment intents, unpaid invoices, dispute holds, payout blockers, fee mismatches, and zero-dollar approval conditions.
- Explain money flow in plain language.

Source data:

- Invoice, payment intent, escrow balance, agreement funding, draw requests, refunds, reimbursement releases, payouts, disputes, ledger/audit events.

Safe prepared actions:

- Prepare payment explanation.
- Draft customer reminder.
- Prepare support checklist for failed payment.

Human-only actions:

- Charge, refund, release funds, retry transfer, create Stripe action, mark paid manually.

Priority: P0.

### Expenses

Current AI behavior:

- Expense and reimbursement workflows exist; no consistent Assistant pattern observed.

Recommended AI behavior:

- Summarize expense approval/reimbursement state.
- Detect missing receipts, over-budget categories, agreement/milestone mismatch, dispute holds, and release blockers.

Source data:

- Expenses, receipts, agreement, milestone, incidentals reserve, reimbursements, ledger, payment holds.

Safe prepared actions:

- Categorize expense draft.
- Prepare reimbursement summary.
- Flag missing receipt.

Human-only actions:

- Approve expense, release reimbursement, retry payout, notify customer.

Priority: P1.

### Team

Current AI behavior:

- Crew recommendations exist.
- Planning validation uses team capabilities.
- Team audit already identifies AI staffing opportunities.

Recommended AI behavior:

- Act as Team Assistant.
- Summarize workload, availability, capability gaps, subcontractor fit, compliance gaps, and assignment conflicts.
- Recommend crew options with evidence.

Source data:

- Employees, subaccounts, subcontractors, capabilities, labor costs, assignments, schedule, invitations, compliance records, agreements, milestones.

Safe prepared actions:

- Prepare crew recommendation.
- Draft subcontractor invite.
- Prepare capability gap checklist.

Human-only actions:

- Assign employees, invite subcontractors, schedule work, change labor cost, send team/customer messages.

Priority: P1.

### Customer Portal

Current AI behavior:

- Customer portal has many workflows, but Assistant behavior appears less developed than contractor side.

Recommended AI behavior:

- Act as Customer Guide, not contractor advisor.
- Explain agreement status, milestones, payments, documents, warranty options, and next customer action.
- Keep language neutral and non-legal.

Source data:

- Customer agreements, properties, records, milestones, invoices, payment status, documents, warranty, maintenance, notifications.

Safe prepared actions:

- Explain next step.
- Prepare question to contractor.
- Summarize documents.

Human-only actions:

- Approve completion, pay invoice, sign agreement, open dispute, submit warranty request, send message.

Priority: P1.

### Property Management

Current AI behavior:

- Rental/property-management workflows exist, including maintenance requests and work orders.
- Maintenance contract specialist exists in orchestrator as preview.

Recommended AI behavior:

- Summarize property portfolio health, open tenant requests, work orders, recurring maintenance, documents, payments, and owner/tenant routing.
- Detect overdue work orders, tenant communication gaps, missing property records, repeated maintenance categories, and warranty overlap.

Source data:

- Properties, units, tenants, maintenance requests, work orders, agreements, invoices, documents, home records, warranties.

Safe prepared actions:

- Draft work order summary.
- Prepare routing recommendation.
- Draft tenant/owner update.

Human-only actions:

- Send tenant messages, assign work, approve costs, schedule appointment, charge/pay.

Priority: P2.

### Warranty

Current AI behavior:

- `build_warranty_ai_review` returns advisory-only review, likely coverage, possible exclusions, missing information, recommended next step, recommended team member, confidence, evidence considered, and boundary.

Recommended AI behavior:

- Act as Warranty Assistant.
- Avoid approve/deny language.
- Summarize warranty terms, issue details, evidence, missing information, possible exclusions, schedule urgency, and next review action.
- Use “appears,” “based on available evidence,” and “needs review” framing.

Source data:

- Agreement warranty, completion date, warranty request, evidence, status history, work order, agreement scope, documents, photos.

Safe prepared actions:

- Draft request for more evidence.
- Prepare inspection checklist.
- Draft work order.

Human-only actions:

- Approve coverage, deny coverage, schedule repair, assign team, close warranty, create payment obligation.

Priority: P0.

### Resolution Workspace

Current AI behavior:

- Resolution AI recommendation panel exists.
- Evidence context panel exists.
- AI artifacts are persisted, versioned, and cached by evidence digest.
- Resolution Workspace prevents AI from resolving disputes or moving funds.

Recommended AI behavior:

- Act as Resolution Assistant.
- Organize case summary, timeline, disputed facts, undisputed facts, evidence table, missing evidence, courses of action, recommended COA, confidence, and human decision options.
- Preserve neutral wording and avoid legal conclusions.

Source data:

- Dispute, agreement, milestones, invoices, payments, expenses, photos, documents, statements, attachments, messages, timeline, evidence index, payment holds.

Safe prepared actions:

- Draft resolution proposal.
- Draft evidence request.
- Draft neutral summary.

Human-only actions:

- Accept/reject/counter/escalate, close dispute, sign resolution agreement, release/refund funds, assign blame.

Priority: P0.

### Insights

Current AI behavior:

- Contractor insights and dashboard insight cards exist.
- Insights audit recommends Operations Analyst behavior.

Recommended AI behavior:

- Act as Operations Analyst.
- Explain business performance, trends, bottlenecks, cash-flow risk, conversion, payment delay, dispute/warranty patterns, team utilization, marketing source performance, and benchmark confidence.

Source data:

- Agreements, estimates, opportunities, invoices, payments, expenses, milestones, team assignments, disputes, warranty, marketing leads, reviews, benchmarks.

Safe prepared actions:

- Prepare report.
- Recommend investigation.
- Draft operational checklist.

Human-only actions:

- Change prices, change staffing, send messages, refund/release money, alter records.

Priority: P1.

### Marketing

Current AI behavior:

- Website Builder AI assist hooks exist but provider integration is pending.
- Public profile generation exists.
- Marketing audit recommends Marketing Advisor behavior.

Recommended AI behavior:

- Act as Marketing Advisor.
- Audit profile, website, SEO, reviews, portfolio, QR/campaigns, and leads.
- Recommend copy, project photos, review requests, SEO improvements, and campaign ideas with evidence.

Source data:

- Company facts, public profile, website pages, gallery, reviews, leads, QR campaigns, SEO metadata, opportunities, conversion outcomes.

Safe prepared actions:

- Draft website copy.
- Draft SEO fields.
- Draft review request.
- Recommend portfolio items.

Human-only actions:

- Publish website, send messages, create campaigns, fabricate or alter reviews, change verified business facts.

Priority: P1.

### Admin

Current AI behavior:

- Admin recommendations and marketplace analytics exist.
- Admin audit recommends Marketplace Operations Advisor.
- Assistant Dock has admin route mode.

Recommended AI behavior:

- Act as Marketplace Operations Advisor.
- Summarize marketplace health, verification queues, routing issues, financial operations risk, support issues, warranty/resolution escalation, platform health, and contractor/customer risk.

Source data:

- Marketplace requests, contractor verification, contractor directory, support tickets, disputes, warranties, payments, fees, reimbursements, webhooks, notifications, admin audit logs, reviews, locations.

Safe prepared actions:

- Prepare investigation checklist.
- Draft internal note.
- Recommend queue priority.

Human-only actions:

- Verify/reject/suspend contractor, route marketplace request, release/refund funds, send platform announcement, close support case, alter admin settings.

Priority: P1.

### Documents

Current AI behavior:

- Agreement PDFs, signed snapshots, document uploads, resolution documents, warranty evidence, gallery/docs exist.
- No unified document assistant observed.

Recommended AI behavior:

- Summarize document set, identify missing required docs, explain document purpose, flag stale versions, and cite signed/current versions.

Source data:

- Agreement PDF versions, signed snapshots, attachments, resolution documents, warranty evidence, project photos, customer documents, receipts.

Safe prepared actions:

- Draft document summary.
- Prepare checklist.
- Suggest which doc to attach.

Human-only actions:

- Sign, archive, delete, send, replace signed document, finalize PDF.

Priority: P2.

### Notifications

Current AI behavior:

- Smart notifications and email/SMS workflows exist.
- Assistant Home claims messages require confirmation.

Recommended AI behavior:

- Draft clear, role-aware notifications and explain why a notification is recommended.
- Detect missing, failed, duplicate, or risky notifications.

Source data:

- Notification rules, smart notification events, agreement status, milestone events, warranty status, maintenance events, support sync, email/SMS logs.

Safe prepared actions:

- Draft email/SMS/in-app notification.
- Suggest recipient and timing.

Human-only actions:

- Send customer message, send SMS/email, broadcast announcement, change notification rules.

Priority: P1.

### Settings

Current AI behavior:

- Contractor onboarding specialist exists.
- Assistant can guide setup and Stripe readiness.

Recommended AI behavior:

- Explain setup completeness, missing business facts, Stripe readiness, notification settings, team permissions, service areas, and marketing readiness.

Source data:

- Contractor profile, Company/Business Profile, Stripe account, service areas, licenses, insurance, notification rules, team roles, marketing profile.

Safe prepared actions:

- Prepare setup checklist.
- Explain setting impact.

Human-only actions:

- Change payment settings, change tax info, change role permissions, publish public facts, connect/disconnect integrations.

Priority: P1.

## Guardrail Matrix

| Domain | AI May Prepare | AI Must Never Automatically Do |
| --- | --- | --- |
| Agreements | Draft terms, scope, milestones, clarifications | Sign, send, finalize binding terms without review |
| Estimates | Draft line items, checklist, handoff payload | Send estimate, approve pricing, create binding agreement without review |
| Payments | Explain state, draft reminder, flag blockers | Release funds, refund, charge, transfer, mark paid |
| Disputes | Summarize, organize evidence, recommend COAs | Resolve, close, assign blame, release/refund funds, make legal conclusion |
| Warranty | Summarize evidence, suggest inspection | Approve/deny coverage, assign blame, create payment obligation |
| Team | Recommend crew, flag conflicts | Assign team, schedule, invite/send messages automatically |
| Marketing | Draft copy, recommend SEO/campaigns | Publish website, send campaigns, fabricate trust signals |
| Admin | Recommend investigation, prioritize queues | Verify/suspend users, route requests, release/refund money |
| Customer Portal | Explain next steps, draft questions | Approve, pay, sign, dispute, submit warranty without user action |
| Notifications | Draft messages | Send email/SMS/push automatically |
| Documents | Summarize, checklist missing docs | Sign, delete, replace locked artifacts, send externally |

## Source-Data Map

| Source Record | Used By Assistant In |
| --- | --- |
| Contractor profile | Dashboard, Settings, Marketing, Admin, Insights |
| Company/business facts | Marketing, Website Builder, Settings, Admin |
| Public leads / ProjectIntake | Opportunities, Estimates, Dashboard, Marketing |
| Opportunities | Opportunities, Estimates, Insights, Dashboard |
| Estimates/proposals | Estimates, Agreement Wizard, Insights |
| Agreements | Agreement Wizard, Agreement Workspace, Projects, Payments, Warranty, Resolution, Insights |
| Milestones | Agreement Wizard, Projects, Payments, Team, Resolution, Insights |
| Invoices/payments/escrow | Payments, Agreements, Resolution, Admin, Insights |
| Expenses/reimbursements | Expenses, Payments, Admin, Resolution, Insights |
| Team/capabilities/assignments | Team, Planning Validation, Projects, Warranty |
| Documents/photos | Estimates, Projects, Warranty, Resolution, Marketing |
| Messages/notifications | Projects, Customer Portal, Resolution, Support |
| Warranty requests | Warranty, Customer Portal, Admin, Insights |
| Disputes/resolution cases | Resolution, Payments, Admin, Insights |
| Reviews/gallery/website | Marketing, Insights, Admin |
| Support tickets | Admin, Customer Portal, Insights |
| Audit logs | Admin, Resolution, Payments, Documents |

## UX Recommendations

1. Use “Project Assistant” everywhere as the primary identity.
2. Use contextual subtitles, such as “Resolution Assistant,” not separate product names.
3. Replace scattered “AI,” “Copilot,” and “Advisor” labels with consistent Assistant language.
4. Add a standard Assistant card component with summary, risk, evidence, confidence, and action slots.
5. Add source citations to every recommendation that affects money, schedule, warranty, dispute, agreement, or public-facing content.
6. Show missing information before recommending high-impact actions.
7. Show one primary recommendation, then alternatives.
8. Clearly distinguish “Prepared draft” from “Applied change.”
9. Use confidence language sparingly and explain why confidence is low.
10. Add “Human approval required” badges for all external or irreversible actions.
11. Show “What happens if I click this?” on prepared actions.
12. Persist and version AI artifacts when recommendations could later be audited.
13. In customer-facing areas, use explanatory language, not contractor-optimization language.
14. In dispute/warranty areas, avoid blame and legal conclusion language.
15. In Admin, keep Assistant recommendations queue-oriented and evidence-backed.

## Risks

### AI Overreach

The biggest platform risk is users believing Project Assistant has made a final decision. The UI must repeatedly distinguish recommendations from actions.

### Inconsistent Context

If Project Assistant lacks the active record context, it may recommend generic or wrong next steps.

### Stale Evidence

Dispute, warranty, agreement, and payment recommendations must show generated time and evidence version.

### Hidden Mutation

AI outputs that directly save fields without visible review can erode trust, especially in Agreement Wizard and Estimate handoff.

### Financial Harm

Payment actions must remain outside automatic AI execution.

### Legal/Resolution Harm

Dispute and warranty language must avoid legal conclusions, blame, and entitlement language.

### Marketplace Fairness

Admin AI recommendations could affect contractor livelihood. Verification, suspension, ranking, routing, and rejection require human review and audit.

### Customer Trust

Customer-facing Assistant must explain, not persuade or pressure customers into approval/payment/signature.

### Fragmented AI Identity

Multiple labels and panels can make the product feel like many AI tools instead of one intelligent system.

## Priority Improvements

### P0

1. Standardize Project Assistant identity and labels.
2. Standardize Assistant output schema.
3. Add evidence/source/confidence fields to all high-impact recommendations.
4. Add universal prepared-action vs human-action distinction.
5. Keep payment, dispute, warranty, agreement signing, marketplace, publishing, and notification actions human-only.
6. Make Agreement Wizard and Estimate handoff preserve source facts by default.
7. Standardize dispute and warranty advisory language.

### P1

8. Add Project Assistant panels to Opportunities, Estimates, Agreement Workspace, Payments, Warranty, Resolution, and Team.
9. Add persisted AI recommendation artifacts beyond disputes for high-impact decisions.
10. Add Marketing Advisor and Operations Analyst patterns.
11. Add notification draft approval flow.
12. Add customer-facing explanatory Assistant in Customer Portal.
13. Add Admin Marketplace Operations Advisor queue summaries.

### P2

14. Add document summary Assistant.
15. Add property-management Assistant.
16. Add campaign/SEO Assistant.
17. Add cross-workspace Assistant history.
18. Add recommendation outcome tracking.

### P3

19. Add deeper benchmark learning from completed work.
20. Add proactive Assistant briefings based on scheduled jobs, weather, material lead times, and customer responsiveness.

## Launch Readiness

Current strengths for launch:

- Global Project Assistant entry point exists.
- Assistant Home states single AI identity.
- Deterministic orchestration exists and does not mutate data.
- Agreement AI drafting and milestone/pricing guidance exist.
- Dispute AI has strong audit/versioning foundation.
- Warranty AI has advisory boundaries.
- Planning validation is explicitly advisory.
- Team crew recommendations are advisory.
- Website Builder AI uses an accept/apply style.

Launch blockers for a polished platform-wide Assistant:

- Inconsistent AI labels and UI patterns.
- Uneven evidence/confidence/source citation display.
- Limited customer-facing Assistant model.
- Limited persisted AI artifacts outside disputes.
- Admin, Marketing, Team, Insights, Documents, and Notifications need consistent Assistant components.
- Universal action guardrails are not yet represented as one shared UX contract.

Recommended launch readiness score:

- Contractor workflow Assistant: 7 out of 10.
- Customer-facing Assistant: 4.5 out of 10.
- Admin/operations Assistant: 5 out of 10.
- Platform-wide unified Assistant: 5 out of 10.

## Suggested Implementation Roadmap

### Phase 0: Product Contract

- Document Project Assistant as the single AI identity.
- Define contextual role labels.
- Define universal output schema.
- Define universal action classes.
- Define human-only action policy.

### Phase 1: Shared UX Components

- Build a shared Assistant recommendation card.
- Build shared evidence summary, missing information checklist, confidence indicator, and prepared action components.
- Replace inconsistent AI labels with Project Assistant language.

### Phase 2: P0 Workspace Integration

- Standardize Assistant cards in Dashboard, Opportunities, Estimates, Agreement Wizard, Agreement Workspace, Milestones, Payments, Warranty, and Resolution.
- Ensure every recommendation shows evidence and confidence.
- Ensure every mutation requires explicit approval.

### Phase 3: Artifact And Audit Model

- Extend AI artifact persistence beyond disputes for high-impact recommendations.
- Store input digest, source records, generated time, model/deterministic source, payload, user action, and outcome.
- Track accepted/rejected/edited recommendation outcomes.

### Phase 4: Customer And Property Assistant

- Add customer-facing explanatory Assistant.
- Add property-management Assistant for requests, properties, units, tenants, work orders, and documents.
- Keep approvals, payments, signatures, disputes, and warranty submissions user-driven.

### Phase 5: Operations, Marketing, And Admin

- Add Operations Analyst to Insights.
- Add Marketing Advisor to Marketing.
- Add Marketplace Operations Advisor to Admin.
- Add notification draft approval flow.

### Phase 6: Learning Loop

- Learn from accepted, rejected, and edited recommendations.
- Learn from signed agreements, completed milestones, payment timing, disputes, warranty outcomes, marketing conversion, and team performance.
- Use learned patterns for better recommendations while preserving human control.

## Final Recommendation

Project Assistant belongs everywhere, but it should not be another page that competes with the workflow. It should be the intelligent connective tissue inside the workflow the user is already using.

The product should keep one identity:

Project Assistant.

Then adapt its role by context:

- Opportunity Assistant for lead review.
- Estimate Assistant for readiness and handoff.
- Agreement Assistant for scope, milestones, pricing, warranty, and final review.
- Planning Assistant for schedule and crew risk.
- Project Assistant for active project execution.
- Team Assistant for staffing recommendations.
- Warranty Assistant for warranty evidence review.
- Resolution Assistant for neutral dispute organization.
- Marketing Advisor for public growth.
- Operations Analyst for Insights.
- Marketplace Operations Advisor for Admin.

The assistant should summarize, detect risk, recommend, draft, compare, validate, and prepare. It should show evidence, confidence, assumptions, and missing information.

It should never silently decide, sign, publish, send, assign, verify, suspend, refund, release, route, approve, deny, or close anything meaningful.

Humans remain in control. Project Assistant makes the work clearer, faster, and safer.
