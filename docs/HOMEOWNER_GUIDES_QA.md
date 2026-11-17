# Bathroom and outdoor homeowner guides — QA report

## Scope
Create homeowner content starting with bathroom renovation, then shed, deck and patio projects. Reuse the existing Improvement Library, editorial review workflow, template-linked DIY planner and public project intake. The release adds reading navigation, five scoped DIY tasks per guide, hiring checklists and official source links.

PR: https://github.com/SchmitzMichael2018/myhomebro/pull/40
Deployed code: 5fe5d7ae2130f151d742498e53c8d839cd3ec877
Content is prepared, not publicly published.

## Files changed
- backend/projects/data/homeowner_guides_v1.json: authoritative content for all four guides.
- backend/projects/management/commands/prepare_homeowner_guides.py: default dry run; --apply creates only missing drafts, never overwrites, reviews or publishes.
- backend/projects/tests_homeowner_guides.py: privacy, review requirement, dry run, preservation and DIY-plan checks.
- frontend/src/components/HomeownerGuideSections.jsx and its test: DIY/hiring anchors, readable steps, printing and HTTPS source links.
- frontend/src/pages/PublicImprovementPage.jsx: integrates guide reading paths and disables project actions in editorial previews.
- frontend/src/pages/PublicImprovementLibraryPage.jsx: homeowner-inclusive library introduction.
- frontend/src/pages/SanAntonioLaunchPage.jsx: bathroom, shed, deck and patio cards, with links only to published guides.
- frontend/tests/homeowner-guides.spec.js and frontend/tests/san-antonio-launch.spec.js: targeted browser coverage and current project-first intake expectations.
- scripts/render_homeowner_guide_previews.py: generates standalone review copies.
- docs/HOMEOWNER_GUIDES_REVIEW.md: complete review copy.

## Content and DIY boundaries
Bathroom DIY covers a cosmetic refresh of sound dry surfaces; full renovation, wet-area waterproofing and trades need qualified help. Shed DIY covers planning/ground-access finishing after a suitable building is installed. Deck DIY covers care of a sound existing deck. Patio DIY is a small uncovered pedestrian paver project on a suitable verified site. Structural, foundation, roofing and utility tutorials are excluded.

Each guide includes scope decisions, measurements/preparation, cost categories, schedule dependencies, tools, stopping points, mistakes, DIY steps, hiring questions, completion checks, FAQs and sources. No invented local prices, project-specific permit approval, fake videos or guaranteed durations are presented.

## Passed
- Six backend behavior tests passed locally after correcting one case-sensitive test assertion.
- Two frontend server-rendering tests passed, covering both reading paths, preserved section text, source-link safety and contractor-article compatibility.
- JSX transformation passed for all four changed React surfaces.
- Python/test-file syntax checks passed.
- Local Vite build completed (1 minute 23 seconds).
- Production SQLite backup and integrity verification completed before draft creation.
- Four live records created: bathroom 27, shed 28, deck 29, patio 30. All ready_for_review, all unreviewed, all with five DIY milestones, zero published.
- Production build completed in 37 seconds; collectstatic completed with 214 copied, 176 unmodified and 1001 post-processed files; WSGI reload completed.
- Six backend tests passed again on the server in an isolated in-memory database with a private local-memory test cache.
- Production source working tree clean after release.
- Live San Antonio page displays the four requested project cards with normal planning links and no links to unpublished guides.
- Public homeowner library API returns HTTP 200 with an empty improvements list; no new draft content is exposed.
- Screenshot captured successfully: docs/qa/homeowner-guides/san-antonio-projects.jpg.
- Four standalone HTML review copies were generated from the same catalog and read back as files.

## Failed
No remaining application test failure. The initial backend run had one assertion expecting a lowercase phrase in mixed-case editorial text; a case-insensitive assertion passed on the rerun. No publication was attempted.

## Blocked
- Targeted Playwright execution was attempted and stopped before application actions because the isolated Windows browser process could not launch. No automated browser, mobile-layout or full account-to-DIY-project end-to-end pass is claimed.
- The private admin-preview route did not remain accessible in the current browser session; staff preview visual verification is not claimed.
- Browser policy rejected a file:// preview. No alternate browser method was used to bypass it. The standalone review files are provided for the owner to open directly.
- Public article publication awaits actual human review. The existing ProjectTemplate.clean() rule states: “A recorded human review is required before publication.” Review timestamps and reviewer IDs were deliberately not fabricated.

The server test emitted core.W130 because the test process intentionally uses a private local-memory cache. This does not change production cache configuration.

## Needs refinement
Owner review of the bathroom guide first, especially tone, depth, DIY boundaries and the desired relationship between full-project planning and limited DIY tasks. Publish through the existing staff review/publish workflow only after approval. The San Antonio guide links will appear automatically once records are published.
Visual verification of the article preview and mobile reading layout remains outstanding.

## Commands
Local:
- python run_welcome_tests.py projects.tests_homeowner_guides
- node node_modules/vitest/vitest.mjs run src/components/HomeownerGuideSections.test.jsx
- node node_modules/vite/bin/vite.js build
- node --check frontend/tests/homeowner-guides.spec.js
- node --check frontend/tests/san-antonio-launch.spec.js
- python -m py_compile backend/projects/management/commands/prepare_homeowner_guides.py backend/projects/tests_homeowner_guides.py
- JSX transform with esbuild for HomeownerGuideSections, PublicImprovementPage, PublicImprovementLibraryPage and SanAntonioLaunchPage.
- Targeted Playwright: homeowner-guides.spec.js and san-antonio-launch.spec.js, installed Edge channel, retries=0, max-failures=1; BLOCKED at launch.
- python scripts/render_homeowner_guide_previews.py

Production:
- venv/bin/python backend/manage.py backup_sqlite_database --output-dir /home/myhomebro/backups/pre-homeowner-guides --skip-checks
- git pull --ff-only origin main
- venv/bin/python backend/manage.py prepare_homeowner_guides --apply
- Node 20.20.2: npm run build
- venv/bin/python backend/manage.py collectstatic --noinput
- touch /var/www/www_myhomebro_com_wsgi.py
- Django test runner: projects.tests_homeowner_guides, TEST.NAME=:memory:, migrations disabled for isolated schema sync, private LocMemCache.
- Read-only query of records 27–30 confirming status, absent human review, five DIY steps each and zero published.
- git status --short

## URLs and sessions
- https://www.myhomebro.com/san-antonio/ — public unauthenticated checks.
- https://www.myhomebro.com/api/projects/public/improvements/?audience=homeowner — public unauthenticated HTTP 200, no draft exposure.
- https://www.myhomebro.com/app/admin/improvements/preview/bathroom-renovation-planning-guide — attempted private preview; not visually verified.
No real homeowner account, project, contractor invitation, notification or payment was created during these checks.

## Recovery
Revert PR 40, rebuild/collect static and reload WSGI. Drafts can remain private or be archived through the editorial workflow; do not delete reviewed or subsequently edited records blindly. No schema migration rollback is needed.
