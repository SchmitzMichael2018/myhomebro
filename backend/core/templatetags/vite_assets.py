from __future__ import annotations

import json
from pathlib import Path

from django import template
from django.conf import settings

register = template.Library()


def _load_manifest() -> dict:
    manifest_path = Path(settings.BASE_DIR) / "frontend" / "dist" / ".vite" / "manifest.json"
    with manifest_path.open("r", encoding="utf-8") as handle:
        return json.load(handle)


def _entry() -> dict:
    manifest = _load_manifest()
    entry = manifest.get("index.html")
    if not entry:
        raise KeyError("index.html entry missing from Vite manifest")
    return entry


@register.simple_tag
def vite_entry_js() -> str:
    return f"/static/{_entry()['file']}"


@register.simple_tag
def vite_entry_css() -> str:
    css_files = _entry().get("css") or []
    if not css_files:
        return ""
    return f"/static/{css_files[0]}"
