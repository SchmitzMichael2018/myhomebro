# Database Migration, Backup, and Restore

## Current architecture

Production startup evidence identifies SQLite at
`/home/myhomebro/backend/db.sqlite3`. Django selects the database through
`DATABASE_URL`; absent an explicit URL, development defaults to the repository
SQLite file. Local media uses `FileSystemStorage` under `media/` and must be
backed up and restored with the database.

SQLite is acceptable for low, bounded write concurrency. MyHomeBro has
concurrent request paths, `select_for_update()` workflows, unique-key races,
payments, Capture processing, and document state transitions. SQLite does not
provide PostgreSQL-equivalent row locking and is not the target architecture
for a larger production workload.

Historical database filenames do not prove provenance. The tracked zero-byte
and `.bak` artifacts must not be treated as recoverable production snapshots.
Validate every candidate through `check_database_integrity` and operator
records. New databases and backups must remain outside Git.

## Environment contract

| Variable | Contract |
|---|---|
| `DEPLOYMENT_ENVIRONMENT` | `development`, `staging`, or `production` |
| `DATABASE_ENGINE` | Explicit intent: `sqlite` or `postgresql` |
| `DATABASE_URL` | Required when intent is PostgreSQL |
| `DB_SSL_REQUIRE` | Explicit TLS requirement; defaults on for PostgreSQL URLs |
| `DB_CONNECT_TIMEOUT` | Bounded 1–60 seconds; default 10 |
| `DB_CONN_MAX_AGE` | Persistent connection lifetime; default 600 |
| `DB_HEALTHCHECKS` | Django connection health checks; default true |

Startup output contains only engine, deployment environment, debug/local-env
state, and SQLite journal mode. It does not print URLs, hosts, users, database
names, or credentials.

## SQLite integrity and inventory

```bash
cd ~/backend/backend
python manage.py check_database_integrity
python manage.py database_inventory --output /secure/reports/sqlite-inventory.json
```

The integrity command runs SQLite `integrity_check` and `foreign_key_check`,
checks migration state and uniqueness assumptions, samples file references,
tests temporary-table writeability, and reports sanitized database size and
per-model counts. Missing files and unapplied migrations are blocking.

## Safe SQLite backup

```bash
mkdir -p /secure/off-host-staging/sqlite
python manage.py backup_sqlite_database \
  --output-dir /secure/off-host-staging/sqlite
```

The command uses SQLite's online backup API, not `cp`. It creates:

- a timestamped `.sqlite3` snapshot;
- `.metadata.json` with migration state, sanitized counts, integrity status,
  sizes, and creation time;
- `.sha256` with the checksum.

Database and metadata permissions are restricted where the platform supports
POSIX modes. Copy the set to encrypted, access-controlled off-host storage.
Suggested policy: daily 35 days, weekly 13 weeks, monthly 12 months, subject to
the approved legal/data-retention policy. Back up `media/` in the same recovery
point and record both checksums.

## Representative SQLite-to-PostgreSQL rehearsal

Never point these steps at the live SQLite file.

1. Create an online SQLite backup and copy it to isolated staging.
2. Run integrity and inventory against that copy.
3. Provision two empty PostgreSQL databases: migration target and restore
   target. Require TLS and separate least-privilege credentials.
4. On the first database, run all migrations from zero.
5. Export from the copied SQLite database with Django natural keys:

   ```bash
   DATABASE_ENGINE=sqlite DATABASE_URL=sqlite:////secure/copy.sqlite3 \
   python manage.py dumpdata \
     --natural-foreign --natural-primary \
     --exclude contenttypes --exclude auth.permission \
     --indent 2 --output /secure/rehearsal/myhomebro.json
   ```

6. Load into migrated PostgreSQL:

   ```bash
   DATABASE_ENGINE=postgresql DATABASE_URL="$STAGING_DATABASE_URL" \
   DB_SSL_REQUIRE=true python manage.py loaddata /secure/rehearsal/myhomebro.json
   ```

   Django creates content types and permissions during migration; excluding
   them avoids environment-specific primary-key collisions. Sessions, token
   tables, application records, Celery results, and beat records remain in the
   fixture unless the rehearsal plan explicitly classifies them as skipped.

7. Reset sequences using Django-generated SQL:

   ```bash
   python manage.py sqlsequencereset accounts projects payments receipts \
     adminpanel django_celery_beat django_celery_results | \
     python manage.py dbshell
   ```

8. Generate destination inventory and reconcile:

   ```bash
   python manage.py database_inventory --output postgres-inventory.json
   python manage.py reconcile_database_inventory \
     sqlite-inventory.json postgres-inventory.json \
     --output reconciliation.json
   ```

9. Investigate every mismatch. Never edit contractual or financial rows solely
   to make import succeed.

## Transformation rules

Default rule: preserve every primary key, UUID, timestamp, decimal, JSON value,
relationship, and file name exactly. A reconciliation record must classify any
exception as `migrated`, `transformed`, `skipped`, or `failed`.

Allowed transformations require a reviewed rule containing model, field,
original-type/checksum, transformed type, affected count, justification, and
approval. Never include private field content in reports. Never silently drop a
row. Restart from a clean target after a failed load rather than layering an
unknown partial import.

Audit nullable unique values, case-insensitive identities, timestamp timezone
awareness, decimal scale, JSON scalar types, booleans, and text encoding before
cutover. PostgreSQL-specific workflow tests must cover row locks, concurrent
creation, uniqueness races, null ordering, `distinct/order_by`, JSON lookups,
date truncation, and decimal aggregation.

## PostgreSQL schema validation

```bash
DATABASE_ENGINE=postgresql DATABASE_URL="$STAGING_DATABASE_URL" \
python manage.py migrate --plan
DATABASE_ENGINE=postgresql DATABASE_URL="$STAGING_DATABASE_URL" \
python manage.py migrate --noinput
DATABASE_ENGINE=postgresql DATABASE_URL="$STAGING_DATABASE_URL" \
python manage.py makemigrations --check --dry-run
DATABASE_ENGINE=postgresql DATABASE_URL="$STAGING_DATABASE_URL" \
python manage.py check_database_integrity
```

Review migration `RunPython`/`RunSQL` operations and reversibility manually.
Record schema duration, locks, extension requirements, constraint/index
definitions, and sequence ownership. Empty-schema success is necessary but not
sufficient.

The repository audit found eight application `RunPython` migrations without an
explicit reverse callable: `0139`, `0143`, `0156`, `0157`, `0158`, `0177`,
`0193`, and `0250` in `projects/migrations`. Treat rollback across these points
as forward-recovery or database-restore work unless a separate rehearsal proves
the intended reverse behavior. Do not infer reversibility merely because the
schema operations around them are reversible.

## PostgreSQL backup and clean restore drill

```bash
pg_dump --format=custom --no-owner --no-acl \
  --dbname="$STAGING_DATABASE_URL" \
  --file=/secure/backups/myhomebro-postgres.dump
sha256sum /secure/backups/myhomebro-postgres.dump \
  > /secure/backups/myhomebro-postgres.dump.sha256

createdb "$RESTORE_DATABASE_NAME"
pg_restore --exit-on-error --no-owner --no-acl \
  --dbname="$RESTORE_DATABASE_URL" \
  /secure/backups/myhomebro-postgres.dump

DATABASE_ENGINE=postgresql DATABASE_URL="$RESTORE_DATABASE_URL" \
python manage.py check_database_integrity
DATABASE_ENGINE=postgresql DATABASE_URL="$RESTORE_DATABASE_URL" \
python manage.py database_inventory --output restored-inventory.json
python manage.py reconcile_database_inventory \
  postgres-inventory.json restored-inventory.json \
  --output restore-reconciliation.json
```

A dump is unverified until restoration into a second clean database,
reconciliation, sequence checks, media restore, and application smoke tests all
pass.

## Recovery objectives and security

Initial targets pending business approval: RPO 24 hours and RTO 4 hours. A
timed staging restore drill must prove or revise them. Encrypt backups in
transit and at rest; limit access to named operators; audit downloads and
restores; rotate database credentials after personnel/provider changes and
after suspected exposure. Never place credentials in command history—use the
provider secret mechanism or protected environment files.

## Troubleshooting

- Missing `DATABASE_URL` with PostgreSQL intent: configuration fails closed.
- Fixture constraint error: stop, retain logs without record content, discard
  the partial target, document the model/key class, and restart clean.
- Count mismatch: do not proceed; classify the mismatch and reconcile.
- Missing media: restore the matching media recovery point before smoke tests.
- Sequence collision: rerun reviewed `sqlsequencereset` and validate next IDs.
- Connection instability: stop the rehearsal/cutover and verify TLS, timeout,
  capacity, provider health, and pool limits.
