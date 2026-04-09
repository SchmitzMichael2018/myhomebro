from __future__ import annotations

import re
from dataclasses import dataclass
from typing import Iterable, Optional

from projects.models_templates import ProjectTemplate


@dataclass
class RecommendationResult:
    template: Optional[ProjectTemplate]
    score: int
    reason: str
    candidates: list[dict]


def _norm(text: str) -> str:
    return re.sub(r"\s+", " ", (text or "").strip().lower())


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
    }


def _template_signals(template: ProjectTemplate) -> dict[str, bool]:
    signature = _norm(
        f"{template.name or ''} {template.project_type or ''} {template.project_subtype or ''} {template.description or ''}"
    )
    return _project_signals(signature)


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


def _keyword_bonus(template: ProjectTemplate, corpus: str) -> tuple[int, list[str]]:
    text = _norm(corpus)
    reasons: list[str] = []
    score = 0

    template_name = _norm(template.name)
    subtype = _norm(template.project_subtype or "")
    ptype = _norm(template.project_type or "")
    desc = _norm(template.description or "")

    if template_name and template_name in text:
        score += 28
        reasons.append(f'name phrase match: "{template.name}"')

    if subtype and subtype in text:
        score += 24
        reasons.append(f'subtype phrase match: "{template.project_subtype}"')

    if ptype and ptype in text:
        score += 12
        reasons.append(f'type phrase match: "{template.project_type}"')

    corpus_tokens = _tokens(text)
    template_tokens = _tokens(f"{template.name} {template.project_subtype} {template.description}")
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
        score += 54
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

    if project_sig["appliance"] and template_sig["countertop"]:
        score -= 16
        penalties.append("penalized countertop mismatch for appliance project")

    if project_sig["countertop"] and template_sig["appliance"]:
        score -= 16
        penalties.append("penalized appliance mismatch for countertop project")

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

    # Small boost to built-in subtype starters only when match is already reasonably aligned
    if (
        _norm(project_subtype)
        and _norm(template.project_subtype or "") == _norm(project_subtype)
        and getattr(template, "is_system", False)
    ):
        total_score += 5
        reasons.append("built-in subtype starter")

    # Small boost to contractor custom templates when score is already decent
    if not getattr(template, "is_system", False) and total_score >= 35:
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
            1 if not getattr(row["template"], "is_system", False) else 0,
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
            "score": row["score"],
            "reason": row["reason"],
        }
        for row in ranked[:5]
    ]

    return RecommendationResult(
        template=best["template"],
        score=best["score"],
        reason=best["reason"],
        candidates=candidate_payload,
    )
