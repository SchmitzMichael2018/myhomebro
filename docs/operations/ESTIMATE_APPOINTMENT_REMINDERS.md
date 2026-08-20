# Estimate appointment reminders

Estimate appointment confirmation and reminder deliveries are persisted in the database and keyed by appointment schedule version, recipient, channel, and offset. Only confirmed appointments are eligible for reminders. Terminal appointments and superseded schedule versions are suppressed without deleting delivery history.

Configure reminder offsets through `ESTIMATE_APPOINTMENT_REMINDER_OFFSETS_MINUTES` as comma-separated minutes. The default is `1440,120` (24 hours and 2 hours).

On PythonAnywhere, configure a scheduled task every 10 minutes using the production virtualenv and project path:

```sh
cd /home/<pythonanywhere-user>/myhomebro/backend && /home/<pythonanywhere-user>/.virtualenvs/<virtualenv>/bin/python manage.py send_estimate_appointment_reminders --batch-size 100
```

Run a non-delivering preflight after deployment:

```sh
python manage.py send_estimate_appointment_reminders --dry-run --batch-size 100
```

Do not schedule overlapping invocations. The command also uses a short command lock and database row claims as defense in depth.
