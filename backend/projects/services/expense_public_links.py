# backend/projects/services/expense_public_links.py
from __future__ import annotations

from django.conf import settings
from django.core import signing


def _ttl_seconds() -> int:
    # default 7 days
    return int(getattr(settings, "MHB_PUBLIC_LINK_TTL_SECONDS", 60 * 60 * 24 * 7))


def make_expense_token(expense_id: int) -> str:
    signer = signing.TimestampSigner(salt="mhb.expense.public")
    return signer.sign(str(int(expense_id)))


def verify_expense_token(expense_id: int, token: str) -> tuple[bool, str]:
    if not token:
        return False, "Missing token."

    signer = signing.TimestampSigner(salt="mhb.expense.public")
    try:
        unsigned = signer.unsign(token, max_age=_ttl_seconds())
    except signing.SignatureExpired:
        return False, "This link has expired. Ask the contractor to resend."
    except signing.BadSignature:
        return False, "Invalid link."

    if str(unsigned) != str(int(expense_id)):
        return False, "Invalid link."

    return True, "ok"