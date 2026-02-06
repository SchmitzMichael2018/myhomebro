# backend/projects/services/pdf/scope_filter.py
from __future__ import annotations

import re


def _norm_key(k: str) -> str:
    k = (k or "").strip().lower()
    k = k.replace("-", "_").replace(" ", "_")
    k = re.sub(r"[^a-z0-9_]", "", k)
    return k


_ASSUMPTION_KEYS_RAW = {
    "who_purchases_materials",
    "materials_purchasing",
    "materials_responsibility",
    "measurements_needed",
    "measurement_notes",
    "measurements_notes",
    "permits_inspections",
    "permits",
    "permit_acquisition",
    "permit_notes",
    "permits_notes",
    "allowances_selections",
    "allowances",
    "allowance_selections",
    "allowance_notes",
    "allowances_notes",
    # common camelCase variants seen in answers
    "measurementsRequired",
    "measurementDetails",
    "permitDetails",
    "allowanceRules",
    "materialsPurchasing",
    "materialsResponsibility",
}

_ASSUMPTION_KEYS: set[str] = set()
_ASSUMPTION_KEYS_NOUS: set[str] = set()
for k in _ASSUMPTION_KEYS_RAW:
    nk = _norm_key(k)
    _ASSUMPTION_KEYS.add(nk)
    _ASSUMPTION_KEYS_NOUS.add(nk.replace("_", ""))


def is_assumption_key(key: str) -> bool:
    nk = _norm_key(key)
    if not nk:
        return False
    if nk in _ASSUMPTION_KEYS:
        return True
    if nk.replace("_", "") in _ASSUMPTION_KEYS_NOUS:
        return True
    return False


def filter_scope_lines(lines: list[str]) -> list[str]:
    """
    Optional: if you build raw '<b>Label:</b> value' strings and want to drop
    duplicates by label.
    """
    out: list[str] = []
    seen: set[str] = set()

    for ln in lines:
        # crude label extraction: everything up to ':'
        try:
            label = re.split(r":</b>|:</b>|:</b> ", ln, maxsplit=1)[0]
        except Exception:
            label = ln

        key = _norm_key(label)
        if key in seen:
            continue
        seen.add(key)
        out.append(ln)

    return out
