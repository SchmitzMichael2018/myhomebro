from __future__ import annotations

import re
from typing import Any


def normalize_region_token(value: str, *, preserve_digits: bool = True) -> str:
    """
    Normalize a location token into a deterministic uppercase slug.

    This key format is shared by seeded benchmarks, learned regional aggregates,
    and future estimator blending so regional matching stays auditable.
    """
    text = str(value or "").strip().upper()
    if not text:
        return ""
    text = text.replace(".", "")

    if preserve_digits:
        text = re.sub(r"[^A-Z0-9]+", "_", text)
    else:
        text = re.sub(r"[^A-Z]+", "_", text)
    return re.sub(r"_+", "_", text).strip("_")


def build_normalized_region_key(*, country: str = "US", state: str = "", city: str = "") -> str:
    """
    Build a future-friendly normalized region key with increasingly specific scopes:
    `US`, `US-TX`, `US-TX-SAN_ANTONIO`.
    """
    parts = [
        normalize_region_token(country or "US"),
        normalize_region_token(state),
        normalize_region_token(city),
    ]
    return "-".join(part for part in parts if part)


def split_normalized_region_key(region_key: str) -> dict[str, str]:
    text = str(region_key or "").strip().upper()
    if not text:
        return {"country": "", "state": "", "city": ""}
    parts = [part for part in text.split("-") if part]
    country = parts[0] if parts else ""
    state = parts[1] if len(parts) > 1 else ""
    city = "-".join(parts[2:]) if len(parts) > 2 else ""
    return {"country": country, "state": state, "city": city}


def _format_region_text(value: str) -> str:
    token = normalize_region_token(value, preserve_digits=False)
    if not token:
        return ""
    text = token.replace("_", " ").strip()
    return " ".join(part for part in text.title().split() if part)


def build_region_context(*, country: str = "US", state: str = "", city: str = "") -> dict[str, str]:
    country_text = normalize_region_token(country or "US") or "US"
    state_text = normalize_region_token(state)
    city_text = normalize_region_token(city)
    region_key = build_normalized_region_key(country=country_text, state=state_text, city=city_text)

    if city_text and state_text:
        region_label = f"{_format_region_text(city)} , {state_text}".replace(" ,", ",")
        region_granularity = "city"
    elif city_text:
        region_label = _format_region_text(city) or "Unknown region"
        region_granularity = "city"
    elif state_text:
        region_label = f"{state_text} statewide"
        region_granularity = "state"
    else:
        region_label = "Unknown region"
        region_granularity = "unknown"

    return {
        "country": country_text,
        "state": state_text,
        "city": city_text,
        "region_key": region_key,
        "region_label": region_label,
        "region_granularity": region_granularity,
    }


def build_region_hierarchy(*, country: str = "US", state: str = "", city: str = "") -> list[dict[str, str]]:
    context = build_region_context(country=country, state=state, city=city)
    if context["region_granularity"] == "unknown":
        return []

    hierarchy: list[dict[str, str]] = [context]
    if context["city"] and context["state"]:
        hierarchy.append(build_region_context(country=context["country"], state=context["state"]))

    deduped: list[dict[str, str]] = []
    seen: set[str] = set()
    for item in hierarchy:
        key = item.get("region_key", "")
        if not key or key in seen:
            continue
        seen.add(key)
        deduped.append(item)
    return deduped


def build_region_context_from_key(region_key: str) -> dict[str, str]:
    parts = split_normalized_region_key(region_key)
    return build_region_context(country=parts.get("country", ""), state=parts.get("state", ""), city=parts.get("city", ""))
