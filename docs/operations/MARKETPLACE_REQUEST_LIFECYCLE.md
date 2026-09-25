# Marketplace request lifecycle

Run the lifecycle once daily during a low-traffic period from the deployed checkout and virtualenv:

```text
cd <backend-path> && python manage.py process_marketplace_request_lifecycle --limit 500
```

Preflight with `--dry-run`; use `--at` only for controlled deterministic checks. The command is bounded, processes request IDs in stable order, and uses conditional timestamp updates plus notification deduplication so repeated runs do not duplicate lifecycle work. SQLite is not treated as providing row-level locks.

Defaults are configured by `MARKETPLACE_FIRST_REMINDER_DAYS=2`, `MARKETPLACE_FINAL_REMINDER_DAYS=5`, `MARKETPLACE_AUTO_ARCHIVE_DAYS=14`, and `MARKETPLACE_ARCHIVE_RETENTION_DAYS=90`.

Do not enable the scheduled task until migrations are applied and a production dry run has been reviewed. The command never routes requests. Archived requests linked to response, customer, project, agreement, property-management, or audit history are retained instead of retried as deletion failures.

Contractor reminders are in-app notifications for linked contractor accounts with valid account email addresses. Unclaimed directory listings and contractors without a valid account email do not receive a reminder; that does not delay the 14-day archive. The customer archive notice uses the existing in-app smart-notification rule and requires a valid customer email. Neither lifecycle notice sends email or SMS in this release.

Restoring an old request starts a new 14-day review window, but preserves the original submission, most recent archive timestamp/reason, and reminder timestamps. It does not resend invitations or clear reminder deduplication. Before hard deletion, the command rechecks retention inside its transaction and retains records with customer attachments, estimate appointments, downstream opportunity/lead history, or any other protected relationship.
