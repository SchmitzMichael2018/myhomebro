# ~/backend/backend/projects/views/debug.py
from __future__ import annotations
from django.conf import settings
from django.http import JsonResponse
from projects.models import Agreement

def env_debug(request):
    # DO NOT KEEP IN PROD LONG-TERM—remove after diagnosis
    try:
        count = Agreement.objects.count()
    except Exception as e:
        count = f"error: {type(e).__name__}: {e}"
    data = {
        "DJANGO_SETTINGS_MODULE": getattr(settings, "DJANGO_SETTINGS_MODULE", None),
        "DB_ENGINE": settings.DATABASES["default"]["ENGINE"],
        "DB_NAME": settings.DATABASES["default"]["NAME"],
        "DEBUG": settings.DEBUG,
        "AGREEMENT_COUNT": count,
    }
    return JsonResponse(data, status=200)
