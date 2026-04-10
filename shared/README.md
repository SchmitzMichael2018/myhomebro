# Shared Contracts

`milestone_shaping_rules.json` is a shared contract consumed by both the frontend and backend milestone suggestion flows.

It controls:
- Subtype default milestone structures
- Clarification-aware milestone additions, removals, and reordering
- Milestone wording refinements based on saved clarification answers
- Default amount weights used when milestone amounts are generated locally

Current consumers:
- [frontend/src/lib/milestoneDraftShaping.js](/Users/schmi/Documents/myhomebro/frontend/src/lib/milestoneDraftShaping.js)
- [backend/projects/ai/agreement_milestone_writer.py](/Users/schmi/Documents/myhomebro/backend/projects/ai/agreement_milestone_writer.py)
- [frontend/tests/milestone-draft-shaping.smoke.mjs](/Users/schmi/Documents/myhomebro/frontend/tests/milestone-draft-shaping.smoke.mjs)
- [backend/projects/tests.py](/Users/schmi/Documents/myhomebro/backend/projects/tests.py)

Maintenance note:
- Treat this file as the single source of truth for supported milestone shaping rules.
- When updating rules, validate both consumers before merging.

Recommended validation:
- `cd frontend; npm.cmd run build`
- `node frontend/tests/milestone-draft-shaping.smoke.mjs`
- `cd backend; .\\venv\\Scripts\\python.exe manage.py test projects.tests.AgreementMilestoneSuggestionShapingTests`
- `cd frontend; npx.cmd playwright test tests/agreement-basic.spec.js -g "clarification answers|clarifications are skipped|optional cabinet milestones|optional bathroom tile|does not overwrite"`
