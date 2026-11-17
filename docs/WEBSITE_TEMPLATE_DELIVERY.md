# Website gallery and customer delivery

The six demos are portable static website templates. They do not change the existing MyHomeBro contractor website builder, publish a real contractor, or connect a real referral code.

## Designs

| Template ID | Audience | Structure |
| --- | --- | --- |
| contractor-showcase | Contractors | Split hero, services, photo gallery |
| contractor-local | Contractors | Service-first hero, quick request panel, service list |
| contractor-premium | Contractors | Editorial headline, panoramic image, staggered gallery |
| restaurant-food | Restaurants | Food image first, featured dishes, full menu |
| restaurant-local | Restaurants | Practical navigation panel, menu highlights, visible hours |
| restaurant-dining | Restaurants | Full-width atmosphere image, story, visit planning |

Gallery selections and demo return links carry the template ID into the existing contact-last inquiry. Selection is included in the reviewed email brief. Demo business names, imagery, dishes, prices, hours, and addresses are illustrative.

## Repeatable delivery process

1. Confirm the selected template, scope, content responsibilities, price, and recurring services.
2. From the repository root, run:

   `node scripts/create-customer-website.mjs contractor-showcase bright-contracting`

3. The independent copy appears in `customer-sites/bright-contracting`. It contains index.html, site.config.js, site.js, styles.css, and a handoff README. The command refuses existing destinations.
4. Edit the final `window.websiteConfig` object in site.config.js. Replace all example business details, services/menu, photos, descriptions, contact information, hours, and optional URLs. Replace example imagery with customer-owned or appropriately licensed images; local assets are preferred for production.
5. Configure contractor MyHomeBro projectUrl, referralUrl, and optional qrImage using the actual contractor's issued URLs. Leave them empty when not applicable. The template does not calculate or issue rewards. For restaurants configure orderingUrl, reservationUrl, and mapUrl if services exist; no ordering/reservation service is fabricated.
6. Keep demo true while reviewing. Demo forms generate a local brief only and make no network submission or browser storage writes. Use fictional test details.
7. For launch, set demo false only after approval. Set a valid business email for the reviewed mailto inquiry. This is not server-backed form delivery. Use a separately implemented submission service if automatic delivery is part of the contracted scope.
8. Update the HTML title, description, and robots policy for the real business. Review privacy/legal content, images, accessibility, and all links. These starter sites navigate by hash routes; advanced multi-page search optimization requires additional work.
9. Put the exported folder contents into a separate customer GitHub repository. Deploy that folder as a static site, with no build command. Connect the customer's domain and verify HTTPS and existing business email DNS records. Hosting on MyHomeBro can be scoped separately; exporting does not change MyHomeBro URL routing.
10. Test navigation, menu search/vegetarian filter, gallery categories, mobile menu, forms, and email brief; obtain customer sign-off. Document account ownership and optional maintenance.

## Source and hosting

- Gallery: frontend/src/pages/WebDesignPage.jsx and WebDesignGallery.css.
- Catalog: frontend/src/lib/websiteTemplates.js.
- Portable runtime: frontend/public/webdesign-templates/site.js and styles.css.
- Business data: frontend/public/webdesign-templates/configs/*.js.
- MyHomeBro demo URL: /static/webdesign-templates/demo.html?template=contractor-showcase.
- Demos are noindex. Real customer exports remain noindex until launch review.

## Checks

- `node --test scripts/website-templates.test.mjs`
- `npm run build` from frontend, with normal project dependencies.
- Production browser checks: six demo links, category filter, selection handoff, every page, photo loading, menu filters, gallery filters, demo form behavior, and narrow-screen navigation.
