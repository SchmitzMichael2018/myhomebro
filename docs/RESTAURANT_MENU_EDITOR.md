# Restaurant menu editor

Save a website project with business type **Restaurant**, then open **Manage menu** in the website customer dashboard. Add, edit, reorder, and remove dishes; set category, description, USD price, vegetarian label, availability, and an optional food photo. JPG/PNG/WebP uploads up to 5 MB are decoded, resized to 1280px, stripped of metadata through JPEG re-encoding, and stored outside public media/static directories.

**Save menu draft** persists changes privately. **Publish menu** explicitly makes the saved dishes and their selected photos public. Unsaved edits must be saved first. Unavailable dishes are omitted. Publishing an empty list removes all public dishes. **Take menu offline** keeps the draft while making the public feed and its photos unavailable. Edits in another window produce a conflict response rather than silently replacing newer work. Save/publication events retain actor, revision and timestamp.

Photos can be read privately by their project owner. The public photo endpoint only serves re-encoded images referenced by the current published, available dishes; draft and unrelated photos return 404. The generic website-project API cannot set menu state. Private website briefs and uploaded general materials are never included in the public menu. Only intentionally published menu endpoints allow anonymous cross-origin reads; authenticated writes remain owner-scoped.

## Connect a standalone restaurant website

Copy the **Public menu feed address** under **Website connection details**. It is a public URL, not an account credential.

`node scripts/create-customer-website.mjs restaurant-food example-kitchen --menu-feed-url https://www.myhomebro.com/api/projects/public/restaurant-menus/REPLACE-WITH-PROJECT-UUID/`

The URL must be the actual project address from the dashboard. The exporter validates the canonical MyHomeBro HTTPS origin and menu path; contractor exports cannot attach a restaurant feed. For an existing export using the updated runtime, set `window.websiteConfig.menuFeedUrl` to this address in `site.config.js`. Redeploy the runtime/CSS once to connect it. All three restaurant layouts support the same feed and item photos, category/search filters and vegetarian filter.

The site fetches the published menu without account credentials. New visits and refreshes see updates; no website rebuild is needed for subsequent menu changes. Menu drafts are not fetched. A missing/unpublished/unreachable feed shows a menu-unavailable message and never falls back to sample prices. Existing sites require this one-time connection; publishing a dashboard menu alone does not alter an unconnected site.

## Release and QA

Migration 0334 adds restaurant menu document fields, private photo records and publication events. Existing projects get distinct public UUIDs through a data backfill before the unique constraint is applied. Back up the database and private_website_materials directory before deployment. Retain new tables/files on application rollback once customers have menu data.

Run `python scripts/check-website-dashboard.py --keepdb` in an isolated checkout/virtualenv. The runner uses offline providers and a separate synthetic test database under the OS user's cache; it never selects the production database. `--keepdb` retains only this QA database to avoid repeating historical migration setup on retries.

Run `node --test scripts/website-templates.test.mjs scripts/restaurant-menu-runtime.test.mjs`, then build the frontend. Validate restaurant/contractor project visibility, add/edit/remove/reorder, save/reload, upload/replace/remove photo, unavailable dishes, draft/public separation, explicit publication/offline actions, conflict recovery, responsive form labels, and the exported site connection. Use synthetic isolated fixtures for mutations; production browser checks must be read-only unless separately authorized.

Initial limits: 150 dishes per menu, 200 uploaded menu photos per project, USD prices only. Ingredient/allergen information remains restaurant-supplied; this editor does not provide checkout, ordering, or inventory management. Old unreferenced photos remain private; automatic cleanup and additional currencies can be added later.
