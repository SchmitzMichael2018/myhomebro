# Production Database Runbook

## Operator checklist

### Preflight

- Identify immutable application revision and approved maintenance window.
- Confirm the current engine with sanitized startup output.
- Confirm no pending migrations: `python manage.py migrate --check`.
- Run `check_database_integrity`; require zero blocking findings.
- Confirm encrypted off-host database and media destinations.
- Confirm PostgreSQL target, restore target, TLS, capacity, monitoring, and
  least-privilege credentials.
- Complete a representative staging migration and separate restore drill.

**Go/no-go:** no go for integrity failures, missing media, incomplete restore
evidence, unreviewed transformations, count mismatches, or unstable target.

### Cutover

1. Announce and enter a maintenance/read-only window. Stop web workers,
   schedulers, workers, and every writer after in-flight work drains.
2. Create the final online SQLite backup and matching media backup.
3. Verify checksums and integrity; copy both off host.
4. Export the final copied snapshot, not the live file.
5. Migrate a clean PostgreSQL schema and import.
6. Reset sequences and generate source/destination reconciliation.
7. Require exact counts or an approved exception report.
8. Switch `DATABASE_ENGINE=postgresql` and `DATABASE_URL` only after approval.
9. Run migrations/checks, then reload web workers.
10. Smoke test authentication, dashboard, customers, opportunities, proposals,
    agreements/signatures/PDFs, invoices/receipts, safe payment-record reads,
    messaging polling, Capture, projects/milestones, disputes, measurements,
    takeoffs, warranties, admin, PWA routes, and media references.
11. Reopen writes gradually and monitor connection errors, latency, constraint
    failures, authentication, PDFs, file access, and write throughput.

Do not send messages, charge/refund money, or contact customers during smoke
testing.

### Rollback triggers

- Any unexplained row-count or checksum mismatch
- Migration/import/sequence failure
- Broken authentication or authorization
- Agreement, signature, invoice, receipt, or PDF failure
- Missing media references
- Severe query/performance regression
- PostgreSQL connection instability

### Rollback before writes reopen

1. Keep all writers stopped.
2. Save PostgreSQL failure evidence and reconciliation reports.
3. Restore the prior SQLite configuration and exact final SQLite/media
   recovery point.
4. Reload the web application.
5. Run SQLite integrity, migration-state, authentication, file, agreement,
   invoice, and PDF checks.
6. Reopen only after the rollback go/no-go owner approves.

### Rollback after PostgreSQL writes

Rollback becomes materially harder after new PostgreSQL writes are accepted.
Do not simply switch back to the old SQLite file: that loses accepted writes.
Stop writes, preserve both databases, inventory the delta, and choose an
approved forward fix or a reviewed reverse-delta migration. Contractual and
financial records require explicit reconciliation and audit preservation.

## Exact recurring backup commands

SQLite:

```bash
cd ~/backend/backend
python manage.py backup_sqlite_database --output-dir /secure/backups/sqlite
python manage.py check_database_integrity
```

PostgreSQL:

```bash
pg_dump --format=custom --no-owner --no-acl \
  --dbname="$DATABASE_URL" --file="$BACKUP_PATH"
sha256sum "$BACKUP_PATH" > "$BACKUP_PATH.sha256"
```

Each backup cycle must include an off-host transfer result. Each release cycle
must include a clean restore or a recorded, still-current restore drill.

## Dangerous legacy utility

`reset_aiven_db.py` drops and recreates the PostgreSQL public schema. It is not
a deployment or migration command. It refuses to run unless both
`--confirm-drop-public-schema` and
`ALLOW_DESTRUCTIVE_DATABASE_RESET=true` are supplied. Use only against an
identified disposable database after independently verifying its host and
name.
