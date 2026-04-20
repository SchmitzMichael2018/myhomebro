from __future__ import annotations

from decimal import Decimal, InvalidOperation
import math
import re
from typing import Any


_NUMBER_WORDS = {
    "one": 1,
    "two": 2,
    "three": 3,
    "four": 4,
    "five": 5,
    "six": 6,
    "seven": 7,
    "eight": 8,
    "nine": 9,
    "ten": 10,
    "eleven": 11,
    "twelve": 12,
}


_SQUARE_FOOTAGE_KEYS = {
    "square_footage",
    "square_feet",
    "square_foot",
    "sq_ft",
    "sqft",
    "project_size",
    "size_sqft",
}


_LINEAR_FEET_KEYS = {
    "linear_feet",
    "linear_foot",
    "linear_ft",
    "lin_ft",
    "lf",
}


_COUNT_KEY_HINTS: dict[str, str] = {
    "cabinet": "cabinets",
    "fixture": "fixtures",
    "window": "windows",
    "door": "doors",
    "opening": "openings",
    "room": "rooms",
    "area": "areas",
    "item": "items",
    "task": "tasks",
    "unit": "units",
    "bath": "bathrooms",
    "bathroom": "bathrooms",
    "bedroom": "bedrooms",
    "outlet": "outlets",
    "switch": "switches",
    "panel": "panels",
    "pipe": "pipes",
    "line": "lines",
}


_FAMILY_BASELINES: dict[str, dict[str, int]] = {
    "roofing": {"square_footage": 2200},
    "bathroom_remodel": {"count": 1, "room_count": 1, "fixture_count": 4, "square_footage": 80},
    "kitchen_remodel": {"cabinet_count": 12, "linear_feet": 24, "square_footage": 220},
    "flooring": {"square_footage": 1000, "room_count": 2},
    "painting": {"square_footage": 1200, "room_count": 2},
    "electrical": {"count": 4, "fixture_count": 4, "item_count": 4},
    "plumbing": {"count": 4, "fixture_count": 4, "item_count": 4},
    "exterior_siding": {"square_footage": 900},
    "windows_doors": {"count": 4, "window_count": 4, "door_count": 2, "opening_count": 4},
    "handyman": {"count": 3, "task_count": 3, "item_count": 3},
    "general": {"count": 1, "square_footage": 500, "linear_feet": 20},
}


def _safe_text(value: Any) -> str:
    return "" if value is None else str(value).strip()


def _normalize_text(value: Any) -> str:
    return " ".join(_safe_text(value).lower().replace("&", " and ").replace("/", " ").replace("-", " ").split())


def _safe_decimal(value: Any) -> Decimal | None:
    if value in (None, "", []):
        return None
    try:
        return Decimal(str(value))
    except (InvalidOperation, TypeError, ValueError):
        return None


def _quantity_label(number: Decimal | int | float | None, unit: str) -> str:
    if number in (None, ""):
        return ""
    if unit in {"sq ft", "linear ft"}:
        try:
            value = int(round(float(number)))
            return f"{value:,} {unit}"
        except Exception:
            return f"{number} {unit}".strip()
    try:
        value = int(round(float(number)))
        singular = unit[:-1] if unit.endswith("s") and not unit.endswith("ss") else unit
        if value == 1 and singular:
            return f"{value} {singular}"
        return f"{value:,} {unit}".strip()
    except Exception:
        return f"{number} {unit}".strip()


def _normalize_key(value: Any) -> str:
    return _normalize_text(value).replace(" ", "_")


def _number_from_text(value: Any) -> Decimal | None:
    text = _safe_text(value).lower().replace(",", "")
    if not text:
        return None
    range_match = re.search(r"\b(\d+(?:\.\d+)?)\s*(?:-|to)\s*(\d+(?:\.\d+)?)\b", text)
    if range_match:
        low = _safe_decimal(range_match.group(1))
        high = _safe_decimal(range_match.group(2))
        if low is not None and high is not None:
            return (low + high) / Decimal("2")

    numeric_match = re.search(r"\b(\d+(?:\.\d+)?)\b", text)
    if numeric_match:
        return _safe_decimal(numeric_match.group(1))

    for word, number in _NUMBER_WORDS.items():
        if re.search(rf"\b{re.escape(word)}\b", text):
            return Decimal(str(number))
    return None


def _infer_unit_from_text(key: str, value: Any, *, quantity_type: str) -> str:
    text = _normalize_text(value)
    key_text = _normalize_key(key)

    if quantity_type == "square_footage":
        return "sq ft"
    if quantity_type == "linear_feet":
        return "linear ft"

    count_unit = ""
    for needle, unit in _COUNT_KEY_HINTS.items():
        if needle in key_text or needle in text:
            count_unit = unit
            break

    if not count_unit:
        if "bath" in key_text or "bath" in text:
            count_unit = "bathrooms"
        elif "room" in key_text or "room" in text:
            count_unit = "rooms"
        elif "area" in key_text or "area" in text:
            count_unit = "areas"

    return count_unit or "items"


def _family_baseline_value(family_key: str, quantity_type: str, quantity_unit: str) -> int:
    family = _FAMILY_BASELINES.get(_safe_text(family_key).lower(), _FAMILY_BASELINES["general"])
    if quantity_type == "square_footage":
        return int(family.get("square_footage") or _FAMILY_BASELINES["general"]["square_footage"])
    if quantity_type == "linear_feet":
        return int(family.get("linear_feet") or _FAMILY_BASELINES["general"]["linear_feet"])

    unit = _safe_text(quantity_unit).lower()
    for key, baseline in family.items():
        if key in {"square_footage", "linear_feet"}:
            continue
        if key == "count" and unit in {"items", "units"}:
            return int(baseline)
        if key in unit:
            return int(baseline)
    return int(family.get("count") or 1)


def _candidate_from_key_value(*, key: str, value: Any, source: str) -> dict[str, Any] | None:
    key_text = _normalize_key(key)
    value_text = _safe_text(value)
    if not key_text or not value_text:
        return None

    if any(needle in key_text for needle in _SQUARE_FOOTAGE_KEYS):
        number = _number_from_text(value_text)
        if number is None:
            return None
        return {
            "quantity_type": "square_footage",
            "quantity_value": number,
            "quantity_unit": "sq ft",
            "quantity_source": source,
            "confidence": "high",
            "score": 100,
            "reason": f"Square footage was stated in {source.replace('_', ' ')}.",
        }

    if any(needle in key_text for needle in _LINEAR_FEET_KEYS):
        number = _number_from_text(value_text)
        if number is None:
            return None
        return {
            "quantity_type": "linear_feet",
            "quantity_value": number,
            "quantity_unit": "linear ft",
            "quantity_source": source,
            "confidence": "high",
            "score": 95,
            "reason": f"Linear footage was stated in {source.replace('_', ' ')}.",
        }

    for needle, unit in _COUNT_KEY_HINTS.items():
        if needle in key_text:
            number = _number_from_text(value_text)
            if number is None and key_text in {"area_count", "room_count"}:
                return None
            if number is None and re.search(r"\b(multiple|several|whole|entire)\b", value_text.lower()):
                return {
                    "quantity_type": "count",
                    "quantity_value": None,
                    "quantity_unit": unit,
                    "quantity_source": source,
                    "confidence": "low",
                    "score": 20,
                    "reason": f"The request mentions {value_text.lower()} for {unit}.",
                }
            if number is None:
                return None
            return {
                "quantity_type": "count",
                "quantity_value": number,
                "quantity_unit": unit,
                "quantity_source": source,
                "confidence": "high",
                "score": 90,
                "reason": f"A {unit.rstrip('s')} count was stated in {source.replace('_', ' ')}.",
            }

    return None


def _candidate_from_text(text: str, *, source: str, family_key: str = "", project_subtype: str = "") -> dict[str, Any] | None:
    normalized = _normalize_text(text)
    if not normalized:
        return None

    explicit_patterns: list[tuple[str, str, re.Pattern[str]]] = [
        (
            "square_footage",
            "sq ft",
            re.compile(r"\b(\d+(?:,\d{3})*(?:\.\d+)?)\s*(?:sq\.?\s*ft|sqft|square feet|square foot|sf)\b", re.I),
        ),
        (
            "linear_feet",
            "linear ft",
            re.compile(r"\b(\d+(?:,\d{3})*(?:\.\d+)?)\s*(?:linear\s*(?:feet|foot)|lin\s*ft|lf)\b", re.I),
        ),
        (
            "count",
            "cabinets",
            re.compile(r"\b(\d+(?:,\d{3})*(?:\.\d+)?)\s*(?:cabinets?|fixtures?|windows?|doors?|openings?|rooms?|areas?|items?|tasks?|units?)\b", re.I),
        ),
    ]

    for quantity_type, unit, pattern in explicit_patterns:
        match = pattern.search(normalized)
        if not match:
            continue
        number = _safe_decimal(match.group(1))
        if number is None:
            continue
        if quantity_type == "count":
            unit = _infer_unit_from_text(project_subtype or family_key or unit, normalized, quantity_type="count")
        return {
            "quantity_type": quantity_type,
            "quantity_value": number,
            "quantity_unit": unit,
            "quantity_source": source,
            "confidence": "high",
            "score": 70 if quantity_type == "count" else 80,
            "reason": f"An explicit quantity was mentioned in {source.replace('_', ' ')}.",
        }

    # Family-specific gentle inference for "one bathroom", "multiple rooms", etc.
    for needle in ("bathroom", "room", "area", "cabinet", "fixture", "window", "door", "opening", "task", "item"):
        if needle not in normalized:
            continue
        number = _number_from_text(normalized)
        if number is None:
            continue
        unit = _infer_unit_from_text(needle, normalized, quantity_type="count")
        score = 60
        if family_key and needle in _normalize_key(project_subtype or family_key):
            score += 10
        return {
            "quantity_type": "count",
            "quantity_value": number,
            "quantity_unit": unit,
            "quantity_source": source,
            "confidence": "medium",
            "score": score,
            "reason": f"A {unit.rstrip('s')} count was inferred from {source.replace('_', ' ')}.",
        }

    return None


def _build_candidates(
    *,
    project_title: str = "",
    project_type: str = "",
    project_subtype: str = "",
    description: str = "",
    project_scope_summary: str = "",
    clarification_answers: dict[str, Any] | None = None,
    family_key: str = "",
) -> list[dict[str, Any]]:
    candidates: list[dict[str, Any]] = []
    combined = " ".join(
        part for part in [project_title, project_type, project_subtype, description, project_scope_summary] if _safe_text(part)
    ).strip()

    answers = dict(clarification_answers or {})
    for raw_key, raw_value in answers.items():
        candidate = _candidate_from_key_value(key=raw_key, value=raw_value, source="clarification_answers")
        if candidate is None:
            candidate = _candidate_from_text(
                _safe_text(raw_value),
                source="clarification_answers",
                family_key=family_key,
                project_subtype=project_subtype,
            )
        if candidate is not None:
            candidate["key"] = _normalize_key(raw_key)
            candidates.append(candidate)

    if combined:
        text_candidate = _candidate_from_text(
            combined,
            source="project_description",
            family_key=family_key,
            project_subtype=project_subtype,
        )
        if text_candidate is not None:
            candidates.append(text_candidate)

    return candidates


def _candidate_rank(candidate: dict[str, Any], *, family_key: str, project_subtype: str) -> tuple[int, int, int]:
    score = int(candidate.get("score") or 0)
    quantity_type = _safe_text(candidate.get("quantity_type"))
    quantity_unit = _safe_text(candidate.get("quantity_unit"))
    family_key_l = _safe_text(family_key).lower()
    subtype_l = _safe_text(project_subtype).lower()

    if family_key_l == "roofing" and quantity_type == "square_footage":
        score += 20
    elif family_key_l in {"flooring", "painting", "exterior_siding"} and quantity_type == "square_footage":
        score += 18
    elif family_key_l == "kitchen_remodel" and quantity_unit in {"cabinets", "linear ft", "sq ft"}:
        score += 20
    elif family_key_l == "bathroom_remodel" and quantity_unit in {"bathrooms", "fixtures", "sq ft"}:
        score += 18
    elif family_key_l in {"windows_doors", "electrical", "plumbing"} and quantity_type == "count":
        score += 16
    elif family_key_l == "handyman" and quantity_type == "count":
        score += 10

    if subtype_l and quantity_unit and quantity_unit.rstrip("s") in subtype_l:
        score += 8
    if quantity_type == "square_footage" and quantity_unit == "sq ft":
        score += 6
    if quantity_type == "linear_feet" and quantity_unit == "linear ft":
        score += 6
    return score, 1 if candidate.get("quantity_source") == "clarification_answers" else 0, 1 if candidate.get("confidence") == "high" else 0


def build_quantity_context(
    *,
    project_title: str = "",
    project_type: str = "",
    project_subtype: str = "",
    description: str = "",
    project_scope_summary: str = "",
    clarification_answers: dict[str, Any] | None = None,
    family_key: str = "",
) -> dict[str, Any]:
    candidates = _build_candidates(
        project_title=project_title,
        project_type=project_type,
        project_subtype=project_subtype,
        description=description,
        project_scope_summary=project_scope_summary,
        clarification_answers=clarification_answers,
        family_key=family_key,
    )

    if not candidates:
        return {
            "quantity_type": "",
            "quantity_value": None,
            "quantity_unit": "",
            "quantity_label": "",
            "quantity_source": "",
            "quantity_confidence": "none",
            "quantity_signals": [],
            "quantity_reason": "",
            "quantity_reference_value": None,
            "quantity_scale_factor": "1.00",
            "quantity_ratio": "1.00",
        }

    candidates.sort(key=lambda candidate: _candidate_rank(candidate, family_key=family_key, project_subtype=project_subtype), reverse=True)
    primary = candidates[0]
    quantity_value = _safe_decimal(primary.get("quantity_value"))
    quantity_type = _safe_text(primary.get("quantity_type"))
    quantity_unit = _safe_text(primary.get("quantity_unit"))
    baseline = _family_baseline_value(family_key, quantity_type, quantity_unit)

    ratio = Decimal("1.00")
    scale = Decimal("1.00")
    if quantity_value is not None and quantity_value > 0 and baseline > 0:
        ratio = (quantity_value / Decimal(str(baseline))).quantize(Decimal("0.01"))
        if quantity_type == "square_footage":
            scale = Decimal(str(max(0.70, min(1.80, math.sqrt(float(ratio))))))
        elif quantity_type == "linear_feet":
            scale = Decimal(str(max(0.75, min(1.70, float(ratio) ** 0.45))))
        else:
            scale = Decimal(str(max(0.80, min(1.60, float(ratio) ** 0.40))))

    label = _quantity_label(quantity_value, quantity_unit) if quantity_value is not None else ""
    reason = _safe_text(primary.get("reason"))
    if quantity_value is not None and baseline > 0:
        reason = reason or f"Using about {label} against a baseline of about {_quantity_label(baseline, quantity_unit)}."

    return {
        "quantity_type": quantity_type,
        "quantity_value": int(quantity_value) if quantity_value is not None and quantity_value == quantity_value.to_integral_value() else float(quantity_value) if quantity_value is not None else None,
        "quantity_unit": quantity_unit,
        "quantity_label": label,
        "quantity_source": _safe_text(primary.get("quantity_source")),
        "quantity_confidence": _safe_text(primary.get("confidence")) or "low",
        "quantity_signals": [
            {
                "quantity_type": _safe_text(candidate.get("quantity_type")),
                "quantity_value": int(candidate["quantity_value"]) if candidate.get("quantity_value") is not None and _safe_decimal(candidate.get("quantity_value")) == _safe_decimal(candidate.get("quantity_value")).to_integral_value() else float(_safe_decimal(candidate.get("quantity_value"))) if candidate.get("quantity_value") is not None else None,
                "quantity_unit": _safe_text(candidate.get("quantity_unit")),
                "quantity_source": _safe_text(candidate.get("quantity_source")),
                "quantity_confidence": _safe_text(candidate.get("confidence")),
                "reason": _safe_text(candidate.get("reason")),
            }
            for candidate in candidates[:4]
        ],
        "quantity_reason": reason,
        "quantity_reference_value": baseline,
        "quantity_scale_factor": str(scale.quantize(Decimal("0.01"))),
        "quantity_ratio": str(ratio.quantize(Decimal("0.01"))),
    }


def build_quantity_adjustment(
    *,
    quantity_context: dict[str, Any] | None = None,
    family_key: str = "",
    project_subtype: str = "",
) -> dict[str, Any]:
    context = dict(quantity_context or {})
    quantity_type = _safe_text(context.get("quantity_type"))
    quantity_unit = _safe_text(context.get("quantity_unit"))
    quantity_value = _safe_decimal(context.get("quantity_value"))
    baseline = int(_safe_decimal(context.get("quantity_reference_value")) or _family_baseline_value(family_key, quantity_type, quantity_unit))

    if quantity_value is None or quantity_value <= 0 or baseline <= 0:
        return {
            "applied": False,
            "price_scale": Decimal("1.00"),
            "duration_scale": Decimal("1.00"),
            "milestone_scale": Decimal("1.00"),
            "quantity_milestone_count": 0,
            "reason": "",
            "baseline_value": baseline,
            "quantity_ratio": Decimal("1.00"),
            "quantity_label": _safe_text(context.get("quantity_label")),
            "quantity_source": _safe_text(context.get("quantity_source")),
            "quantity_confidence": _safe_text(context.get("quantity_confidence")) or "none",
        }

    ratio = max(float(quantity_value / Decimal(str(baseline))), 0.1)
    quantity_type_l = quantity_type.lower()
    if quantity_type_l == "square_footage":
        price_scale = Decimal(str(max(0.70, min(1.80, math.sqrt(ratio)))))
        duration_scale = Decimal(str(max(0.80, min(1.60, ratio ** 0.35))))
        milestone_scale = Decimal(str(max(0.90, min(1.35, ratio ** 0.20))))
    elif quantity_type_l == "linear_feet":
        price_scale = Decimal(str(max(0.75, min(1.70, ratio ** 0.45))))
        duration_scale = Decimal(str(max(0.85, min(1.50, ratio ** 0.30))))
        milestone_scale = Decimal(str(max(0.90, min(1.30, ratio ** 0.18))))
    else:
        price_scale = Decimal(str(max(0.75, min(1.75, ratio ** 0.40))))
        duration_scale = Decimal(str(max(0.85, min(1.50, ratio ** 0.28))))
        milestone_scale = Decimal(str(max(0.90, min(1.30, ratio ** 0.15))))

    quantity_milestone_count = max(int(round(float(milestone_scale) * 4)), 3)
    if family_key.lower() in {"roofing", "flooring", "painting", "kitchen_remodel", "bathroom_remodel"}:
        quantity_milestone_count = max(quantity_milestone_count, 4)

    label = _safe_text(context.get("quantity_label"))
    reason = _safe_text(context.get("quantity_reason"))
    if not reason:
        reason = f"Quantity scaling used {label or _quantity_label(quantity_value, quantity_unit)} against a baseline of about {_quantity_label(baseline, quantity_unit)}."

    return {
        "applied": True,
        "price_scale": price_scale.quantize(Decimal("0.01")),
        "duration_scale": duration_scale.quantize(Decimal("0.01")),
        "milestone_scale": milestone_scale.quantize(Decimal("0.01")),
        "quantity_milestone_count": quantity_milestone_count,
        "reason": reason,
        "baseline_value": baseline,
        "quantity_ratio": Decimal(str(ratio)).quantize(Decimal("0.01")),
        "quantity_label": label,
        "quantity_source": _safe_text(context.get("quantity_source")),
        "quantity_confidence": _safe_text(context.get("quantity_confidence")) or "medium",
    }
