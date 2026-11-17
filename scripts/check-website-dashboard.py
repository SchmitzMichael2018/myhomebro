"""Run website-service tests with a separate in-memory DB and offline providers."""
import os
import sys
import tempfile
from pathlib import Path

repo = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(repo / "backend"))
os.environ.setdefault("SECRET_KEY", "isolated-website-dashboard-qa-only")
from core import settings_local_qa as source
from django.conf import settings

config = {name: getattr(source, name) for name in dir(source) if name.isupper()}
config.update(
    DATABASES={"default": {"ENGINE": "django.db.backends.sqlite3", "NAME": ":memory:"}},
    CACHES={"default": {"BACKEND": "django.core.cache.backends.locmem.LocMemCache"}},
    PASSWORD_HASHERS=["django.contrib.auth.hashers.MD5PasswordHasher"],
    CELERY_TASK_ALWAYS_EAGER=False,
    ADMIN_SIGNUP_SMS_ENABLED=False,
    CONTRACTOR_WELCOME_EMAIL_ENABLED=False,
)
settings.configure(**config)
import django
django.setup()
from django.core.management import call_command
call_command("check")
call_command("makemigrations", "projects", check=True, dry_run=True, verbosity=1)
from django.test.utils import get_runner
runner = get_runner(settings)(verbosity=1, interactive=False)
raise SystemExit(bool(runner.run_tests(["projects.tests_website_service"])))
