from __future__ import annotations

from typing import Any


def _has_text(value: Any) -> bool:
    return bool(str(value or "").strip())


def build_profile_completion(contractor, user, *, trade_requirements=None, public_profile=None) -> dict[str, Any]:
    requirements = list(trade_requirements or [])
    license_required = any(
        item.get("license_required") is True
        or item.get("requires_license") is True
        or item.get("requirement_type") == "license"
        for item in requirements
        if isinstance(item, dict)
    )
    full_name = f"{getattr(user, 'first_name', '')} {getattr(user, 'last_name', '')}".strip()
    required_definitions = [
        ("contact_name", "Contact name", _has_text(full_name)),
        ("business_name", "Business name", _has_text(getattr(contractor, "business_name", ""))),
        ("email", "Email", _has_text(getattr(user, "email", ""))),
        ("phone", "Phone", _has_text(getattr(contractor, "phone", ""))),
        (
            "business_address",
            "Business address",
            all(
                _has_text(getattr(contractor, field, ""))
                for field in ("address", "city", "state", "zip")
            ),
        ),
        ("service_area", "Service area", int(getattr(contractor, "service_radius_miles", 0) or 0) > 0),
        ("trade_profile", "Trade profile", contractor.skills.exists() or bool(getattr(contractor, "custom_services", []))),
    ]
    items = [
        {"key": key, "label": label, "required": True, "state": "complete" if complete else "incomplete"}
        for key, label, complete in required_definitions
    ]
    has_license = _has_text(getattr(contractor, "license_number", ""))
    items.append(
        {
            "key": "license",
            "label": "License information",
            "required": license_required,
            "state": "complete" if has_license else "incomplete" if license_required else "optional",
        }
    )
    items.extend(
        [
            {
                "key": "logo",
                "label": "Company logo",
                "required": False,
                "state": "complete" if getattr(contractor, "logo", None) else "recommended",
            },
            {
                "key": "business_description",
                "label": "Business description",
                "required": False,
                "state": "complete" if _has_text(getattr(public_profile, "bio", "")) else "recommended",
            },
        ]
    )
    required_items = [item for item in items if item["required"]]
    completed_required = sum(item["state"] == "complete" for item in required_items)
    score = round((completed_required / len(required_items)) * 100) if required_items else 100
    return {
        "score": score,
        "required_count": len(required_items),
        "completed_required": completed_required,
        "items": items,
    }
