# ~/backend/backend/core/wsgi.py
"""
WSGI config for the MyHomeBro project.

This file provides the WSGI application for serving your Django project.
On PythonAnywhere, /var/www/..._wsgi.py may be the actual entrypoint,
but keeping dotenv loading here makes other runtimes consistent too.
"""

import os
from pathlib import Path

# Load ~/backend/.env (repo root) if present
REPO_ROOT = Path(__file__).resolve().parent.parent.parent  # ~/backend
ENV_PATH = REPO_ROOT / ".env"
try:
    if ENV_PATH.exists():
        from dotenv import load_dotenv
        load_dotenv(dotenv_path=str(ENV_PATH), override=True)
except Exception:
    pass

os.environ.setdefault("DJANGO_SETTINGS_MODULE", "core.settings")

from django.core.wsgi import get_wsgi_application  # noqa: E402

application = get_wsgi_application()
