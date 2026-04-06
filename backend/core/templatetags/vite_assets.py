from __future__ import annotations

import json
from pathlib import Path

from django import template
from django.conf import settings

register = template.Library()


def _load_manifest() -> dict:
    # settings.FRONTEND_DIST_DIR is REPO_DIR / "frontend" / "dist"
    # (BASE_DIR is backend/, REPO_DIR is the repo root where frontend/ lives)
    dist_dir = getattr(settings, "FRONTEND_DIST_DIR", None)
    if dist_dir is None:
        # Fallback: derive from BASE_DIR's parent (repo root)
        dist_dir = Path(settings.BASE_DIR).parent / "frontend" / "dist"
    manifest_path = Path(dist_dir) / ".vite" / "manifest.json"
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
