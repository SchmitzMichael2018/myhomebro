# Local Integrated QA Runner

Date: July 9, 2026

Use this runner when a Playwright test needs the real local Django API plus the Vite frontend.

## Command

```bash
cd frontend
npm run test:e2e:integrated:intake
```

This runs `intake-estimate-agreement-flow.spec.js` against:

- Backend: `http://127.0.0.1:8000`
- Frontend: `http://127.0.0.1:5173`
- API base: `VITE_API_BASE_URL=http://127.0.0.1:8000`
- Django settings: `core.settings_local_qa`

## What It Does

1. Runs `python backend/manage.py seed_qa_environment`.
2. Starts Django with `python backend/manage.py runserver 127.0.0.1:8000 --noreload --nothreading` if no healthy backend is already running.
3. Health-checks `http://127.0.0.1:8000/admin/login/`.
4. Runs the Playwright spec with the normal frontend Playwright config, which starts Vite.
5. Stops the Django process it started.

Playwright is run with one worker in this integrated mode so live API state and mocked browser specs do not cross-talk.

## Environment

Optional overrides:

```bash
QA_BACKEND_HOST=127.0.0.1
QA_BACKEND_PORT=8000
QA_BACKEND_HEALTH_TIMEOUT_MS=120000
QA_REUSE_BACKEND=false
PYTHON=python
```

## Safety

The runner is intended for local/test QA only.

- `seed_qa_environment` refuses unsafe databases unless explicitly forced.
- Seeded Stripe identifiers are stubs.
- The runner does not send real email or SMS.
- The runner does not trigger real Stripe payments.
- Google Maps/Places keys are blanked so browser tests use mocks instead of external scripts.

## Troubleshooting

If the runner fails before Playwright starts, check:

- Port `8000` is free or already serving the local Django app.
- Port `5173` is free or already serving the local Vite app.
- Existing backend processes on port `8000` are not using production-style SSL redirects.
- By default, the runner owns the backend lifecycle. Set `QA_REUSE_BACKEND=true` only when you intentionally want to reuse a known-good local QA backend.
- The runner uses `--nothreading` to avoid local SQLite write-lock races during full browser flows.
- The local database has applied migrations. The QA seed command applies pending local migrations before seeding.
- `frontend/.env.local` does not point at production.
