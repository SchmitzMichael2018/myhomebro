# core/wsgi.py

"""
WSGI config for the MyHomeBro project.

This file provides the WSGI application for serving your Django project.
- Loads environment variables from .env at startup.
- Integrates WhiteNoise for secure and efficient static file serving.

For more information on this file, see:
https://docs.djangoproject.com/en/5.0/howto/deployment/wsgi/
"""

import os
from django.core.wsgi import get_wsgi_application
from dotenv import load_dotenv
from whitenoise import WhiteNoise
from django.conf import settings

# Load environment variables from .env file at the very start
load_dotenv()

os.environ.setdefault('DJANGO_SETTINGS_MODULE', 'core.settings')

# Get the standard Django WSGI application
application = get_wsgi_application()

# Wrap the application with WhiteNoise for static file serving.
# The detailed configuration options you had are excellent for production.
application = WhiteNoise(
    application,
    root=settings.STATIC_ROOT,
    max_age=31536000,  # 1 Year Cache
    autorefresh=settings.DEBUG,
    immutable_file_test=lambda path, url: 'immutable' in url
)