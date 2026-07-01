from __future__ import annotations

import re

from projects.models import Homeowner


def normalize_customer_email(value: str | None) -> str:
    return str(value or "").strip().lower()


def normalize_customer_phone(value: str | None) -> str:
    return re.sub(r"\D+", "", str(value or ""))


def split_customer_name(full_name: str) -> tuple[str, str]:
    parts = str(full_name or "").strip().split()
    if not parts:
        return "", ""
    if len(parts) == 1:
        return parts[0], ""
    return parts[0], " ".join(parts[1:])


def get_or_create_customer_account_identity(
    *,
    full_name: str,
    email: str,
    phone: str = "",
) -> tuple[Homeowner, bool]:
    """Return the email-linked customer identity without creating duplicates."""
    normalized_email = normalize_customer_email(email)
    normalized_phone = normalize_customer_phone(phone)
    clean_phone = str(phone or "").strip()
    clean_name = str(full_name or "").strip()

    homeowner = None
    if normalized_email:
        homeowner = (
            Homeowner.objects.filter(email__iexact=normalized_email)
            .order_by("-updated_at", "-created_at")
            .first()
        )

    if homeowner is None and normalized_phone:
        for candidate in Homeowner.objects.exclude(phone_number="").order_by("-updated_at", "-created_at")[:500]:
            if normalize_customer_phone(candidate.phone_number) == normalized_phone:
                homeowner = candidate
                break

    if homeowner is None:
        return (
            Homeowner.objects.create(
                full_name=clean_name or normalized_email or clean_phone or "Customer",
                email=normalized_email,
                phone_number=clean_phone,
                status="active",
            ),
            True,
        )

    update_fields: list[str] = []
    if clean_name and not str(homeowner.full_name or "").strip():
        homeowner.full_name = clean_name
        update_fields.append("full_name")
    if normalized_email and not str(homeowner.email or "").strip():
        homeowner.email = normalized_email
        update_fields.append("email")
    if clean_phone and not str(homeowner.phone_number or "").strip():
        homeowner.phone_number = clean_phone
        update_fields.append("phone_number")
    if str(getattr(homeowner, "status", "") or "").lower() not in {"active", "vip"}:
        homeowner.status = "active"
        update_fields.append("status")
    if update_fields:
        homeowner.save(update_fields=[*dict.fromkeys(update_fields), "updated_at"])

    return homeowner, False


def ensure_customer_identity_for_user(user) -> tuple[Homeowner | None, bool]:
    email = normalize_customer_email(getattr(user, "email", ""))
    if not email:
        return None, False
    full_name = str(getattr(user, "get_full_name", lambda: "")() or "").strip()
    phone = str(getattr(user, "phone_number", "") or "").strip()
    return get_or_create_customer_account_identity(full_name=full_name, email=email, phone=phone)
