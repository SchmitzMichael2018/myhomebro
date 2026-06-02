# MyHomeBro AI Architecture

## Product Vision

MyHomeBro should be able to generate a professional contractor agreement from a single project description.

Templates, taxonomy, contractor history, and signed agreements should enhance the result, but should not be required to create a meaningful agreement.

---

# Core Principles

## AI Understanding First

AI is responsible for understanding the project.

From a simple description, AI should be able to generate:

* Project Title
* Project Type
* Project Subtype
* Scope of Work

without requiring:

* Templates
* Taxonomy
* Prior project history

---

## Templates Provide Standardization

Templates are reusable contractor workflows.

Templates may contribute:

* Milestones
* Exclusions
* Clarification Questions
* Warranty Language
* Pricing Structures
* Scheduling Structures

Templates should not define project identity.

Templates should not overwrite:

* Project Title
* Project Type
* Project Subtype
* AI-generated Scope

unless the user explicitly chooses to replace the draft.

---

## Taxonomy Provides Organization

Taxonomy exists for:

* Search
* Reporting
* Analytics
* Template Discovery
* Contractor Matching

Taxonomy should not be required to generate a meaningful agreement.

Taxonomy should not overwrite a valid AI draft.

Taxonomy should be advisory.

---

## Contractor Is Final Authority

Contractor edits always override:

* AI suggestions
* Templates
* Taxonomy

The contractor is the source of truth.

---

## Signed Agreements Are Learning Data

The highest quality learning signal is a completed agreement.

The system should learn from:

* Original descriptions
* Final scopes
* Contractor edits
* Milestones
* Pricing structures
* Amendments
* Disputes
* Completion history

---

# Agreement Creation Workflow

Description
↓
Search Templates

If strong template exists:
Template
↓
AI Refinement
↓
Contractor Review

If no useful template exists:
AI Draft Creation
↓
Contractor Review

Then:
Milestones
Pricing
Clarifications
Exclusions
Warranty
↓
Agreement

---

# Non-Negotiable Rules

1. A contractor must be able to create an agreement from a single sentence.

2. Missing templates must never prevent agreement generation.

3. Missing taxonomy must never prevent agreement generation.

4. AI defines project identity.

5. Templates standardize project execution.

6. Taxonomy organizes projects.

7. Contractor edits override all automated suggestions.

8. Signed agreements are the platform's most valuable learning asset.
