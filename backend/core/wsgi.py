"""
WSGI config for core project.

This file provides the WSGI application for serving your Django project.
- Secure Static File Serving (WhiteNoise with Compression)
- Enhanced Error Handling with Logging
- Dynamic Configuration Based on Django Settings

For more information on this file, see:
https://docs.djangoproject.com/en/5.2/howto/deployment/wsgi/
"""

import os
import logging
from django.core.wsgi import get_wsgi_application
from whitenoise import WhiteNoise
from django.conf import settings

logger = logging.getLogger("django")

try:
    os.environ.setdefault('DJANGO_SETTINGS_MODULE', 'core.settings')
    application = get_wsgi_application()
    
    # ✅ Secure WhiteNoise Configuration with Compression
    application = WhiteNoise(
        application,
        root=settings.STATIC_ROOT,
        max_age=31536000,  # 1 Year Cache
        autorefresh=settings.DEBUG,  # Auto-refresh in DEBUG mode
        index_file=True,
        immutable_file_test=lambda path, url: 'immutable' in url
    )

except Exception as e:
    logger.error(f"❌ WSGI Application Error: {str(e)}")
    application = None


