# Local Integrated Playwright QA

This runbook adds a non-mocked local Playwright lane for the real MyHomeBro backend-backed Templates page and Agreement Wizard.

## What it covers

- real contractor login against the local Django backend
- authenticated browser storage reuse through Playwright `storageState`
- real `/app/templates` system-template visibility
- applying a seeded template inside the real Agreement Wizard
- verifying Step 1 fields and Step 2 milestones against seeded backend data

The existing mocked Playwright specs remain unchanged. This is an additional live-backend QA path.

## Local contractor test account

Use the local-only seed command to create or refresh the browser automation account and ensure system templates are seeded:

```powershell
cd backend
.\venv\Scripts\python.exe manage.py seed_local_playwright_contractor
```

Default credentials:

- Email: `playwright.contractor@myhomebro.local`
- Password: `Playwright123!`

You can override them if needed:

```powershell
cd backend
.\venv\Scripts\python.exe manage.py seed_local_playwright_contractor --email qa.contractor@myhomebro.local --password "AnotherPass123!"
```

## One-time local prerequisites

1. Install frontend dependencies.
2. Ensure the local backend database is migrated.
3. Ensure the backend virtualenv exists at `backend\venv`.

Suggested commands:

```powershell
cd frontend
npm.cmd install

cd ..\backend
.\venv\Scripts\python.exe manage.py migrate
.\venv\Scripts\python.exe manage.py seed_local_playwright_contractor
```

## Run the local integrated Playwright lane

From `frontend`:

```powershell
npm.cmd run test:e2e:local-integrated
```

Headed mode:

```powershell
npm.cmd run test:e2e:local-integrated:headed
```

## What the harness starts automatically

The dedicated config at `frontend/playwright.local-auth.config.js` starts:

- Django backend on `http://127.0.0.1:8000`
- Vite frontend on `http://127.0.0.1:5173`

It also writes authenticated browser state to:

- `frontend/playwright/.auth/contractor.json`

That file is ignored by git.

## Files involved

- `backend/projects/management/commands/seed_local_playwright_contractor.py`
- `frontend/playwright.local-auth.config.js`
- `frontend/tests/local-integrated/auth.setup.js`
- `frontend/tests/local-integrated/templates-live.spec.js`

## Override credentials with environment variables

If you seeded a different local contractor account, the auth setup spec supports:

```powershell
$env:PLAYWRIGHT_CONTRACTOR_EMAIL='qa.contractor@myhomebro.local'
$env:PLAYWRIGHT_CONTRACTOR_PASSWORD='AnotherPass123!'
cd frontend
npm.cmd run test:e2e:local-integrated
```
