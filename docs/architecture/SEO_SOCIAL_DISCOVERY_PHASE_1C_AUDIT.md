# SEO and Social Discovery Phase 1C Audit

## Pre-implementation audit

### Working

- The homepage had one clear H1, a useful H2/H3 hierarchy, descriptive CTA text, accessible logo text, and visible home-project positioning.
- The public FAQ had a specific title, useful description, visible matching FAQ content, and matching `FAQPage` JSON-LD.
- Phase 1B already recorded public landing, FAQ/guide, signup, and contractor-profile intent without blocking navigation.
- Django served the production SPA shell, canonical legal HTML existed, and official logo/favicon/PWA assets existed.

### Partial

- PWA metadata described only contractor operations.
- FAQ changed its title and description in the browser, but duplicated metadata mutation and restored the obsolete site title on unmount.
- Legal documents had HTML titles, but no canonical, description, robots, or Open Graph metadata.
- The homepage semantic structure was sound, but one contractor marketing bullet still advertised "escrow" as the product claim.

### Missing

- Default description, canonical, Open Graph, Twitter/X, robots directives, homepage structured data, `robots.txt`, and an XML sitemap.
- Explicit noindex behavior for private, authenticated, tokenized, transactional, and operational routes.
- Search Console verification configuration and Phase 1D sitemap extension point.
- A dedicated approved 1200×630 social-sharing image.

### Duplicated

- The old title appeared in the Vite shell and both Django SPA templates.
- FAQ owned metadata through page-specific DOM calls rather than a public-route metadata service.

### Unsafe or ambiguous

- Every SPA route inherited the same old title, and private/token routes had no explicit noindex directive.
- "Secure escrow payments" and "Get paid securely with escrow" could imply that MyHomeBro provides licensed escrow rather than milestone funding/payment controls processed through Stripe.
- Phase 1B collection was broader than the privacy policy's attribution-specific explanation.

## Implemented architecture

- `frontend/src/lib/seoMetadata.js` is the declarative client-side metadata authority. It updates title, description, canonical, Open Graph, Twitter/X, robots, and route structured data. Unknown/private routes fail closed to `noindex, nofollow`.
- `backend/core/seo.py` supplies equivalent request-time shell metadata so crawlers receive useful metadata before React runs. It also provides an optional `GOOGLE_SITE_VERIFICATION` setting without committing a token.
- Production canonical origin is `https://www.myhomebro.com`; root keeps `/`, while other canonical paths omit a trailing slash unless an existing server-owned legal route requires it.
- `robots.txt` allows public discovery, explicitly leaves `/improvements/` available, blocks operational/private families, and points to `https://www.myhomebro.com/sitemap.xml`.
- The sitemap includes only the homepage, FAQ, Terms, and Privacy. Phase 1D can append database-backed library categories, templates, and guides with authoritative timestamps in `sitemap_xml`; Phase 1C invents no timestamps.
- Homepage JSON-LD contains only truthful `Organization` and `WebSite` fields. FAQ retains its visible-content-derived `FAQPage` payload.
- Public route attribution remains in `PublicAttributionObserver`; the adjacent SEO observer does not change its location, UTM, referrer, visitor, or event behavior.

## Index policy

- Index: homepage, FAQ, Terms, Privacy. Future `/improvements/` content is crawler-allowed but is not yet published or included in the sitemap.
- Noindex by default: login, registration, account setup, authenticated application routes, portals, token links, payment outcomes, internal/admin/API routes, and any unclassified SPA route.
- Dynamic contractor profiles/websites need a Phase 1D-quality publication/indexability decision plus server-rendered record metadata before sitemap inclusion.

## Social asset status

Phase 1D supplied and validated the approved navy/blue/gold image at `/static/social/myhomebro-default-1200x630.png`. The supplied file was proportionally resized from 1730×909 to the required 1200×630 without redesigning its approved composition. It is present in both the Vite public tree and Django static source, and is now the default Open Graph/Twitter image. Page-specific approved `/static/social/*.png` overrides are supported.

## Search and social validation after deployment

1. Verify the canonical domain in Google Search Console (DNS verification preferred), or set `GOOGLE_SITE_VERIFICATION` to the supplied HTML-tag token.
2. Confirm `https://www.myhomebro.com/robots.txt` and `https://www.myhomebro.com/sitemap.xml`, then submit the sitemap URL in Search Console and Bing Webmaster Tools.
3. Inspect final production HTML and use Facebook Sharing Debugger plus a normal messaging/social share. Refresh cached previews after the approved 1200×630 asset ships.
4. Validate structured data with a standards-compatible JSON-LD parser or search-engine rich-results tooling. Do not add ratings, locations, profiles, or FAQ markup that visible content does not support.

## Phase 1D dependencies

- Approved default and optional page-specific 1200×630 social images.
- Public Improvement Library route/data model, publication state, canonical slugs, authoritative update timestamps, breadcrumbs, and internal links.
- Dynamic sitemap providers and page-specific server metadata for published categories, templates, guides, contractor profiles, and contractor websites.
