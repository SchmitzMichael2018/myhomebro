# backend/projects/utils/clarifications.py
# v2026-01-26 — Unified extraction of Scope Clarifications for PDFs / emails / UI
#
# Your frontend stores clarifications into agreement.ai_scope.answers (and mirrors into
# agreement.scope_clarifications if your API exposes it).
#
# Update your PDF generator to call `extract_scope_clarifications(agreement)` and render the returned
# list instead of printing "No Clarifications provided".

from __future__ import annotations

from typing import Any, Dict, List


def _title_case_from_key(key: str) -> str:
    return " ".join([w.capitalize() for w in key.replace("_", " ").split()])


def extract_scope_clarifications(agreement: Any) -> List[Dict[str, str]]:
    if agreement is None:
        return []

    # 1) ai_scope questions + answers (preferred labels)
    ai_scope = getattr(agreement, "ai_scope", None) or {}
    questions = ai_scope.get("questions") if isinstance(ai_scope, dict) else None
    answers = ai_scope.get("answers") if isinstance(ai_scope, dict) else None

    out: List[Dict[str, str]] = []

    if isinstance(questions, list) and isinstance(answers, dict):
        for q in questions:
            key = (q or {}).get("key")
            if not key:
                continue
            val = answers.get(key)
            if val is None:
                continue
            val_str = str(val).strip()
            if not val_str:
                continue
            label = (q or {}).get("label") or _title_case_from_key(str(key))
            out.append({"label": str(label), "value": val_str})
        if out:
            return out

    # 2) scope_clarifications dict (if exists)
    sc = getattr(agreement, "scope_clarifications", None)
    if isinstance(sc, dict):
        for k, v in sc.items():
            if v is None:
                continue
            v_str = str(v).strip()
            if not v_str:
                continue
            out.append({"label": _title_case_from_key(str(k)), "value": v_str})
        if out:
            return out

    # 3) ai_scope answers dict (fallback)
    if isinstance(answers, dict):
        for k, v in answers.items():
            if v is None:
                continue
            v_str = str(v).strip()
            if not v_str:
                continue
            out.append({"label": _title_case_from_key(str(k)), "value": v_str})

    return out
