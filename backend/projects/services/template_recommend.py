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


def _keyword_bonus(template: ProjectTemplate, corpus: str) -> tuple[int, list[str]]:
    text = _norm(corpus)
    reasons: list[str] = []
    score = 0

    template_name = _norm(template.name)
    subtype = _norm(template.project_subtype or "")
    ptype = _norm(template.project_type or "")
    desc = _norm(template.description or "")

    if template_name and template_name in text:
        score += 50
        reasons.append(f'name match: "{template.name}"')

    if subtype and subtype in text:
        score += 35
        reasons.append(f'subtype match: "{template.project_subtype}"')

    if ptype and ptype in text:
        score += 20
        reasons.append(f'type match: "{template.project_type}"')

    corpus_tokens = _tokens(text)
    template_tokens = _tokens(f"{template.name} {template.project_subtype} {template.description}")

    overlap = corpus_tokens.intersection(template_tokens)
    if overlap:
        overlap_bonus = min(len(overlap) * 4, 24)
        score += overlap_bonus
        reasons.append(f"shared keywords: {', '.join(sorted(list(overlap))[:6])}")

    keyword_groups = {
        "kitchen": ["kitchen", "cabinet", "countertop", "backsplash", "island"],
        "bathroom": ["bathroom", "shower", "vanity", "toilet", "tub"],
        "deck": ["deck", "railing", "joist", "ledger", "stair"],
        "shed": ["shed", "outbuilding", "backyard shed"],
        "painting": ["paint", "painting", "primer", "coating"],
        "flooring": ["floor", "flooring", "tile", "vinyl", "laminate", "hardwood"],
        "roofing": ["roof", "roofing", "shingle", "flashing", "underlayment"],
        "repair": ["repair", "fix", "patch", "replace damaged"],
        "inspection": ["inspect", "inspection", "walkthrough", "assessment"],
        "installation": ["install", "installation", "mount", "set up"],
        "diy": ["diy", "help me", "assist", "contractor assist", "hourly help"],
    }

    template_signature = _norm(f"{template.name} {template.project_subtype} {template.description}")

    for group_name, words in keyword_groups.items():
        template_has_group = any(w in template_signature for w in words)
        corpus_has_group = any(w in text for w in words)
        if template_has_group and corpus_has_group:
            score += 12
            reasons.append(f"{group_name} context")

    return score, reasons


def _type_bonus(template: ProjectTemplate, project_type: str, project_subtype: str) -> tuple[int, list[str]]:
    score = 0
    reasons: list[str] = []

    t_type = _norm(template.project_type or "")
    t_subtype = _norm(template.project_subtype or "")
    p_type = _norm(project_type or "")
    p_subtype = _norm(project_subtype or "")

    if p_type and t_type == p_type:
        score += 40
        reasons.append("exact project type match")

    if p_subtype and t_subtype and t_subtype == p_subtype:
        score += 45
        reasons.append("exact subtype match")

    if p_subtype and not t_subtype and p_type and t_type == p_type:
        score += 10
        reasons.append("type-level fallback template")

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
            1 if getattr(row["template"], "is_system", False) else 0,
            -(len(getattr(row["template"], "project_subtype", "") or "")),
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