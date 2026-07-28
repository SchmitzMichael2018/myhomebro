# Frontend Dependency Remediation — July 2026

Date: 2026-07-27  
Scope: `frontend/` production dependency security remediation

## Outcome

The production critical/high launch blocker is resolved. The production audit moved
from 17 findings (3 critical, 11 high, 3 moderate) to 2 moderate findings and no
critical or high findings:

```text
npm audit --omit=dev --audit-level=high
0 critical, 0 high, 2 moderate; exit 0
```

No audit suppression, forced audit fix, package override, framework migration,
backend behavior change, or deployment was performed.

## Baseline and remediation inventory

The baseline was captured with `npm audit --omit=dev --json`, `npm audit --json`,
`npm ls --all`, `npm outdated`, and targeted `npm explain` commands before changes.
The package-level inventory below consolidates advisories that share a dependency
path.

| Severity | Vulnerable package/path | Baseline installed | Resolution | Runtime reachability and feature | Risk |
| --- | --- | --- | --- | --- | --- |
| Critical/high | `axios` → `form-data`, `follow-redirects` | `axios@1.12.2`, `form-data@4.0.4`, `follow-redirects@1.15.11` | Direct dependency pinned to `axios@1.18.1`; resolved transitives are `form-data@4.0.6` and `follow-redirects@1.16.0` | Reachable through the shared API client, authentication, uploads, Capture, and customer portal requests | Low-to-medium; compatible Axios 1.x update |
| Critical/high | `jspdf` → DOMPurify and related browser dependencies | `jspdf@3.0.2`, DOMPurify `3.2.6` | Removed `jspdf` and `jspdf-autotable` | No source import, dynamic import, call site, or implemented export path exists. The only non-manifest reference was the Vite chunk matcher. Active PDF.js functionality is separate. | Low; obsolete direct dependencies removed |
| Critical/high | `pdfjs-dist` → `canvas` → `@mapbox/node-pre-gyp` → `tar` and utility packages | `pdfjs-dist@4.4.168`, `canvas@2.11.2`, `tar@6.2.1` | Pinned `pdfjs-dist@4.10.38`; the old native-canvas path is gone and optional canvas support resolves through `@napi-rs/canvas@0.1.100` | Reachable in Blueprint/PDF Takeoff through `PlanMeasurementWorkspacePage` and the bundled PDF worker | Medium; bounded PDF.js 4.x update |
| High | `react-router-dom` → `react-router` → `@remix-run/router` | `6.30.1` / `6.30.1` / `1.23.0` | Pinned `react-router-dom@6.30.4`; resolved `react-router@6.30.4` and `@remix-run/router@1.23.3` | Reachable across all browser routing, protected pages, deep links, and PWA navigation | Low-to-medium; React Router 6 patch update |
| High | `recharts` → `lodash` | `lodash@4.17.21` | Normal lockfile resolution updated to `lodash@4.18.1` | Reachable in chart/data transformation code | Low; transitive resolution only |
| High/moderate | `react-markdown` → `mdast-util-to-hast` | `mdast-util-to-hast@13.2.0` | Normal lockfile resolution updated to `13.2.1` | Reachable in the legal Markdown renderer | Low; transitive patch resolution |
| High | `brace-expansion`, `minimatch`, and related paths | Multiple paths inspected with `npm explain` | Vulnerable production paths were removed with the PDF/native-canvas chain; remaining paths are development tooling | Not shipped as an application runtime dependency in the production audit | Low for production; development backlog remains |

## Direct dependency changes

- `axios`: `^1.9.0` (resolved `1.12.2`) → exact `1.18.1`.
- `pdfjs-dist`: `^4.4.168` → exact `4.10.38`.
- `react-router-dom`: `^6.11.2` (resolved `6.30.1`) → exact `6.30.4`.
- Removed `jspdf` and `jspdf-autotable` after the package-removal audit found no
  runtime import, dynamic import, or implemented behavior.

Exact pins keep this security change reproducible and prevent an unreviewed future
minor release from entering a production install.

## Transitive dependency changes

- `@remix-run/router`: `1.23.0` → `1.23.3`.
- `follow-redirects`: `1.15.11` → `1.16.0`.
- `form-data`: `4.0.4` → `4.0.6`.
- `lodash`: `4.17.21` → `4.18.1`.
- `mdast-util-to-hast`: `13.2.0` → `13.2.1`.
- The `canvas` / `@mapbox/node-pre-gyp` / vulnerable `tar` subtree was removed.
- The jsPDF DOMPurify subtree was removed with its unused direct parent.

No `overrides` or `resolutions` were added.

## Compatibility review

Axios remains on the 1.x line. Existing shared interceptors, authentication headers,
CSRF configuration, timeout/error handling, FormData upload behavior, and base URL
configuration were inspected and exercised by unit and browser workflows.

React Router remains on the 6.x line. Route architecture and route definitions were
not changed. Moving to the fully fixed Router 7 line would be a separate major
migration and was intentionally excluded from this bounded production-critical/high
remediation.

PDF.js remains on the 4.x line. The existing worker import
`pdfjs-dist/build/pdf.worker.mjs?url` compiles and emits a hashed worker asset.
Measurement Session, Photo Measurement, Takeoff Session, and Plan Measurement route
chunks are present in the production build.

## Regression evidence

### Dependency and quality checks

| Check | Result |
| --- | --- |
| Clean `npm ci` | PASS; process completed and the installed tree validated |
| `npm ls --all` | PASS; exit 0, no invalid/extraneous/unmet tree |
| ESLint | PASS; 0 errors (existing warnings remain) |
| Unit tests | PASS; 32 files, 274 tests |
| Production build | PASS; 3,283 modules transformed |
| PWA-disabled build | PASS |
| PWA-enabled build | PASS; 12 precache entries |

### PDF/document and PWA checks

- The production build emits `pdf.worker-*.mjs` (approximately 2.21 MB) and the
  `documents-*.js` PDF.js chunk.
- Measurement, photo-measurement, takeoff, and plan-measurement chunks compile.
- PWA-on inspection confirmed the manifest, service worker, offline fallback, and
  precache output.
- Service-worker inspection confirmed `/api/` and `/media/` remain `NetworkOnly`;
  private responses are not precached or runtime-cached.
- Frontend PDF worker/bundle compatibility passed. Backend queued PDF generation
  remains a separate Redis/runtime launch-readiness concern and is not changed by
  this remediation.

### Focused browser checks

- Capture launcher/review/application and file upload: 17 applicable tests passed
  in the combined critical-route run.
- Customer portal reachability, returning login, and mobile document upload:
  3 tests passed.
- Agreement workspace and AI-access navigation passed on retry after local
  web-server startup contention.
- One existing public-sign workflow test remains stale: it expects three consent
  checkboxes, while the current signature dialog has one consent checkbox plus
  required PDF review and signature input. The failure occurs before any Axios,
  Router, or PDF.js behavior under test and was not changed as part of dependency
  remediation.

## Final audits

### Production dependencies

```text
critical: 0
high:     0
moderate: 2
low:      0
total:    2
```

`npm audit --omit=dev --audit-level=high` exits 0.

### Full dependency tree

```text
critical: 2
high:     12
moderate: 9
low:      1
total:    24
```

The remaining full-tree critical/high findings are in development/build/test
tooling paths (including Babel/eslint tooling and utilities such as minimatch,
glob, postcss/rollup-related tooling, serialization, YAML, and tar paths). They do
not appear in `npm audit --omit=dev`. They remain visible follow-up work and are
not represented as production-remediated findings.

## Time-bounded production exceptions

The two audit package findings represent three moderate React Router advisories.
The compatible React Router 6 line has no complete fix; npm identifies React Router
7.18.x as the fixed major line.

| Advisory | Dependency path | Reachability | Compensating controls | Owner | Expiry / follow-up |
| --- | --- | --- | --- | --- | --- |
| [GHSA-wrjc-x8rr-h8h6](https://github.com/advisories/GHSA-wrjc-x8rr-h8h6), open redirect via backslash in `Link`/`useNavigate` | `react-router-dom@6.30.4` → `react-router@6.30.4` | Browser navigation is reachable; untrusted backslash-prefixed route destinations were not found in the inspected application routing | Application navigation uses known internal routes; authentication and deep-link workflows are regression-tested | Frontend Platform / Release Owner | 2026-09-30; evaluate and test React Router 7 migration |
| [GHSA-jjmj-jmhj-qwj2](https://github.com/advisories/GHSA-jjmj-jmhj-qwj2), open redirect leading to XSS | `react-router-dom@6.30.4` | Same browser routing surface; no repository call site intentionally navigates to an untrusted external destination | Known internal route construction and protected-route checks | Frontend Platform / Release Owner | 2026-09-30; include in Router 7 migration |
| [GHSA-337j-9hxr-rhxg](https://github.com/advisories/GHSA-337j-9hxr-rhxg), constructor injection in SSR hydration error deserialization | `react-router-dom@6.30.4` → `react-router@6.30.4` | Not reachable: MyHomeBro uses a Vite client-rendered `BrowserRouter`, not React Router SSR hydration/error deserialization | No server router hydration payload is consumed | Frontend Platform / Release Owner | 2026-09-30; remove exception with Router 7 migration |

These are moderate findings, not accepted critical/high production risk. The
acceptance must be revisited before the expiry date or sooner if route destinations
begin accepting unsanitized external input.

## Remaining work

1. Plan and execute a separately reviewed React Router 7 migration before
   2026-09-30.
2. Remediate the development-tool audit findings in bounded Babel, lint/test, and
   build-tool batches without forcing framework upgrades.
3. Update the stale public-sign Playwright workflow to follow the current required
   PDF-review and signature interaction.
4. Complete authenticated production smoke validation after deployment; this task
   did not deploy or access production data.

