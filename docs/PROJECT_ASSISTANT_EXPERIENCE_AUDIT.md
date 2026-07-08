# Project Assistant Experience Audit

Date: July 8, 2026

Scope: UX, UI, design-system, voice, trust, safety, responsiveness, accessibility, evidence, confidence, and human-approval audit of Project Assistant across MyHomeBro. This is an experience refinement audit only and does not implement behavior changes.

## Executive Summary

Project Assistant is present across MyHomeBro, but the experience still feels like a set of related AI panels rather than one reusable assistant system. The strongest surfaces are the global Assistant Dock, Assistant Home, Agreement Wizard assistant panel, Resolution Assistant recommendation panel, Warranty Assistant summary, Website Builder AI suggestion modal, and advisory crew/planning patterns. Each has useful pieces, but they do not yet share a common visual system, language structure, confidence standard, evidence standard, or action-state model.

The main recommendation is to create a reusable Project Assistant experience system:

- One identity: Project Assistant.
- Contextual subtitle: Agreement Assistant, Warranty Assistant, Resolution Assistant, Marketing Advisor, Operations Analyst, Marketplace Operations Advisor.
- One card structure: Summary, why it matters, evidence, missing information, risks, recommendation, alternatives, confidence, prepared actions, human approval.
- One confidence language: High confidence, Medium confidence, Low confidence, Needs more information.
- One action vocabulary: Review draft, Apply suggestion, Prepare message, Open source record, Request more info, Compare options, View evidence.
- One safety pattern: Human approval required for customer-facing, financial, legal, staffing, warranty, resolution, marketplace, publishing, and administrative actions.

Launch readiness:

- Assistant usefulness: 7 out of 10.
- Assistant visual consistency: 5 out of 10.
- Assistant trust/safety clarity: 6.5 out of 10.
- Reusable experience-system readiness: 4.5 out of 10.

## Current Project Assistant UX Review

### Global Assistant Dock

Files reviewed:

- `frontend/src/components/AssistantDock.jsx`
- `frontend/src/layouts/AuthenticatedLayout.jsx`

What works:

- The global trigger is clearly labeled “Project Assistant.”
- The dock adapts its title and helper copy by route.
- The dock provides dashboard, agreement, milestone, payment, dispute, admin, and lead context labels.
- It supports minimized/expanded states on desktop.
- It includes briefing and job health panels.
- The trigger has an accessible label and pressed state.

Issues:

- Route modes are still broad. Marketing and Opportunities are grouped as `leads`; Estimates, Warranty, Team, Customer Portal, and Property Management are not first-class modes.
- Some action labels imply high-impact operations, such as “Release payment,” even when they route rather than execute.
- The dock looks different from domain-specific Assistant panels.
- The minimized state uses an icon without much context.
- Mobile behavior should be visually verified; the desktop shell is clearly optimized for wide screens.

Recommendation:

- Keep the global dock as the single persistent assistant entry point.
- Add a consistent header model: Project Assistant + contextual subtitle.
- Rename high-impact route CTAs to safer language, such as “Review payment release.”
- Add workspace-specific modes for Estimates, Warranty, Team, Customer Portal, Property Management, Marketing, Insights, and Documents.

### Assistant Home

File reviewed:

- `frontend/src/pages/AIAssistantPage.jsx`

What works:

- It explicitly frames Project Assistant as a single AI identity.
- It explains inherited context.
- It includes pending recommendations, recent context, history, saved conversations, and settings placeholders.
- It states that assistant actions never sign, fund, assign, schedule, release payment, resolve disputes, or send customer messages without confirmation.

Issues:

- The subtitle calls it “a compatibility home,” which feels internal.
- The page is useful, but it risks making Project Assistant feel like a destination instead of an embedded workflow partner.
- Saved conversations and settings are placeholder-like.
- Recommendation cards are simpler than the recommendation structure needed elsewhere.

Recommendation:

- Reframe Assistant Home as “Assistant Overview” or “Project Assistant Home.”
- Use it for history, preferences, and cross-workspace recommendations, but keep the primary assistant experience embedded in workspaces.
- Replace “compatibility home” language with user-facing product language.

### Dashboard Assistant Summaries

Current behavior:

- Assistant Home and dashboard insight components provide recommendation-like summaries.
- Job health and briefing panels appear in the dock.

What works:

- “What needs attention” is a strong dashboard use case.
- The cards are practical and task-oriented.

Issues:

- The dashboard assistant pattern is not visually identical to domain-specific assistant panels.
- Evidence and source links are minimal.
- Confidence and missing-data details are not consistently shown.

Recommendation:

- Dashboard Assistant should use a compact version of the standard assistant card.
- Each recommendation should include source links and “why this matters.”

### Opportunity Assistant Moments

Files reviewed:

- `frontend/src/components/intake/IntakeAiRecommendationPanel.jsx`
- `frontend/src/pages/ContractorPublicPresencePage.jsx`
- `backend/projects/views/public_presence.py`

What works:

- Intake analysis has a clear “Analyze Project” entry point.
- Recommendations explain template match, project type, project subtype, safety guidance, payment protection, and contractor compatibility.
- It gives next-step guidance toward agreement creation.

Issues:

- The heading “AI Project Analysis” creates a separate AI identity.
- Confidence labels include “Recommended,” “Possible,” and “No strong match,” which are match-quality labels rather than confidence labels.
- The “Create Agreement” button can feel like AI moves straight to agreement rather than a human-reviewed next step.
- Evidence/source links are not consistently displayed.

Recommendation:

- Rename the surface to “Project Assistant” with subtitle “Opportunity Assistant.”
- Use recommendation structure: recommendation, why, evidence, missing, confidence, next action.
- Prefer “Review agreement draft” or “Prepare agreement draft” over “Create Agreement” when AI-prepared context is involved.

### Estimate Assistant Moments

Current behavior:

- Estimate Workspace and estimate-first handoff exist.
- Estimate-specific Assistant UX is less standardized than Agreement Wizard.

What works:

- Estimate readiness and handoff have a clear product need.
- Existing pricing confidence and project intelligence can feed the experience.

Issues:

- No single reusable Estimate Assistant card pattern is visible.
- Missing information, readiness, pricing confidence, incidentals reserve, and handoff status should be presented in one place.

Recommendation:

- Add a standard Project Assistant card with subtitle “Estimate Assistant.”
- Show: readiness, missing checklist, line-item evidence, pricing confidence, handoff status, and human approval state.

### Agreement Wizard AI Panel

Files reviewed:

- `frontend/src/components/StartWithAIAssistant.jsx`
- `frontend/src/lib/projectAssistantActions.js`
- `frontend/src/lib/agreementWizardAiPanel.js`
- `frontend/src/components/Step2Milestones.jsx`

What works:

- The Agreement Wizard panel is one of the strongest assistant experiences.
- It provides a step guide, current project summary, needs-attention block, advisory recommendations, step actions, and continue action.
- It uses user-facing action buttons like “Improve Scope,” “Generate Scope Draft,” “Improve Classification,” “Generate Milestone Plan,” and “Rebalance Budget.”
- It distinguishes advisory suggestions in several places.

Issues:

- The current project summary uses a dark card that visually differs from other Assistant surfaces.
- “Step Actions” is generic and does not always clarify whether the action drafts, applies, replaces, or navigates.
- Confidence appears as a small badge but evidence is often not linked.
- Some generated/replace flows need stronger “Review before applying” language.
- The panel is very dense on mobile because multiple cards stack with many buttons.

Recommendation:

- Keep the step guide pattern.
- Add source/evidence rows for generated recommendations.
- Make every destructive or overwriting action use “Review generated draft” before “Apply.”
- Align card shape and section order with the standard Assistant card.

### Agreement Workspace Assistant Moments

Current behavior:

- Agreement Workspace has an “AI Review” tab placeholder.
- Global dock has agreement context.

What works:

- Agreement Workspace is a natural place for Project Assistant.

Issues:

- The placeholder creates a dead-end feeling.
- The workspace lacks a mature Assistant summary for signed/funded/amended/payment/dispute state.

Recommendation:

- Replace placeholder language with a real assistant-ready empty state:
  “Project Assistant will summarize scope, milestones, funding, signatures, amendments, invoices, and blockers here.”

### Planning Validation

Files reviewed:

- `backend/projects/services/planning_validation.py`
- `frontend/src/components/Step2Milestones.jsx`
- `frontend/src/pages/AgreementDetail.jsx`

What works:

- Planning validation is correctly advisory.
- It has statuses, reason, recommended timeline, warnings, blockers, conflicts, and acknowledgement.
- It does not create schedules or assignments.

Issues:

- The experience does not consistently look like Project Assistant.
- Status names such as `hard_conflict` and `needs_review` need more polished UI phrasing.
- Acknowledgement is present but should more clearly explain what the human is accepting.

Recommendation:

- Present as Project Assistant with subtitle “Planning Assistant.”
- Use: Summary, conflicts, source records, recommended timeline, confidence/limitations, human acknowledgement.

### Project Activation Preview

Current behavior:

- Activation preview exists as an advisory preview in backend services.

What works:

- The concept is launch-important: preview only, no assignments/schedules created.

Issues:

- It should be visually part of Project Assistant rather than a separate preview tool.

Recommendation:

- Use Project Assistant subtitle “Activation Preview.”
- Require “Human approval required” before activating, assigning, scheduling, or messaging.

### Project Detail Assistant Moments

Current behavior:

- Project Detail has many operational records, but Assistant experience appears mostly through global dock.

What works:

- Project detail has enough source data for high-value summaries.

Issues:

- No consistent embedded assistant summary appears as a project operating layer.

Recommendation:

- Add a compact Project Assistant summary card: current milestone, open blockers, payment status, customer action, team action, documents, risks.

### Milestone Assistant Moments

Current behavior:

- Agreement Wizard has strong milestone assistant actions.
- Milestone Detail and completion/invoice flows have related data.

What works:

- AI milestone generation is reviewable.
- Advisory text appears in Step 2.

Issues:

- Milestone completion/invoice assistant language should be clearer about approval vs payment release.
- Zero-dollar approval flows need distinct labels like “Approve Completion.”

Recommendation:

- Use subtitle “Milestone Assistant.”
- Standard recommendation: “Request additional evidence,” “Prepare completion note,” “Review invoice readiness.”
- Separate completion approval from money movement in button language.

### Payment Assistant Moments

Current behavior:

- Assistant Dock has payment context.
- Payment/reimbursement/admin tools have many financial states.

What works:

- The product already tracks funding, invoices, reimbursements, escrow, holds, payouts, and release blockers.

Issues:

- AI/payment assistant copy must be extremely conservative.
- Labels like “Release payment” in assistant CTAs should not imply automatic AI execution.

Recommendation:

- Use “Review payment release,” “Review invoice approval,” and “Prepare payment explanation.”
- Always show source records and human approval for money actions.

### Expense Assistant Moments

Current behavior:

- Expense/reimbursement data exists, but a consistent assistant UX is not visible.

Recommendation:

- Use subtitle “Expense Assistant.”
- Show missing receipts, reserve impact, reimbursement status, dispute holds, and payment blockers.
- AI may prepare categorization and summaries, not approvals/releases.

### Team Assistant Recommendations

Files reviewed:

- `backend/projects/services/crew_recommendations.py`
- `frontend/src/pages/ContractorBidsPage.jsx`

What works:

- “Recommended Crew” is explicitly advisory.
- Crew recommendation uses evidence like skills, availability, source context, and compliance.

Issues:

- It is not labeled as Project Assistant.
- Evidence and alternatives should be standardized.
- “Assign” actions need clear human-approval framing.

Recommendation:

- Rename the panel header to “Project Assistant” with subtitle “Team Assistant.”
- Use comparison-table format for crew options.
- Show “Human approval required before assigning work.”

### Customer Portal Assistant Guidance

Current behavior:

- Customer portal has advisory property intelligence and workflows, but a clear Project Assistant identity is less visible.

What works:

- Customer-facing workflows have many opportunities for explanatory guidance.

Issues:

- Contractor/internal wording must not leak into customer views.
- Customer Assistant must not pressure approval, payment, signature, or dispute choices.

Recommendation:

- Use a simplified customer card:
  “What this means,” “What you can do next,” “What happens after,” “Questions or concerns.”
- Avoid confidence unless useful.
- Avoid salesy urgency.

### Warranty Assistant

Files reviewed:

- `frontend/src/pages/WarrantyDashboardPage.jsx`
- `backend/projects/services/warranty_management.py`

What works:

- “Warranty Assistant Summary” exists.
- Backend AI review includes advisory-only, likely coverage, possible exclusions, missing information, recommended next step, recommended team member, confidence level, evidence considered, and boundary.
- Boundary states Assistant does not approve, deny, assign blame, or create payment obligations.

Issues:

- Frontend only appears to show a short summary and “Recommendation only,” leaving richer evidence/missing/confidence data underused.
- “Likely coverage” should be carefully phrased in UX as “Possible coverage status” or “Coverage review signal.”

Recommendation:

- Use subtitle “Warranty Assistant.”
- Show: Based on available records, Coverage review signal, Evidence reviewed, Missing information, Recommended next review step, Human decision required.

### Resolution Assistant

Files reviewed:

- `frontend/src/components/ai/DisputeAIAdvisor.jsx`
- `frontend/src/components/ai/DisputeAIRecommendationPanel.jsx`
- `frontend/src/pages/DisputesPages.jsx`
- `backend/projects/services/resolution_workspace.py`

What works:

- Resolution has the strongest guardrail language.
- It says recommendation only and no resolution/payment/blame/legal conclusion.
- It presents neutral summary, timeline, disputed facts, undisputed facts, evidence used, missing evidence, COAs, recommended COA, and human approval notes.
- It detects forbidden language.
- It persists AI artifacts with model/cache/version/created metadata.

Issues:

- Header uses “Neutral Resolution Assistant” rather than Project Assistant + Resolution Assistant subtitle.
- The component uses inline styles rather than the app design system.
- Confidence currently uses percentages, which conflicts with desired standard language.
- Source links are mostly labels rather than deep links.
- Buttons “Generate” and “Refresh” should be more explicit: “Generate recommendation” and “Generate new version.”

Recommendation:

- This should become the reference high-risk assistant pattern after visual/design-system cleanup.
- Replace percentage confidence with High/Medium/Low/Needs more information plus explanation.

### Insights Operations Analyst

Current behavior:

- Insights cards and recommendations exist.
- Prior Insights audit recommends Operations Analyst behavior.

What works:

- Insight summary/recommendation cards are a good foundation.

Issues:

- “Operations Analyst” should still be Project Assistant, not a new brand.
- Confidence/source data should be clearer for metrics and benchmarks.

Recommendation:

- Header: Project Assistant, subtitle “Operations Analyst.”
- Use metric source, date range, confidence, and recommended investigation.

### Marketing Advisor

Files reviewed:

- `frontend/src/components/website/WebsiteBuilderWizard.jsx`
- `frontend/src/pages/ContractorPublicPresencePage.jsx`

What works:

- Website Builder AI suggestion modal has a strong “Before / Suggested” review pattern.
- It requires acceptance before applying.
- Website Builder already has readiness and publish blockers.

Issues:

- It says “AI suggestion” and “Improve with AI,” not Project Assistant / Marketing Advisor.
- It does not consistently show evidence/source records.
- It lacks explicit “Human approval required before publishing.”

Recommendation:

- Keep the before/suggested modal pattern.
- Rename to Project Assistant, subtitle “Marketing Advisor.”
- Add “Source used” and “Publishing still requires your approval.”

### Admin Marketplace Operations Advisor

Current behavior:

- Admin dashboards and recommendations exist.
- Global dock has admin route mode.

What works:

- Admin pages are serious and queue-oriented.

Issues:

- No consistent admin Assistant card standard.
- Admin actions are high impact and need stronger evidence/approval treatment.

Recommendation:

- Use subtitle “Marketplace Operations Advisor.”
- Admin Assistant cards should emphasize risk, evidence, source records, queue impact, and approval requirements.

### Notification And Message Drafting

Current behavior:

- Assistant Dock can draft job health messages and copy them.
- It does not automatically send.

What works:

- Copy-to-clipboard draft pattern is safe.
- “View drafted message” is a good collapsed/expanded state.

Issues:

- Draft state should be labeled more explicitly as “Drafted, not sent.”
- The user should see recipient, channel, and source reason before sending/copying.

Recommendation:

- Standardize message draft card with recipient, channel, source event, draft, edit action, and “Human approval required before sending.”

### Document Summarization

Current behavior:

- Document/PDF/version/evidence data exists, but a distinct Assistant summarization UX was not identified.

Recommendation:

- Future document Assistant cards should be read-only by default.
- Summaries that affect signed/locked artifacts must show document version, generated time, and source record.

## Design-System Recommendations

### Standard Assistant Container

Use one reusable component family:

- `ProjectAssistantPanel`
- `ProjectAssistantCard`
- `ProjectAssistantEvidenceList`
- `ProjectAssistantConfidenceBadge`
- `ProjectAssistantActionBar`
- `ProjectAssistantApprovalNotice`
- `ProjectAssistantEmptyState`
- `ProjectAssistantErrorState`

### Standard Header

Use:

```text
Project Assistant
Agreement Assistant
```

Never use separate product names like:

- AI Advisor
- AI Project Analysis
- Copilot
- Neutral Resolution Assistant

Context labels are fine as subtitles.

### Standard Card Shape

Recommended:

- Border radius: 12px or existing app equivalent.
- Border: neutral slate.
- Background: white or very light slate.
- Shadow: subtle.
- Header: compact, not hero-sized.
- Severity states: left border or small badge, not whole-card color floods for every state.

Avoid:

- Inline styles.
- Multiple unrelated rounded systems in the same assistant surface.
- Heavy gradients for routine assistant cards.
- Overusing blue for every assistant state.

### Standard Section Order

Not every section is required, but when present, use this order:

1. Summary
2. Why this matters
3. Evidence reviewed
4. Missing information
5. Risks
6. Recommendation
7. Alternatives
8. Confidence
9. Prepared actions
10. Human approval required

### Standard Visual Language

Use the same icon family already present in the app:

- Sparkles for Project Assistant identity.
- AlertTriangle for risk.
- ShieldCheck for safety/approval.
- Clipboard/List for evidence.
- ArrowRight for navigation.
- CheckCircle for ready/applied.

Use severity:

- Info: neutral/surface.
- Attention: amber.
- Risk: rose.
- Ready: emerald.
- Advisory: indigo or slate.

Do not use color alone; include text labels.

## Standard Assistant Card Structure

Recommended high-impact card:

```text
Project Assistant
Resolution Assistant

Summary
Based on available records, this case is waiting on contractor statement and close-up photos.

Why this matters
The proposed option affects payment hold timing and customer expectations.

Evidence reviewed
- Agreement #123
- Milestone: Tile install
- Invoice #456
- Customer photos

Missing information
- Contractor statement
- Close-up photo of finished edge

Risks
- Payment hold remains unresolved
- Customer may not understand what evidence is needed

Recommendation
Request additional photos before proposing a resolution.

Alternatives
- Continue with current evidence
- Escalate for admin review

Confidence
Medium confidence: agreement scope is clear, but completion evidence is incomplete.

Prepared actions
[Prepare evidence request] [Open source record]

Human approval required
No message will be sent and no case status will change until a human approves.
```

## Tone And Voice Guidelines

### Global Voice

Project Assistant should sound:

- Calm.
- Practical.
- Neutral.
- Professional.
- Plain-language.
- Evidence-based.
- Helpful without pressure.

Avoid:

- Hype.
- Legal certainty.
- Blame.
- Overpromising.
- Fake precision.
- “You should” pressure language.
- Internal implementation words.

### Contractor Voice

Use direct operational language:

- “This estimate is missing measurements.”
- “Review photos before requesting approval.”
- “Pricing confidence is low because there are no similar completed jobs yet.”

### Customer Voice

Use explanatory and reassuring language:

- “This request means the contractor marked the milestone complete.”
- “You can approve, ask a question, or dispute if something looks wrong.”
- “Payment will not move until you confirm the approval step.”

Avoid:

- “Fast approval improves contractor cash flow.”
- “You should approve.”
- “The contractor is entitled.”

### Admin Voice

Use serious, queue-oriented language:

- “This queue has three failed reimbursement releases.”
- “Review source records before retrying.”
- “Human approval required before changing marketplace status.”

### Resolution And Warranty Voice

Use neutral language:

- “Based on available records...”
- “Evidence appears incomplete...”
- “Possible coverage issue...”
- “Human decision required...”

Avoid:

- liable
- negligent
- breached
- entitled
- violation
- guilty
- at fault
- you should

## Confidence Language Standard

Use only:

- High confidence
- Medium confidence
- Low confidence
- Needs more information

Every confidence label must include a reason:

- High confidence: source records are complete and consistent.
- Medium confidence: key records are present, but some evidence is missing.
- Low confidence: records are sparse, stale, or contradictory.
- Needs more information: no reliable recommendation can be made yet.

Avoid:

- Percent confidence, unless there is a calibrated model and explanation.
- “Recommended” as a confidence label.
- “Possible” as a confidence label.
- Confidence without source reasoning.

## Evidence And Source-Link Standard

Recommendations should cite source records when they affect:

- Money.
- Agreement terms.
- Warranty.
- Resolution/disputes.
- Assignments.
- Public content.
- Customer communications.
- Admin decisions.
- Marketplace routing or verification.

Source links should include:

- Record type.
- Human name/title.
- Status.
- Last updated date if useful.
- Direct link or open action.

Examples:

- Agreement: “Flooring Remodel Agreement #123”
- Estimate: “LVP Installation Estimate”
- Milestone: “Installation Labor”
- Invoice: “Invoice #456”
- Payment: “Escrow funding record”
- Expense: “Material receipt”
- Warranty request: “Floor seam issue”
- Resolution case: “Case #19”
- Property record: “4400 QA Lead Street”
- Photo/document/review/support ticket/website page.

## Human Approval UX Standard

Use clear action states:

- Suggested
- Drafted
- Ready to review
- Requires approval
- Approved by user
- Applied
- Sent
- Published

High-impact actions must display:

```text
Human approval required
```

Use this language for:

- Sending messages.
- Publishing website changes.
- Sending estimates.
- Sending agreements.
- Signing agreements.
- Releasing funds.
- Refunding money.
- Approving expenses.
- Assigning team members.
- Approving or denying warranty coverage.
- Resolving cases.
- Suspending contractors.
- Routing marketplace requests.

Preferred action labels:

- Review draft.
- Apply suggestion.
- Prepare message.
- Open source record.
- Request more info.
- Compare options.
- View evidence.
- Generate recommendation.
- Generate new version.

Avoid:

- Release payment.
- Resolve dispute.
- Approve warranty.
- Deny coverage.
- Publish now.
- Send message.
- Assign crew.

Unless those labels are used on actual human-confirmed final action buttons outside Assistant.

## Loading, Empty, And Error States

### Loading

Use:

- “Reviewing source records...”
- “Preparing recommendation...”
- “Loading latest saved recommendation...”

Include what records are being checked when possible.

### Empty

Use:

- “No recommendation yet.”
- “Add project details to get a stronger recommendation.”
- “No urgent assistant recommendations.”

Include a next action.

### Error

Use:

- Plain explanation.
- Retry action.
- Manual fallback.

Avoid:

- Raw API errors.
- Silent failure.
- “AI unavailable” without telling the user what to do next.

### Stale

High-impact persisted recommendations should show:

- Generated time.
- Evidence version/digest if available.
- “Source records changed since this was generated.”
- “Generate new version.”

## Persistence And Audit Recommendations

Persist Assistant outputs when they influence:

- Agreement terms.
- Estimate pricing/scope.
- Payment explanations or release decisions.
- Warranty coverage review.
- Resolution cases.
- Admin actions.
- Public website content.
- Customer-facing messages.
- Assignment recommendations.

Store:

- Generated time.
- Assistant context/subtitle.
- Source records.
- Evidence digest.
- Output payload.
- User action.
- Edited/accepted/rejected status.
- Applied fields.
- Actor.
- Follow-up outcome.

The existing Dispute AI artifact model is the best current reference pattern.

## Customer-Facing Assistant Guidance

Customer Assistant should answer:

- What does this mean?
- What should I do next?
- Why am I being asked to approve, pay, or sign?
- What happens after I approve?
- What if I disagree?

Customer Assistant should not:

- Pressure approval.
- Use contractor-internal terms.
- Say a contractor is right.
- Say a customer is wrong.
- Suggest legal conclusions.
- Hide payment consequences.

Recommended customer structure:

1. What this means.
2. What you can review.
3. What happens next.
4. Your options.
5. Need help or disagree?

## Admin-Facing Assistant Guidance

Admin Assistant should answer:

- What needs attention?
- Why is this risky?
- What evidence supports this?
- What should I investigate?
- What action requires approval?

Admin Assistant should be:

- Serious.
- Queue-oriented.
- Evidence-focused.
- Low on decorative styling.
- Explicit about auditability.

Admin Assistant should not:

- Verify/reject contractors.
- Suspend users.
- Route marketplace requests.
- Release/refund funds.
- Close support cases.
- Send announcements.

It may prepare investigation notes and recommended queue priorities.

## Resolution And Warranty Language Guidance

Use:

- “Based on available records...”
- “The agreement appears to state...”
- “The evidence supports...”
- “Evidence appears incomplete...”
- “Possible coverage issue...”
- “Likely needs review...”
- “Human decision required.”

Avoid:

- liable
- negligent
- breached
- entitled
- violation
- guilty
- at fault
- you should
- approved
- denied

For warranty, prefer:

- “Coverage review signal”
- “Possible exclusion to review”
- “Recommended next review step”

For resolution, prefer:

- “Course of action”
- “Recommendation only”
- “Human decision”

## Mobile And Accessibility Review

Risks to verify before launch:

- Dock behavior on mobile and tablet.
- Long recommendation cards becoming too tall.
- Evidence links wrapping or becoming hard to tap.
- Dense Agreement Wizard assistant cards stacking excessively.
- Resolution Assistant tables becoming hard to scan.
- Small uppercase labels reducing readability.
- Color-only severity indicators.
- Icon-only minimized dock lacking context.
- Touch targets below 44px.
- Buttons with generic labels like “Generate” or “Refresh.”

Recommendations:

- Use collapsible sections for evidence, alternatives, and audit metadata.
- Keep primary recommendation visible above the fold.
- Use sticky action footer only when it does not cover content.
- Ensure every icon button has aria-label.
- Do not rely on color alone for confidence/risk.
- Provide keyboard focus states on all assistant actions.

## UI Risks

1. Users may think AI is taking action when it is only preparing guidance.
2. Separate labels make Project Assistant feel fragmented.
3. Percentage confidence can create false precision.
4. Missing evidence/source links can reduce trust.
5. Inline styles in Resolution Assistant make it visually separate from the design system.
6. High-impact CTAs can sound too final.
7. Dense cards may be difficult on mobile.
8. Customer-facing assistant copy may accidentally sound like pressure.
9. Admin Assistant could appear too casual if it reuses contractor-friendly patterns without risk framing.
10. Placeholder AI surfaces can create the impression of unfinished product.

## Launch Readiness

Ready now:

- Global Assistant Dock.
- Assistant Home identity framing.
- Agreement Wizard assistant guide.
- Advisory dispute/resolution language.
- Warranty advisory backend payload.
- Website Builder before/suggested accept pattern.
- Crew recommendation advisory notice.
- Planning validation advisory notice.
- Message draft copy pattern.

Needs refinement before launch-quality Project Assistant experience:

- One Assistant component system.
- One naming standard.
- One confidence standard.
- One evidence/source-link standard.
- One human approval standard.
- Mobile/responsive verification.
- Customer-facing assistant language.
- Admin-facing assistant pattern.
- Persistence standard beyond disputes.
- Replacement of placeholder AI Review tab.

Launch readiness score:

- Contractor UX: 6.5 out of 10.
- Customer UX: 4.5 out of 10.
- Admin UX: 5 out of 10.
- High-risk Resolution/Warranty UX: 7 out of 10 for guardrails, 5.5 out of 10 for visual consistency.
- Design-system readiness: 4.5 out of 10.

## Top 20 Improvements

1. Standardize all AI surface headers as Project Assistant + contextual subtitle.
2. Replace “AI Project Analysis,” “AI Advisor,” “AI suggestion,” and “Copilot” labels.
3. Create shared Project Assistant card components.
4. Standardize section order across Assistant panels.
5. Replace percentage confidence with High/Medium/Low/Needs more information.
6. Require confidence reasoning for every recommendation.
7. Add source links to high-impact recommendations.
8. Add a shared evidence list/table component.
9. Add a shared missing information checklist component.
10. Add a shared human approval notice component.
11. Rename high-impact action labels to review/prepare language.
12. Add stale recommendation state for persisted outputs.
13. Persist high-impact assistant outputs beyond disputes.
14. Clean up Resolution Assistant inline styling.
15. Expand Warranty Assistant UI to show evidence/missing/confidence details.
16. Replace Agreement Workspace AI Review placeholder with a real empty state.
17. Add mobile collapsible sections for long assistant cards.
18. Add customer-facing Assistant copy rules and components.
19. Add admin-facing Assistant queue/risk card pattern.
20. Add design-system documentation for Assistant voice, visuals, actions, and safety states.

## Suggested Implementation Roadmap

### Phase 0: Experience Contract

- Define Project Assistant naming rules.
- Define standard card structure.
- Define standard confidence language.
- Define human approval action-state language.
- Define source-link requirements.

### Phase 1: Shared Components

- Build Project Assistant design-system components.
- Replace inline Resolution Assistant styles.
- Reuse shared confidence, evidence, missing info, and approval components.

### Phase 2: High-Impact Surfaces

- Standardize Agreement Wizard, Estimates, Payments, Warranty, and Resolution.
- Add evidence links and source records.
- Add human approval banners on high-impact actions.

### Phase 3: Customer And Admin Patterns

- Add customer-facing Assistant guidance cards.
- Add admin Marketplace Operations Advisor cards.
- Add tone-specific variants while preserving same component structure.

### Phase 4: Persistence And Audit UX

- Show generated time, source records, stale state, accepted/rejected/applied status.
- Add Assistant history by workspace.

### Phase 5: Mobile And Accessibility Polish

- Verify dock, cards, evidence lists, action buttons, and modals on mobile/tablet.
- Add collapsible sections and keyboard/screen-reader polish.

## Final Recommendation

Project Assistant already has the right product direction. It is useful, embedded in important workflows, and mostly advisory. What it needs next is not more personality or more AI buttons. It needs a calm, repeatable experience system.

The best version of Project Assistant should feel like the same experienced operations partner everywhere:

- Same identity.
- Same structure.
- Same evidence habits.
- Same confidence language.
- Same approval boundaries.
- Same design-system components.

It can adapt to the work in front of the user, but it should never feel like a different AI product on every page.
