#!/usr/bin/env python
"""
Django management utility (with robust dotenv loading).
"""

import os
import sys
import logging
from pathlib import Path

from dotenv import load_dotenv, find_dotenv

# ------------------------------------------------------------------------------
# Logging
# ------------------------------------------------------------------------------
# Keep logging simple; PythonAnywhere/console will capture it.
logging.basicConfig(level=logging.INFO, format="%(levelname)s: %(message)s")
logger = logging.getLogger(__name__)

# ------------------------------------------------------------------------------
# Paths & .env loading
# ------------------------------------------------------------------------------
# IMPORTANT: manage.py lives in .../backend/manage.py
# We want BASE_DIR to be the backend folder (same place as .env and manage.py)
BASE_DIR = Path(__file__).resolve().parent  # -> .../backend

# Try explicit path first (backend/.env), then fall back to auto-discovery
explicit_env = BASE_DIR / ".env"
loaded = False
if explicit_env.exists():
    load_dotenv(dotenv_path=explicit_env, override=True)
    loaded = True
else:
    discovered = find_dotenv(filename=".env", usecwd=True)
    if discovered:
        load_dotenv(discovered, override=True)
        loaded = True

# Only be chatty about .env when DEBUG=True (after we read env below)
def _maybe_log_env_status():
    debug = os.environ.get("DEBUG", "False").lower() in ("1", "true", "t", "yes", "y")
    if not loaded and debug:
        logger.warning("⚠️  No .env file found at expected path: %s", explicit_env)

# ------------------------------------------------------------------------------
# Main
# ------------------------------------------------------------------------------
def main():
    os.environ.setdefault("DJANGO_SETTINGS_MODULE", "core.settings")
    _maybe_log_env_status()

    try:
        from django.core.management import execute_from_command_line
    except ImportError as exc:
        logger.error("❌ Django Import Error: %s", str(exc))
        print("Make sure your virtual environment is activated and Django is installed.")
        raise

    execute_from_command_line(sys.argv)


if __name__ == "__main__":
    main()
