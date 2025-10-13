"""
WSGI config for MyHomeBro Django project on PythonAnywhere.

This file ensures the web worker uses the *same* settings and database as
your manage.py shell, so API results match what you see in the shell.
"""

import os
import sys
from pathlib import Path

# --- Ensure project is on the path ------------------------------------------------
BASE_DIR = Path(__file__).resolve().parent
PROJECT_ROOT = BASE_DIR  # ~/backend/backend
REPO_ROOT = PROJECT_ROOT.parent  # ~/backend

if str(REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(REPO_ROOT))

# --- Pin DJANGO_SETTINGS_MODULE ---------------------------------------------------
# IMPORTANT: set this to your *actual* settings module (e.g., "backend.settings")
os.environ.setdefault("DJANGO_SETTINGS_MODULE", "core.settings")

# --- Optional: force consistent timezone/locale ----------------------------------
# os.environ.setdefault("TZ", "UTC")

# --- Django setup ----------------------------------------------------------------
from django.core.wsgi import get_wsgi_application

application = get_wsgi_application()

# --- WhiteNoise (serve static files) ---------------------------------------------
# Only if you have WhiteNoise installed and configured in settings.MIDDLEWARE
try:
    from whitenoise import WhiteNoise
    from django.conf import settings

    if getattr(settings, "STATIC_ROOT", None):
        application = WhiteNoise(application, root=settings.STATIC_ROOT)
        # Optionally serve compressed/manifest files:
        application.add_files(settings.STATIC_ROOT, prefix=getattr(settings, "STATIC_URL", "/static/"))
except Exception:
    # WhiteNoise is optional; ignore if not installed
    pass
