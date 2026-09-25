# Marketplace request lifecycle

Run the lifecycle once daily during a low-traffic period from the deployed checkout and virtualenv:

```text
cd <backend-path> && python manage.py process_marketplace_request_lifecycle --limit 500
```

Preflight with `--dry-run`; use `--at` only for controlled deterministic checks. The command is bounded, processes request IDs in stable order, and uses conditional timestamp updates plus notification deduplication so repeated runs do not duplicate lifecycle work. SQLite is not treated as providing row-level locks.

Defaults are configured by `MARKETPLACE_FIRST_REMINDER_DAYS=2`, `MARKETPLACE_FINAL_REMINDER_DAYS=5`, `MARKETPLACE_AUTO_ARCHIVE_DAYS=14`, and `MARKETPLACE_ARCHIVE_RETENTION_DAYS=90`.

Do not enable the scheduled task until migrations are applied and a production dry run has been reviewed. The command never routes requests. Archived requests linked to response, customer, project, agreement, property-management, or audit history are retained instead of retried as deletion failures.
