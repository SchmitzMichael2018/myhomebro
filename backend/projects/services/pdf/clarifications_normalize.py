"""
backend/projects/services/pdf/clarifications_normalize.py
v2026-01-29 — Clarifications normalization for PDF output

Goal:
- Avoid duplicate meaning lines in PDFs, e.g.:
  "Permits Inspections: Electric Permit"
  "Permits: Electric Permit"
  "Permit Notes: Electric Permit"

This module normalizes the "yellow" assumptions/responsibilities fields into a single
canonical structure for display/export.

Safe:
- Does not change DB schema
- Backward compatible with legacy keys found in:
  - agreement.ai_scope.answers
  - top-level agreement fields

Usage (inside your PDF generator):
    from projects.services.pdf.clarifications_normalize import normalize_assumptions_for_export

    norm = normalize_assumptions_for_export(agreement_dict_or_model)
    # then render norm["permits"], norm["permit_details"], etc.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Dict, Optional


def _get_attr(obj: Any, key: str) -> Any:
    """Read key from dict-like OR attribute-like objects."""
    if obj is None:
        return None
    if isinstance(obj, dict):
        return obj.get(key)
    return getattr(obj, key, None)


def _pick(*vals: Any) -> Any:
    for v in vals:
        if v is None:
            continue
        if isinstance(v, str) and v.strip() == "":
            continue
        return v
    return ""


def _to_bool(v: Any) -> bool:
    if v is True:
        return True
    if v is False:
        return False
    if isinstance(v, str):
        s = v.strip().lower()
        if s in ("true", "yes", "y", "1"):
            return True
        if s in ("false", "no", "n", "0"):
            return False
    return bool(v)


def _dedupe(main: str, details: str) -> str:
    m = (main or "").strip()
    d = (details or "").strip()
    if not d:
        return ""
    if not m:
        return d
    if m.lower() == d.lower():
        return ""
    return d


def normalize_assumptions_for_export(agreement: Any) -> Dict[str, Any]:
    """
    Returns canonical assumptions/responsibilities fields:

    {
      "who_purchases_materials": str,
      "measurements_needed": bool,
      "measurement_details": str,
      "permits": str,
      "permit_details": str,
      "allowances": str,
      "allowance_rules": str,
      "has_any": bool,
    }
    """
    if agreement is None:
        return {
            "who_purchases_materials": "",
            "measurements_needed": False,
            "measurement_details": "",
            "permits": "",
            "permit_details": "",
            "allowances": "",
            "allowance_rules": "",
            "has_any": False,
        }

    ai_scope = _get_attr(agreement, "ai_scope") or {}
    answers = ai_scope.get("answers") if isinstance(ai_scope, dict) else _get_attr(ai_scope, "answers") or {}
    if answers is None:
        answers = {}

    # Materials
    who = _pick(
        answers.get("who_purchases_materials"),
        answers.get("materials_purchasing"),
        answers.get("materials_responsibility"),
        _get_attr(agreement, "who_purchases_materials"),
        _get_attr(agreement, "materials_purchasing"),
        _get_attr(agreement, "materials_responsibility"),
    )

    # Measurements
    meas_needed_raw = _pick(
        answers.get("measurements_needed"),
        answers.get("measurementsRequired"),
        _get_attr(agreement, "measurements_needed"),
        _get_attr(agreement, "measurementsRequired"),
    )
    meas_needed = _to_bool(meas_needed_raw)

    meas_details = _pick(
        answers.get("measurement_notes"),
        answers.get("measurements_notes"),
        answers.get("measurementDetails"),
        _get_attr(agreement, "measurement_notes"),
        _get_attr(agreement, "measurements_notes"),
        _get_attr(agreement, "measurementDetails"),
    )

    # Permits
    permits = _pick(
        answers.get("permits_inspections"),
        answers.get("permits"),
        answers.get("permit_acquisition"),
        _get_attr(agreement, "permits_inspections"),
        _get_attr(agreement, "permits"),
        _get_attr(agreement, "permit_acquisition"),
    )

    permit_details_raw = _pick(
        answers.get("permit_notes"),
        answers.get("permits_notes"),
        answers.get("permitDetails"),
        _get_attr(agreement, "permit_notes"),
        _get_attr(agreement, "permits_notes"),
        _get_attr(agreement, "permitDetails"),
    )
    permit_details = _dedupe(str(permits or ""), str(permit_details_raw or ""))

    # Allowances
    allowances = _pick(
        answers.get("allowances_selections"),
        answers.get("allowances"),
        answers.get("allowance_selections"),
        _get_attr(agreement, "allowances_selections"),
        _get_attr(agreement, "allowances"),
        _get_attr(agreement, "allowance_selections"),
    )

    allowance_rules_raw = _pick(
        answers.get("allowance_notes"),
        answers.get("allowances_notes"),
        answers.get("allowanceRules"),
        _get_attr(agreement, "allowance_notes"),
        _get_attr(agreement, "allowances_notes"),
        _get_attr(agreement, "allowanceRules"),
    )
    allowance_rules = _dedupe(str(allowances or ""), str(allowance_rules_raw or ""))

    who_s = str(who or "").strip()
    meas_details_s = str(meas_details or "").strip()
    permits_s = str(permits or "").strip()
    allowances_s = str(allowances or "").strip()

    has_any = bool(
        who_s
        or meas_details_s
        or permits_s
        or permit_details
        or allowances_s
        or allowance_rules
        or meas_needed is True
    )

    return {
        "who_purchases_materials": who_s,
        "measurements_needed": meas_needed,
        "measurement_details": meas_details_s,
        "permits": permits_s,
        "permit_details": str(permit_details or "").strip(),
        "allowances": allowances_s,
        "allowance_rules": str(allowance_rules or "").strip(),
        "has_any": has_any,
    }
