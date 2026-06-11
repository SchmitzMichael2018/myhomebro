from __future__ import annotations

import re
from dataclasses import dataclass
from typing import Any


def _safe_text(value: Any) -> str:
    return "" if value is None else str(value).strip()


def normalize_relevance_text(*values: Any) -> str:
    text = " ".join(_safe_text(value) for value in values if _safe_text(value))
    return text.lower().replace("&", " and ").replace("_", " ").replace("-", " ")


def contains_term(text: str, terms: set[str]) -> bool:
    normalized = normalize_relevance_text(text)
    for term in terms:
        cleaned = normalize_relevance_text(term)
        if not cleaned:
            continue
        if " " in cleaned:
            if cleaned in normalized:
                return True
            continue
        if re.search(rf"\b{re.escape(cleaned)}\b", normalized):
            return True
    return False


@dataclass(frozen=True)
class TradeIntent:
    key: str
    label: str
    query: str
    primary_terms: set[str]
    secondary_terms: set[str]
    unrelated_terms: set[str]


NON_CONTRACTOR_ENTITY_TERMS = {
    "hoa",
    "homeowners association",
    "home owners association",
    "recreation center",
    "community center",
    "community pool",
    "park",
    "aquatic center",
    "swimming pool facility",
    "pool facility",
    "apartment complex",
    "apartments",
    "hotel",
    "school",
    "gym",
    "fitness center",
    "clubhouse",
    "municipal",
    "city of",
    "county",
}


TRADE_INTENTS: tuple[TradeIntent, ...] = (
    TradeIntent(
        key="pool",
        label="Pool Installation",
        query="pool contractor pool builder pool service company",
        primary_terms={
            "pool contractor",
            "pool builder",
            "pool builders",
            "pool construction",
            "swimming pool contractor",
            "swimming pool builder",
            "pool service",
            "pool company",
            "pool installation",
            "pool installer",
            "pool and spa",
            "spa contractor",
        },
        secondary_terms={"plumbing", "plumber", "electrical", "electrician", "excavation", "concrete", "hardscape"},
        unrelated_terms={"roofing", "roofer", "gutter", "hvac", "flooring", "drywall"},
    ),
    TradeIntent(
        key="appliance",
        label="Appliance Repair",
        query="appliance repair contractor",
        primary_terms={
            "appliance repair",
            "dryer repair",
            "refrigerator repair",
            "washer repair",
            "dishwasher repair",
            "oven repair",
            "range repair",
            "appliance service",
        },
        secondary_terms={"handyman", "home repair"},
        unrelated_terms={"plumbing", "plumber", "roofing", "roofer", "electrical", "electrician", "hvac"},
    ),
    TradeIntent(
        key="roofing",
        label="Roofing",
        query="roofing contractor",
        primary_terms={"roof", "roofing", "roofer", "shingle", "shingles", "flashing", "underlayment"},
        secondary_terms={"exterior", "siding", "gutter"},
        unrelated_terms={"pool", "appliance", "flooring", "plumbing", "hvac"},
    ),
    TradeIntent(
        key="gutter",
        label="Gutters",
        query="gutter contractor gutter installation",
        primary_terms={"gutter", "gutters", "downspout", "downspouts", "gutter installation", "gutter contractor"},
        secondary_terms={"roofing", "exterior", "siding"},
        unrelated_terms={"pool", "appliance", "plumbing", "hvac", "electrical"},
    ),
    TradeIntent(
        key="plumbing",
        label="Plumbing",
        query="plumber",
        primary_terms={"plumbing", "plumber", "toilet", "pipe", "drain", "sewer", "water heater"},
        secondary_terms={"leak repair", "bathroom"},
        unrelated_terms={"pool", "roofing", "appliance", "hvac", "electrical"},
    ),
    TradeIntent(
        key="hvac",
        label="HVAC",
        query="hvac contractor",
        primary_terms={"hvac", "air conditioning", "ac repair", "furnace", "heating", "cooling", "heat pump"},
        secondary_terms={"mechanical contractor"},
        unrelated_terms={"pool", "roofing", "plumbing", "appliance", "electrical"},
    ),
    TradeIntent(
        key="electrical",
        label="Electrical",
        query="electrician",
        primary_terms={"electrical", "electrician", "panel", "wiring", "breaker", "outlet"},
        secondary_terms={"lighting", "low voltage"},
        unrelated_terms={"pool", "roofing", "plumbing", "appliance", "hvac"},
    ),
    TradeIntent(
        key="concrete_patio",
        label="Concrete / Patio",
        query="concrete contractor patio contractor hardscape contractor",
        primary_terms={
            "patio",
            "concrete",
            "cement",
            "slab",
            "driveway",
            "walkway",
            "hardscape",
            "masonry",
            "mason",
            "paver",
            "pavers",
            "outdoor living",
        },
        secondary_terms={"deck", "decking", "landscaping"},
        unrelated_terms={"roofing", "roofer", "plumbing", "hvac", "electrical"},
    ),
)


def project_trade_intent(*values: Any) -> TradeIntent | None:
    text = normalize_relevance_text(*values)
    if not text:
        return None
    if contains_term(text, {"water heater"}):
        return next(intent for intent in TRADE_INTENTS if intent.key == "plumbing")
    if contains_term(text, {"pool", "swimming pool", "spa"}) and contains_term(
        text, {"install", "installation", "build", "builder", "construction", "replace", "renovate", "remodel", "service", "repair"}
    ):
        return next(intent for intent in TRADE_INTENTS if intent.key == "pool")
    for intent in TRADE_INTENTS:
        if contains_term(text, intent.primary_terms):
            return intent
    return None


def contractor_entity_excluded(*values: Any) -> bool:
    return contains_term(normalize_relevance_text(*values), NON_CONTRACTOR_ENTITY_TERMS)


def trade_fit(intent: TradeIntent | None, *candidate_values: Any) -> dict[str, Any]:
    if intent is None:
        return {"level": "unknown", "score_delta": 0, "cap": 100, "reason": ""}
    text = normalize_relevance_text(*candidate_values)
    if contractor_entity_excluded(text):
        return {"level": "excluded", "score_delta": -100, "cap": 0, "reason": "Non-contractor entity filtered from contractor discovery."}
    if contains_term(text, intent.primary_terms):
        return {"level": "primary", "score_delta": 45, "cap": 100, "reason": f"Primary {intent.label.lower()} trade matches the request."}
    if contains_term(text, intent.secondary_terms):
        return {"level": "secondary", "score_delta": 8, "cap": 44, "reason": f"Related trade may support parts of this {intent.label.lower()} request."}
    if contains_term(text, intent.unrelated_terms):
        return {"level": "unrelated", "score_delta": -35, "cap": 30, "reason": f"Listed trade does not match this {intent.label.lower()} request."}
    return {"level": "missing", "score_delta": -18, "cap": 38, "reason": f"No clear {intent.label.lower()} trade metadata found."}


def apply_trade_fit_cap(score: int, intent: TradeIntent | None, *candidate_values: Any) -> tuple[int, dict[str, Any]]:
    fit = trade_fit(intent, *candidate_values)
    adjusted = max(0, min(int(score or 0) + int(fit["score_delta"] or 0), int(fit["cap"] or 100)))
    return adjusted, fit
