from __future__ import annotations

import re


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
