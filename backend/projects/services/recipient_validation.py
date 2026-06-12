from __future__ import annotations

from django.core.exceptions import ValidationError
from django.core.validators import validate_email


def normalize_valid_email(value: str | None) -> str:
    email = str(value or "").strip().lower()
    if not email:
        return ""
    try:
        validate_email(email)
    except ValidationError:
        return ""
    return email


def has_valid_email(value: str | None) -> bool:
    return bool(normalize_valid_email(value))


def contractor_has_valid_account_email(contractor) -> bool:
    user = getattr(contractor, "user", None)
    return bool(user and normalize_valid_email(getattr(user, "email", "")))
