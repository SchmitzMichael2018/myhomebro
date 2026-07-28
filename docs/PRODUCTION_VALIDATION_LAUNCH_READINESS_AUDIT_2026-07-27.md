# MyHomeBro Production Validation and Launch Readiness Audit

Date: 2026-07-27  
Audited revision: `2226541` (`main`, matching `origin/main` at audit start)  
Classification: **NOT READY FOR STAGING**

## Executive decision

The repository has strong implementation-level evidence: the worktree was clean, recent
Capture and PWA phases were committed, Django model drift was absent, an empty disposable
SQLite database migrated through `projects.0273`, frontend unit tests passed, both PWA build
modes passed, and the focused Capture browser suite previously passed 17/17.

That evidence is not sufficient to deploy the current release candidate to a production-like
staging environment. The release is blocked by:

1. production frontend dependencies with 3 critical and 11 high findings;
2. repeated PDF task dispatch failures (`'NoneType' object has no attribute 'Redis'`) during
   backend workflows, without a verified production broker/worker/fallback health gate;
3. no PostgreSQL migration result, representative pre-phase snapshot migration, or restore
   drill;
4. no verified staging configuration, private artifact storage, email suppression, monitoring,
   or rollback drill;
5. no deployed authenticated, cross-tenant, payment/signature sandbox, or physical-device PWA
   evidence.

No production data was read or mutated. No production flag was enabled.

## Gate status

| Gate | Status | Evidence required to pass |
|---|---|---|
| Repository/release identity | PASS | Clean worktree; `main` and `origin/main` at `2226541` |
| Static/backend startup | PASS WITH WARNINGS | `check` passes; deploy check reports HSTS and frame-policy warnings |
| Dependency integrity | FAIL | Remediate and regression-test production high/critical advisories |
| Migration integrity | PARTIAL | Empty SQLite passes; PostgreSQL and pre-phase snapshot are blocked |
| Capture implementation | PARTIAL | Local suites exist; one audit invocation contained a nonexistent test label |
| Queue/PDF runtime | FAIL | Redis dispatch errors reproduced; no broker/worker/failure recovery proof |
| PWA artifact generation | PASS | On/off builds behave as designed |
| PWA deployed/device behavior | BLOCKED | HTTPS staging and physical devices required |
| Authentication/authorization | PARTIAL | Repository tests exist; deployed multi-role negative tests required |
| Storage/artifacts | BLOCKED | Production uses local filesystem storage by default; private delivery/backup unproved |
| Email/notifications | BLOCKED | Provider, suppression, bounce/retry, recipient and commit-boundary evidence required |
| Payments/signatures | BLOCKED | Sandbox webhooks, idempotency, reconciliation and signed artifact run required |
| Monitoring/backup/rollback | FAIL | No complete evidence of alerting, restore or rollback drills |

## Repository and worktree

- `main` matched `origin/main`; audit start was clean.
- Capture E.1/E.2, PWA Phase F and keyboard-workflow remediation are committed.
- Latest project migration is `0273_capture_routing_attempt.py` and is committed.
- The local developer database remained at `projects.0256`; it was not migrated.
- An isolated file-backed SQLite database migrated cleanly from empty through `0273`, and a
  repeated plan returned no operations. It was deleted after validation.
- `frontend/dist` is generated output and must remain deployment output, not release source.
- Local `.env` files are not tracked according to `git ls-files`; values were not printed.
- Historical savepoint tags exist, but no documented release-candidate tag convention or
  current launch tag was found. Use immutable `release/YYYY-MM-DD-N` tags after gates pass.
- The older mobile audit says PWA is absent; Phase F supersedes that statement. Cross-link or
  annotate the older audit to prevent stale operational guidance.

## Build and static validation

| Check | Result |
|---|---|
| `npm ci --ignore-scripts` | PASS; 880 packages installed |
| `npm run lint` | PASS with 512 warnings, zero errors |
| `npm run test:unit` | PASS; 32 files, 274 tests |
| PWA-disabled production build | PASS; 3,282 modules; no `sw.js` |
| PWA-enabled production build | PASS; 3,283 modules; 12-entry, 3.5 MiB precache |
| Source maps | PASS; disabled in production Vite config |
| Django `check` | PASS |
| Django `check --deploy` | NEEDS REFINEMENT; HSTS unset, `X_FRAME_OPTIONS` not explicitly `DENY` |
| Model drift | PASS; no changes detected |
| Collectstatic dry run | PASS |
| Backend PWA tests | PASS; 3 tests |
| Capture/Measurement/Takeoff backend regression | PASS; 44 tests |

Large production assets remain a performance risk: the PDF worker is about 2.19 MB, two landing
images are about 1.66 MB and 1.91 MB, CSS is about 418 KB, and several route chunks are
500–670 KB before compression. Performance budgets and representative mobile-network results
are required before general launch.

## Dependency risk

`npm audit --omit=dev` reports 17 production findings: 3 critical, 11 high and 3 moderate.
Affected runtime packages include `jspdf`, `axios`, React Router, `pdfjs-dist` transitive
dependencies, `lodash`, `form-data`, `brace-expansion`, `minimatch` and DOMPurify. The full
tree reports 36 findings. Do not use `npm audit fix --force` without a reviewed upgrade plan.
Patch direct dependencies first, regenerate the lockfile, inspect transitive paths, and rerun
document, upload, routing, authentication and full browser regressions.

## Migration readiness

Recent migrations are additive in shape: new Capture/measurement/takeoff/routing tables and
fields dominate; provenance foreign keys use `PROTECT` where history must survive. Risks:

- `0263` removes and recreates a homeowner uniqueness constraint and includes Python data work;
- `0271` adds a non-null default and then a unique constraint, requiring representative legacy
  data validation;
- new indexes/constraints may lock larger PostgreSQL tables;
- SQLite results do not establish PostgreSQL DDL duration or compatibility;
- no reverse/forward-recovery result exists for the recent chain;
- no old-application/new-schema rolling-deployment compatibility result exists.

Before staging, migrate a disposable PostgreSQL copy from (a) empty, and (b) a sanitized
pre-`0261` snapshot. Record duration, locks, row counts, constraint failures and application
startup. Back up before migration and prefer forward recovery for additive migrations.

## Database and integrity checks

Production engine, pooling and recovery guarantees were not available from local evidence.
Settings support `DATABASE_URL` with persistent connections (`conn_max_age=600`); the default
is SQLite. A production-like launch must use a documented database engine and capacity plan.

Run read-only integrity checks in staging for:

- Capture artifacts without Capture;
- applied Capture without application receipt;
- duplicate application idempotency keys;
- Measurement results without sessions;
- Takeoff items without measurement/material lineage;
- AmendmentRequest with missing project/agreement/source Capture;
- contractor/project/assignment ownership mismatches;
- missing actor provenance and stale open routing attempts.

Save query text, counts, reviewed exceptions and zero-result evidence. Do not auto-delete rows.

## Environment and secret contract

Required launch configuration includes:

- `SECRET_KEY`, `DATABASE_URL`, `ALLOWED_HOSTS`, `CSRF_TRUSTED_ORIGINS`,
  `CORS_ALLOWED_ORIGINS`, `FRONTEND_URL`, `SITE_URL`;
- HTTPS/proxy/cookie policy and explicit `DEBUG=false`;
- Postmark token/from/support identities and staging recipient suppression;
- private media storage credentials and backup destination;
- `REDIS_URL`/Celery broker/result backend plus worker and scheduler ownership;
- Stripe keys, webhook secret, account mode and callback URLs;
- AI provider key/model/timeout only when provider use is enabled;
- matched backend/frontend Capture flags and PWA build/runtime flags;
- immutable `VITE_APP_VERSION`, logging/error aggregation and release identity.

Secrets must come from the environment/secret manager, never Vite variables, manifests,
service-worker caches, logs, screenshots or repository files. Add a redacted startup
configuration validator that reports presence/mode, never secret values.

## Security posture

Positive repository settings: `DEBUG` defaults false; SSL redirect and secure cookies default
on outside debug; proxy SSL header is set; SameSite is `Lax`; referrer policy is
`strict-origin-when-cross-origin`; CORS/CSRF are allowlists; JWT expiry is configurable.

Open security gates:

- decide and test HSTS only after HTTPS/subdomain behavior is proven;
- set/document `X_FRAME_OPTIONS=DENY` unless a reviewed framing workflow requires otherwise;
- document/test CSP, Permissions Policy and production error pages;
- verify login/password-reset/API throttling and session-expiry behavior;
- verify body/file limits at proxy and Django layers;
- remediate high/critical runtime dependencies;
- perform negative cross-contractor and cross-role artifact/API tests in staging.

## Authoritative feature-flag matrix

All discovered new-feature backend defaults are off. Frontend flags are build-time and also
default off. A mismatch can hide UI while leaving an API enabled, or expose a dead action that
receives 404/400 from a disabled API.

| Capability | Backend | Frontend | Dependency / recommendation |
|---|---|---|---|
| Foundation | `CAPTURE_FOUNDATION_ENABLED` | `VITE_CAPTURE_FOUNDATION_ENABLED` | Root; pilot ON after staging |
| Inbox | `CAPTURE_INBOX_ENABLED` | `VITE_CAPTURE_INBOX_ENABLED` | Foundation; pilot ON |
| Review | `CAPTURE_REVIEW_ENABLED` | `VITE_CAPTURE_REVIEW_ENABLED` | Inbox; pilot ON |
| Application | `CAPTURE_APPLICATION_ENABLED` | `VITE_CAPTURE_APPLICATION_ENABLED` | Review; pilot ON |
| QR | `CAPTURE_QR_ENABLED`, `CAPTURE_QR_PUBLIC_ENABLED` | `VITE_CAPTURE_QR_ENABLED` | Inbox; optional, public flag separate |
| Project Capture | Foundation/application chain | Launcher type flags | Pilot ON after role checks |
| Equipment | `CAPTURE_EQUIPMENT_ENABLED` | `VITE_CAPTURE_EQUIPMENT_ENABLED` | Optional pilot |
| Warranty | `CAPTURE_WARRANTY_ENABLED` | `VITE_CAPTURE_WARRANTY_ENABLED` | Optional pilot |
| Measurement | `CAPTURE_MEASUREMENT_ENABLED` | `VITE_CAPTURE_MEASUREMENT_ENABLED` | Pilot ON; server calculations |
| Intelligent Takeoff | `TAKEOFF_ENABLED` | route availability | Measurement; pilot only after inventory verification |
| Estimate preview | `TAKEOFF_ESTIMATE_PREVIEW_ENABLED` | route availability | Takeoff; must not mutate Estimate |
| PDF measurement | `MEASUREMENT_PDF_ENABLED` | route availability | Optional pilot |
| Photo measurement | `MEASUREMENT_PHOTO_ASSISTED_ENABLED` | route availability | Optional pilot |
| Field Findings | `CAPTURE_FIELD_FINDINGS_ENABLED` | `VITE_CAPTURE_FIELD_FINDINGS_ENABLED` | Review; pilot ON |
| Change Intake | `CAPTURE_CHANGE_REQUEST_ENABLED` | `VITE_CAPTURE_CHANGE_REQUEST_ENABLED` | Application; pilot ON |
| Profile registry | `CAPTURE_PROFILE_REGISTRY_ENABLED` | no independent UI flag | Review; pilot ON |
| Conversational | `CAPTURE_CONVERSATIONAL_ENABLED` | `VITE_CAPTURE_CONVERSATIONAL_ENABLED` | Registry/review; deterministic pilot |
| Conversational provider | `CAPTURE_CONVERSATIONAL_PROVIDER_ENABLED` | none | OFF until provider validation |
| PWA shell | `PWA_ENABLED` | `VITE_PWA_ENABLED` | Both required; staged cohort |
| Install invitation | none | `VITE_PWA_INSTALL_PROMPT_ENABLED` | PWA; after meaningful use |
| Local drafts | none | `VITE_PWA_OFFLINE_DRAFTS_ENABLED` | PWA; staged after isolation/logout tests |
| Laser spike | isolated spike only | isolated spike | OFF; not production |
| Native LiDAR/AR | none | none | Not implemented; OFF |

Confirm exact Takeoff/measurement names from deployment configuration before enablement. Add a
single redacted capabilities endpoint/diagnostic that exposes effective booleans to authorized
operators and automated smoke tests.

## Recommended limited-pilot configuration

After all staging gates pass:

- ON: Foundation, Inbox, Review, Application, Project Capture, Manual Measurement, Intelligent
  Takeoff, Estimate preview, Field Findings, Change Intake, Profile Registry, deterministic
  Conversational Capture.
- CONDITIONAL: PWA shell for an explicit cohort; install prompt after meaningful use; local
  drafts only after account-isolation/logout testing.
- OPTIONAL LATER: PDF/photo measurement, QR, equipment and warranty Capture.
- OFF: conversational external provider, laser, LiDAR/AR, background sync, push, offline
  business mutations and deferred D.4 modules.

Enable backend and frontend flags as one versioned release manifest. Never toggle only one side.

## Roles, workflows and invariants

Automated tests cover many contractor, assigned-employee, customer and negative paths, but
deployed evidence is required for contractor owner, supervisor, assigned employee, office
staff, customer, property manager, tenant, subcontractor and public users.

For every role verify login/logout/expiry, direct URL, capability response, project and
contractor scope, artifacts and notification visibility. Use two contractors and attempt
cross-tenant IDs. Expected result is non-enumerating 403/404 and no metadata leakage.

Staging workflow scripts must cover Quick Lead, Measurement, Takeoff preview, Field Findings,
Change Intake, deterministic conversation, optional warranty/equipment, artifacts and existing
agreements/signatures/payments/invoices/milestones/disputes. Before/after snapshots must prove
Measurement, Takeoff preview, findings, intake, routing and PWA drafts do not alter agreement
scope/amount, milestones, payment schedule, dates, signatures, invoices, pricing, Estimate or
warranty decisions.

## Artifacts and storage

The default storage backend is local `FileSystemStorage` under `media/`. That is not evidence of
durable private multi-instance storage. Capture limits are configured (photo 10 MB, document
15 MB, project maximum 10 files), but production validation must prove signature/MIME checks,
decode limits, corrupt/password-protected PDF handling, EXIF/GPS policy, safe filenames,
private expiring delivery, cross-tenant denial, malware policy, archive/orphan behavior and
backup/restore. Service-worker runtime policy is NetworkOnly for `/api/` and `/media/`; verify
logout/browser cache behavior on deployed HTTPS.

## PWA readiness

Build behavior is correct and fail-closed: backend and frontend PWA flags are both required;
PWA-off has no service worker; PWA-on creates the manifest, offline shell and service worker.
The service worker does not runtime-cache APIs or media. Local draft unit tests pass.

Still blocked: HTTPS scope, installability, deep links, update waiting/activation, unsaved-work
protection, offline current-data messaging, draft restoration/reselection, logout cleanup,
account switching and disable-PWA rollback. Test Chrome/Edge desktop, Android Chrome and
installed PWA, iPhone Safari/A2HS, plus iPad/macOS Safari where supported. Record physical
device, OS/browser version, screenshots and DevTools application evidence.

## Email, notifications, queue and documents

Production email defaults to Postmark SMTP when debug is false. Provider credentials, sender
verification, suppression, bounces, retries, recipient boundaries and delivery failure
visibility are unverified. Staging must sink or allowlist recipients. Capture processing must
send no unintended external messages, and Change Intake creation must not imply contract change.

The repeated Redis error is a launch blocker for any workflow relying on queued PDF generation.
`core/celery_app.py` defaults to localhost Redis even when Django settings may have no broker,
creating configuration ambiguity. Add a release health check that verifies broker connection,
worker heartbeat, queue round trip, result/failure visibility and the explicitly intended
synchronous fallback. Validate agreement, amendment, invoice, estimate/proposal, signature and
warranty PDFs with real fonts/storage/download permissions and retry behavior.

## Payment and signature safety

No real charges were attempted. Before pilot, use Stripe test mode to verify webhook signatures,
idempotency, duplicate protection, failures, refunds, reconciliation and log redaction. Record
account mode. Verify signer/token identity, scope/expiry, duplicate prevention, immutable PDF
versioning, storage, state transitions and failure recovery. Live-mode keys and webhooks require
separate approval and a final redacted configuration check.

## Monitoring, performance, backups and rollback

No complete repository evidence establishes error aggregation, uptime/API/PWA checks, queue
depth/failures, webhook failures, database/storage capacity alerts, alert ownership or incident
response. Logging exists but needs structured release/actor/object-safe events and PII review.

`scripts/backup_db.sh` is SQLite-oriented. A staging/production database and media backup must
have documented encryption, retention, off-host copies, restore ownership, RPO/RTO and a timed
restore drill. Restore database and artifacts together and verify signed/versioned documents.

Rollback order:

1. disable new backend capability flags and deploy a frontend build with matching flags off;
2. disable PWA at Django, deploy PWA-off build, verify service-worker retirement/update path;
3. preserve additive schema and roll application forward where possible;
4. restore database/media only for proven data corruption, using approved backups;
5. verify login, agreement/signature/payment/PDF paths, queue and monitoring after rollback.

Do not reverse destructive/data migrations during an incident without rehearsal.

## Severity register

### P0 — blocks staging

- Production dependency graph contains critical/high vulnerabilities.
- Redis/PDF dispatch fails in local workflow output and has no runtime readiness gate.
- No production-like PostgreSQL migration/snapshot result.
- No staging secret/config inventory with private storage, safe email routing and monitoring.

### P1 — blocks authenticated pilot

- Multi-role deployed positive/negative permission matrix incomplete.
- Critical workflows and contractual/financial invariants not run on staging.
- Artifact security, PDFs, Stripe test webhooks and signature lifecycle unverified.
- Backup restore and rollback drills incomplete.
- PWA HTTPS/update/logout/account-isolation and physical-device matrix incomplete.

### P2 — blocks general launch

- Performance budgets/load results and large-asset remediation incomplete.
- HSTS/frame/CSP/Permissions Policy decisions incomplete.
- Operational alert ownership, support runbooks and browser support policy incomplete.
- Email bounce/retry and notification dedupe evidence incomplete.

### P3 — post-pilot refinement

- Reduce 512 lint warnings and stale Browserslist data.
- Consolidate feature capability diagnostics and documentation cross-links.
- Expand optional PDF/photo/QR/warranty pilot coverage.

## Ordered remediation plan

1. Create an immutable release candidate branch/tag and versioned environment manifest.
2. Upgrade vulnerable production dependencies in reviewed batches; rerun unit, document,
   routing, upload and browser suites; require zero unaccepted critical/high findings.
3. Align Celery/Django Redis configuration and implement a redacted queue/PDF readiness check.
4. Provision production-like staging: PostgreSQL, private durable media, Redis/worker, email
   sink, error aggregation and backups.
5. Migrate empty and sanitized pre-`0261` PostgreSQL databases; capture timing/locks/integrity.
6. Restore a backup into an isolated environment and verify database/media consistency.
7. Deploy with all new flags off; validate security headers, static/media paths and smoke tests.
8. Run multi-role and cross-tenant negative tests with approved staging accounts.
9. Enable the Capture chain in dependency order using deterministic routing; run critical
   workflows and before/after invariant checks.
10. Validate PDFs, notification boundaries, Stripe sandbox and signatures.
11. Enable PWA for a cohort; execute HTTPS/browser/physical-device/update/logout tests.
12. Run performance/load/accessibility/responsive checks and a flag/PWA/application rollback.
13. Review evidence at the staging gate, then admit 3–5 pilot contractors with daily support.

## Go/no-go criteria

- **Staging:** NO-GO now. Pass P0 items first.
- **Authenticated pilot:** NO-GO. Requires staging deployment, migrations, roles, invariants,
  artifacts, queue/PDF, sandbox integrations, backup and rollback evidence.
- **General launch:** NO-GO. Requires a successful limited pilot, device/browser support,
  monitoring ownership, support documentation, performance acceptance and no unresolved
  critical incidents.

Pilot success criteria: 3–5 approved contractors, deterministic/new-feature flags only, no
cross-tenant event, no financial/contract mutation outside owning workflows, no data loss,
successful PDF/notification processing, documented support response, daily metrics and a
minimum agreed observation period before expansion.

## Exact blocked validation work

| Work | Requirement | Evidence |
|---|---|---|
| PostgreSQL migrations | Disposable DB plus sanitized snapshot | logs, duration, lock/query report |
| Deployed auth/roles | approved staging accounts for all roles | Playwright report/traces and denied-access matrix |
| Storage | private staging bucket/filesystem and two tenants | access logs, expired links, backup/restore proof |
| Queue/PDF | Redis, worker and operator access | heartbeat, round trip, generated/downloaded PDFs |
| Email | staging sender/sink | provider delivery/bounce/retry logs |
| Payments/signatures | Stripe sandbox and test signers | verified webhooks, receipts, immutable documents |
| PWA devices | HTTPS staging and physical devices | install/update/offline/logout evidence |
| Monitoring | deployed telemetry and on-call owner | alert test and incident acknowledgement |
| Backup/rollback | isolated restore target and release artifact | timed drill report and post-rollback smoke |

## Commands and local evidence

Commands executed include:

```text
git status --short
git branch --show-current
git log -8 --oneline --decorate
git ls-files …
npm ci --ignore-scripts
npm audit --omit=dev --audit-level=high
npm run lint
npm run test:unit
npx cross-env VITE_PWA_ENABLED=false npm run build
npx cross-env VITE_PWA_ENABLED=true VITE_APP_VERSION=launch-audit npm run build
python manage.py check
python manage.py check --deploy
python manage.py makemigrations --check --dry-run
python manage.py migrate --plan
python manage.py collectstatic --noinput --dry-run
python manage.py test core.tests_pwa --verbosity 1 --keepdb
python manage.py migrate --noinput  (disposable file-backed SQLite database)
```

One initial combined Capture invocation was invalid because
`projects.tests_capture_takeoff` does not exist and is not counted as suite evidence. The
corrected command used `projects.tests_takeoff_api` and
`projects.tests_takeoff_calculations`; all 44 Capture/Measurement/Takeoff tests passed. The
passing run continued to emit Redis/PDF dispatch errors, so test success does not clear that
runtime-readiness blocker.

## Final launch checklist

- [ ] release commit/tag and environment manifest approved
- [ ] zero unaccepted critical/high production dependency findings
- [ ] production-like PostgreSQL migrations and integrity queries pass
- [ ] Redis/worker/PDF health gate and recovery pass
- [ ] private media, email suppression, monitoring and backups configured
- [ ] deployed role/cross-tenant tests pass
- [ ] critical workflows and invariants pass
- [ ] sandbox payment/signature/document flows pass
- [ ] HTTPS PWA and physical devices pass
- [ ] performance/accessibility/browser support accepted
- [ ] backup restore and rollback drills pass
- [ ] pilot owners, cohort, metrics, support and stop criteria approved

Recommended follow-up task: remediate production dependency vulnerabilities and implement the
Redis/Celery/PDF release-readiness check before provisioning staging.
