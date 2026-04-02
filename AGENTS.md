# MyHomeBro Agent Instructions

## Overview

MyHomeBro is a contractor–customer agreement and payment platform.

Tech stack:
- Backend: Django (API + business logic)
- Frontend: React (Vite)
- Payments: Stripe (test-mode for development)
- Documents: PDF generation with versioning
- Features include agreements, milestones, invoices, disputes, escrow/direct pay

---

## Agent Mode

Act as a hands-on coding agent, not a passive assistant.

You must:
- Execute tasks end-to-end
- Read the repo before making changes
- Modify files directly where appropriate
- Run relevant commands/tests after changes
- Diagnose and fix clearly related issues
- Provide structured output and QA reporting

Do NOT:
- Only suggest code without executing
- Refactor unrelated parts of the codebase
- Introduce unnecessary abstractions

---

## Deployment / Validation Workflow

Primary workflow:
- Codex works in VS Code on a git branch
- Changes are committed and pushed to GitHub
- Changes are pulled and redeployed on PythonAnywhere
- Visual verification is performed against the deployed site when needed

Do not assume localhost is the primary validation path unless explicitly instructed.

---

## Environment Preference

For MyHomeBro, the default validation environment is the deployed production site, not localhost.

Reason:
- Certain platform features do not behave correctly or completely on localhost
- Production validation has been the normal workflow for this project

Rules:
- Do not assume localhost is the primary testing target
- If a task involves UI validation, prefer the deployed site unless explicitly told to use localhost
- If production testing requires authentication and no valid session or safe credentials are available, report BLOCKED clearly
- Use localhost only when explicitly requested or when debugging local-only backend/config issues

---

## Core Workflow

For any task:

1. Understand the feature and relevant files
2. Implement the required changes
3. Run relevant commands/tests
4. Identify failures or inconsistencies
5. Fix clearly related issues only
6. Provide a QA report

---

## Testing / QA

Use targeted tests for the area being changed. Prefer Playwright for UI and workflow validation in the frontend.

Commands:
- Frontend dev: `cd frontend && npm run dev`
- E2E tests: `cd frontend && npm run test:e2e`
- Headed mode: `cd frontend && npm run test:e2e:headed`
- UI mode: `cd frontend && npm run test:e2e:ui`
- Report: `cd frontend && npm run test:e2e:report`

Rules:
- Run targeted Playwright tests for UI or workflow changes
- If tests do not exist, add minimal smoke tests when appropriate
- Prefer stable selectors (`data-testid`)
- Use the least brittle fallback selectors only when needed
- Report results as `PASS`, `FAIL`, `BLOCKED`, or `NEEDS REFINEMENT`
- Avoid unrelated edits while fixing test or setup issues
- Do not overbuild test coverage — keep it focused
- For MyHomeBro, Playwright should target the deployed production site by default unless explicitly instructed otherwise

---

## Production Playwright Rules

When asked to validate the deployed site:
- Prefer the production site over localhost if explicitly requested
- Use only non-destructive checks on production
- Do not create, delete, charge, refund, or mutate production data unless explicitly instructed
- If authenticated production testing is required, use only a provided safe test account or an existing approved session
- If no valid production session or credentials are available, report `BLOCKED` instead of guessing

---

## Critical Flows (High Priority)

These flows must remain stable:

- Contractor login
- Dashboard load
- Agreement creation (wizard)
- Template application
- AI clarifications
- Milestone completion
- Invoice creation and approval
- Dispute creation and resolution
- Refund handling
- Signature flow (including public signing)
- PDF generation and versioning

---

## Guardrails (VERY IMPORTANT)

- Preserve amendment history, auditability, and PDF versioning
- Do NOT overwrite prior signed or archived agreement artifacts
- Maintain full traceability of changes (who/when/what)
- Do NOT break existing agreement → milestone → invoice relationships
- Do NOT remove or alter audit logs unless explicitly required
- Use test-mode or safe data for any payment-related logic
- Keep changes minimal and production-safe
- Do NOT change layout shells, sidebar overflow, or scrolling behavior unless the task explicitly targets those areas

---

## UI Guidelines

- Prefer adding `data-testid` for key interactions:
  - login inputs/buttons
  - dashboard elements
  - agreement actions
  - milestone actions
  - invoice actions
  - dispute actions

- Avoid large UI refactors unless explicitly requested
- Maintain consistency with existing styling and patterns

---

## Backend Guidelines

- Follow existing Django patterns (models, serializers, viewsets)
- Avoid breaking API contracts used by frontend
- Maintain relationships between:
  - Agreement
  - Project
  - Milestone
  - Invoice
  - Dispute

---

## AI Features (Important Context)

AI is used for:
- milestone suggestions
- pricing guidance
- clarification questions
- dispute summaries and recommendations

Rules:
- AI output must be advisory, not authoritative
- Do not present AI as final decision-maker
- Always allow user override

---

## Output Requirements

After completing any task, ALWAYS provide:

1. Files changed
2. Summary of implementation
3. Commands run
4. Test results

Then include:

## QA Report
### Scope
### Passed
### Failed
### Blocked
### Needs refinement
### Commands

If testing on production:
- Include exact URL(s) tested
- State whether testing was authenticated or unauthenticated
- State whether screenshots were captured successfully