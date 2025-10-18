# ~/backend/backend/core/asgi.py
"""
ASGI config for MyHomeBro (PythonAnywhere-compatible, no WebSockets).

We intentionally avoid Channels/WebSocket routing because PythonAnywhere
does not support WebSockets for web apps. This file exposes a plain
Django ASGI application for completeness, but your site runs via WSGI.
"""

import os
from django.core.asgi import get_asgi_application

# Point to Django settings
os.environ.setdefault("DJANGO_SETTINGS_MODULE", "core.settings")

# Plain ASGI app (HTTP only)
application = get_asgi_application()
