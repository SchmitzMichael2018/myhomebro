from __future__ import annotations

import json
import os
from typing import Any

from django.conf import settings


ALLOWED_TONES = (
    "professional",
    "friendly",
    "straightforward",
    "premium",
    "warm_and_consultative",
)


def _safe_text(value: Any) -> str:
    if value is None:
        return ""
    return str(value).strip()


def _safe_list(value: Any) -> list[str]:
    if isinstance(value, (list, tuple)):
        return [str(item).strip() for item in value if _safe_text(item)]
    if isinstance(value, str):
        parts = [part.strip() for part in value.split(",")]
        return [part for part in parts if part]
    return []


def _env_openai_api_key() -> str:
    return _safe_text(getattr(settings, "OPENAI_API_KEY", None) or os.getenv("OPENAI_API_KEY", ""))


def _get_openai_client():
    try:
        from openai import OpenAI  # type: ignore
    except Exception:
        return None

    api_key = _env_openai_api_key()
    if api_key:
        return OpenAI(api_key=api_key)
    return OpenAI()


def _normalize_tone(value: Any, fallback: str = "professional") -> str:
    tone = _safe_text(value).lower()
    if tone in ALLOWED_TONES:
        return tone
    return fallback if fallback in ALLOWED_TONES else "professional"


def _normalize_work_types(value: Any, fallback: list[str]) -> list[str]:
    items = _safe_list(value)
    if items:
        return items[:8]
    return fallback[:8]


def _fallback_profile_copy(context: dict[str, Any]) -> dict[str, Any]:
    business_name = _safe_text(context.get("business_name")) or "MyHomeBro Contractor"
    city = _safe_text(context.get("city"))
    state = _safe_text(context.get("state"))
    specialties = _safe_list(context.get("specialties"))
    work_types = _safe_list(context.get("work_types"))
    prompt = _safe_text(context.get("prompt"))
    tone = _normalize_tone(context.get("tone") or context.get("proposal_tone"))

    lead_service = work_types[:3] or specialties[:3] or ["home projects"]
    area_label = ", ".join(part for part in [city, state] if part)
    area_phrase = f" in {area_label}" if area_label else ""
    tagline = prompt or f"Trusted {lead_service[0].lower()} support{area_phrase}".strip()
    intro = (
        f"{business_name} helps homeowners with {', '.join(lead_service)}{area_phrase}. "
        "We keep communication clear, projects organized, and next steps easy to follow."
    )
    seo_title = f"{business_name} - Contractor Services"
    if area_label:
        seo_title = f"{business_name} - {area_label}"
    seo_description = (
        f"{business_name} offers {', '.join(lead_service)}{area_phrase}. "
        "Request a project consultation and get a clear, professional plan."
    )

    return {
        "tagline": tagline[:120],
        "intro": intro[:800],
        "tone": tone,
        "work_types": lead_service,
        "seo_title": seo_title[:80],
        "seo_description": seo_description[:200],
    }


def _normalize_result(data: dict[str, Any], context: dict[str, Any]) -> dict[str, Any]:
    fallback = _fallback_profile_copy(context)
    return {
        "tagline": _safe_text(data.get("tagline")) or fallback["tagline"],
        "intro": _safe_text(data.get("intro") or data.get("bio")) or fallback["intro"],
        "tone": _normalize_tone(data.get("tone") or data.get("proposal_tone"), fallback=fallback["tone"]),
        "work_types": _normalize_work_types(data.get("work_types"), fallback=fallback["work_types"]),
        "seo_title": _safe_text(data.get("seo_title")) or fallback["seo_title"],
        "seo_description": _safe_text(data.get("seo_description")) or fallback["seo_description"],
    }


def generate_contractor_public_profile(contractor, prompt: str = "") -> dict[str, Any]:
    profile = getattr(contractor, "public_profile", None)
    specialty_values = []
    try:
        specialty_values = [skill.name for skill in contractor.skills.all()]
    except Exception:
        specialty_values = []

    context = {
        "business_name": getattr(profile, "business_name_public", "") or getattr(contractor, "business_name", "") or getattr(contractor, "name", ""),
        "tagline": getattr(profile, "tagline", "") or "",
        "bio": getattr(profile, "bio", "") or "",
        "tone": getattr(profile, "proposal_tone", "") or "",
        "city": getattr(profile, "city", "") or getattr(contractor, "city", "") or "",
        "state": getattr(profile, "state", "") or getattr(contractor, "state", "") or "",
        "specialties": getattr(profile, "specialties", None) or specialty_values,
        "work_types": getattr(profile, "work_types", None) or specialty_values,
        "service_area_text": getattr(profile, "service_area_text", "") or "",
        "website_url": getattr(profile, "website_url", "") or "",
        "prompt": prompt,
    }

    client = _get_openai_client()
    model = (
        getattr(settings, "OPENAI_PUBLIC_PROFILE_MODEL", None)
        or getattr(settings, "OPENAI_MODEL", None)
        or "gpt-4o-mini"
    )

    if client is not None:
        system = (
            "You write clear, trustworthy contractor public profile copy for a home services platform. "
            "Return valid JSON only. Use a tone that feels professional and reassuring. "
            "Do not invent certifications, licenses, guarantees, awards, or claims that are not supported by the provided context. "
            "Keep the intro concise and easy to scan. "
            "The work_types array should contain short service labels. "
            "Tone must be one of: professional, friendly, straightforward, premium, warm_and_consultative."
        )
        user = {
            "prompt": prompt,
            "contractor_context": {
                "business_name": context["business_name"],
                "tagline": context["tagline"],
                "bio": context["bio"],
                "tone": context["tone"],
                "city": context["city"],
                "state": context["state"],
                "service_area_text": context["service_area_text"],
                "website_url": context["website_url"],
                "specialties": context["specialties"],
                "work_types": context["work_types"],
            },
            "required_fields": {
                "tagline": "string",
                "intro": "string",
                "tone": list(ALLOWED_TONES),
                "work_types": ["array of strings"],
                "seo_title": "string",
                "seo_description": "string",
            },
        }

        try:
            resp = client.responses.create(
                model=model,
                input=[
                    {"role": "system", "content": system},
                    {"role": "user", "content": json.dumps(user, ensure_ascii=False)},
                ],
                temperature=0.5,
            )
            text = getattr(resp, "output_text", "") or ""
            parsed = json.loads(text)
            if isinstance(parsed, dict):
                return _normalize_result(parsed, context)
        except Exception:
            pass

    return _normalize_result({}, context)
