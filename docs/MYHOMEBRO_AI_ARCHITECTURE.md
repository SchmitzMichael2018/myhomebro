# MyHomeBro AI Architecture

## Product Vision

MyHomeBro should be able to generate a professional contractor agreement from a single project description.

Templates, taxonomy, contractor history, milestone performance, and signed agreements should enhance the result, but should never be required to create a meaningful agreement.

The platform should become smarter over time by learning from contractor behavior, signed agreements, project outcomes, milestone completion, payment timing, amendments, and disputes.

---

# Core Authority Hierarchy

Highest Authority:

Contractor Edits

↓

AI Draft Identity

↓

Templates

↓

Taxonomy

Lowest Authority

Rules:

* Contractor edits always win.
* AI defines project identity.
* Templates provide standardization.
* Taxonomy provides organization.
* Taxonomy must never overwrite a valid AI draft.
* Templates must never overwrite a valid AI draft unless explicitly requested.

---

# AI Understanding First

AI is responsible for understanding the project.

Given a simple project description, AI should be able to generate:

* Project Title
* Project Type
* Project Subtype
* Scope of Work

without requiring:

* Templates
* Taxonomy
* Prior project history

---

# Agreement Creation Workflow

Quick Description

↓

Search Templates

If Strong Template Exists:

Template

↓

AI Refinement

↓

Contractor Review

If No Useful Template Exists:

AI Draft Creation

↓

Contractor Review

Then:

Milestones

↓

Pricing

↓

Clarifications

↓

Exclusions

↓

Warranty

↓

Agreement

---

# Templates

Templates represent reusable contractor workflows.

Templates may contribute:

* Milestones
* Clarification Questions
* Exclusions
* Warranty Language
* Pricing Structures
* Scheduling Structures
* Checklists

Templates should not define:

* Project Title
* Project Type
* Project Subtype
* AI Scope

unless the contractor explicitly chooses replacement.

Default behavior should be:

Template Enhance Mode

not

Template Replace Mode

---

# Taxonomy

Taxonomy exists for:

* Search
* Reporting
* Analytics
* Contractor Matching
* Template Discovery
* Benchmarking

Taxonomy should be advisory.

Taxonomy should never prevent AI from creating a meaningful agreement.

Taxonomy should not define project identity.

Missing taxonomy should not degrade AI understanding.

---

# Agreement Intelligence

Templates are optional.

Agreement learning is automatic.

Every signed agreement should improve future platform performance.

The system should capture:

* Original Description
* AI Draft Title
* AI Draft Type
* AI Draft Subtype
* AI Draft Scope
* Final Contractor Title
* Final Contractor Type
* Final Contractor Subtype
* Final Contractor Scope
* Milestones
* Pricing Structure
* Schedule
* Clarification Questions
* Exclusions
* Amendments
* Disputes
* Completion Outcomes
* Template Used, if any
* No-template AI draft source, if any

Agreement learning should occur even when:

* No template exists
* Contractor does not save a template

---

# Milestone Performance Intelligence

Milestones are not only workflow items.

Milestones are performance data.

The system should capture milestone lifecycle events, including:

* Planned milestone date
* Actual contractor completion date
* Homeowner approval date
* Invoice creation date
* Invoice payment date
* Escrow release date
* Dispute date, if applicable
* Final resolution date, if applicable

The system should eventually calculate:

* Time from agreement signing to milestone completion
* Time from milestone completion to homeowner approval
* Time from approval to payment/release
* Planned vs actual milestone duration
* Total project duration
* Delayed milestones
* Repeated bottlenecks
* Average approval time by project type
* Average payment time by project type
* Contractor performance by project type

Milestone performance should support future Copilot insights such as:

* "Your fence projects average 7.2 days from start to final approval."
* "This milestone is running 3 days behind your usual timeline."
* "Homeowners approve painting milestones faster when photos are uploaded."
* "Your roofing jobs often experience delays at final inspection."
* "Your drywall repair projects are paid 40% faster than your exterior repair projects."

Milestone performance data should be captured even when:

* No template was used
* No template was saved
* The agreement was AI-generated from scratch

---

# Payment and Approval Intelligence

Payments and approvals are part of contractor performance.

The system should capture:

* Milestone invoice date
* Homeowner approval date
* Payment date
* Escrow release date
* Dispute hold date
* Dispute resolution date
* Contractor payout date

This should allow MyHomeBro to analyze:

* Approval speed
* Payment speed
* Payout delays
* Dispute frequency
* Cash-flow timing
* Project types with slower approvals
* Project types with faster payment release

Future Copilot should be able to identify:

* Underperforming project types
* Slow-paying project categories
* Milestones that frequently cause delays
* Agreement structures that improve payment speed
* Scope gaps that lead to disputes

---

# Save As Template

Save As Template is intentional.

Contractors choose whether to convert a workflow into a reusable template.

Templates are not required for learning.

The platform should continue learning from signed agreements regardless of template creation.

---

# AI Copilot

AI Copilot should evolve into a contractor-aware business assistant.

Copilot should become aware of:

* Contractor Profile
* Past Agreements
* Saved Templates
* Project History
* Pricing History
* Milestone Performance
* Approval Timing
* Payment Timing
* Amendment History
* Dispute History
* Payout History
* Customer Approval Trends

Copilot should provide advisory recommendations.

Examples:

* "Your bathroom remodel projects average 12% below similar completed projects."
* "Projects missing exclusions generate more disputes."
* "You frequently add fascia repair amendments to gutter projects."
* "You typically use four milestones for this project type."
* "This project is behind your average completion timeline."
* "Your approval delays are highest on exterior repair projects."

---

# Copilot Rules

Copilot may recommend.

Copilot may explain.

Copilot may analyze.

Copilot may compare.

Copilot may identify underpricing.

Copilot may identify underperformance.

Copilot may suggest workflow improvements.

Copilot may not automatically modify contractor agreements without approval.

Contractor remains the final authority.

---

# Future Learning Model

AI should improve from:

1. Signed Agreements
2. Contractor Edits
3. Milestone Completion Data
4. Payment and Approval Timing
5. Project Outcomes
6. Amendments
7. Disputes
8. Saved Templates

The platform should eventually build a learned project taxonomy from real contractor activity rather than relying only on static categories.

---

# Non-Negotiable Rules

1. A contractor must be able to create a useful agreement from a single sentence.

2. Missing templates must never prevent agreement creation.

3. Missing taxonomy must never prevent agreement creation.

4. AI defines project identity.

5. Templates standardize project execution.

6. Taxonomy organizes projects.

7. Contractor edits override all automated suggestions.

8. Signed agreements are the platform's most valuable learning asset.

9. Milestone completion and payment timing are core learning signals.

10. AI Copilot provides recommendations, not automatic decisions.

11. Every agreement should teach the platform something.

12. Every completed milestone should teach the platform something.
