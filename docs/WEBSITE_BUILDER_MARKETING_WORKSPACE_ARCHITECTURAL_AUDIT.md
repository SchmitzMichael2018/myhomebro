# Website Builder And Marketing Workspace Architectural Audit

Date: July 8, 2026

Scope: Architectural, UX, source-of-truth, public website, marketing, lead generation, SEO, reviews, portfolio, branding, analytics, and AI opportunity audit for the MyHomeBro Website Builder and Marketing Workspace. This audit does not implement behavior changes.

## Executive Summary

The current Marketing Workspace is no longer just a public profile editor. It now has a real foundation for a contractor growth system: public profile, QR sharing, gallery, reviews, website builder, public website rendering, public lead intake, opportunity handoff, SEO basics, and AI-assisted copy hooks.

The strongest architectural decision is that Website Builder uses a backend resolver to consume public profile, gallery, review, trust, and lead-readiness data instead of creating a completely separate website data silo. This is directionally correct.

The main risk is that Marketing still owns too many business facts directly. `ContractorPublicProfile` stores public business name, phone, email, city, state, service areas, specialties, work types, credentials, years in business, website URL, SEO, brand assets, and visibility settings. Some of these are legitimate marketing overrides, but some are business facts that should be owned once by Company or Business Profile and consumed read-only by Marketing.

Recommended direction:

- Company/Business Profile owns factual business identity, compliance, service coverage, operating information, and verified trust data.
- Marketing owns presentation, public copy, public visibility, campaigns, portfolio curation, review promotion, website pages, SEO metadata, lead capture, QR campaigns, and conversion analytics.
- Website Builder should remain a presentation layer over contractor business facts, reviews, portfolio, trust indicators, and lead intake.
- Public Profile should remain the lightweight/free public presence and marketplace identity.
- Website should be the richer owned marketing site that inherits Company/Profile facts automatically.
- Project Assistant should become a Marketing Advisor that recommends improvements, drafts content, explains evidence, and never publishes or changes public content without explicit human action.

Launch readiness today:

- Website Builder foundation: 7 out of 10.
- Full Marketing Workspace: 5.5 out of 10.

## Current Architecture Review

### Frontend Surface

Primary frontend files reviewed:

- `frontend/src/pages/ContractorPublicPresencePage.jsx`
- `frontend/src/components/website/WebsiteBuilderWizard.jsx`
- `frontend/src/components/website/PublicWebsiteRenderer.jsx`
- `frontend/src/pages/ContractorWebsitePreviewPage.jsx`
- `frontend/src/pages/PublicWebsitePage.jsx`
- `frontend/src/pages/PublicProfile.jsx`
- `frontend/src/routes/ProtectedRoutes.jsx`
- `frontend/src/routes/PublicRoutes.jsx`

Current contractor routes include:

- `/app/marketing`
- `/app/marketing/preview`
- `/app/public-presence`, redirected to `/app/marketing`

Current public website routes include:

- `/websites/:slug`
- `/websites/:slug/:pageSlug`

Current Marketing Workspace tabs/steps include:

- Public profile / basics
- Photo gallery
- Reviews and testimonials
- Website design and content
- SEO and visibility
- Final review
- Publish
- Leads / opportunities handoff

The current page combines setup, website builder, QR sharing, gallery, reviews, SEO, lead management, and opportunity handoff in one broad workspace.

### Backend Surface

Primary backend files reviewed:

- `backend/projects/models.py`
- `backend/projects/views/website_builder.py`
- `backend/projects/services/website_builder.py`
- `backend/projects/views/public_presence.py`
- `backend/projects/serializers/public_presence.py`
- `backend/projects/services/public_lead_pipeline.py`
- `backend/projects/services/public_lead_notifications.py`
- `backend/projects/services/contractor_reviews.py`
- `backend/projects/urls.py`
- `backend/projects/tests_website_builder.py`
- `backend/projects/tests_website_lead_routing.py`
- `backend/projects/tests_reviews.py`

Core models:

- `ContractorPublicProfile`
- `ContractorGalleryItem`
- `ContractorReview`
- `PublicContractorLead`
- `ContractorWebsite`
- `ContractorWebsitePage`
- `ProjectIntake`

Website Builder APIs include:

- `/api/projects/contractor/website/`
- `/api/projects/contractor/website/preview/`
- `/api/projects/contractor/website/ai-assist/`
- `/api/projects/contractor/website/publish/`
- `/api/projects/contractor/website/pause/`
- `/api/projects/contractor/website/pages/`
- `/api/projects/contractor/website/pages/<page_id>/`
- `/api/projects/public/websites/<slug>/`
- `/api/projects/public/websites/<slug>/<page_slug>/`
- `/api/projects/public/websites/<slug>/intake/`

Public Presence APIs include:

- `/api/projects/contractor/public-profile/`
- `/api/projects/contractor/public-profile/qr/`
- `/api/projects/contractor/gallery/`
- `/api/projects/contractor/gallery/<item_id>/`
- `/api/projects/contractor/reviews/`
- `/api/projects/contractor/reviews/<review_id>/`
- `/api/projects/contractor/public-leads/`
- `/api/projects/contractor/public-leads/<lead_id>/`
- `/api/projects/contractor/public-leads/<lead_id>/accept/`
- `/api/projects/contractor/public-leads/<lead_id>/reject/`
- `/api/projects/contractor/public-leads/<lead_id>/analyze/`
- `/api/projects/contractor/public-leads/<lead_id>/send-intake/`
- `/api/projects/contractor/public-leads/<lead_id>/create-agreement/`
- `/api/projects/contractor/public-leads/<lead_id>/convert-homeowner/`
- `/api/projects/public/contractors/<slug>/gallery/`
- `/api/projects/public/contractors/<slug>/reviews/`
- `/api/projects/public/contractors/<slug>/request-quote/`
- `/api/projects/public/contractors/<slug>/qr/`

## Current Data Model Assessment

### ContractorPublicProfile

`ContractorPublicProfile` currently mixes three categories:

- Business facts: public business name, city, state, service area, primary trade, specialties, work types, credentials, years in business, phone, email, website URL.
- Marketing presentation: tagline, bio, colors, font theme, profile theme, logo, cover image, hero image, SEO title, SEO description.
- Public visibility settings: show phone, show email, show reviews, show gallery, show quote CTA, allow public intake, allow public reviews, is public.

This model is doing useful work, but the ownership boundary is too broad. It should be treated as a public presentation profile that can override or selectively expose Company-owned facts, not as the canonical business profile.

### ContractorWebsite

`ContractorWebsite` is a good first-class container for a contractor-owned marketing site:

- One website per contractor.
- Linked to one public profile.
- Draft/published/paused status.
- Template key.
- Homepage layout JSON.
- Published snapshot JSON.
- Published timestamp.

This is the right shape for a website presentation layer. The `published_snapshot` is valuable because it freezes what visitors see until the contractor republishes.

Risk: business fact changes, such as phone, service area, license, or insurance, can become stale in a snapshot unless the UI clearly prompts the contractor to republish or some verified facts remain dynamically resolved.

### ContractorWebsitePage

`ContractorWebsitePage` currently supports:

- Home
- Services
- Gallery
- Reviews
- Contact

It stores slug, title, SEO title, SEO description, content blocks, publish flag, and sort order.

This is a solid foundation. Missing first-class page types include:

- About
- FAQ
- Service detail
- City/service landing pages
- Before/after gallery
- Financing/payment information
- Warranty/service guarantee
- Seasonal landing pages

### PublicContractorLead

`PublicContractorLead` supports multiple marketing sources:

- Landing page
- Public profile
- Website
- Quote request
- Manual
- QR
- Contractor-sent form
- Direct

This is a good attribution foundation. The current UX already tells contractors that leads from profile, QR code, and website appear in Opportunities.

Risk: Marketing, Opportunities, and Project Intake can feel like separate lead systems unless the lifecycle is formalized as:

`Marketing source -> ProjectIntake/PublicContractorLead -> Opportunity -> Estimate -> Agreement`

## Business Ownership Review

### Principle

Business owns facts. Marketing owns presentation.

Company/Business Profile should be the source of truth for factual information. Marketing should decide how those facts are displayed, promoted, hidden, sequenced, and measured.

### Business Facts That Should Be Owned Once

These should be editable in Company/Business Profile and consumed by Marketing:

- Legal company name
- DBA/display company name baseline
- Primary phone
- Primary email
- Physical/mailing address
- Service areas
- Business hours
- Licenses
- Insurance
- Certifications
- Years in business if factual
- Primary trade
- Approved services
- Stripe/payment readiness
- Tax information
- Verification status
- Company logo if treated as the official brand asset
- Company website URL if it refers to an external existing website

### Marketing Data That Should Be Owned By Marketing

These should be editable in Marketing:

- Public display name override
- Tagline
- Marketing bio
- Hero headline
- Hero subheadline
- CTA labels
- Public visibility toggles
- Brand colors
- Font theme
- Website theme/template
- Hero image
- Cover image
- Page copy
- Page order
- SEO title
- SEO description
- Featured gallery items
- Featured reviews
- QR campaign labels
- Landing page content
- Lead form intro copy
- Campaign tracking metadata
- Published website snapshot

### Fields That Need Explicit Ownership Clarification

These fields currently look like business facts but live on `ContractorPublicProfile`:

- `business_name_public`
- `phone_public`
- `email_public`
- `city`
- `state`
- `service_area_text`
- `service_area_mode`
- `service_cities`
- `service_counties`
- `primary_trade`
- `specialties`
- `work_types`
- `credentials`
- `years_in_business`
- `website_url`

Recommendation: keep public override fields where needed, but label them as overrides or visibility/presentation fields. The canonical value should be stored in Company/Business Profile.

## Source-Of-Truth Map

| Data Item | Owner | Marketing Role | Website Builder Role | Public Profile Role |
| --- | --- | --- | --- | --- |
| Legal company name | Company | Read-only | Inherit | Inherit |
| Public display name | Marketing override | Owns override | Display | Display |
| Logo | Brand Kit / Company | Curate/display | Display | Display |
| Phone | Company | Visibility/override | Display/contact | Display/contact |
| Email | Company | Visibility/override | Display/contact | Display/contact |
| Address | Company | Visibility/format | Display if enabled | Display if enabled |
| Business hours | Company | Display settings | Display if enabled | Display if enabled |
| Service areas | Company | Highlight/SEO | Inherit and promote | Inherit and show |
| Licenses | Company/compliance | Visibility | Display trust indicator | Display trust indicator |
| Insurance | Company/compliance | Visibility | Display trust indicator | Display trust indicator |
| Certifications | Company/compliance | Visibility | Display trust indicator | Display trust indicator |
| Stripe readiness | Payments | Do not edit | Not public except trust/payment messaging | Not public by default |
| Tax information | Company/finance | No access | No access | No access |
| Website URL | Marketing | Owns MyHomeBro website URL; may reference external URL | Owns published URL | Links to website |
| SEO title | Marketing | Owns | Page/profile metadata | Profile metadata |
| SEO description | Marketing | Owns | Page/profile metadata | Profile metadata |
| Reviews | Reviews/customer feedback | Curate/public visibility | Consume featured approved reviews | Consume approved reviews |
| Portfolio photos | Marketing/project records | Curate | Consume | Consume |
| Before/after photos | Marketing/project records | Curate | Consume | Consume |
| Social links | Company or Marketing | Display/campaign use | Display | Display |
| Google Business Profile | Marketing | Owns integration/status | Consume listing data | Link/display |
| Brand colors | Brand Kit / Marketing | Owns | Consume | Consume |
| Fonts | Brand Kit / Marketing | Owns | Consume | Consume |
| Hero image | Marketing | Owns | Consume | Consume as cover/hero |
| CTA buttons | Marketing | Owns | Consume | Consume |
| Lead form | Marketing/intake | Owns copy/settings | Render | Render |
| Lead records | Opportunities/intake | Monitor source/quality | Create via website | Create via profile/QR |
| Analytics | Marketing/Insights | Owns campaign view | Emits events | Emits events |

## Marketing Workspace Assessment

### What Works

- Marketing is accessible as a contractor workspace at `/app/marketing`.
- Public Presence has been merged into Marketing, reducing navigation confusion.
- QR, gallery, reviews, leads, public profile, SEO, and website builder live together.
- Public website leads are routed into intake/public lead infrastructure.
- The UI explicitly links website/profile/QR leads to Opportunities.
- Public reviews support moderation and verified review context.
- Gallery supports public visibility and featured ordering.
- Website Builder has draft, preview, publish, pause, and readiness concepts.
- Website AI hooks exist and are gated by entitlements.

### Gaps

- No true Marketing Overview that answers, “Is my business presence working?”
- Analytics entitlement exists, but public-facing marketing analytics are not first-class.
- QR appears as a profile sharing utility rather than campaign-level tracking.
- Lead source attribution exists, but campaign attribution, UTM tracking, and conversion metrics are not mature.
- Reviews are visible and publishable, but review request campaigns and response management are not first-class.
- Portfolio is photo-centric, not project/outcome-centric.
- SEO is mostly metadata and keyword guidance, not a full SEO system.
- Brand assets are spread across Public Profile fields rather than a clear Brand Kit.
- No visible publish version history, diff, rollback, or scheduled publishing.
- No clear custom domain or domain verification workflow.

### Recommended Marketing Purpose

Marketing should answer five questions:

- Does my business look professional?
- Am I generating leads?
- Which channels are working?
- Why are visitors not converting?
- What should I improve or promote next?

Marketing should focus on:

- Website
- Landing pages
- Public profile
- SEO
- Portfolio
- Reviews
- Google Business Profile
- QR codes
- Lead generation
- Campaigns
- Analytics
- Brand presentation

Marketing should not become:

- The source of truth for legal business facts.
- A second contractor settings area.
- A financial settings workspace.
- A project operations workspace.
- A customer CRM beyond lead handoff and campaign source analysis.

## Website Builder Assessment

### What Works

- Website Builder reuses existing profile/gallery/review/trust data.
- The backend `build_website_profile_payload` function acts as a useful resolver between business facts and presentation.
- Website publishing stores a snapshot, which keeps public output stable.
- Default pages are created deterministically.
- Page content blocks are flexible enough for incremental expansion.
- Readiness and publish blockers help prevent incomplete sites from going live.
- Preview supports desktop and mobile modes.
- Public website intake creates `ProjectIntake` and syncs to `PublicContractorLead`.
- Website leads are tagged with a website source.

### Website Builder Should Automatically Inherit

Website Builder should inherit the following from Company/Business Profile or Public Profile resolver:

- Company name
- Logo
- Phone
- Email
- Address/city/state
- Business hours
- Service areas
- Licenses
- Insurance
- Certifications
- Social links
- Approved reviews
- Portfolio photos
- Trust indicators

These should not be repeatedly requested inside Website Builder unless the user is intentionally setting a public override or display preference.

### Website-Specific Ownership

Website Builder should own:

- Template
- Page structure
- Page order
- Page slugs
- Page copy
- Hero headline
- CTA labels
- Contact form intro
- Website-specific SEO metadata
- Published snapshot
- Draft content
- Navigation labels
- Landing page variants
- Custom domain configuration
- Publish/rollback history

### Missing Website Capabilities

Near-term:

- About page
- FAQ page
- Before/after gallery
- Full page editor for each default page
- Draft vs published diff
- Publish history
- Clear stale business-fact republish prompt
- Basic image optimization requirements

Growth-stage:

- City/service landing pages
- Custom domain and DNS verification
- Redirect manager
- Sitemap and robots support
- Canonical URLs
- Open Graph/social preview controls
- Local business schema
- Accessibility and performance checks
- A/B test hooks

## Public Profile Assessment

Public Profile should remain the lightweight public identity layer and marketplace profile. It is useful for:

- Free/basic contractor presence.
- Marketplace discovery.
- QR sharing.
- Reviews.
- Portfolio preview.
- Initial quote request.
- Trust indicators.

When a contractor publishes a full website, Public Profile should:

- Continue to exist for marketplace compatibility.
- Link clearly to the website.
- Share the same facts, reviews, gallery, and trust indicators.
- Avoid creating a separate editing surface for the same business data.

Recommended relationship:

- Public Profile is the contractor card/profile.
- Website is the owned marketing site.
- Both consume the same Business Profile and Marketing assets.

## Portfolio And Gallery Assessment

### What Works

- Contractors can upload gallery items.
- Gallery items can be public/private and featured.
- Gallery data is consumed by Public Profile and Website Builder.
- Project city/state and category exist.

### Gaps

- Gallery is not yet strongly linked to completed projects.
- No structured before/after pairing.
- No project outcome story: problem, scope, materials, timeline, result.
- No customer approval/release workflow for using project photos.
- No portfolio analytics showing which photos drive leads.
- No video portfolio support surfaced as a first-class concept.

### Recommendation

Evolve Gallery into Portfolio:

- Project-linked portfolio entries.
- Before/after photo pairs.
- Project category/service tags.
- Location granularity controls.
- Customer permission/release status.
- Featured project stories.
- Review/testimonial pairing.
- AI-suggested captions based on project facts.

## Reviews Assessment

### What Works

- Reviews can be linked to agreements, homeowners, invoices, and milestones.
- Verified reviews can auto-approve.
- Admin moderation exists.
- Contractors can control public visibility.
- Public reviews and ratings are exposed through public endpoints.

### Gaps

- Review request campaigns are not first-class.
- Review response management is not first-class.
- No visible review funnel: requested, opened, submitted, approved, published.
- Featured testimonial selection is still basic.
- Reviews do not yet appear integrated with Google Business Profile review strategy.

### Recommendation

Marketing should own review growth and display, while reviews themselves remain customer feedback artifacts.

Add:

- Review request workflows.
- Post-project review prompt timing.
- Contractor response drafting.
- Featured testimonials.
- Google Business Profile review link support.
- Review trend analytics.

## SEO Assessment

### What Works

- Public Profile stores SEO title and description.
- Website pages store SEO title and description.
- SEO is surfaced in the Marketing UI.
- AI assist hooks exist for SEO title, description, keywords, and local business schema.

### Gaps

- No sitemap/robots/canonical management visible.
- No Open Graph/social preview controls visible.
- No redirect manager.
- No city/service landing page strategy.
- No technical SEO checklist.
- No structured FAQ schema/page workflow.
- No SEO analytics loop from search impressions or traffic.

### Recommendation

SEO should be a Marketing subarea, not a Company field.

SEO should consume Company facts and Marketing content, then manage:

- Page titles.
- Meta descriptions.
- Slugs.
- Schema.
- Sitemap.
- Canonicals.
- Redirects.
- City/service pages.
- Search-oriented content recommendations.

## Lead Generation Assessment

### What Works

- Website intake creates `ProjectIntake`.
- Website intake syncs to `PublicContractorLead`.
- Public profile and QR paths create or route leads.
- Contractor UI presents primary actions for leads.
- Opportunity leads can be recognized and routed to Opportunities.
- Leads can be accepted, rejected, analyzed, sent intake forms, converted to homeowners, or used to create agreements.

### Gaps

- The exact lifecycle between `PublicContractorLead`, `ProjectIntake`, Opportunity, Estimate, and Agreement needs a formal product contract.
- Marketing attribution should include campaign, UTM, QR code, landing page, and referrer metadata.
- Lead quality scoring and lead source quality are not yet first-class.
- Revenue attribution from lead source to agreement is not visible in Marketing.

### Recommendation

Marketing should own acquisition source and conversion performance. Opportunities should own sales workflow.

Recommended lifecycle:

`Visitor -> Marketing source -> Lead/Intake -> Opportunity -> Estimate -> Agreement -> Revenue`

Marketing should show the funnel and source attribution. It should not become the place where contractors operate the full sales pipeline.

## Analytics Assessment

### Current State

There is a website analytics entitlement key, but the audit did not find a mature Marketing Analytics dashboard in the current workspace.

### Recommended Marketing Metrics

Marketing Overview should show:

- Profile views.
- Website visits.
- QR scans.
- Lead form starts.
- Lead form submissions.
- Leads by source.
- Lead-to-opportunity conversion.
- Opportunity-to-estimate conversion.
- Estimate-to-agreement conversion.
- Revenue influenced by marketing source.
- Top pages.
- Top portfolio items.
- Review count and average rating.
- SEO readiness.
- Stale content warnings.

Insights should consume these rollups for broader business performance, but Marketing should own channel-level detail.

## Branding Assessment

### What Works

- Logo, cover image, hero image, primary color, accent color, font theme, and profile theme exist.
- Website Builder uses these branding fields.
- Public preview reflects brand changes.

### Gaps

- Brand assets are attached to Public Profile rather than a clear Brand Kit.
- Proposals, agreements, public website, public profile, documents, and emails may eventually need the same brand system.
- No clear owner for official logo vs website-specific hero image vs campaign assets.

### Recommendation

Create a Brand Kit concept:

- Logo
- Primary/accent colors
- Font theme
- Hero/cover assets
- Brand voice
- Proposal/document styling
- Public website styling
- Social preview images

Marketing can own Brand Kit presentation, but Company should own the official business identity behind it.

## Navigation Recommendation

Recommended contractor navigation:

- Company
- Team
- Opportunities
- Estimates
- Agreements
- Projects
- Customers
- Finance
- Marketing
- Insights
- Settings

Recommended Marketing subnavigation:

1. Overview
2. Website
3. Portfolio
4. Reviews
5. Leads
6. SEO
7. QR/Campaigns
8. Branding
9. Analytics
10. Settings

Launch-safe version:

1. Overview
2. Website
3. Portfolio
4. Reviews
5. Leads
6. Branding & SEO

Keep Public Presence as an internal concept, not the primary navigation label. “Marketing” is clearer for the contractor.

## UX Findings

### What Works

- The workspace has a clear “build your online presence” flow.
- Step labels make setup approachable.
- The live preview is valuable.
- Website Builder shows readiness and publish blockers.
- Public profile, gallery, reviews, and website are visibly connected.
- The final review step gives the user confidence before publishing.
- The Opportunities handoff message reduces confusion.

### Issues

- The workspace is doing too many jobs on one page.
- “Public Profile,” “Online Presence,” “Website,” and “Marketing” can feel like overlapping terms.
- Business facts and marketing copy are presented side by side without a strong ownership distinction.
- Website Builder still asks for fields that may already exist in Company/Business Profile.
- QR is framed as a link-sharing utility rather than a campaign channel.
- SEO fields are present, but the user does not get a full “what to improve next” SEO plan.
- Gallery is photo management, not yet portfolio marketing.
- Leads in Marketing risk duplicating Opportunities unless lifecycle language stays strict.

### UX Recommendations

- Make Marketing Overview the first screen.
- Use “Website,” “Portfolio,” “Reviews,” “Leads,” “SEO,” and “Campaigns” as task-oriented labels.
- Show inherited Company facts as read-only cards with “Edit in Company.”
- Label public overrides clearly.
- Add “Used on website/public profile/proposals” indicators for shared brand assets.
- Add a stale content warning when Company facts change after website publish.
- Add a source timeline for leads: Website -> Opportunity -> Estimate -> Agreement.
- Add campaign labels to QR codes.
- Add stronger empty states with one next action per section.

## AI Opportunities

Project Assistant should become a Marketing Advisor.

It should:

- Audit profile completeness.
- Suggest homepage copy.
- Suggest service descriptions.
- Recommend portfolio photos to feature.
- Draft photo captions.
- Recommend review requests after completed projects.
- Suggest contractor responses to reviews.
- Identify missing trust signals.
- Recommend SEO titles/descriptions.
- Suggest city/service landing pages.
- Explain why visitors might not convert.
- Recommend QR/campaign ideas.
- Summarize lead source performance.
- Flag stale website content after business facts change.

AI must:

- Show evidence.
- Label output as suggestions.
- Preserve user control.
- Require explicit approval before applying changes.
- Never publish automatically.
- Never fabricate licenses, insurance, reviews, photos, locations, awards, or certifications.
- Never misrepresent service areas or capabilities.
- Never send review requests, emails, SMS, campaigns, or customer messages without explicit human action.

## Integration Recommendations

### Company Integration

Marketing should consume Company facts through a resolver, not duplicate them.

Recommended resolver behavior:

- Return canonical Company facts.
- Return public override fields separately.
- Return visibility settings.
- Return trust/compliance status.
- Return stale publish warnings.

### Opportunities Integration

Marketing should create and attribute leads. Opportunities should own sales follow-up.

Recommended behavior:

- Every public lead has a source.
- Every source can link to an Opportunity.
- Opportunity shows campaign/source context.
- Estimate and Agreement retain source attribution.
- Marketing analytics show conversion outcomes.

### Insights Integration

Insights should consume Marketing rollups, not replace Marketing.

Insights asks: “How is my business performing?”

Marketing asks: “How is my public presence generating leads?”

### Admin Integration

Admin should observe marketplace-wide marketing health:

- Public profile completeness.
- Contractor website adoption.
- Suspicious reviews.
- Review moderation queues.
- Marketplace coverage gaps.
- Lead routing health.
- Website/QR source performance.

Admin should not edit contractor marketing content except through support/admin-authorized workflows.

## Risks

### Duplicate Business Data

If Marketing keeps editable copies of phone, email, service areas, credentials, and business facts, contractors will eventually publish inconsistent data.

### Stale Published Snapshots

Published website snapshots are useful, but they can become stale after Company facts change.

### Lead Fragmentation

Public leads, project intake, opportunities, estimates, and agreements must remain one lifecycle.

### SEO Underinvestment

Basic metadata is not enough for a contractor website product. Technical SEO, local pages, and schema will matter.

### AI Overreach

AI must not publish, send messages, invent facts, or imply verified trust signals.

### Review Trust

Reviews must remain auditable and moderated. Contractors should not be able to fabricate verified reviews.

### Branding Fragmentation

Branding spread across profile, website, proposals, and documents can drift without a Brand Kit.

### Billing/Entitlement Ambiguity

Website Builder has entitlement abstractions, but billing and plan enforcement need a durable source before launch-scale monetization.

## Launch Readiness

Ready now:

- Public profile foundation.
- Public website foundation.
- Draft website creation.
- Default website pages.
- Template selection.
- Branding fields.
- Gallery.
- Reviews.
- QR code sharing.
- SEO basics.
- Website preview.
- Website publish/pause.
- Public website intake.
- Lead sync to public lead/opportunity workflows.
- Website readiness and publish blockers.
- AI assist endpoint structure.

Needs refinement before positioning as full Marketing Workspace:

- Formal Company vs Marketing source-of-truth contract.
- Marketing Overview.
- Campaign/QR analytics.
- Lead source conversion analytics.
- Portfolio project linkage.
- Before/after support.
- Review request and response workflows.
- Advanced SEO and local landing pages.
- Custom domain workflow.
- Publish history and rollback.
- Brand Kit.
- Stale snapshot warnings.
- AI provider integration and guardrails.

## Priority Improvements

### P0

1. Define Company vs Marketing data ownership.
2. Show inherited Company facts as read-only in Marketing.
3. Label public overrides explicitly.
4. Add Marketing Overview with readiness and lead funnel.
5. Preserve one lifecycle from Marketing lead to Opportunity to Estimate to Agreement.

### P1

6. Add campaign/QR attribution.
7. Add website/profile analytics.
8. Add portfolio project linkage.
9. Add before/after portfolio support.
10. Add review request and review response workflows.
11. Add publish history and stale-content warnings.
12. Add sitemap, canonical, Open Graph, and schema support.

### P2

13. Add custom domains.
14. Add city/service landing pages.
15. Add Brand Kit shared by website, proposals, documents, and emails.
16. Add Marketing Advisor recommendations.
17. Add lead source revenue attribution.
18. Add A/B testing hooks.
19. Add accessibility/performance checks.
20. Add Google Business Profile integration.

## Top 20 Improvements

1. Create a formal Business Profile to Marketing data contract.
2. Move factual business edits out of Marketing or mark them as public overrides.
3. Add Marketing Overview as the first tab.
4. Rename remaining “Public Presence” UI to contractor-friendly Marketing labels.
5. Add read-only inherited Company fact cards with “Edit in Company” links.
6. Add a Brand Kit shared across website, profile, proposals, documents, and emails.
7. Add campaign-aware QR codes.
8. Add marketing analytics for profile views, website visits, QR scans, leads, and conversions.
9. Tie every Marketing lead to Opportunity, Estimate, Agreement, and revenue attribution.
10. Add portfolio entries linked to completed projects.
11. Add before/after gallery support.
12. Add customer photo permission/release tracking.
13. Add review request campaigns.
14. Add contractor review response drafting and publishing.
15. Add SEO technical foundation: sitemap, robots, canonical, schema, Open Graph.
16. Add service and city landing pages.
17. Add custom domains and DNS verification.
18. Add publish history, rollback, and draft/published diff.
19. Add stale website warning when inherited business facts change.
20. Add AI Marketing Advisor with evidence-based recommendations and human approval.

## Suggested Implementation Roadmap

### Phase 0: Source Of Truth

- Document canonical Company fields.
- Document Marketing override fields.
- Update UI copy to distinguish inherited facts from public overrides.
- Define stale published snapshot behavior.

### Phase 1: Marketing Workspace Structure

- Add Marketing Overview.
- Split sections into Website, Portfolio, Reviews, Leads, Branding/SEO.
- Keep existing routes and APIs stable.
- Preserve `/app/public-presence` redirect.

### Phase 2: Website Builder Hardening

- Add page-level editing polish.
- Add About and FAQ pages.
- Add publish history.
- Add stale content warnings.
- Add preview/share flow improvements.

### Phase 3: Portfolio And Reviews

- Link portfolio items to projects.
- Add before/after pairs.
- Add review request workflows.
- Add featured testimonials.
- Add Google Business Profile review link support.

### Phase 4: Attribution And Analytics

- Add campaign IDs and UTM metadata.
- Add QR campaign tracking.
- Add website/profile events.
- Add conversion funnel reporting.
- Attribute opportunities, estimates, agreements, and revenue to marketing source.

### Phase 5: SEO And Growth

- Add sitemap/robots/canonical/Open Graph/schema.
- Add service/city landing pages.
- Add custom domains.
- Add performance and accessibility checks.

### Phase 6: Marketing Advisor

- Add AI recommendations grounded in business facts, website content, reviews, portfolio, and lead performance.
- Require explicit approval for every content change.
- Never auto-publish or auto-send communications.

## Final Recommendation

Do not rebuild Marketing or Website Builder. The current system already has the right major pieces: public profile, website builder, gallery, reviews, QR, lead intake, opportunity handoff, and published website snapshots.

The next architectural step is to clarify ownership and sharpen the workspace:

- Company owns the facts.
- Marketing owns public presentation and growth.
- Website Builder consumes Company facts and Marketing assets.
- Public Profile remains the lightweight marketplace identity.
- Leads flow into Opportunities instead of becoming a parallel CRM.
- Insights consumes marketing performance rollups.
- Project Assistant advises, explains, drafts, and recommends, but never publishes or sends on its own.

This keeps MyHomeBro from becoming a tangle of duplicate profiles while giving contractors a clear, useful answer to the core Marketing question: “Is my business presence helping me win better work?”
