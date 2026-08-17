#!/usr/bin/env python3
"""Fail a release when the Vite entry bundle still contains the legacy launcher."""

from __future__ import annotations

import json
from pathlib import Path


repo = Path(__file__).resolve().parents[1]
dist = repo / "frontend" / "dist"
manifest = json.loads((dist / ".vite" / "manifest.json").read_text(encoding="utf-8"))
entry = dist / manifest["index.html"]["file"]
bundle = entry.read_text(encoding="utf-8")

required = ("global-header-actions", "Open Project Assistant", "assistant-dock-open-button")
legacy = ("Project Assistant open", "max(calc(env(safe-area-inset-bottom")

missing = [value for value in required if value not in bundle]
present_legacy = [value for value in legacy if value in bundle]
if missing or present_legacy:
    raise SystemExit(
        f"Project Assistant bundle verification failed for {entry.name}: "
        f"missing={missing or 'none'}, legacy={present_legacy or 'none'}"
    )

print(f"Verified Project Assistant header launcher in {entry.name}")
