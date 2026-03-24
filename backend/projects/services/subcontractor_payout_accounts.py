from __future__ import annotations

from typing import Optional

from django.conf import settings

from payments.models import ConnectedAccount
from payments.stripe_config import stripe
from projects.models_subcontractor import (
    SubcontractorInvitation,
    SubcontractorInvitationStatus,
)


def stripe_connect_enabled() -> bool:
    return bool(
        getattr(settings, "STRIPE_ENABLED", False)
        and (getattr(settings, "STRIPE_API_KEY", None) or getattr(settings, "STRIPE_SECRET_KEY", None))
    )


def is_eligible_subcontractor_user(user) -> bool:
    if user is None:
        return False
    if hasattr(user, "contractor_profile") or hasattr(user, "contractor_subaccount"):
        return False
    return SubcontractorInvitation.objects.filter(
        accepted_by_user=user,
        status=SubcontractorInvitationStatus.ACCEPTED,
    ).exists()


def _frontend_return_url() -> str:
    return f"{getattr(settings, 'FRONTEND_URL', 'http://localhost:3000').rstrip('/')}/app/subcontractor/assigned-work"


def get_or_create_connected_account(user) -> ConnectedAccount:
    profile, _ = ConnectedAccount.objects.get_or_create(user=user)
    return profile


def refresh_connected_account(profile: ConnectedAccount):
    if not profile.stripe_account_id or not stripe_connect_enabled():
        return None
    acct = stripe.Account.retrieve(profile.stripe_account_id)
    profile.set_flags(
        charges=bool(acct.get("charges_enabled")),
        payouts=bool(acct.get("payouts_enabled")),
        submitted=bool(acct.get("details_submitted")),
    )
    return acct


def payout_account_status_payload(user) -> dict:
    profile = get_or_create_connected_account(user)
    acct = None
    if profile.stripe_account_id and stripe_connect_enabled():
        try:
            acct = refresh_connected_account(profile)
        except Exception:
            acct = None

    if acct is None and not profile.stripe_account_id:
        return {
            "eligible_role": True,
            "connected": False,
            "account_linked": False,
            "onboarding_status": "not_connected",
            "payouts_enabled": False,
            "details_submitted": False,
            "currently_due": [],
            "disabled_reason": None,
        }

    if acct is None:
        return {
            "eligible_role": True,
            "connected": False,
            "account_linked": bool(profile.stripe_account_id),
            "onboarding_status": "onboarding_incomplete",
            "payouts_enabled": bool(profile.payouts_enabled),
            "details_submitted": bool(profile.details_submitted),
            "currently_due": [],
            "disabled_reason": None,
        }

    requirements = acct.get("requirements") or {}
    currently_due = requirements.get("currently_due") or []
    payouts_enabled = bool(acct.get("payouts_enabled"))
    details_submitted = bool(acct.get("details_submitted"))
    connected = payouts_enabled and details_submitted and len(currently_due) == 0

    return {
        "eligible_role": True,
        "connected": connected,
        "account_linked": bool(acct.get("id")),
        "onboarding_status": "ready" if connected else "onboarding_incomplete",
        "payouts_enabled": payouts_enabled,
        "details_submitted": details_submitted,
        "currently_due": currently_due,
        "disabled_reason": requirements.get("disabled_reason"),
    }


def ensure_subcontractor_connect_account(user) -> str:
    if not stripe_connect_enabled():
        raise RuntimeError("Stripe is not enabled.")

    profile = get_or_create_connected_account(user)
    if profile.stripe_account_id:
        return profile.stripe_account_id

    acct = stripe.Account.create(
        type="express",
        country=getattr(settings, "STRIPE_CONNECT_ACCOUNT_COUNTRY", "US"),
        email=(getattr(user, "email", "") or None),
        business_type="individual",
        capabilities={"transfers": {"requested": True}},
        metadata={
            "user_id": str(getattr(user, "id", "")),
            "payout_role": "subcontractor",
        },
    )
    profile.link(acct["id"])
    profile.set_flags(
        charges=bool(acct.get("charges_enabled")),
        payouts=bool(acct.get("payouts_enabled")),
        submitted=bool(acct.get("details_submitted")),
    )
    return acct["id"]


def create_subcontractor_onboarding_link(user) -> dict:
    acct_id = ensure_subcontractor_connect_account(user)
    return_url = _frontend_return_url()
    link = stripe.AccountLink.create(
        account=acct_id,
        refresh_url=return_url,
        return_url=return_url,
        type="account_onboarding",
    )
    return {"url": link["url"], "account_id": acct_id}


def create_subcontractor_manage_link(user) -> dict:
    acct_id = ensure_subcontractor_connect_account(user)
    return_url = _frontend_return_url()
    acct = refresh_connected_account(get_or_create_connected_account(user))
    requirements = (acct or {}).get("requirements") or {}
    connected = bool(acct and acct.get("payouts_enabled") and acct.get("details_submitted") and not requirements.get("currently_due"))

    try:
        link = stripe.AccountLink.create(
            account=acct_id,
            refresh_url=return_url,
            return_url=return_url,
            type="account_update" if connected else "account_onboarding",
        )
        return {"url": link["url"], "account_id": acct_id}
    except Exception:
        login = stripe.Account.create_login_link(acct_id)
        return {"url": login["url"], "account_id": acct_id}
