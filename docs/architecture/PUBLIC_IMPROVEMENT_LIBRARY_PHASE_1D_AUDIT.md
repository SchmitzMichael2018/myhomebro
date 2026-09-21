# Public Improvement Library Phase 1D Audit and Architecture

## Pre-implementation audit

### Working

- `ProjectTemplate` was already the canonical reusable template, taxonomy, scope, milestone, materials, pricing, duration, ownership, and system-template record.
- Authenticated template discovery, editing, cloning, agreement application, admin management, benchmarks, and usage analytics already preserved template identity.
- The DIY planner already supported projects, phases, tasks, progress, assets, measurements, and escalation into the existing contractor-request workflow.
- Public project intake already created the canonical request record and Phase 1B already supported content views, DIY starts, hire-pro clicks, project creation, funding, and revenue attribution.
- Phase 1C already supplied centralized client/server metadata, robots, sitemap, structured-data support, and conservative noindex defaults.

### Partial

- Contractor-facing `is_published` controlled authenticated system-template discovery, but was not a reviewed public-web publication decision.
- Template taxonomy used `project_type` and `project_subtype` strings rather than stable public category and improvement slugs.
- Template content could describe scope, milestones, materials, duration, assumptions, and exclusions, but lacked reviewed public education, safety, DIY/pro, SEO, and social fields.
- Attribution supported stable content IDs but did not aggregate improvement/category events in the staff report.

### Missing

- Public library, category, and improvement routes; publication workflow; slug redirects; public search; breadcrumbs; dynamic sitemap records; conversion lineage; and public content validation.

### Duplicated

- No parallel blog or SEO improvement database existed, and none was added.

### Unsafe or ambiguous

- Treating contractor-facing `is_published` as public-web approval would have exposed unreviewed internal templates.
- Automatically publishing AI/system templates could expose incomplete or hazardous instructions.
- User-uploaded images were not approved as social previews.

## Chosen architecture

`ProjectTemplate` remains authoritative. Phase 1D adds a deliberately separate public publication state (`draft`, `ready_for_review`, `published`, `archived`) and structured public fields to that same record. `ProjectTemplatePublicSlug` stores prior canonical paths only, enabling permanent redirects without duplicating content.

Only active `published` templates are returned by public APIs, category queries, related links, direct public shells, search, or sitemap generation. Publishing requires a title, public category and slug, summary, SEO description, useful scope/milestone content, and a recorded reviewer/time. Existing templates default to `draft`.

## Routes and behavior

- `/improvements/`: searchable library landing; only published content and non-empty categories appear.
- `/improvements/<category>/`: published non-empty category or 404.
- `/improvements/<category>/<improvement>/`: published detail or 404; historical published slugs permanently redirect.
- `/api/projects/public/improvements/...`: read-only public data endpoints with the same publication boundary.

Pages render only non-empty authoritative sections. Visible breadcrumbs and `BreadcrumbList` JSON-LD describe the real hierarchy. Related links use the explicit symmetric template relationship and filter to published records.

## Conversion and attribution

The DIY CTA records `diy_project_started`, stores resumable template intent through registration, and points to the existing customer portal. The existing DIY creation endpoint accepts a published `source_template_id`, records immutable template lineage, and seeds phases/tasks from canonical milestones.

The contractor-help CTA records `hire_pro_clicked` and enters existing public intake with `template_id`. `ProjectIntake.source_template` preserves canonical context without creating another lead system. Phase 1B continues to preserve first/last touch, landing page, referrer, UTMs, signup, project, funding, and revenue records. Staff reporting now groups content events by stable improvement ID and category.

## Content safety

- Public publication requires recorded human review; AI/system content is never automatically public.
- Safety, preparation, DIY, professional-help, mistakes, cost, FAQ, and duration fields are optional and omitted when empty.
- FAQ JSON is structurally validated as question/answer pairs.
- Social overrides must be approved PNG paths under `/static/social/`; arbitrary uploads are rejected.
- Hazardous work must remain draft/review until a reviewer supplies appropriately cautious guidance. The software does not fabricate permit, licensing, cost, safety, or jurisdictional facts.

## Initial Bathroom cluster

The local canonical library contained one relevant system template: **Bathroom Remodel**. Existing scope, milestones, and materials were sufficient to prepare a public summary and canonical identity, but no human public-content review was recorded. Migration `0319` therefore places it in `READY_FOR_REVIEW` as `/improvements/bathroom/bathroom-remodel-planning/`; it is not accessible or indexable.

No canonical templates existed for Replace Bathroom Vanity, Replace Bathroom Faucet, Replace Toilet, or Install Shower Door. Phase 1D does not fabricate them. They remain content/model dependencies for Phase 2 rather than empty SEO records.

**Actually published pages: none.** Publication requires deliberate review after deployment.

## Social asset

The approved asset was present but measured 1730×909 rather than its stated 1200×630. Its approved composition was resized to exactly 1200×630 and stored at both `frontend/public/static/social/myhomebro-default-1200x630.png` and `backend/static/social/myhomebro-default-1200x630.png`. Both copies have the same SHA-256 and the production metadata fallback is `/static/social/myhomebro-default-1200x630.png`.

## Performance and future guides

The public library is a lazy-loaded public route chunk and requests only the small public endpoint it needs. Images are not added to page layouts without approved content. No guide/article model is introduced. Future question-specific guides can link to `ProjectTemplate` if a reviewed need justifies a separate model later.

## Deployment

Apply migrations `0317`, `0318`, and `0319` before serving the new code, then build frontend assets and run collectstatic. No new secret is required. No deployment was performed in Phase 1D.
