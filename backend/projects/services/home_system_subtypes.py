from __future__ import annotations

import re

from projects.models_customer_portal import PropertyHomeSystem


SUBTYPE_REFRIGERATOR = "refrigerator"
SUBTYPE_DRYER = "dryer"
SUBTYPE_WASHER = "washer"
SUBTYPE_DISHWASHER = "dishwasher"
SUBTYPE_OVEN = "oven"
SUBTYPE_RANGE = "range"
SUBTYPE_MICROWAVE = "microwave"
SUBTYPE_FREEZER = "freezer"
SUBTYPE_WATER_SOFTENER = "water_softener"
SUBTYPE_SUMP_PUMP = "sump_pump"
SUBTYPE_WATER_HEATER = "water_heater"
SUBTYPE_FURNACE = "furnace"
SUBTYPE_AIR_CONDITIONER = "air_conditioner"
SUBTYPE_HEAT_PUMP = "heat_pump"
SUBTYPE_AIR_HANDLER = "air_handler"
SUBTYPE_POOL_FILTER = "pool_filter"
SUBTYPE_POOL_PUMP = "pool_pump"
SUBTYPE_SPA = "spa"


_SUBTYPE_PATTERNS = {
    PropertyHomeSystem.SYSTEM_APPLIANCE: [
        (SUBTYPE_REFRIGERATOR, [r"\brefrigerator\b", r"\bfridge\b"]),
        (SUBTYPE_DRYER, [r"\bdryer\b", r"\bdryers\b"]),
        (SUBTYPE_WASHER, [r"\bwasher\b", r"\bwashing machine\b", r"\blaundry machine\b"]),
        (SUBTYPE_DISHWASHER, [r"\bdishwasher\b"]),
        (SUBTYPE_MICROWAVE, [r"\bmicrowave\b"]),
        (SUBTYPE_FREEZER, [r"\bfreezer\b"]),
        (SUBTYPE_OVEN, [r"\boven\b", r"\bwall oven\b"]),
        (SUBTYPE_RANGE, [r"\brange\b", r"\bstove\b", r"\bcooktop\b"]),
    ],
    PropertyHomeSystem.SYSTEM_PLUMBING: [
        (SUBTYPE_WATER_SOFTENER, [r"\bwater softener\b", r"\bsoftener\b"]),
        (SUBTYPE_SUMP_PUMP, [r"\bsump pump\b", r"\bsump\b"]),
        (SUBTYPE_WATER_HEATER, [r"\bwater heater\b", r"\btankless\b", r"\bhot water\b"]),
    ],
    PropertyHomeSystem.SYSTEM_HVAC: [
        (SUBTYPE_HEAT_PUMP, [r"\bheat pump\b"]),
        (SUBTYPE_AIR_CONDITIONER, [r"\bair conditioner\b", r"\bair conditioning\b", r"\bac\b", r"\ba/c\b", r"\bcondenser\b"]),
        (SUBTYPE_AIR_HANDLER, [r"\bair handler\b"]),
        (SUBTYPE_FURNACE, [r"\bfurnace\b"]),
    ],
    PropertyHomeSystem.SYSTEM_POOL_SPA: [
        (SUBTYPE_POOL_FILTER, [r"\bpool filter\b", r"\bfilter cartridge\b", r"\bcartridge filter\b"]),
        (SUBTYPE_POOL_PUMP, [r"\bpool pump\b", r"\bpump\b"]),
        (SUBTYPE_SPA, [r"\bspa\b", r"\bhot tub\b", r"\bjacuzzi\b"]),
    ],
}


def _system_text(system: PropertyHomeSystem) -> str:
    return " ".join(
        str(value or "")
        for value in [
            getattr(system, "custom_name", ""),
            getattr(system, "manufacturer", ""),
            getattr(system, "model_number", ""),
            getattr(system, "notes", ""),
        ]
    ).lower()


def infer_home_system_subtype(system: PropertyHomeSystem) -> str:
    text = _system_text(system)
    for subtype, patterns in _SUBTYPE_PATTERNS.get(getattr(system, "system_type", ""), []):
        if any(re.search(pattern, text) for pattern in patterns):
            return subtype
    if getattr(system, "system_type", "") == PropertyHomeSystem.SYSTEM_WATER_HEATER:
        return SUBTYPE_WATER_HEATER
    return ""


def inferred_home_system_label(system: PropertyHomeSystem) -> str:
    subtype = infer_home_system_subtype(system)
    if subtype:
        return subtype.replace("_", " ").title()
    try:
        return system.get_system_type_display()
    except Exception:
        return "Home System"
