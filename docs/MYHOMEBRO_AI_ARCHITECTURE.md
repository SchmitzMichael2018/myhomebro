# MyHomeBro AI Architecture

## Product Vision

MyHomeBro should be able to generate a professional contractor agreement from a single project description.

Templates, taxonomy, contractor history, and signed agreements should enhance the result, but should never be required to create a meaningful agreement.

The platform should become smarter over time by learning from contractor behavior, signed agreements, project outcomes, and business performance.

---

# Core Authority Hierarchy

Highest Authority

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

Example:

Input:

Install new gutters and downspouts on two-story home

Output:

Title:
Gutter Installation and Downspout Replacement

Type:
Roofing

Subtype:
Gutter Installation

Scope:
Generated automatically

---

# Agreement Creation Workflow

Quick Description

↓

Search Templates

If Strong Template Exists

Template

↓

AI Refinement

↓

Contractor Review

If No Useful Template Exists

AI Draft Creation

↓

Contractor Review

↓

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

Default behavior:

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
* Template Used (if any)

Agreement learning should occur even when:

* No template exists
* Contractor does not save a template

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
* Amendment History
* Dispute History
* Payment History
* Customer Approval Trends

Copilot should provide advisory recommendations.

Examples:

"Your bathroom remodel projects average 12% below similar completed projects."

"Projects missing exclusions generate more disputes."

"You frequently add fascia repair amendments to gutter projects."

"You typically use four milestones for this project type."

---

# Copilot Rules

Copilot may recommend.

Copilot may explain.

Copilot may analyze.

Copilot may compare.

Copilot may not automatically modify contractor agreements without approval.

Contractor remains the final authority.

---

# Future Learning Model

AI should improve from:

1. Signed Agreements
2. Contractor Edits
3. Project Outcomes
4. Milestone Performance
5. Pricing Outcomes
6. Amendments
7. Disputes
8. Saved Templates

in that order.

The platform should eventually build a learned project taxonomy from real contractor activity rather than relying solely on static categories.

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

9. AI Copilot provides recommendations, not automatic decisions.

10. Every agreement should teach the platform something.
