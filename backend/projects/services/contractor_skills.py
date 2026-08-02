from __future__ import annotations

from collections.abc import Iterable
from typing import Any
import re

from django.utils.text import slugify

from projects.models import Contractor, Skill


def normalize_custom_services(raw_value: Any, canonical_names: Iterable[str] = ()) -> list[str]:
    if not isinstance(raw_value, (list, tuple, set)):
        raise ValueError("Enter a valid service list.")
    values = raw_value
    canonical = {" ".join(str(name).strip().split()).casefold() for name in canonical_names}
    normalized: list[str] = []
    seen: set[str] = set()
    for item in values:
        text = " ".join(str(item or "").strip().split())
        key = text.casefold()
        if not text:
            raise ValueError("Enter a service name.")
        if len(text) < 2 or len(text) > 80 or not re.search(r"[a-z0-9]", text, re.I):
            raise ValueError("Use 2–80 characters.")
        if re.search(r"<[^>]*>|https?://|www\.|\S+@\S+\.\S+|(?:\+?\d[\d ().-]{7,}\d)", text, re.I):
            raise ValueError("Enter a service, not contact information.")
        if key in seen or key in canonical:
            raise ValueError("This service already exists.")
        normalized.append(text)
        seen.add(key)
    return normalized


def normalize_contractor_skill_names(raw_value: Any) -> list[str]:
    if raw_value in (None, "", []):
        return []

    if isinstance(raw_value, str):
        values: Iterable[Any] = raw_value.split(",")
    elif hasattr(raw_value, "getlist"):
        values = raw_value.getlist("skills")
    elif isinstance(raw_value, (list, tuple, set)):
        values = raw_value
    else:
        values = [raw_value]

    normalized: list[str] = []
    seen: set[str] = set()
    for item in values:
        if item in (None, "", []):
            continue
        if isinstance(item, dict):
            candidate = item.get("name") or item.get("label") or item.get("title") or item.get("value") or ""
        else:
            candidate = item
        text = " ".join(str(candidate).strip().split())
        if not text:
            continue
        key = text.lower()
        if key in seen:
            continue
        seen.add(key)
        normalized.append(text)
    return normalized


def set_contractor_skills(contractor: Contractor, raw_value: Any) -> list[Skill]:
    skill_names = normalize_contractor_skill_names(raw_value)
    skills: list[Skill] = []
    for name in skill_names:
        skill = (
            Skill.objects.filter(name__iexact=name).first()
            or Skill.objects.filter(slug=slugify(name)).first()
        )
        if skill is None:
            skill, _created = Skill.objects.get_or_create(
                name=name,
                defaults={"slug": slugify(name)},
            )
        skills.append(skill)

    contractor.skills.set(skills)
    return skills
