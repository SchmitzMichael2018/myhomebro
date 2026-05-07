from __future__ import annotations

import json
import os
import re
from dataclasses import dataclass
from typing import Any

from django.conf import settings
from django.db.models import Q

from projects.models import Contractor
from projects.models_project_taxonomy import ProjectSubtype, ProjectType, normalized_key
from projects.services.ai.project_drafter import (
    _norm_text,
    _safe_str,
    build_classification_title,
    classify_type_subtype,
)


CONFIDENCE_LEVELS = {"high", "medium", "low"}
TYPE_ALIASES = {
    "outdoor": "Outdoor Living",
    "outdoor living": "Outdoor Living",
    "home theater": "Remodel",
    "media room": "Remodel",
    "junk removal": "Junk Removal",
    "siding": "Siding",
    "pool": "Pool",
}


@dataclass(frozen=True)
class _TaxonomyLookup:
    type_by_norm: dict[str, str]
    subtypes_by_type_norm: dict[str, dict[str, str]]


def _env_openai_api_key() -> str:
    return _safe_str(getattr(settings, "OPENAI_API_KEY", None) or os.getenv("OPENAI_API_KEY", ""))


def _json_dump(value: Any) -> str:
    return json.dumps(value, ensure_ascii=False, indent=2, default=str)


def _safe_json_loads(text: str) -> dict[str, Any] | None:
    try:
        parsed = json.loads(text)
    except Exception:
        return None
    return parsed if isinstance(parsed, dict) else None


def build_project_taxonomy_snapshot(contractor: Contractor | None = None) -> dict[str, Any]:
    type_qs = ProjectType.objects.filter(is_active=True, merged_into__isnull=True)
    if contractor is not None:
        type_qs = type_qs.filter(Q(is_system=True) | Q(contractor=contractor))
    else:
        type_qs = type_qs.filter(is_system=True, contractor__isnull=True)

    type_rows: list[dict[str, Any]] = []
    for project_type in type_qs.order_by("sort_order", "name").prefetch_related("subtypes"):
        subtype_rows = list(
            project_type.subtypes.filter(is_active=True, merged_into__isnull=True)
            .order_by("sort_order", "name")
            .values("id", "name", "normalized_name")
        )
        type_rows.append(
            {
                "id": project_type.id,
                "name": project_type.name,
                "normalized_name": project_type.normalized_name,
                "subtypes": subtype_rows,
            }
        )

    return {"types": type_rows}


def _taxonomy_lookup(taxonomy: dict[str, Any] | None) -> _TaxonomyLookup:
    type_by_norm: dict[str, str] = {}
    subtypes_by_type_norm: dict[str, dict[str, str]] = {}
    types = (taxonomy or {}).get("types") if isinstance(taxonomy, dict) else []

    for row in types or []:
        if not isinstance(row, dict):
            continue
        type_name = _safe_str(row.get("name"))
        if not type_name:
            continue
        type_norm = normalized_key(type_name)
        type_by_norm[type_norm] = type_name
        subtype_map: dict[str, str] = {}
        for subtype in row.get("subtypes") or []:
            if not isinstance(subtype, dict):
                continue
            subtype_name = _safe_str(subtype.get("name"))
            if not subtype_name:
                continue
            subtype_map[normalized_key(subtype_name)] = subtype_name
        subtypes_by_type_norm[type_norm] = subtype_map

    return _TaxonomyLookup(type_by_norm=type_by_norm, subtypes_by_type_norm=subtypes_by_type_norm)


def _normalize_confidence(value: Any, fallback: str = "low") -> str:
    confidence = _safe_str(value).lower()
    if confidence in CONFIDENCE_LEVELS:
        return confidence
    return fallback if fallback in CONFIDENCE_LEVELS else "low"


def _norm_choice(value: Any) -> str:
    return _safe_str(value)


def _resolve_type(value: Any, lookup: _TaxonomyLookup) -> str:
    candidate = _norm_choice(value)
    if not candidate:
        return ""
    direct = lookup.type_by_norm.get(normalized_key(candidate))
    if direct:
        return direct
    alias = TYPE_ALIASES.get(_norm_text(candidate))
    if alias:
        alias_direct = lookup.type_by_norm.get(normalized_key(alias))
        if alias_direct:
            return alias_direct
    return ""


def _resolve_subtype(project_type: str, value: Any, lookup: _TaxonomyLookup) -> str:
    candidate = _norm_choice(value)
    if not project_type or not candidate:
        return ""
    subtype_map = lookup.subtypes_by_type_norm.get(normalized_key(project_type), {})
    if not subtype_map:
        return ""
    direct = subtype_map.get(normalized_key(candidate))
    if direct:
        return direct
    return ""


def _friendly_title(project_type: str, project_subtype: str, description: str, scope: str) -> str:
    title = build_classification_title(project_type, project_subtype, "", scope or description)
    if title:
        return title
    if project_subtype:
        return project_subtype
    if project_type:
        return f"{project_type} Project"
    return "Project Starting Point"


def _score_alternative(text: str, project_type: str, project_subtype: str) -> int:
    hay = _norm_text(text)
    score = 0
    label = f"{project_type} {project_subtype}".strip()
    for token in re.split(r"[^a-z0-9]+", _norm_text(label)):
        if token and token in hay:
            score += 2
    if project_subtype and _norm_text(project_subtype) in hay:
        score += 4
    return score


def _build_alternatives(
    *,
    text: str,
    lookup: _TaxonomyLookup,
    primary: dict[str, Any],
    current_values: dict[str, Any] | None = None,
) -> list[dict[str, Any]]:
    current_values = current_values or {}
    primary_key = (
        normalized_key(primary.get("project_type") or ""),
        normalized_key(primary.get("project_subtype") or ""),
    )
    options: list[tuple[int, str, str]] = []

    for type_norm, type_name in lookup.type_by_norm.items():
        subtype_map = lookup.subtypes_by_type_norm.get(type_norm, {})
        if subtype_map:
            for subtype_name in subtype_map.values():
                options.append((_score_alternative(text, type_name, subtype_name), type_name, subtype_name))
        else:
            options.append((_score_alternative(text, type_name, ""), type_name, ""))

    current_type = _resolve_type(current_values.get("project_type"), lookup)
    current_subtype = _resolve_subtype(current_type, current_values.get("project_subtype"), lookup)
    if current_type:
        options.append((_score_alternative(text, current_type, current_subtype), current_type, current_subtype))

    unique: list[dict[str, Any]] = []
    seen: set[tuple[str, str]] = {primary_key}
    for _, type_name, subtype_name in sorted(options, key=lambda item: item[0], reverse=True):
        key = (normalized_key(type_name), normalized_key(subtype_name))
        if key in seen:
            continue
        if not type_name:
            continue
        seen.add(key)
        unique.append(
            {
                "project_type": type_name,
                "project_subtype": subtype_name,
                "project_title": _friendly_title(type_name, subtype_name, text, text),
            }
        )
        if len(unique) >= 3:
            break

    return unique[:3]


def _call_openai_classifier(
    *,
    description: str,
    scope: str,
    taxonomy: dict[str, Any],
    current_values: dict[str, Any] | None = None,
) -> dict[str, Any] | None:
    api_key = _env_openai_api_key()
    if not api_key:
        return None

    try:
        from openai import OpenAI  # type: ignore
    except Exception:
        return None

    model = (
        getattr(settings, "OPENAI_PROJECT_CLASSIFIER_MODEL", None)
        or getattr(settings, "OPENAI_MODEL", None)
        or "gpt-4o-mini"
    )

    schema = {
        "type": "object",
        "properties": {
            "project_type": {"type": "string"},
            "project_subtype": {"type": "string"},
            "project_title": {"type": "string"},
            "confidence": {"type": "string", "enum": ["high", "medium", "low"]},
            "reason": {"type": "string"},
            "recommended_custom_subtype": {"type": ["string", "null"]},
            "alternatives": {
                "type": "array",
                "items": {
                    "type": "object",
                    "properties": {
                        "project_type": {"type": "string"},
                        "project_subtype": {"type": "string"},
                        "project_title": {"type": "string"},
                    },
                    "required": ["project_type", "project_subtype", "project_title"],
                    "additionalProperties": False,
                },
            },
        },
        "required": [
            "project_type",
            "project_subtype",
            "project_title",
            "confidence",
            "reason",
            "alternatives",
        ],
        "additionalProperties": False,
    }

    system = (
        "You classify contractor jobs into a project taxonomy. "
        "Use the generated scope as the strongest signal, then the original description. "
        "Choose only from the provided project types and subtypes. "
        "If no exact subtype exists, pick the closest valid project type and return a recommended_custom_subtype separately. "
        "Never reuse stale values from prior requests unless the current text clearly supports them. "
        "Return only valid JSON matching the schema."
    )

    user = _json_dump(
        {
            "description": description,
            "scope": scope,
            "current_values": current_values or {},
            "taxonomy": taxonomy,
        }
    )

    client = OpenAI(api_key=api_key)
    resp = client.responses.create(
        model=model,
        input=[
            {"role": "system", "content": system},
            {"role": "user", "content": user},
        ],
        response_format={
            "type": "json_schema",
            "json_schema": {
                "name": "project_classification",
                "strict": True,
                "schema": schema,
            },
        },
        temperature=0.1,
    )

    text = getattr(resp, "output_text", "") or ""
    if not text and isinstance(getattr(resp, "output", None), list):
        text = json.dumps(getattr(resp, "output"), default=str)
    if not text:
        return None

    return _safe_json_loads(text)


def _normalize_candidate(result: dict[str, Any] | None, lookup: _TaxonomyLookup) -> dict[str, Any] | None:
    if not isinstance(result, dict):
        return None

    project_type = _resolve_type(result.get("project_type"), lookup)
    project_subtype = _resolve_subtype(project_type, result.get("project_subtype"), lookup)
    recommended_custom_subtype = _safe_str(result.get("recommended_custom_subtype"))
    confidence = _normalize_confidence(result.get("confidence"), fallback="medium")
    reason = _safe_str(result.get("reason"))
    alternatives = result.get("alternatives") if isinstance(result.get("alternatives"), list) else []

    if not project_type:
        return None

    normalized_alternatives: list[dict[str, Any]] = []
    for alt in alternatives or []:
        if not isinstance(alt, dict):
            continue
        alt_type = _resolve_type(alt.get("project_type"), lookup)
        alt_subtype = _resolve_subtype(alt_type, alt.get("project_subtype"), lookup)
        if not alt_type:
            continue
        key = (normalized_key(alt_type), normalized_key(alt_subtype))
        if any(
            key == (normalized_key(item.get("project_type")), normalized_key(item.get("project_subtype")))
            for item in normalized_alternatives
        ):
            continue
        normalized_alternatives.append(
            {
                "project_type": alt_type,
                "project_subtype": alt_subtype,
                "project_title": _friendly_title(alt_type, alt_subtype, result.get("project_title") or "", result.get("project_title") or ""),
            }
        )
        if len(normalized_alternatives) >= 3:
            break

    if not project_subtype and recommended_custom_subtype:
        confidence = "low" if confidence == "high" else confidence

    project_title = _friendly_title(
        project_type,
        project_subtype,
        _safe_str(result.get("project_title") or ""),
        _safe_str(result.get("project_title") or ""),
    )

    return {
        "project_type": project_type,
        "project_subtype": project_subtype,
        "project_title": project_title,
        "confidence": confidence,
        "confidence_label": f"{confidence.title()} confidence",
        "reason": reason,
        "alternatives": normalized_alternatives,
        "recommended_custom_subtype": recommended_custom_subtype,
        "classification_source": "ai",
    }


def _fallback_classification(
    *,
    description: str,
    scope: str,
    current_values: dict[str, Any] | None = None,
) -> dict[str, Any]:
    current_values = current_values or {}
    project_type, project_subtype, reason = classify_type_subtype(
        project_title=_safe_str(current_values.get("project_title")),
        description=description,
        scope_text=scope,
        requested_type=_safe_str(current_values.get("project_type")),
        requested_subtype=_safe_str(current_values.get("project_subtype")),
    )

    if not project_type:
        project_type = _safe_str(current_values.get("project_type")) or "Remodel"
    if not project_subtype:
        project_subtype = _safe_str(current_values.get("project_subtype"))

    project_title = build_classification_title(project_type, project_subtype, _safe_str(current_values.get("project_title")), scope or description)
    if not project_title:
        project_title = _friendly_title(project_type, project_subtype, description, scope)

    return {
        "project_type": project_type,
        "project_subtype": project_subtype,
        "project_title": project_title,
        "confidence": "medium" if project_type and project_subtype else "low",
        "confidence_label": "Recommended from your description",
        "reason": reason or "Matched the dominant project intent from the description and scope.",
        "alternatives": [],
        "recommended_custom_subtype": "",
        "classification_source": "fallback",
    }


def classify_project_from_scope(
    *,
    description: str,
    scope: str,
    taxonomy: dict[str, Any] | None = None,
    current_values: dict[str, Any] | None = None,
    contractor: Contractor | None = None,
) -> dict[str, Any]:
    description = _safe_str(description)
    scope = _safe_str(scope)
    current_values = current_values or {}
    taxonomy = taxonomy or build_project_taxonomy_snapshot(contractor=contractor)
    lookup = _taxonomy_lookup(taxonomy)

    candidate = _call_openai_classifier(
        description=description,
        scope=scope,
        taxonomy=taxonomy,
        current_values={
            "project_type": _safe_str(current_values.get("project_type")),
            "project_subtype": _safe_str(current_values.get("project_subtype")),
            "project_title": _safe_str(current_values.get("project_title")),
        },
    )
    normalized_candidate = _normalize_candidate(candidate, lookup) if candidate else None
    fallback = _fallback_classification(
        description=description,
        scope=scope,
        current_values=current_values,
    )

    if not normalized_candidate:
        fallback["alternatives"] = _build_alternatives(
            text=f"{scope}\n{description}",
            lookup=lookup,
            primary=fallback,
            current_values=current_values,
        )
        return fallback

    candidate_type = normalized_candidate.get("project_type", "")
    candidate_subtype = normalized_candidate.get("project_subtype", "")
    if candidate_type not in lookup.type_by_norm.values():
        fallback["alternatives"] = _build_alternatives(
            text=f"{scope}\n{description}",
            lookup=lookup,
            primary=fallback,
            current_values=current_values,
        )
        return fallback

    if candidate_subtype:
        subtype_map = lookup.subtypes_by_type_norm.get(normalized_key(candidate_type), {})
        if candidate_subtype not in subtype_map.values():
            fallback["project_type"] = candidate_type
            fallback["project_subtype"] = ""
            fallback["project_title"] = _friendly_title(candidate_type, "", description, scope)
            fallback["confidence"] = "low"
            fallback["confidence_label"] = "Review recommended category"
            fallback["reason"] = normalized_candidate.get("reason") or fallback["reason"]
            fallback["recommended_custom_subtype"] = _safe_str(candidate.get("recommended_custom_subtype") if candidate else "")
            fallback["alternatives"] = normalized_candidate.get("alternatives") or _build_alternatives(
                text=f"{scope}\n{description}",
                lookup=lookup,
                primary=fallback,
                current_values=current_values,
            )
            return fallback

    result = {
        **normalized_candidate,
        "project_title": normalized_candidate.get("project_title") or _friendly_title(candidate_type, candidate_subtype, description, scope),
        "alternatives": normalized_candidate.get("alternatives")
        or _build_alternatives(
            text=f"{scope}\n{description}",
            lookup=lookup,
            primary=normalized_candidate,
            current_values=current_values,
        ),
    }

    if not result.get("confidence_label"):
        result["confidence_label"] = f"{_normalize_confidence(result.get('confidence'), 'low').title()} confidence"
    if not result.get("reason"):
        result["reason"] = fallback.get("reason") or "Matched the dominant project intent from the description and scope."

    return result

