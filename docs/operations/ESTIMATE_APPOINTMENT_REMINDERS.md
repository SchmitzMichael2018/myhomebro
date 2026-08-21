# Estimate appointment reminders

Estimate appointment confirmation and reminder deliveries are persisted in the database and keyed by appointment schedule version, recipient, channel, and offset. Only confirmed appointments are eligible for reminders. Terminal appointments and superseded schedule versions are suppressed without deleting delivery history.

Configure reminder offsets through `ESTIMATE_APPOINTMENT_REMINDER_OFFSETS_MINUTES` as comma-separated minutes. The default is `1440,120` (24 hours and 2 hours).

`SITE_URL` is the single authoritative public application origin for Estimate and Appointment customer links. Production must set:

```text
SITE_URL=https://www.myhomebro.com
```

The normal Django settings loader reads the first existing main `.env` from the backend or repository root for both PythonAnywhere web workers and `manage.py` commands. PythonAnywhere scheduled tasks must run from the same checkout and environment; do not rely on a WSGI-only environment assignment. Local development may explicitly set `SITE_URL` to its frontend origin.

Before enabling customer communications, run:

```sh
python manage.py check
python manage.py print_public_app_origin
```

The second command intentionally prints only the resolved public origin. It must print exactly `https://www.myhomebro.com` in production.

On PythonAnywhere, configure a scheduled task every 10 minutes. The values in angle brackets below are operator substitutions, not confirmed production paths:

```sh
cd /home/<pythonanywhere-user>/myhomebro/backend && /home/<pythonanywhere-user>/.virtualenvs/<virtualenv>/bin/python manage.py send_estimate_appointment_reminders --batch-size 100
```

Run a non-delivering preflight after deployment:

```sh
python manage.py send_estimate_appointment_reminders --dry-run --batch-size 100
```

Do not schedule overlapping invocations. The command also uses a short command lock and database row claims as defense in depth.

Deployment order: update the shared production environment with `SITE_URL`, update the checkout and virtualenv dependencies, run the system check and origin preflight, apply required migrations, build frontend assets, reload the PythonAnywhere web app, then enable or resume the reminder task. Run the reminder dry-run before its first delivering invocation.

To invalidate an exposed or stale confirmation authorization, reschedule through the supported Appointment workflow (or use the appropriate cancel/decline lifecycle action). Schedule-version binding invalidates the old authorization. Do not edit appointment status directly in the database.
