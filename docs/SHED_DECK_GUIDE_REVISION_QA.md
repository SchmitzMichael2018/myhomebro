# Shed and deck guide revision

## Scope

Revised the existing shed and deck editorial drafts. Bathroom and patio catalog entries are unchanged. Shed now includes a model-specific kit assembly workflow; deck includes a low detached build workflow plus existing-deck care. Each retains five DIY planner milestones. Size-based permit exemptions are separate from DIY suitability, site restrictions and construction requirements.

San Antonio official sources checked November 17, 2026: No Permit Required list, Residential Improvements application (Rev 9/26), and IB 151 (May 2025). Shed exemption: qualifying one-story detached storage structure, no more than 300 square feet, applicable setbacks. Deck exemption: uncovered, no more than 300 square feet, no point more than 30 inches above grade, detached from dwelling, not serving a required exit door. Address, use and other restrictions still require checking. Manufacturer/AWC sources inform model/design-specific checkpoints; no universal structural dimensions are supplied.

## Files changed

- `backend/projects/data/homeowner_guides_v1.json`: revised shed/deck copy, source dates, SEO titles, FAQs and sources.
- `backend/projects/management/commands/prepare_homeowner_guides.py`: uses optional per-guide source date and SEO title.
- `backend/projects/management/commands/refresh_homeowner_guide_drafts.py`: explicit selected-slug dry run/apply against a saved baseline; refuses manual changes or reviewed/published state; validates the complete batch before saving in one transaction; preserves milestone IDs.
- `backend/projects/tests_homeowner_guides.py`: draft import/publication coverage plus refresh dry-run, repeatability, ID preservation and refusal tests.
- `scripts/render_homeowner_guide_previews.py`, `scripts/render_homeowner_guide_review.py`: catalog-derived review copies with current dates.
- `docs/HOMEOWNER_GUIDES_REVIEW.md`: regenerated owner review copy.

## Passed

- Catalog inspection: bathroom/patio unchanged; all four guides have five numbered DIY tasks; section counts within model limit.
- Python syntax checks for updater, tests and review renderer.
- Both review rendering commands completed.
- Focused backend suite: 8 tests passed in 0.200 seconds (isolated local test database). Includes draft API exclusion, human-review publication requirement, dry run, idempotency, milestone ID preservation and edited/reviewed-draft refusal.

## Failed

None in the final focused checks. The first baseline export ran before its commit had been fetched; fetching main resolved it before any draft mutation.

## Blocked

Authenticated article preview was unavailable in the prior session. This revision does not change frontend rendering; no new browser-rendering pass is claimed. Review HTML files are provided for owner inspection.

## Needs refinement

Owner editorial review remains outstanding. No review identity/date is manufactured and no article is published by this operation. Exact kit and site-specific structural design belong to a real homeowner project, not the generic guide.

## Commands

```
python scripts/render_homeowner_guide_previews.py
python scripts/render_homeowner_guide_review.py
python ../run_welcome_tests.py projects.tests_homeowner_guides
python -m py_compile backend/projects/management/commands/refresh_homeowner_guide_drafts.py backend/projects/tests_homeowner_guides.py scripts/render_homeowner_guide_review.py
```

Production: back up database, save the original catalog from commit `059b4b8a4e6aaf834f0d298247131720453460e8`, pull release, run isolated tests, dry-run refresh, then apply only shed and deck. Check article IDs 28/29, review/publication state and milestone IDs. Rollback: restore the pre-change database backup together with the preceding code version if needed; do not overwrite later owner edits.

## Production result

- PASS: PR 41 merged and release `dfa333590c08bdf969ceea2b893e0121dc2fa2ae` pulled on PythonAnywhere. WSGI reloaded. No frontend files or schema changed, so no frontend rebuild or migration was needed.
- PASS: verified a fresh SQLite backup before updating content. Internal backup locations are omitted from this report.
- PASS: all 8 focused tests passed in 0.444 seconds using an isolated in-memory test database on the server. Its deliberately temporary LocMem cache raised core.W130; production cache configuration was not changed.
- PASS: dry run validated both existing seed drafts against the original catalog; targeted refresh updated only shed ID 28 and deck ID 29.
- PASS: post-update database assertions verified all milestone IDs preserved and bathroom ID 27 / patio ID 30 model fields unchanged. All four guides have five milestones, remain ready_for_review, and have no human review recorded. No articles published.
- Validation used the authenticated deployment console, not an authenticated homeowner-guide browser preview. No new article screenshot captured and no frontend visual pass claimed. Internal console links are omitted from this report.
- Refreshed local standalone HTML previews and combined Markdown review copy are available for owner review.
