# core/celery_app.py

import os
import sys
from pathlib import Path

from celery import Celery

# -----------------------------------------------------------------------------
# Ensure the repo is on sys.path (helps when Celery is launched outside manage.py)
# -----------------------------------------------------------------------------
REPO_ROOT = Path("/home/myhomebro/backend")
DJANGO_ROOT = REPO_ROOT / "backend"

for p in (str(REPO_ROOT), str(DJANGO_ROOT)):
    if p not in sys.path:
        sys.path.insert(0, p)

# -----------------------------------------------------------------------------
# Load .env for worker processes (Celery does NOT automatically load it)
# -----------------------------------------------------------------------------
ENV_PATH = REPO_ROOT / ".env"
try:
    if ENV_PATH.exists():
        from dotenv import load_dotenv
        load_dotenv(dotenv_path=str(ENV_PATH), override=True)
except Exception:
    # Never crash Celery boot due to dotenv issues
    pass

# -----------------------------------------------------------------------------
# Django settings module for Celery
# -----------------------------------------------------------------------------
os.environ.setdefault("DJANGO_SETTINGS_MODULE", "core.settings")

from django.conf import settings  # noqa: E402

app = Celery("core")

# Load Celery settings from Django settings.py (CELERY_ namespace)
app.config_from_object("django.conf:settings", namespace="CELERY")

# Broker / backend (prefer REDIS_URL if present)
redis_url = os.getenv("REDIS_URL", "redis://localhost:6379/0")
app.conf.broker_url = redis_url
app.conf.result_backend = redis_url

# Discover tasks from installed apps
app.autodiscover_tasks(lambda: settings.INSTALLED_APPS)

# Optional: Custom task settings (tune as needed)
app.conf.task_serializer = "json"
app.conf.result_serializer = "json"
app.conf.accept_content = ["json"]
app.conf.task_always_eager = False  # Set True for debugging (synchronous execution)
