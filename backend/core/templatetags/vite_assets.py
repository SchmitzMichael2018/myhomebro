# /home/myhomebro/backend/backend/core/templatetags/vite_assets.py

import json
import os
from django import template
from django.conf import settings
from django.templatetags.static import static

register = template.Library()

# Cache the manifest file in DEBUG mode to avoid re-reading on every request
_manifest = None

@register.simple_tag
def vite_asset(filename):
    global _manifest
    if settings.DEBUG and _manifest:
        manifest = _manifest
    else:
        # Path to your manifest.json relative to STATIC_ROOT
        manifest_path = os.path.join(settings.STATIC_ROOT, '.vite', 'manifest.json')
        try:
            with open(manifest_path, 'r') as f:
                manifest = json.load(f)
            if settings.DEBUG:
                _manifest = manifest # Cache for debug mode
        except FileNotFoundError:
            raise Exception(
                f"Vite manifest.json not found at {manifest_path}. "
                "Did you run 'npm run build' in your frontend project?"
            )

    if filename not in manifest:
        raise Exception(f"Asset '{filename}' not found in Vite manifest.")

    # Vite's manifest stores the original path and the hashed path
    # The 'file' key is the hashed output path
    # The 'src' key is the original input path (e.g., 'src/main.jsx')
    # We need the 'file' key, which is relative to the build output root (STATIC_ROOT)
    hashed_filename = manifest[filename]['file']

    # Use Django's static tag to get the full URL
    # Vite's base: '/static/' already handled, so just append
    return static(hashed_filename)