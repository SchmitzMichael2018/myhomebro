# backend/backend/payments/views/onboarding.py
# v2025-12-30d — Stripe onboarding: keep ConnectedAccount + Contractor in sync
#
# Fixes:
# - Restores OnboardingLoginLink (imports expected by payments/views/__init__.py)
# - Ensures Contractor.stripe_account_id is saved/updated from ConnectedAccount
# - Syncs charges_enabled/payouts_enabled/details_submitted to Contractor flags
#
# Endpoints typically wired in payments/urls.py:
#   GET  /api/payments/onboarding/status/
#   POST /api/payments/onboarding/start/
#   POST /api/payments/onboarding/manage/
#   POST /api/payments/onboarding/login_link/   (or similar)  <-- restored

from __future__ import annotations

from typing import Optional, Tuple

from django.conf import settings
from rest_framework import permissions, status
from rest_framework.response import Response
from rest_framework.views import APIView

from ..models import ConnectedAccount

# Stripe import (guarded)
try:
    import stripe  # type: ignore
except Exception:  # pragma: no cover
    stripe = None  # type: ignore


# ──────────────────────────────────────────────────────────────────────────────
# Helpers
# ──────────────────────────────────────────────────────────────────────────────
def _stripe_enabled() -> bool:
    return bool(getattr(settings, "STRIPE_ENABLED", False) and getattr(settings, "STRIPE_SECRET_KEY", None))


def _maybe_init_stripe() -> None:
    if _stripe_enabled() and stripe:
        stripe.api_key = settings.STRIPE_SECRET_KEY  # type: ignore[attr-defined]


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
    _maybe_init_stripe()
    if not (_stripe_enabled() and stripe):
        raise RuntimeError("Stripe is not enabled. Set STRIPE_ENABLED=1 and STRIPE_SECRET_KEY.")

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
    if acct:
        charges = bool(acct.get("charges_enabled"))
        payouts = bool(acct.get("payouts_enabled"))
        submitted = bool(acct.get("details_submitted"))
        status_str = "completed" if (payouts or charges) else ("in_progress" if submitted else "not_started")
        profile.set_flags(charges=charges, payouts=payouts, submitted=submitted)
        acct_id = acct.get("id")
    else:
        status_str = "not_started"
        charges = payouts = submitted = False
        acct_id = profile.stripe_account_id

    # ✅ Keep Contractor aligned too
    _sync_contractor_from_connected_account(user, acct_id, acct)

    return {
        "onboarding_status": status_str,
        "linked": bool(payouts or charges),
        "connected": bool(payouts or charges),
        "account_id": acct_id,
        "charges_enabled": charges,
        "payouts_enabled": payouts,
        "details_submitted": submitted,
        "link": None,
    }


# ──────────────────────────────────────────────────────────────────────────────
# Views
# ──────────────────────────────────────────────────────────────────────────────
class OnboardingStatus(APIView):
    permission_classes = [permissions.IsAuthenticated]

    def get(self, request):
        if not _stripe_enabled():
            return Response({"detail": "Stripe disabled", "onboarding_status": "disabled"}, status=status.HTTP_200_OK)

        _maybe_init_stripe()
        if not stripe:
            return Response({"detail": "Stripe library missing"}, status=status.HTTP_503_SERVICE_UNAVAILABLE)

        user, profile = _get_user_and_profile(request)

        # Self-heal: create/link a Connect account if we don't have one yet
        if not profile.stripe_account_id:
            try:
                _create_or_get_connect_account_id(profile, user)
            except Exception:
                pass

        acct_obj = None
        if profile.stripe_account_id:
            try:
                acct_obj = stripe.Account.retrieve(profile.stripe_account_id)
            except Exception:
                acct_obj = None

        payload = _status_payload(acct_obj, profile, user)
        return Response(payload, status=status.HTTP_200_OK)


class OnboardingStart(APIView):
    permission_classes = [permissions.IsAuthenticated]

    def post(self, request):
        if not _stripe_enabled():
            return Response({"detail": "Stripe disabled"}, status=status.HTTP_400_BAD_REQUEST)

        _maybe_init_stripe()
        if not stripe:
            return Response({"detail": "Stripe library missing"}, status=status.HTTP_503_SERVICE_UNAVAILABLE)

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
    permission_classes = [permissions.IsAuthenticated]

    def post(self, request):
        if not _stripe_enabled():
            return Response({"detail": "Stripe disabled"}, status=status.HTTP_400_BAD_REQUEST)

        _maybe_init_stripe()
        if not stripe:
            return Response({"detail": "Stripe library missing"}, status=status.HTTP_503_SERVICE_UNAVAILABLE)

        user, profile = _get_user_and_profile(request)
        acct_id = _create_or_get_connect_account_id(profile, user)
        frontend_url, _ = _get_site_urls()

        try:
            acct = stripe.Account.retrieve(acct_id)
        except Exception as exc:
            return Response({"detail": f"Stripe error retrieving account: {exc}"}, status=status.HTTP_502_BAD_GATEWAY)

        charges_enabled = bool(acct.get("charges_enabled"))
        payouts_enabled = bool(acct.get("payouts_enabled"))
        submitted = bool(acct.get("details_submitted"))

        profile.set_flags(charges=charges_enabled, payouts=payouts_enabled, submitted=submitted)
        _sync_contractor_from_connected_account(user, acct_id, acct)

        is_completed = charges_enabled or payouts_enabled

        if not is_completed:
            try:
                link = stripe.AccountLink.create(
                    account=acct_id,
                    refresh_url=f"{frontend_url}/onboarding",
                    return_url=f"{frontend_url}/onboarding",
                    type="account_onboarding",
                )
                return Response({"manage_url": link["url"], "account_id": acct_id}, status=200)
            except Exception as exc:
                return Response({"detail": f"Stripe error: {exc}"}, status=status.HTTP_502_BAD_GATEWAY)

        try:
            link = stripe.AccountLink.create(
                account=acct_id,
                refresh_url=f"{frontend_url}/onboarding",
                return_url=f"{frontend_url}/onboarding",
                type="account_update",
            )
            return Response({"manage_url": link["url"], "account_id": acct_id}, status=200)
        except Exception:
            try:
                login = stripe.Account.create_login_link(acct_id)
                return Response({"manage_url": login["url"], "account_id": acct_id}, status=200)
            except Exception as exc:
                return Response({"detail": f"Stripe error: {exc}"}, status=status.HTTP_502_BAD_GATEWAY)


class OnboardingLoginLink(APIView):
    """
    POST /api/payments/onboarding/login_link/
    Returns a Stripe Express Dashboard login link (requires completed-ish account).
    This is required because your payments.views.__init__ imports it.
    """
    permission_classes = [permissions.IsAuthenticated]

    def post(self, request):
        if not _stripe_enabled():
            return Response({"detail": "Stripe disabled"}, status=status.HTTP_400_BAD_REQUEST)

        _maybe_init_stripe()
        if not stripe:
            return Response({"detail": "Stripe library missing"}, status=status.HTTP_503_SERVICE_UNAVAILABLE)

        user, profile = _get_user_and_profile(request)
        acct_id = _create_or_get_connect_account_id(profile, user)

        try:
            acct = stripe.Account.retrieve(acct_id)
        except Exception as exc:
            return Response({"detail": f"Stripe error retrieving account: {exc}"}, status=status.HTTP_502_BAD_GATEWAY)

        # Sync flags to both models
        _sync_flags_from_stripe(profile, acct)
        _sync_contractor_from_connected_account(user, acct_id, acct)

        # Stripe will fail login links if account not ready; still try.
        try:
            login = stripe.Account.create_login_link(acct_id)
            return Response({"login_url": login["url"], "url": login["url"], "account_id": acct_id}, status=200)
        except Exception as exc:
            return Response({"detail": f"Stripe error: {exc}"}, status=status.HTTP_502_BAD_GATEWAY)
