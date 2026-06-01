from __future__ import annotations

import re
from dataclasses import dataclass
from typing import Iterable, Optional

from projects.models_templates import ProjectTemplate
from projects.services.project_intelligence import infer_project_intelligence


@dataclass
class RecommendationResult:
    template: Optional[ProjectTemplate]
    score: int
    reason: str
    candidates: list[dict]
    partial_match: bool = False
    partial_match_reason: str = ""


def _norm(text: str) -> str:
    return re.sub(r"\s+", " ", (text or "").strip().lower())


def _search_norm(text: str) -> str:
    return re.sub(r"\s+", " ", re.sub(r"[^a-z0-9]+", " ", (text or "").strip().lower())).strip()


_HVAC_ALIAS_PATTERNS = [
    r"\bcentral\s+ac\s+install(?:ation)?\b",
    r"\bcentral\s+air\s+install(?:ation)?\b",
    r"\bair\s+conditioner\s+install(?:ation)?\b",
    r"\bhvac\s+install(?:ation)?\b",
    r"\bcooling\s+system\s+install(?:ation)?\b",
    r"\bac\s+install(?:ation)?\b",
    r"\binstall\s+air\s+conditioner\b",
    r"\binstall\s+central\s+ac\b",
    r"\binstall\s+central\s+air\b",
    r"\binstall\s+hvac\b",
    r"\binstall\s+cooling\s+system\b",
]


def _canonical_hvac_text(text: str) -> str:
    normalized = _search_norm(text)
    if not normalized:
        return ""

    for pattern in _HVAC_ALIAS_PATTERNS:
        normalized = re.sub(pattern, " central air installation ", normalized)

    return _search_norm(normalized)


# Extended trade groups used for multi-trade detection. Broader than the kitchen-remodel-focused
# groups in _count_project_trade_groups — these cover exterior, roofing, siding, etc.
_EXTENDED_TRADE_GROUPS: list[tuple[str, list[str]]] = [
    ("roofing", ["roofing", "roof", "shingle", "flashing", "underlayment"]),
    ("siding", ["siding", "vinyl siding", "lap siding", "fiber cement", "hardie", "exterior cladding"]),
    ("patio_roof", ["patio roof", "patio cover", "porch roof", "covered patio", "shade structure"]),
    ("inspection", ["inspection", "inspect", "assessment", "site visit"]),
    ("installation", ["install", "installation", "build", "construct", "new construction"]),
    ("repair", ["repair", "fix", "patch", "restore", "damaged"]),
    ("plumbing", ["plumbing", "plumber", "water line", "drain", "pipe", "faucet"]),
    ("electrical", ["electrical", "electric", "wiring", "outlet", "breaker", "panel"]),
    ("flooring", ["flooring", "floor", "lvp", "hardwood", "tile floor", "laminate"]),
    ("painting", ["painting", "paint", "primer", "stain", "repaint"]),
    ("hvac", ["hvac", "air conditioning", "heating", "ductwork", "furnace", "central air"]),
    ("deck", ["deck", "pergola", "gazebo"]),
    ("concrete", ["concrete", "driveway", "sidewalk", "patio slab", "concrete slab"]),
    ("fencing", ["fence", "fencing", "gate"]),
    ("masonry", ["masonry", "brick", "stone wall", "retaining wall"]),
    ("tile", ["tile", "backsplash", "shower tile", "bathroom tile"]),
    ("cabinet", ["cabinet", "cabinetry", "kitchen cabinet"]),
    ("countertop", ["countertop", "counter top", "quartz", "granite countertop"]),
]


def _matched_trade_group_keys(text: str) -> set[str]:
    matched: set[str] = set()
    normalized = _norm(text)
    for key, phrases in _EXTENDED_TRADE_GROUPS:
        if key in {"plumbing", "electrical"} and re.search(rf"\b(no|without|excluding)\s+{key}\b", normalized):
            continue
        if _contains_phrase(text, phrases):
            matched.add(key)
    return matched


def _count_all_trade_groups_extended(text: str) -> int:
    """Return the number of distinct extended trade groups found in the text."""
    return len(_matched_trade_group_keys(text))


def _request_scope_trade_keys(text: str) -> set[str]:
    ignored_intent_keys = {"inspection", "installation", "repair"}
    return _matched_trade_group_keys(text) - ignored_intent_keys


def _template_has_repair_keyword(template: "ProjectTemplate") -> bool:
    """Return True when the template's name/subtype signals repair/fix/patch intent."""
    text = _norm((template.name or "") + " " + (template.project_subtype or ""))
    return bool(re.search(r"\b(repair|fix|patch|damage|restore|maintenance)\b", text))


def _tokens(text: str) -> set[str]:
    text = _norm(text)
    if not text:
        return set()
    return set(re.findall(r"[a-z0-9]+", text))


def _contains_phrase(text: str, phrases: list[str]) -> bool:
    base = _norm(text)
    for phrase in phrases:
        normalized = _norm(phrase)
        if not normalized:
            continue
        pattern = r"(?<![a-z0-9])" + re.escape(normalized).replace(r"\ ", r"\s+") + r"(?![a-z0-9])"
        if re.search(pattern, base):
            return True
    return False


def _count_project_trade_groups(text: str) -> int:
    groups = [
        ["plumbing", "plumber", "water line", "drain"],
        ["electrical", "electric", "lighting", "outlet", "switch"],
        ["tile", "backsplash", "shower tile"],
        ["cabinet", "cabinetry"],
        ["countertop", "counter top", "stone top"],
        ["fixture", "fixtures", "vanity", "toilet", "tub", "shower"],
        ["flooring", "floor", "lvp", "laminate", "hardwood"],
        ["paint", "painting", "primer"],
        ["appliance", "dishwasher", "range", "microwave", "oven", "washer", "dryer"],
    ]
    return sum(1 for phrases in groups if _contains_phrase(text, phrases))


def _meaningful_overlap(corpus_tokens: set[str], template_tokens: set[str]) -> set[str]:
    stop = {
        "a",
        "an",
        "and",
        "or",
        "the",
        "of",
        "for",
        "to",
        "with",
        "in",
        "on",
        "at",
        "by",
        "my",
        "me",
        "help",
        "job",
        "project",
        "work",
        "scope",
        "contractor",
        "customer",
        "homeowner",
        "install",
        "installation",
        "repair",
        "replace",
        "new",
        "existing",
        "general",
        "standard",
        "service",
        "decking",
        "utilities",
        "utility",
    }
    return {
        t
        for t in corpus_tokens.intersection(template_tokens)
        if len(t) >= 4 and t not in stop
    }


def _project_signals(text: str) -> dict[str, bool]:
    t = _norm(text)
    trade_group_count = _count_project_trade_groups(t)
    has_demo = _contains_phrase(t, ["demo", "demolition", "gut", "tear out", "tear-out"])
    has_layout_change = _contains_phrase(
        t,
        ["layout change", "move wall", "wall removal", "reconfigure", "relocate"],
    )
    remodel_signal = _contains_phrase(
        t,
        [
            "remodel",
            "renovation",
            "gut remodel",
            "update bathroom",
            "update kitchen",
            "full remodel",
        ],
    )

    return {
        "addition": _contains_phrase(
            t,
            [
                "addition",
                "bedroom addition",
                "room addition",
                "home addition",
                "add on",
                "add-on",
                "expand house",
                "expansion",
                "build out",
                "build-out",
                "new bedroom",
                "new room",
            ],
        ),
        "outdoor": _contains_phrase(
            t,
            [
                "shed",
                "outbuilding",
                "storage shed",
                "tool shed",
                "garden shed",
                "backyard shed",
                "garage",
                "carport",
                "outdoor",
                "patio",
                "pergola",
                "gazebo",
                "fence",
                "yard",
                "backyard",
            ],
        ),
        "remodel": remodel_signal,
        "flooring": _contains_phrase(
            t,
            [
                "flooring",
                "lvp",
                "vinyl plank",
                "laminate",
                "hardwood",
                "tile floor",
                "replace floor",
                "install flooring",
                "refinish floor",
            ],
        ),
        "painting": _contains_phrase(
            t,
            [
                "painting",
                "paint",
                "primer",
                "repaint",
                "interior paint",
                "exterior paint",
            ],
        ),
        "deck": _contains_phrase(
            t,
            [
                "deck",
                "deck build",
                "build deck",
                "deck replacement",
                "replace deck",
                "new deck",
                "composite deck",
                "railing",
                "joist",
                "ledger board",
                "stairs",
                "patio cover",
                "pergola",
            ],
        ),
        "roofing": _contains_phrase(
            t,
            [
                "roof",
                "roof replacement",
                "roofing",
                "shingle",
                "flashing",
                "underlayment",
                "tear off",
                "tear-off",
                "tearoff",
                "asphalt shingle",
                "architectural shingle",
                "leak in roof",
                "decking",
            ],
        ),
        "bathroom": _contains_phrase(
            t,
            [
                "bathroom",
                "shower",
                "tub",
                "toilet",
                "vanity",
                "powder room",
            ],
        ),
        "kitchen": _contains_phrase(
            t,
            [
                "kitchen",
                "cabinet",
                "countertop",
                "backsplash",
                "island",
            ],
        ),
        "cabinet": _contains_phrase(
            t,
            [
                "cabinet installation",
                "cabinet install",
                "install cabinets",
                "new cabinets",
                "kitchen cabinets",
                "bathroom vanity cabinets",
                "cabinet replacement",
                "replace cabinets",
                "base cabinets",
                "wall cabinets",
                "cabinet doors",
                "vanity install",
            ],
        ),
        "countertop": _contains_phrase(
            t,
            [
                "countertop installation",
                "countertop install",
                "new countertop",
                "replace countertop",
                "quartz countertop",
                "granite countertop",
                "counter top",
            ],
        ),
        "appliance": _contains_phrase(
            t,
            [
                "appliance installation",
                "appliance install",
                "install appliance",
                "dishwasher",
                "microwave",
                "range",
                "oven",
                "cooktop",
                "refrigerator",
                "washer",
                "dryer",
            ],
        ),
        "structural": _contains_phrase(
            t,
            [
                "frame",
                "framing",
                "wall removal",
                "load bearing",
                "foundation",
                "footing",
                "permit",
                "addition",
                "new room",
                "build room",
            ],
        ),
        "diy": _contains_phrase(
            t,
            [
                "diy",
                "help me",
                "assist me",
                "hourly help",
                "help with project",
                "contractor assist",
            ],
        ),
        "multi_trade": trade_group_count >= 3,
        "full_scope": remodel_signal and (trade_group_count >= 3 or has_demo or has_layout_change),
        # Intent signals — detects whether the INPUT describes new work vs. fixing existing
        "has_install_signal": _contains_phrase(
            t, ["install", "build", "construct", "attach", "put in", "put up", "new construction", "build new"]
        ),
        "has_repair_signal": _contains_phrase(
            t, ["repair", "fix", "patch", "restore", "damaged", "damage repair"]
        ),
        # Fires when 2+ distinct trade categories are found in the input text
        "two_distinct_trades": len(_request_scope_trade_keys(t)) >= 2,
        "explicit_inspection": _contains_phrase(t, ["home inspection", "roof inspection", "inspect", "inspection"]),
        "construction_work": _contains_phrase(
            t,
            [
                "siding",
                "patio roof",
                "patio cover",
                "roof construction",
                "structural repair",
                "install",
                "installation",
                "build",
                "repair",
                "renovation",
                "exterior",
            ],
        ),
    }


def _template_signature_text(template: ProjectTemplate) -> str:
    clarification_text = " ".join(
        _search_norm(str(item))
        for item in (getattr(template, "default_clarifications", None) or [])
        if _search_norm(str(item))
    )
    return _canonical_hvac_text(
        " ".join(
            [
                template.name or "",
                template.project_type or "",
                template.project_subtype or "",
                template.description or "",
                getattr(template, "default_scope", "") or "",
                getattr(template, "exclusions_text", "") or "",
                getattr(template, "assumptions_text", "") or "",
                getattr(template, "project_materials_hint", "") or "",
                clarification_text,
            ]
        )
    )


def _template_signals(template: ProjectTemplate) -> dict[str, bool]:
    signature = _template_signature_text(template)
    return _project_signals(signature)


def _family_key_for_request(
    project_title: str,
    project_type: str,
    project_subtype: str,
    description: str,
) -> str:
    family = infer_project_intelligence(
        project_title=project_title,
        project_type=project_type,
        project_subtype=project_subtype,
        description=description,
    )
    return _norm(family.get("key", "general"))


def _family_key_for_template(template: ProjectTemplate) -> str:
    family = infer_project_intelligence(
        project_title=template.name or "",
        project_type=template.project_type or "",
        project_subtype=template.project_subtype or "",
        description=template.description or "",
    )
    return _norm(family.get("key", "general"))


def _type_bonus(template: ProjectTemplate, project_type: str, project_subtype: str) -> tuple[int, list[str]]:
    score = 0
    reasons: list[str] = []

    t_type = _norm(template.project_type or "")
    t_subtype = _norm(template.project_subtype or "")
    p_type = _norm(project_type or "")
    p_subtype = _norm(project_subtype or "")

    if p_type and t_type == p_type:
        score += 32
        reasons.append("exact project type match")

    if p_subtype and t_subtype and t_subtype == p_subtype:
        score += 42
        reasons.append("exact subtype match")

    if p_subtype and not t_subtype and p_type and t_type == p_type:
        score += 6
        reasons.append("type-level fallback template")

    return score, reasons


def _title_bonus(template: ProjectTemplate, project_title: str, description: str) -> tuple[int, list[str]]:
    score = 0
    reasons: list[str] = []

    template_name = _canonical_hvac_text(template.name or "")
    request_title = _canonical_hvac_text(project_title or "")
    request_body = _canonical_hvac_text(" ".join(x for x in [project_title or "", description or ""] if x))

    if template_name and request_title and template_name == request_title:
        score += 240
        reasons.append(f'exact title match: "{template.name}"')
        return score, reasons

    if template_name and request_body and template_name in request_body:
        score += 200
        reasons.append(f'title phrase match: "{template.name}"')
        return score, reasons

    if request_title and template_name and request_title in template_name:
        score += 170
        reasons.append(f'request phrase match: "{template.name}"')

    return score, reasons


def _keyword_bonus(template: ProjectTemplate, corpus: str) -> tuple[int, list[str]]:
    text = _canonical_hvac_text(corpus)
    reasons: list[str] = []
    score = 0

    template_name = _canonical_hvac_text(template.name)
    subtype = _canonical_hvac_text(template.project_subtype or "")
    ptype = _canonical_hvac_text(template.project_type or "")
    desc = _canonical_hvac_text(template.description or "")
    default_scope = _canonical_hvac_text(getattr(template, "default_scope", "") or "")
    exclusions = _canonical_hvac_text(getattr(template, "exclusions_text", "") or "")
    assumptions = _canonical_hvac_text(getattr(template, "assumptions_text", "") or "")
    materials_hint = _canonical_hvac_text(getattr(template, "project_materials_hint", "") or "")

    if template_name and template_name in text:
        score += 42
        reasons.append(f'name phrase match: "{template.name}"')

    if subtype and subtype in text:
        score += 24
        reasons.append(f'subtype phrase match: "{template.project_subtype}"')

    if ptype and ptype in text:
        score += 12
        reasons.append(f'type phrase match: "{template.project_type}"')

    if default_scope and default_scope in text:
        score += 18
        reasons.append("default scope phrase match")

    if exclusions and exclusions in text:
        score += 6
        reasons.append("exclusions phrase match")

    if assumptions and assumptions in text:
        score += 6
        reasons.append("assumptions phrase match")

    if materials_hint and materials_hint in text:
        score += 12
        reasons.append("materials hint phrase match")

    corpus_tokens = _tokens(text)
    template_tokens = _tokens(
        " ".join(
            [
                template.name or "",
                template.project_subtype or "",
                template.description or "",
                getattr(template, "default_scope", "") or "",
                getattr(template, "exclusions_text", "") or "",
                getattr(template, "assumptions_text", "") or "",
                getattr(template, "project_materials_hint", "") or "",
            ]
        )
    )
    overlap = _meaningful_overlap(corpus_tokens, template_tokens)

    if overlap:
        overlap_bonus = min(len(overlap) * 5, 20)
        score += overlap_bonus
        reasons.append(f"shared keywords: {', '.join(sorted(list(overlap))[:6])}")

    # Bonus for richer templates that actually describe something
    if desc:
        score += min(len(desc.split()) // 12, 6)
        if len(desc.split()) >= 12:
            reasons.append("richer template description")

    return score, reasons


def _signal_bonus(template: ProjectTemplate, project_title: str, project_type: str, project_subtype: str, description: str) -> tuple[int, list[str]]:
    corpus = " ".join(
        x for x in [project_title or "", description or "", project_subtype or "", project_type or ""] if x
    )
    project_sig = _project_signals(corpus)
    template_sig = _template_signals(template)

    score = 0
    reasons: list[str] = []

    # Strong positive matches
    for key, pts, label in [
        ("addition", 36, "addition context"),
        ("outdoor", 16, "outdoor structure context"),
        ("structural", 18, "structural context"),
        ("bathroom", 12, "bathroom context"),
        ("kitchen", 12, "kitchen context"),
        ("deck", 12, "deck context"),
        ("roofing", 12, "roofing context"),
        ("flooring", 12, "flooring context"),
        ("painting", 12, "painting context"),
        ("cabinet", 16, "cabinet-install context"),
        ("countertop", 16, "countertop-install context"),
        ("appliance", 16, "appliance-install context"),
        ("diy", 14, "DIY-assist context"),
        ("remodel", 12, "remodel context"),
    ]:
        if project_sig.get(key) and template_sig.get(key):
            score += pts
            reasons.append(label)

    # Strong whole-job or task-specific intent matches
    if (
        project_sig["bathroom"]
        and project_sig["remodel"]
        and project_sig["full_scope"]
        and template_sig["bathroom"]
        and template_sig["remodel"]
    ):
        score += 34
        reasons.append("bathroom remodel intent")

    if (
        project_sig["kitchen"]
        and project_sig["remodel"]
        and project_sig["full_scope"]
        and template_sig["kitchen"]
        and template_sig["remodel"]
    ):
        score += 42
        reasons.append("kitchen remodel intent")

    if project_sig["cabinet"] and template_sig["cabinet"]:
        score += 52
        reasons.append("cabinet installation intent")

    if project_sig["countertop"] and template_sig["countertop"]:
        score += 36
        reasons.append("countertop installation intent")

    if project_sig["appliance"] and template_sig["appliance"]:
        score += 54
        reasons.append("appliance installation intent")

    if project_sig["roofing"] and template_sig["roofing"]:
        score += 62
        reasons.append("roof replacement intent")

    if project_sig["flooring"] and template_sig["flooring"]:
        score += 38
        reasons.append("flooring installation intent")

    if project_sig["painting"] and template_sig["painting"]:
        score += 28
        reasons.append("painting scope intent")

    if project_sig["deck"] and template_sig["deck"]:
        score += 32
        reasons.append("deck build intent")

    if project_sig.get("explicit_inspection") and template_sig.get("explicit_inspection"):
        score += 45
        reasons.append("inspection intent")

    # Explicit mismatch penalties
    penalties: list[str] = []

    if project_sig["addition"] and template_sig["flooring"]:
        score -= 26
        penalties.append("penalized flooring mismatch for addition project")

    if project_sig["addition"] and template_sig["painting"]:
        score -= 16
        penalties.append("penalized painting mismatch for addition project")

    if project_sig["addition"] and template_sig["roofing"]:
        score -= 12
        penalties.append("penalized roofing mismatch for addition project")

    if project_sig["flooring"] and template_sig["addition"]:
        score -= 18
        penalties.append("penalized addition mismatch for flooring project")

    if project_sig["bathroom"] and template_sig["kitchen"]:
        score -= 10
        penalties.append("penalized kitchen mismatch for bathroom project")

    if project_sig["kitchen"] and template_sig["bathroom"]:
        score -= 10
        penalties.append("penalized bathroom mismatch for kitchen project")

    if (
        (project_sig["cabinet"] or project_sig["countertop"] or project_sig["appliance"])
        and not project_sig["full_scope"]
        and template_sig["remodel"]
    ):
        score -= 28
        penalties.append("penalized full remodel mismatch for task-specific project")

    if project_sig["kitchen"] and project_sig["full_scope"] and (
        template_sig["cabinet"] or template_sig["countertop"] or template_sig["appliance"]
    ):
        score -= 26
        penalties.append("penalized task-specific mismatch for kitchen remodel")

    if project_sig["bathroom"] and project_sig["full_scope"] and template_sig["cabinet"]:
        score -= 18
        penalties.append("penalized cabinet mismatch for bathroom remodel")

    if project_sig["roofing"] and template_sig["deck"]:
        score -= 30
        penalties.append("penalized deck mismatch for roofing project")

    if project_sig["deck"] and template_sig["roofing"]:
        score -= 18
        penalties.append("penalized roofing mismatch for deck project")

    if project_sig["outdoor"] and template_sig["roofing"]:
        score -= 34
        penalties.append("penalized roofing mismatch for outdoor structure project")

    if project_sig["outdoor"] and template_sig["deck"] and not project_sig["deck"]:
        score -= 18
        penalties.append("penalized deck mismatch for outdoor structure project")

    if project_sig["appliance"] and template_sig["countertop"]:
        score -= 16
        penalties.append("penalized countertop mismatch for appliance project")

    if project_sig["countertop"] and template_sig["appliance"]:
        score -= 16
        penalties.append("penalized appliance mismatch for countertop project")

    if template_sig.get("explicit_inspection") and project_sig.get("construction_work") and not project_sig.get("explicit_inspection"):
        score -= 95
        penalties.append("penalized inspection template for construction/repair/install scope")

    if project_sig["cabinet"] and template_sig.get("structural"):
        score -= 24
        penalties.append("penalized structural mismatch for cabinet installation")

    if project_sig["cabinet"] and _contains_phrase(description or "", ["no electrical", "no plumbing"]) and (
        _contains_phrase(template.project_type or "", ["Electrical", "Plumbing"])
        or _contains_phrase(template.project_subtype or "", ["Electrical", "Plumbing"])
        or _contains_phrase(template.description or "", ["electrical", "plumbing"])
    ):
        score -= 28
        penalties.append("penalized trade mismatch for no-utility cabinet scope")

    # --- Intent mismatch penalties ---
    # When the input has new-install/build intent, penalize templates named/typed as repair.
    # "patio roof install" should not match "Roof Repair Project".
    if project_sig.get("has_install_signal") and _template_has_repair_keyword(template):
        score -= 40
        penalties.append("penalized repair template for new-install/build input")

    # When the input is clearly repair-only (no install signal), penalize explicit new-build templates.
    # Threshold is softer because many templates say "install" generically in their scope.
    if project_sig.get("has_repair_signal") and not project_sig.get("has_install_signal"):
        template_name_lower = _norm(template.name or "")
        if re.search(r"\b(new construction|build new|installation project)\b", template_name_lower):
            score -= 30
            penalties.append("penalized new-construction template for repair-only input")

    # --- Multi-trade penalty ---
    # A job describing 2+ distinct trade categories shouldn't confidently match a single-trade template.
    if project_sig.get("two_distinct_trades"):
        request_trades = _request_scope_trade_keys(
            " ".join(x for x in [project_title or "", description or ""] if x)
        )
        template_trades = _request_scope_trade_keys(_template_signature_text(template))
        missing_trades = request_trades - template_trades
        if len(request_trades) >= 2 and missing_trades:
            score -= 55
            if score > 54:
                score = 54
            penalties.append("multi-trade job partially covered by single-trade template")

    if penalties:
        reasons.extend(penalties)

    return score, reasons


def score_template(
    *,
    template: ProjectTemplate,
    project_title: str,
    project_type: str,
    project_subtype: str,
    description: str,
) -> tuple[int, str]:
    total_score = 0
    reasons: list[str] = []

    s0, r0 = _title_bonus(template, project_title, description)
    total_score += s0
    reasons.extend(r0)

    s1, r1 = _type_bonus(template, project_type, project_subtype)
    total_score += s1
    reasons.extend(r1)

    corpus = " ".join(
        x for x in [project_title or "", description or "", project_subtype or "", project_type or ""] if x
    )

    s2, r2 = _keyword_bonus(template, corpus)
    total_score += s2
    reasons.extend(r2)

    s3, r3 = _signal_bonus(template, project_title, project_type, project_subtype, description)
    total_score += s3
    reasons.extend(r3)

    request_family = _family_key_for_request(project_title, project_type, project_subtype, description)
    template_family = _family_key_for_template(template)

    if request_family != "general" and template_family != "general":
        if request_family == template_family:
            total_score += 22
            reasons.append(f"{request_family} family match")
        else:
            total_score -= 45
            reasons.append(f"family mismatch: {template_family} vs {request_family}")
    elif request_family != "general" and template_family == "general":
        total_score -= 18
        reasons.append(f"generic template mismatch for {request_family} project")

    if request_family == "outdoor":
        if template_family == "concrete":
            total_score -= 70
            reasons.append("shed/outdoor project should not fall back to concrete slab template")
        elif template_family == "roofing":
            total_score -= 70
            reasons.append("shed/outdoor project should not fall back to roofing template")

    # Small boost to built-in subtype starters only when match is already reasonably aligned
    if (
        _norm(project_subtype)
        and _norm(template.project_subtype or "") == _norm(project_subtype)
        and getattr(template, "is_system_template", False)
        and getattr(template, "is_published", False)
    ):
        total_score += 5
        reasons.append("built-in subtype starter")

    # Small boost to contractor custom templates when score is already decent
    if not getattr(template, "is_system_template", False) and total_score >= 35:
        total_score += 4
        reasons.append("custom contractor template")

    if total_score < 0:
        total_score = 0

    if not reasons:
        reasons.append("closest general template match")

    reason = "; ".join(dict.fromkeys(reasons))
    return total_score, reason


def recommend_template(
    *,
    templates: Iterable[ProjectTemplate],
    project_title: str,
    project_type: str,
    project_subtype: str,
    description: str,
) -> RecommendationResult:
    ranked: list[dict] = []

    for template in templates:
        score, reason = score_template(
            template=template,
            project_title=project_title,
            project_type=project_type,
            project_subtype=project_subtype,
            description=description,
        )
        ranked.append(
            {
                "template": template,
                "score": score,
                "reason": reason,
            }
        )

    ranked.sort(
        key=lambda row: (
            row["score"],
            1 if not getattr(row["template"], "is_system_template", False) else 0,
            len(getattr(row["template"], "description", "") or ""),
            len(getattr(row["template"], "project_subtype", "") or ""),
        ),
        reverse=True,
    )

    if not ranked:
        return RecommendationResult(
            template=None,
            score=0,
            reason="No templates available.",
            candidates=[],
        )

    best = ranked[0]

    candidate_payload = [
        {
            "id": row["template"].id,
            "name": row["template"].name,
            "project_type": row["template"].project_type,
            "project_subtype": row["template"].project_subtype,
            "is_system": row["template"].is_system,
            "is_system_template": bool(getattr(row["template"], "is_system_template", False)),
            "is_published": bool(getattr(row["template"], "is_published", False)),
            "score": row["score"],
            "reason": row["reason"],
        }
        for row in ranked[:5]
    ]

    best_reason = best["reason"]
    is_partial = "partially covered by single-trade template" in best_reason
    partial_reason = ""
    if is_partial and best["template"]:
        tpl_type = _norm(best["template"].project_type or "")
        label = best["template"].project_type or "one trade"
        partial_reason = (
            f"Partial match — this template covers {label} only. "
            "Work from other trades in your scope will need to be added manually."
        )

    return RecommendationResult(
        template=best["template"],
        score=best["score"],
        reason=best_reason,
        candidates=candidate_payload,
        partial_match=is_partial,
        partial_match_reason=partial_reason,
    )
