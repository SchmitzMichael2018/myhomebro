# backend/backend/payments/views/onboarding.py
# Stripe onboarding: keep ConnectedAccount + Contractor in sync (authoritative status)
#
# Endpoints typically wired in payments/urls.py:
#   GET  /api/payments/onboarding/status/
#   POST /api/payments/onboarding/start/
#   POST /api/payments/onboarding/manage/
#   POST /api/payments/onboarding/login_link/

from __future__ import annotations

from typing import Optional, Tuple

from django.conf import settings
from rest_framework import permissions, status
from rest_framework.response import Response
from rest_framework.views import APIView

from ..models import ConnectedAccount
from payments.stripe_config import stripe  # ✅ single source of truth for Stripe config


# ──────────────────────────────────────────────────────────────────────────────
# Helpers
# ──────────────────────────────────────────────────────────────────────────────
def _stripe_enabled() -> bool:
    # Accept either STRIPE_API_KEY or STRIPE_SECRET_KEY (stripe_config handles preference)
    return bool(
        getattr(settings, "STRIPE_ENABLED", False)
        and (getattr(settings, "STRIPE_API_KEY", None) or getattr(settings, "STRIPE_SECRET_KEY", None))
    )


def _get_site_urls() -> Tuple[str, str]:
    frontend = getattr(settings, "FRONTEND_URL", "http://localhost:3000").rstrip("/")
    site = getattr(settings, "SITE_URL", "http://127.0.0.1:8000").rstrip("/")
    return frontend, site


def _get_user_and_profile(request) -> tuple:
    user = request.user
    profile, _ = ConnectedAccount.objects.get_or_create(user=user)
    return user, profile


def _sync_flags_from_stripe(profile: ConnectedAccount, acct: Optional[dict]) -> None:
    if not acct:
        return
    charges = bool(acct.get("charges_enabled"))
    payouts = bool(acct.get("payouts_enabled"))
    submitted = bool(acct.get("details_submitted"))
    profile.set_flags(charges=charges, payouts=payouts, submitted=submitted)


def _sync_contractor_from_connected_account(user, acct_id: Optional[str], acct: Optional[dict]) -> None:
    """
    Keep projects.Contractor aligned with payments.ConnectedAccount.
    Required for escrow releases because payouts use Contractor.stripe_account_id.
    """
    if not acct_id:
        return

    try:
        from projects.models import Contractor  # type: ignore
    except Exception:
        return

    try:
        contractor = Contractor.objects.get(user=user)
    except Exception:
        return

    dirty = []

    if getattr(contractor, "stripe_account_id", "") != acct_id:
        contractor.stripe_account_id = acct_id
        dirty.append("stripe_account_id")

    if acct:
        charges = bool(acct.get("charges_enabled"))
        payouts = bool(acct.get("payouts_enabled"))
        submitted = bool(acct.get("details_submitted"))

        for field, val in [
            ("charges_enabled", charges),
            ("payouts_enabled", payouts),
            ("details_submitted", submitted),
        ]:
            if hasattr(contractor, field) and getattr(contractor, field) != val:
                setattr(contractor, field, val)
                dirty.append(field)

    if dirty:
        contractor.save(update_fields=dirty)


def _create_or_get_connect_account_id(profile: ConnectedAccount, user) -> str:
    if not _stripe_enabled():
        raise RuntimeError("Stripe is not enabled. Set STRIPE_ENABLED=1 and STRIPE_API_KEY/STRIPE_SECRET_KEY.")

    if profile.stripe_account_id:
        return profile.stripe_account_id

    acct_country = getattr(settings, "STRIPE_CONNECT_ACCOUNT_COUNTRY", "US")
    acct = stripe.Account.create(
        type="express",
        country=acct_country,
        email=(user.email or None),
        business_type="individual",
        capabilities={"card_payments": {"requested": True}, "transfers": {"requested": True}},
        metadata={"user_id": str(getattr(user, "id", ""))},
    )
    acct_id = acct["id"]

    profile.link(acct_id)
    _sync_flags_from_stripe(profile, acct)

    # ✅ Sync to Contractor immediately
    _sync_contractor_from_connected_account(user, acct_id, acct)

    return acct_id


def _status_payload(acct: Optional[dict], profile: ConnectedAccount, user) -> dict:
    """
    Canonical onboarding status:
      - completed/connected ONLY if:
          details_submitted && charges_enabled && payouts_enabled && currently_due empty
      - in_progress if account exists but not fully enabled
      - not_started if no account id
      - unknown if account id exists but Stripe retrieve failed
    """
    acct_id = profile.stripe_account_id

    if not acct:
        if not acct_id:
            return {
                "onboarding_status": "not_started",
                "linked": False,
                "connected": False,
                "account_id": None,
                "charges_enabled": False,
                "payouts_enabled": False,
                "details_submitted": False,
                "currently_due": [],
                "eventually_due": [],
                "past_due": [],
                "disabled_reason": None,
                "link": None,
            }

        # Stripe retrieve failed but we have an account id
        return {
            "onboarding_status": "unknown",
            "linked": True,
            "connected": False,
            "account_id": acct_id,
            "charges_enabled": bool(getattr(profile, "charges_enabled", False)),
            "payouts_enabled": bool(getattr(profile, "payouts_enabled", False)),
            "details_submitted": bool(getattr(profile, "details_submitted", False)),
            "currently_due": [],
            "eventually_due": [],
            "past_due": [],
            "disabled_reason": None,
            "link": None,
        }

    acct_id = acct.get("id") or acct_id
    charges = bool(acct.get("charges_enabled"))
    payouts = bool(acct.get("payouts_enabled"))
    submitted = bool(acct.get("details_submitted"))

    req = acct.get("requirements") or {}
    currently_due = req.get("currently_due") or []
    eventually_due = req.get("eventually_due") or []
    past_due = req.get("past_due") or []
    disabled_reason = req.get("disabled_reason")

    fully_connected = submitted and charges and payouts and (len(currently_due) == 0)
    status_str = "completed" if fully_connected else "in_progress"

    # Sync flags to profile + contractor
    profile.set_flags(charges=charges, payouts=payouts, submitted=submitted)
    _sync_contractor_from_connected_account(user, acct_id, acct)

    return {
        "onboarding_status": status_str,
        "linked": bool(acct_id),
        "connected": bool(fully_connected),
        "account_id": acct_id,
        "charges_enabled": charges,
        "payouts_enabled": payouts,
        "details_submitted": submitted,
        "currently_due": currently_due,
        "eventually_due": eventually_due,
        "past_due": past_due,
        "disabled_reason": disabled_reason,
        "link": None,
    }


# ──────────────────────────────────────────────────────────────────────────────
# Views
# ──────────────────────────────────────────────────────────────────────────────
class OnboardingStatus(APIView):
    """
    GET /api/payments/onboarding/status/
    ✅ Read-only. Does NOT create accounts.
    """
    permission_classes = [permissions.IsAuthenticated]

    def get(self, request):
        if not _stripe_enabled():
            return Response({"detail": "Stripe disabled", "onboarding_status": "disabled"}, status=status.HTTP_200_OK)

        user, profile = _get_user_and_profile(request)

        acct_obj = None
        if profile.stripe_account_id:
            try:
                acct_obj = stripe.Account.retrieve(profile.stripe_account_id)
            except Exception:
                acct_obj = None

        payload = _status_payload(acct_obj, profile, user)
        return Response(payload, status=status.HTTP_200_OK)


class OnboardingStart(APIView):
    """
    POST /api/payments/onboarding/start/
    Creates account if needed, returns Stripe onboarding link.
    """
    permission_classes = [permissions.IsAuthenticated]

    def post(self, request):
        if not _stripe_enabled():
            return Response({"detail": "Stripe disabled"}, status=status.HTTP_400_BAD_REQUEST)

        user, profile = _get_user_and_profile(request)
        acct_id = _create_or_get_connect_account_id(profile, user)
        frontend_url, _ = _get_site_urls()

        try:
            link = stripe.AccountLink.create(
                account=acct_id,
                refresh_url=f"{frontend_url}/onboarding",
                return_url=f"{frontend_url}/onboarding",
                type="account_onboarding",
            )
            return Response({"url": link["url"], "onboarding_url": link["url"], "account_id": acct_id}, status=200)
        except Exception as exc:
            return Response({"detail": f"Stripe error: {exc}"}, status=status.HTTP_502_BAD_GATEWAY)


class OnboardingManage(APIView):
    """
    POST /api/payments/onboarding/manage/
    Sends user to update or Express dashboard depending on status.
    """
    permission_classes = [permissions.IsAuthenticated]

    def post(self, request):
        if not _stripe_enabled():
            return Response({"detail": "Stripe disabled"}, status=status.HTTP_400_BAD_REQUEST)

        user, profile = _get_user_and_profile(request)
        acct_id = _create_or_get_connect_account_id(profile, user)
        frontend_url, _ = _get_site_urls()

        try:
            acct = stripe.Account.retrieve(acct_id)
        except Exception as exc:
            return Response({"detail": f"Stripe error retrieving account: {exc}"}, status=status.HTTP_502_BAD_GATEWAY)

        _sync_flags_from_stripe(profile, acct)
        _sync_contractor_from_connected_account(user, acct_id, acct)

        req = acct.get("requirements") or {}
        currently_due = req.get("currently_due") or []

        fully_connected = bool(acct.get("details_submitted")) and bool(acct.get("charges_enabled")) and bool(
            acct.get("payouts_enabled")
        ) and (len(currently_due) == 0)

        try:
            link_type = "account_update" if fully_connected else "account_onboarding"
            link = stripe.AccountLink.create(
                account=acct_id,
                refresh_url=f"{frontend_url}/onboarding",
                return_url=f"{frontend_url}/onboarding",
                type=link_type,
            )
            return Response({"manage_url": link["url"], "account_id": acct_id}, status=200)
        except Exception:
            # Fallback: Express login link
            try:
                login = stripe.Account.create_login_link(acct_id)
                return Response({"manage_url": login["url"], "account_id": acct_id}, status=200)
            except Exception as exc:
                return Response({"detail": f"Stripe error: {exc}"}, status=status.HTTP_502_BAD_GATEWAY)


class OnboardingLoginLink(APIView):
    """
    POST /api/payments/onboarding/login_link/
    Returns Stripe Express Dashboard login link.
    """
    permission_classes = [permissions.IsAuthenticated]

    def post(self, request):
        if not _stripe_enabled():
            return Response({"detail": "Stripe disabled"}, status=status.HTTP_400_BAD_REQUEST)

        user, profile = _get_user_and_profile(request)
        acct_id = _create_or_get_connect_account_id(profile, user)

        try:
            acct = stripe.Account.retrieve(acct_id)
        except Exception as exc:
            return Response({"detail": f"Stripe error retrieving account: {exc}"}, status=status.HTTP_502_BAD_GATEWAY)

        _sync_flags_from_stripe(profile, acct)
        _sync_contractor_from_connected_account(user, acct_id, acct)

        try:
            login = stripe.Account.create_login_link(acct_id)
            return Response({"login_url": login["url"], "url": login["url"], "account_id": acct_id}, status=200)
        except Exception as exc:
            return Response({"detail": f"Stripe error: {exc}"}, status=status.HTTP_502_BAD_GATEWAY)
