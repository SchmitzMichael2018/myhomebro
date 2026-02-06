"""
WSGI config for MyHomeBro Django project on PythonAnywhere.

This file ensures the web worker uses the *same* settings and database as
your manage.py shell, so API results match what you see in the shell.

Key fix:
- Explicitly load ~/backend/.env BEFORE get_wsgi_application() so OPENAI_API_KEY
  and all other env vars exist in the web worker process.
"""

import os
import sys
from pathlib import Path

# --- Ensure project is on the path ------------------------------------------------
BASE_DIR = Path(__file__).resolve().parent
PROJECT_ROOT = BASE_DIR            # ~/backend/backend
REPO_ROOT = PROJECT_ROOT.parent    # ~/backend

if str(REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(REPO_ROOT))

# --- Load .env explicitly (PythonAnywhere web workers often don't inherit shell env) ----
ENV_PATH = REPO_ROOT / ".env"
try:
    if ENV_PATH.exists():
        from dotenv import load_dotenv
        load_dotenv(dotenv_path=ENV_PATH, override=True)
except Exception:
    # Never crash WSGI due to dotenv issues
    pass

# --- Pin DJANGO_SETTINGS_MODULE ---------------------------------------------------
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
        application.add_files(
            settings.STATIC_ROOT,
            prefix=getattr(settings, "STATIC_URL", "/static/"),
        )
except Exception:
    # WhiteNoise is optional; ignore if not installed
    pass
