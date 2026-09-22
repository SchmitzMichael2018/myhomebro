# Bathroom Improvement Content Phase 2A Audit

## Objective and boundary

Phase 2A prepares the first five canonical Bathroom improvement templates for human editorial and safety review. It does not publish them, add a blog system, deploy code, or introduce unsourced national cost claims.

## Canonical-record audit

| Target | Audit result | Canonical action |
| --- | --- | --- |
| Bathroom Remodel Planning | EXISTING / EXTENDED / MERGED-REUSED | Existing system template `Bathroom Remodel` (local canonical ID 2, key `remodel:bathroom_remodel`) remains the operational source. Its public title is Bathroom Remodel Planning. |
| Replace Bathroom Vanity | CREATED | No system-template equivalent or near-equivalent existed. |
| Replace Bathroom Faucet | CREATED | No system-template equivalent existed; repair-classification code was not a reusable canonical template. |
| Replace Toilet | CREATED | No Toilet Replacement or Toilet Installation system template existed. |
| Install Shower Door | CREATED | No Shower Door, Glass Shower Door, or Shower Enclosure system template existed. |

All five use `public_category_slug=bathroom`, have unique canonical public slugs, and finish as `READY_FOR_REVIEW`. Reviewer identity, review timestamp, and public publication timestamp remain empty.

## Content architecture

`ProjectTemplate` remains the source of truth. Phase 2A adds only `public_title` and `tools_guidance`, two missing public-content concepts, then fills the existing Phase 1D fields for summary, introduction, scope, materials, preparation, safety, cost drivers, common mistakes, DIY/pro guidance, FAQs, SEO, duration, difficulty, milestones, and relationships.

The content avoids numeric price promises. Duration fields are planning ranges rather than completion promises; the prose identifies factors that may expand elapsed time. Permit and licensing language remains jurisdiction-dependent.

The existing approved default social preview remains in use. No project-specific or AI-generated image was added.

## Project sequence and relationships

Each template has one canonical milestone sequence used by both the public explanation and downstream DIY project creation. The sequences are intentionally compact enough to remain useful for future agreement and funding workflows.

Bathroom Remodel Planning is the cluster hub and relates to Vanity, Faucet, Toilet, and Shower Door. Vanity and Faucet also relate directly. Both directions are explicitly stored so every applicable public page can discover its related content after publication.

## Conversion and attribution

No Phase 1B/1D attribution architecture changed. After a reviewer publishes a template, its stable `ProjectTemplate.id` continues through `improvement_template_view`, `diy_project_started`, `hire_pro_clicked`, DIY creation, and public contractor intake. Automated tests temporarily simulate completed human review to verify those contracts, then the test transaction rolls back.

## Human-review gates

Automated validation establishes structural completeness, not publication approval. A human reviewer must independently assess:

- Safety language, especially water isolation, deteriorated plumbing, toilet lifting/flange/floor conditions, glass handling, mounting support, drilling, and waterproofed assemblies.
- Product- and manufacturer-dependent claims.
- Local permit, inspection, plumbing, electrical, and licensing implications.
- Whether the proposed time ranges are appropriate as broad planning guidance.
- Editorial clarity, terminology, milestone scope, FAQ accuracy, and SEO presentation.

None of the five templates is ready for publication until that review is recorded through the Phase 1D workflow.

## Deployment considerations

Deploy code before running migrations `0320` and `0321`. Migration `0320` adds the two public-content fields; `0321` extends the existing hub, creates only missing canonical records, writes milestone sequences, and establishes relationships. Build frontend assets and collect static files after migration. Phase 2A itself performs no deployment or publication.
