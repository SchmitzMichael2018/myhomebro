# Redis, Celery, and Queued PDF Readiness

## Architecture

Agreement PDF generation is dispatched after the creating database transaction
commits. Django records an explicit lifecycle on `Agreement`:

```text
pending → queued → processing → completed
                   ↘ failed_retryable
                   ↘ failed_permanent
```

The web process publishes `generate_full_agreement_pdf` to `PDF_QUEUE_NAME`.
A Celery worker consumes that queue and calls the canonical
`projects.services.pdf.generate_full_agreement_pdf` service. Existing PDF files
and `AgreementPDFVersion` history are preserved; status changes do not replace
document artifacts.

Public `/healthz` is liveness only and returns `ok`. Staff administrators can
inspect redacted dependency readiness at `/admin/health/async-services/`.

## Proven failure cause

The production requirements installed Celery and Kombu without the optional
Python Redis transport dependency. Kombu's Redis transport performs an optional
`import redis`; when that import fails, its module variable is `None`. Class
initialization later accesses `redis.Redis`, producing:

```text
AttributeError: 'NoneType' object has no attribute 'Redis'
```

The failure was reproduced locally before remediation:

```text
redis: PackageNotFoundError
kombu.transport.redis: AttributeError("'NoneType' object has no attribute 'Redis'")
```

Kombu declares `redis>=4.5.2` with excluded incompatible releases for its Redis
extra. The repository now pins `redis==5.3.1`, within the declared compatible
range for the pinned Celery/Kombu line.

Two configuration inconsistencies amplified the problem:

- `core/celery_app.py` replaced Django's broker and backend configuration with
  `REDIS_URL`, silently defaulting to localhost.
- `core.__init__` did not export the Celery application, so standard Django
  Celery initialization was disabled.

Both have been removed. Django settings are now the single configuration source.

## Required environment variables

| Variable | Requirement |
| --- | --- |
| `DEPLOYMENT_ENVIRONMENT` | `development`, `staging`, or `production` |
| `REDIS_URL` | Optional source for the broker when `CELERY_BROKER_URL` is absent |
| `CELERY_BROKER_URL` | Required when `PDF_ASYNC_ENABLED=true` |
| `CELERY_RESULT_BACKEND` | Recommended; defaults to Redis database 1 for a Redis broker |
| `CACHE_URL` | Reserved explicit cache endpoint; no queue fallback depends on it |
| `PDF_ASYNC_ENABLED` | Must be explicitly true to dispatch queued PDFs |
| `PDF_SYNC_FALLBACK_ENABLED` | Must remain false; synchronous web fallback is unsupported |
| `PDF_QUEUE_NAME` | Defaults to `pdf` |
| `CELERY_DEFAULT_QUEUE` | Defaults to `default` |
| `CELERY_TASK_ALWAYS_EAGER` | Development/test only |
| `CELERY_TASK_EAGER_PROPAGATES` | Defaults true |
| `CELERY_TIMEZONE` | Defaults to `America/Chicago` |
| `CELERY_BROKER_CONNECTION_TIMEOUT` | Defaults to 5 seconds |
| `CELERY_TASK_SOFT_TIME_LIMIT` | Defaults to 120 seconds |
| `CELERY_TASK_TIME_LIMIT` | Defaults to 150 seconds |

Boolean values use deterministic accepted values:
`1`, `true`, `t`, `yes`, `y`, or `on` (case-insensitive). Other values are false.

Never place credentials in source control or command output. Readiness output
contains only configured state, scheme, and sanitized hostname.

## Environment examples

### Local development

Use an explicit disabled mode when Redis is not needed:

```dotenv
DEPLOYMENT_ENVIRONMENT=development
PDF_ASYNC_ENABLED=false
PDF_SYNC_FALLBACK_ENABLED=false
CELERY_TASK_ALWAYS_EAGER=false
```

To develop against local Redis, explicitly configure it; no code path defaults
to localhost:

```dotenv
CELERY_BROKER_URL=redis://127.0.0.1:6379/0
CELERY_RESULT_BACKEND=redis://127.0.0.1:6379/1
PDF_ASYNC_ENABLED=true
```

### Staging and production

```dotenv
DEPLOYMENT_ENVIRONMENT=staging
CELERY_BROKER_URL=rediss://USER:PASSWORD@PRIVATE_REDIS_HOST:PORT/0
CELERY_RESULT_BACKEND=rediss://USER:PASSWORD@PRIVATE_REDIS_HOST:PORT/1
PDF_ASYNC_ENABLED=true
PDF_SYNC_FALLBACK_ENABLED=false
PDF_QUEUE_NAME=pdf
CELERY_TASK_ALWAYS_EAGER=false
```

Use `DEPLOYMENT_ENVIRONMENT=production` in production. Localhost broker URLs,
missing broker configuration, missing Redis transport dependencies, and
unwritable PDF storage fail deployment checks when async PDF is enabled.

## Startup commands

Web:

```bash
python manage.py check --deploy
```

Worker:

```bash
celery -A core worker --loglevel=INFO --queues=pdf,default
```

Beat, if scheduled tasks are enabled:

```bash
celery -A core beat --loglevel=INFO
```

Run beat as a separately supervised singleton. Do not start multiple beat
instances against the same schedule.

## Readiness and smoke tests

```bash
python manage.py check_async_services --mode configuration
python manage.py check_async_services --mode broker --timeout 10
python manage.py check_async_services --mode worker --timeout 10
python manage.py check_async_services --mode pdf --timeout 10
```

- `configuration` performs no network connection.
- `broker` pings broker and result-backend Redis endpoints.
- `worker` also requires a worker ping and safe task round trip.
- `pdf` performs the round trip with an in-memory non-customer PDF and checks
  PDF output-directory writability.

Every mode returns nonzero on failure. A broker ping alone does not establish
readiness; staging requires the worker and PDF round trips.

The full deployment scripts call `scripts/check_async_readiness.sh`. The fast
frontend rebuild does not run infrastructure checks.

## Dispatch, retry, and idempotency

- Dispatch occurs with `transaction.on_commit`, so workers cannot race an
  uncommitted Agreement.
- A task ID is saved only after the broker accepts the publish request.
- Publish failures leave `failed_retryable`, clear the task ID, and expose a
  non-sensitive error code.
- Task start sets `processing`; only successful file generation sets `completed`.
- Storage/connection/time-out failures are retryable up to three attempts.
- Invalid document data is permanent and is not retried.
- A duplicate task sees `completed` and exits without creating another version.
- Existing `pdf_file` and version history are not cleared on failure.

## Synchronous fallback policy

There is no synchronous PDF fallback in web requests. Setting
`PDF_SYNC_FALLBACK_ENABLED=true` produces a deployment warning but does not
activate unbounded generation. When the queue is unavailable, the Agreement
remains retryable and operators restore the queue before retrying.

## Observability

Structured log events include:

- `pdf_enqueue_attempt`, `pdf_enqueue_success`, `pdf_enqueue_failure`
- `pdf_task_start`, `pdf_task_retry`, `pdf_task_completion`
- `pdf_task_permanent_failure`, `pdf_task_duplicate`

Fields are limited to document type, record ID, task ID, queue, duration,
sanitized broker host, retry number, and error class/code. Logs must never add
Redis credentials, customer document content, signatures, tokens, or payment data.

## Troubleshooting

`NoneType ... Redis`:

1. Activate the production virtualenv.
2. Run `python -m pip show redis celery kombu`.
3. Install `backend/requirements.txt`.
4. Re-run configuration and broker checks.

Broker passes but worker fails:

1. Confirm the worker uses the same virtualenv and environment file as Django.
2. Confirm it consumes `PDF_QUEUE_NAME`.
3. Confirm the Celery application is `core`.
4. Inspect sanitized worker logs and supervisor status.

PDF smoke fails:

1. Verify worker filesystem/storage credentials match the web process.
2. Verify `MEDIA_ROOT/agreements/tmp` is writable.
3. Check ReportLab/Pillow/PyPDF installation.
4. Leave affected records retryable; do not mark them completed manually.

## Deployment and rollback

Deployment order:

1. Install `backend/requirements.txt`.
2. Configure Redis/broker/result backend without logging credentials.
3. Apply migrations.
4. Start/restart the worker consuming `pdf`.
5. Run the complete readiness gate.
6. Reload the web application.
7. Perform a non-destructive staff readiness check.

Rollback application code and worker together. The added status fields are
backward-compatible and should normally remain during rollback. Do not reverse
the migration while code or workers may still write those fields. Disable async
dispatch explicitly if the queue must be taken out of service.

When rotating Redis credentials, update web, worker, beat, and deployment-check
environments together; restart all processes, revoke the old credential, and
repeat broker, worker, and PDF checks.
