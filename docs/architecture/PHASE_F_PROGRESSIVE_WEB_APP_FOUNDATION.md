# Phase F — Progressive Web App Foundation

## Status and boundary

Phase F makes the authenticated contractor console installable and resilient to
an interrupted connection. It does not make MyHomeBro an offline system. Server
records, authentication, pricing, payments, agreements, signatures, PDFs, and
all mutations remain network-authoritative.

The rollout is fail-closed. Both `PWA_ENABLED=true` (Django) and
`VITE_PWA_ENABLED=true` (build time) are required. The install invitation and
local draft integrations have separate build-time flags:

- `VITE_PWA_INSTALL_PROMPT_ENABLED=true`
- `VITE_PWA_OFFLINE_DRAFTS_ENABLED=true`
- `VITE_APP_VERSION=<release identifier>` for cache names and diagnostics

With the foundation flag off, the backend returns 404 for the root PWA assets
and the client unregisters MyHomeBro workers and deletes only MyHomeBro caches.

## Architecture

The production Vite build generates `/sw.js` with Workbox. Django serves that
file at the origin root with `Service-Worker-Allowed: /`; this is necessary
because the SPA lives below `/app` while hashed bundles live below `/static`.
The manifest and generic offline shell are also served at the root.

Only versioned JS, CSS, fonts, public icons, the manifest, and the offline shell
are precached. `/api`, `/media`, `/admin`, and `/static` navigations are excluded
from navigation fallback. API and media requests are explicitly `NetworkOnly`.
There is no cache-first private data path and no background mutation queue.

New workers wait. The UI announces an available update and will not offer an
immediate activation on critical workflow routes or while a form declares
unsaved work. Users can defer the update.

## Authentication and privacy

The worker does not read or store tokens. Responses containing contractor,
customer, agreement, project, pricing, payment, signature, document, or upload
data are not runtime-cached. Logout and token-expiry cleanup clear all local PWA
drafts; draft records are also keyed by both user and contractor identity.

Approved draft persistence is deliberately narrow:

- conversational capture text and its selected public context identifiers;
- manual measurement form values;
- generic file type/size references that always require reselection.

Drafts use IndexedDB schema `pwa-draft.v1`, expire after 30 days, are limited to
20 per identity, and enforce bounded text/value sizes. A local draft is not a
server record and is never submitted automatically after reconnect. Restoration
requires an explicit user choice. Successful submission or cancellation deletes
the matching local draft. No file bytes or filenames are stored.

## User experience

Authenticated users receive restrained connectivity, update, installation, and
recovery UI. Chromium install uses the browser install event. iOS Safari shows
Share → Add to Home Screen guidance. Dismissal is remembered for 14 days.
Standalone mode applies safe-area insets and dynamic viewport sizing. The
offline page plainly states that current private data is unavailable and that
attachments may need reselection.

Manifest shortcuts open Capture and Capture Inbox only. They do not create,
approve, sign, charge, submit, or otherwise mutate records.

## Security and browser policy

The HTML CSP permits same-origin workers and manifests. HTTPS remains required
outside local development. Current support is the actively supported Chromium,
Safari/iOS Safari, and Firefox versions; installation UI varies by browser.
Private/incognito storage, OS eviction, managed-device policy, and low-storage
conditions can make draft storage unavailable. The browser experience remains
the fallback.

Push notifications, background sync, offline API writes, private response
caching, silent conflict resolution, native wrappers, camera/background capture,
and guaranteed offline storage are explicitly deferred.

## Operator runbook

1. Set a unique `VITE_APP_VERSION` and enable the desired build flags.
2. Build the frontend, then run the normal deployment script so root PWA files
   and public assets are published.
3. Set `PWA_ENABLED=true` in the Django environment and reload the application.
4. Verify `/manifest.webmanifest`, `/offline.html`, and `/sw.js` return 200 over
   HTTPS. Confirm `/sw.js` includes `Service-Worker-Allowed: /` and
   `Cache-Control: no-store`.
5. In browser developer tools, confirm the worker scope is `/`, API responses do
   not appear in Cache Storage, and a new release waits for user activation.
6. Validate install, update deferral, offline fallback, logout cleanup, and draft
   restore/discard with a safe test account.

Rollback is safe in either order:

1. Set `PWA_ENABLED=false` and reload Django.
2. Build/deploy with `VITE_PWA_ENABLED=false`.

On the next authenticated browser load the disabled client unregisters prior
MyHomeBro workers and removes caches whose keys begin with `myhomebro-`. If a
browser cannot load that cleanup release, operators may direct the user to the
site-data controls exposed by their browser; the ordinary web application
continues to work without the worker.

## Validation checklist

- Run `python manage.py test core.tests_pwa`.
- Run `python manage.py check`.
- Run `npm run test:unit`.
- Build once with PWA flags disabled and once enabled.
- Inspect the enabled worker precache manifest and Cache Storage.
- Run targeted authenticated Playwright checks on the deployed HTTPS site.
- Run `bash -n` on deployment scripts and `git diff --check`.

