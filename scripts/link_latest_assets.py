#!/usr/bin/env python3
"""
link_latest_assets.py
Create stable /static/assets/index.{js,css} symlinks that point to the latest
Vite-hashed files after a production build + collectstatic.

Usage:
    python /home/myhomebro/backend/scripts/link_latest_assets.py

Idempotent and safe to run after every deploy.
"""
from __future__ import annotations
import json
import os
from pathlib import Path
import sys

REPO = Path("/home/myhomebro/backend")
DIST = REPO / "frontend" / "dist"
MANIFEST = DIST / ".vite" / "manifest.json"
STATIC_ROOT = REPO / "staticfiles"
ASSETS = STATIC_ROOT / "assets"

def die(msg: str, code: int = 1) -> None:
    print(msg, file=sys.stderr)
    raise SystemExit(code)

def ensure_paths() -> None:
    if not MANIFEST.exists():
        die(f"manifest.json not found at {MANIFEST}. Did you run `npm run build`?")
    if not ASSETS.exists():
        die(f"Static assets directory not found: {ASSETS}. Did you run collectstatic?")

def load_manifest() -> dict:
    try:
        return json.loads(MANIFEST.read_text())
    except Exception as e:
        die(f"Failed to read manifest: {e}")

def pick_entry(m: dict) -> dict | None:
    # Prefer common entry keys; fallback to first .js entry
    for key in ("index.html", "src/main.jsx", "src/main.tsx", "main.jsx", "main.tsx"):
        if key in m and isinstance(m[key], dict) and m[key].get("file", "").endswith(".js"):
            return m[key]
    for _, v in m.items():
        if isinstance(v, dict) and str(v.get("file", "")).endswith(".js"):
            return v
    return None

def link(name: str, target_file: Path) -> None:
    stable = ASSETS / name
    if stable.exists() or stable.is_symlink():
        stable.unlink()
    # Symlink to filename (relative) to keep STATIC_ROOT portable
    os.symlink(target_file.name, stable)
    print(f"Linked {stable} -> {target_file.name}")

def main() -> None:
    ensure_paths()
    m = load_manifest()
    entry = pick_entry(m)
    if not entry:
        # Fallback: find files by glob
        js_candidates = sorted(ASSETS.glob("index-*.js"))
        css_candidates = sorted(ASSETS.glob("index-*.css"))
        if not js_candidates:
            die("Could not locate index-*.js in collected assets.")
        link("index.js", js_candidates[-1])
        if css_candidates:
            link("index.css", css_candidates[-1])
        else:
            print("No CSS entry found; skipped index.css")
        return

    # Resolve the JS file
    js_rel = entry.get("file")
    if not js_rel:
        die("Manifest entry has no 'file' key for JS.")
    js_target = ASSETS / Path(js_rel).name
    if not js_target.exists():
        # Try to locate by glob
        candidates = sorted(ASSETS.glob("index-*.js"))
        if not candidates:
            die(f"JS asset not found in {ASSETS} (expected {js_target.name}).")
        js_target = candidates[-1]
    link("index.js", js_target)

    # Resolve CSS (optional)
    css_list = entry.get("css") or []
    css_target = None
    if css_list:
        first_css = Path(css_list[0]).name
        css_target = ASSETS / first_css
        if not css_target.exists():
            # Fallback to glob
            candidates = sorted(ASSETS.glob("index-*.css"))
            css_target = candidates[-1] if candidates else None
    else:
        # Some builds put CSS in a separate chunk; try glob
        candidates = sorted(ASSETS.glob("index-*.css"))
        css_target = candidates[-1] if candidates else None

    if css_target and css_target.exists():
        link("index.css", css_target)
    else:
        print("No CSS entry found; skipped index.css")

if __name__ == "__main__":
    main()
