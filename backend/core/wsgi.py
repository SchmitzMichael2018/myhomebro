# ~/backend/backend/core/wsgi.py
"""
WSGI config for the MyHomeBro project.

This file provides the WSGI application for serving your Django project.
Environment variables are loaded by settings (and optionally by PA's WSGI).
Static files are handled by WhiteNoise via middleware (see settings.MIDDLEWARE).
"""

import os
os.environ.setdefault("DJANGO_SETTINGS_MODULE", "core.settings")

from django.core.wsgi import get_wsgi_application  # noqa: E402

application = get_wsgi_application()
