# backend/projects/views/funding.py
# v2026-02-10 — Escrow funding + public fund + fee preview + amendment top-ups + receipt endpoint
#
# Includes:
# - Milestones are source of truth for total required (self-heals agreement.total_cost)
# - escrow_funded is computed from amounts (self-heals stale escrow_funded flag)
# - Public funding info returns total_required, escrow_funded_amount, remaining_to_fund
# - Card-only PaymentIntents (removes Cash App / Klarna / Amazon Pay, etc.)
# - Adds receipt_email to PaymentIntent (Stripe can email receipts if enabled)
# - Adds receipt endpoint: GET /api/projects/funding/receipt/?token=...
#
# ✅ Fix:
# - Funding preview intro pricing now anchors to the *most recent* of:
#     contractor.created_at OR contractor.user.date_joined
#   This prevents pre-created contractor rows (invites/seeds) from incorrectly ending intro pricing.

from __future__ import annotations

from decimal import Decimal
import logging

from django.conf import settings
from django.db.models import Sum
from django.utils import timezone

from rest_framework import permissions, status
from rest_framework.response import Response
from rest_framework.views import APIView

import stripe

from projects.models import Agreement, AgreementFundingLink, Milestone
from projects.services.contractor_onboarding import build_stripe_requirement_payload
from projects.services.mailer import email_escrow_funding_request
from payments.fees import (
    compute_fee_summary,
    get_monthly_paid_invoice_volume_for_contractor,
    INTRO_DAYS,
)  # ✅ pull intro days for UI consistency

logger = logging.getLogger(__name__)
stripe.api_key = getattr(settings, "STRIPE_SECRET_KEY", None)


# ─────────────────────────────────────────────────────────────
# Helpers
# ─────────────────────────────────────────────────────────────

def get_contractor_monthly_volume(contractor) -> Decimal:
    return get_monthly_paid_invoice_volume_for_contractor(contractor)


def _to_decimal(v, default: str = "0.00") -> Decimal:
    try:
        if v is None:
            return Decimal(default)
        return Decimal(str(v))
    except Exception:
        return Decimal(default)


def _milestone_sum(agreement: Agreement) -> Decimal:
    total = (
        Milestone.objects.filter(agreement=agreement)
        .aggregate(total=Sum("amount"))
        .get("total")
        or Decimal("0.00")
    )
    return _to_decimal(total).quantize(Decimal("0.01"))


def _get_total_required(agreement: Agreement, *, heal_db: bool = False) -> Decimal:
    ms_total = _milestone_sum(agreement)
    tc = _to_decimal(getattr(agreement, "total_cost", None)).quantize(Decimal("0.01"))

    if ms_total > 0:
        if heal_db and hasattr(agreement, "total_cost") and ms_total != tc:
            try:
                agreement.total_cost = ms_total
                agreement.save(update_fields=["total_cost"])
            except Exception as e:
                logger.warning("Could not self-heal total_cost for Agreement %s: %s", agreement.id, e)
        return ms_total

    if tc > 0:
        return tc

    return Decimal("0.00")


def _sync_funding_flags(agreement: Agreement, *, heal_total: bool = True, persist: bool = True) -> dict:
    total_required = _get_total_required(agreement, heal_db=heal_total)
    funded = _to_decimal(getattr(agreement, "escrow_funded_amount", None)).quantize(Decimal("0.01"))
    remaining = max(total_required - funded, Decimal("0.00"))
    is_funded = bool(total_required > 0 and funded >= total_required)

    if persist and hasattr(agreement, "escrow_funded"):
        cur = bool(getattr(agreement, "escrow_funded", False))
        if cur != is_funded:
            try:
                agreement.escrow_funded = is_funded
                agreement.save(update_fields=["escrow_funded"])
            except Exception as e:
                logger.warning("Could not self-heal escrow_funded for Agreement %s: %s", agreement.id, e)

    return {
        "total_required": total_required,
        "funded": funded,
        "remaining": remaining,
        "escrow_funded": is_funded,
    }


def _pricing_start_date_for_contractor(contractor):
    """
    ✅ Determines pricing start anchor for intro pricing.
    Use the *most recent* of contractor.created_at and contractor.user.date_joined.
    This prevents pre-created contractor rows from incorrectly ending intro pricing.
    """
    created_at = getattr(contractor, "created_at", None) or getattr(contractor, "created", None)
    user = getattr(contractor, "user", None)
    joined_at = getattr(user, "date_joined", None) if user else None

    candidates = []
    if created_at:
        candidates.append(created_at)
    if joined_at:
        candidates.append(joined_at)

    if not candidates:
        return timezone.now()

    latest = max(candidates)
    return latest


# ─────────────────────────────────────────────────────────────
# Core funding logic
# ─────────────────────────────────────────────────────────────

def send_funding_link_for_agreement(
    agreement: Agreement,
    request=None,
    amount=None,
    currency: str | None = None,
) -> dict:
    if not agreement.is_fully_signed:
        raise ValueError("Agreement must be fully signed before funding.")

    currency = (currency or "usd").lower()

    sync = _sync_funding_flags(agreement, heal_total=True, persist=True)
    remaining = sync["remaining"]

    if remaining <= 0:
        raise ValueError("Escrow is already fully funded for this agreement.")

    if amount is not None:
        amount = _to_decimal(amount)
        if amount <= 0:
            raise ValueError("Funding amount must be greater than zero.")
        if amount > remaining:
            raise ValueError(f"Funding amount exceeds remaining escrow (${remaining:.2f}).")
    else:
        amount = remaining

    homeowner_email = ""
    if agreement.homeowner:
        homeowner_email = agreement.homeowner.email or ""
    if not homeowner_email:
        homeowner_email = getattr(agreement, "homeowner_email", "") or ""
    if not homeowner_email:
        raise ValueError("Agreement is missing a homeowner email address.")

    # Deactivate any prior active links
    AgreementFundingLink.objects.filter(
        agreement=agreement, is_active=True, used_at__isnull=True
    ).update(is_active=False)

    link = AgreementFundingLink.create_for_agreement(
        agreement=agreement,
        amount=amount,
        currency=currency,
    )

    base_url = getattr(settings, "PUBLIC_FRONTEND_BASE_URL", "").rstrip("/")
    if not base_url and request is not None:
        base_url = request.build_absolute_uri("/").rstrip("/")
    public_fund_url = f"{base_url}/public-fund/{link.token}" if base_url else f"/public-fund/{link.token}"

    try:
        email_escrow_funding_request(
            agreement,
            funding_url=public_fund_url,
        )
    except Exception:
        logger.exception("Failed sending escrow funding email for Agreement %s", agreement.id)

    return {
        "agreement_id": agreement.id,
        "amount": f"{amount:.2f}",
        "currency": currency,
        "remaining_after": f"{(remaining - amount):.2f}",
        "public_fund_url": public_fund_url,
        "expires_at": link.expires_at.isoformat(),
    }


# ─────────────────────────────────────────────────────────────
# Permissions
# ─────────────────────────────────────────────────────────────

class IsContractorOrReadOnly(permissions.BasePermission):
    def has_permission(self, request, view):
        return request.user and request.user.is_authenticated


# ─────────────────────────────────────────────────────────────
# Views
# ─────────────────────────────────────────────────────────────

class SendFundingLinkView(APIView):
    permission_classes = [IsContractorOrReadOnly]

    def post(self, request, pk: int, *args, **kwargs):
        try:
            agreement = Agreement.objects.get(pk=pk)
        except Agreement.DoesNotExist:
            return Response({"detail": "Agreement not found."}, status=status.HTTP_404_NOT_FOUND)

        contractor = getattr(agreement, "contractor", None)
        if contractor is not None and not bool(getattr(contractor, "stripe_connected", False)):
            return Response(
                build_stripe_requirement_payload(
                    contractor,
                    action_key="send_funding_link",
                    action_label="Send Escrow Funding Link",
                    source="agreement_funding",
                    return_path=f"/app/agreements/{agreement.id}/wizard?step=4",
                ),
                status=status.HTTP_409_CONFLICT,
            )

        try:
            payload = send_funding_link_for_agreement(
                agreement,
                request=request,
                amount=request.data.get("amount"),
                currency=request.data.get("currency"),
            )
        except ValueError as exc:
            return Response({"detail": str(exc)}, status=status.HTTP_400_BAD_REQUEST)

        return Response(payload, status=status.HTTP_201_CREATED)


class PublicFundingInfoView(APIView):
    permission_classes = []  # token-based; no auth

    def get(self, request, *args, **kwargs):
        token = (request.query_params.get("token") or "").strip()
        if not token:
            return Response({"detail": "Missing funding token."}, status=status.HTTP_400_BAD_REQUEST)

        try:
            link = AgreementFundingLink.objects.select_related(
                "agreement",
                "agreement__project",
                "agreement__contractor",
                "agreement__homeowner",
            ).get(token=token)
        except AgreementFundingLink.DoesNotExist:
            return Response({"detail": "Funding link not found."}, status=status.HTTP_404_NOT_FOUND)

        if not link.is_valid():
            return Response({"detail": "This funding link is no longer valid."}, status=status.HTTP_400_BAD_REQUEST)

        agreement = link.agreement
        sync = _sync_funding_flags(agreement, heal_total=True, persist=True)

        contractor_name = ""
        if agreement.contractor:
            contractor_name = (
                agreement.contractor.business_name
                or agreement.contractor.name
                or getattr(agreement.contractor, "email", "")
            )

        homeowner_name = ""
        if agreement.homeowner:
            homeowner_name = agreement.homeowner.full_name or ""

        project_title = ""
        if agreement.project:
            project_title = agreement.project.title or ""

        return Response(
            {
                "token": link.token,
                "amount": f"{link.amount:.2f}",
                "currency": link.currency,
                "project_title": project_title or "Your project",
                "contractor_name": contractor_name or "Your contractor",
                "homeowner_name": homeowner_name or "Homeowner",
                "agreement_id": agreement.id,

                # Truth fields
                "total_required": f"{sync['total_required']:.2f}",
                "escrow_funded_amount": f"{sync['funded']:.2f}",
                "remaining_to_fund": f"{sync['remaining']:.2f}",
                "escrow_funded": bool(sync["escrow_funded"]),

                "expires_at": link.expires_at.isoformat(),
                "expired": link.is_expired,
            },
            status=status.HTTP_200_OK,
        )


class CreateFundingPaymentIntentView(APIView):
    permission_classes = []  # token-based; no auth

    def post(self, request, *args, **kwargs):
        if stripe.api_key is None:
            return Response({"detail": "Stripe API key not configured."}, status=status.HTTP_503_SERVICE_UNAVAILABLE)

        token = (request.data.get("token") or "").strip()
        if not token:
            return Response({"detail": "Missing funding token."}, status=status.HTTP_400_BAD_REQUEST)

        try:
            link = AgreementFundingLink.objects.select_related(
                "agreement",
                "agreement__project",
                "agreement__contractor",
                "agreement__homeowner",
            ).get(token=token)
        except AgreementFundingLink.DoesNotExist:
            return Response({"detail": "Funding link not found."}, status=status.HTTP_404_NOT_FOUND)

        if not link.is_valid():
            return Response({"detail": "This funding link is no longer valid."}, status=status.HTTP_400_BAD_REQUEST)

        agreement = link.agreement
        sync = _sync_funding_flags(agreement, heal_total=True, persist=True)
        if sync["remaining"] <= 0:
            return Response({"already_paid": True, "status": "succeeded"}, status=status.HTTP_200_OK)

        currency = (link.currency or "usd").lower()
        amount_cents = int(Decimal(link.amount) * 100)

        # Reuse existing PI if present (only if not succeeded)
        if link.payment_intent_id:
            try:
                pi = stripe.PaymentIntent.retrieve(link.payment_intent_id)
            except Exception:
                pi = None

            if pi is not None:
                if pi.status in ("succeeded", "processing", "requires_capture"):
                    return Response({"already_paid": True, "status": pi.status}, status=status.HTTP_200_OK)

                return Response(
                    {
                        "client_secret": pi.client_secret,
                        "amount": f"{link.amount:.2f}",
                        "currency": currency,
                        "already_paid": False,
                        "payment_intent_id": pi.id,
                    },
                    status=status.HTTP_200_OK,
                )

        project_title = agreement.project.title if agreement.project else "Your project"
        description = f"MyHomeBro escrow funding for project: {project_title}"

        receipt_email = ""
        try:
            receipt_email = (agreement.homeowner.email or "").strip() if agreement.homeowner else ""
        except Exception:
            receipt_email = ""

        # ✅ Card-only (removes Cash App / Klarna / Amazon Pay)
        stripe_kwargs = {
            "amount": amount_cents,
            "currency": currency,
            "payment_method_types": ["card"],
            "description": description,
            "metadata": {
                "agreement_id": str(agreement.id),
                "funding_link_id": str(link.id),
            },
        }

        # ✅ Stripe will email a receipt if receipts are enabled in Stripe settings
        if receipt_email:
            stripe_kwargs["receipt_email"] = receipt_email

        try:
            pi = stripe.PaymentIntent.create(**stripe_kwargs)
        except Exception as exc:
            logger.exception("Failed to create PaymentIntent for funding link %s: %s", link.id, exc)
            return Response({"detail": f"Unable to create payment intent: {exc}"}, status=status.HTTP_500_INTERNAL_SERVER_ERROR)

        link.payment_intent_id = pi.id
        link.save(update_fields=["payment_intent_id"])

        return Response(
            {
                "client_secret": pi.client_secret,
                "amount": f"{link.amount:.2f}",
                "currency": currency,
                "already_paid": False,
                "payment_intent_id": pi.id,
                "receipt_email": receipt_email or None,
            },
            status=status.HTTP_200_OK,
        )


class FundingReceiptView(APIView):
    """
    Token-based receipt summary endpoint.
    GET /api/projects/funding/receipt/?token=...
    """
    permission_classes = []  # token-based; no auth

    def get(self, request, *args, **kwargs):
        token = (request.query_params.get("token") or "").strip()
        if not token:
            return Response({"detail": "Missing funding token."}, status=status.HTTP_400_BAD_REQUEST)

        try:
            link = AgreementFundingLink.objects.select_related(
                "agreement",
                "agreement__project",
                "agreement__homeowner",
            ).get(token=token)
        except AgreementFundingLink.DoesNotExist:
            return Response({"detail": "Funding link not found."}, status=status.HTTP_404_NOT_FOUND)

        agreement = link.agreement
        project_title = agreement.project.title if agreement.project else f"Agreement #{agreement.id}"

        # Default receipt payload (even if Stripe not available)
        payload = {
            "agreement_id": agreement.id,
            "project_title": project_title,
            "funding_link_id": link.id,
            "token": link.token,
            "amount": f"{link.amount:.2f}",
            "currency": link.currency,
            "payment_intent_id": link.payment_intent_id or None,
            "status": None,
            "paid": False,
            "paid_at": link.used_at.isoformat() if getattr(link, "used_at", None) else None,
            "receipt_email": (agreement.homeowner.email if agreement.homeowner else None),
            "receipt_url": None,
        }

        if not stripe.api_key or not link.payment_intent_id:
            return Response(payload, status=status.HTTP_200_OK)

        # Retrieve PI to prove amount/status and (sometimes) a receipt link
        try:
            pi = stripe.PaymentIntent.retrieve(link.payment_intent_id)
            payload["status"] = getattr(pi, "status", None)
            payload["paid"] = getattr(pi, "status", "") == "succeeded"

            # Some accounts expose latest_charge which can have a receipt_url
            latest_charge = getattr(pi, "latest_charge", None)
            if latest_charge:
                try:
                    ch = stripe.Charge.retrieve(latest_charge)
                    payload["receipt_url"] = getattr(ch, "receipt_url", None)
                except Exception:
                    pass
        except Exception as exc:
            payload["status"] = f"error: {exc}"

        return Response(payload, status=status.HTTP_200_OK)


class AgreementFundingPreviewView(APIView):
    permission_classes = [IsContractorOrReadOnly]

    def get(self, request, pk: int, *args, **kwargs):
        try:
            agreement = Agreement.objects.select_related("contractor", "contractor__user").get(pk=pk)
        except Agreement.DoesNotExist:
            return Response({"detail": "Agreement not found."}, status=status.HTTP_404_NOT_FOUND)

        contractor = getattr(agreement, "contractor", None)
        if not contractor:
            return Response({"detail": "Agreement is missing contractor metadata."}, status=status.HTTP_400_BAD_REQUEST)

        # ✅ Use the most recent anchor date (prevents old pre-created contractor rows from killing intro)
        pricing_start = _pricing_start_date_for_contractor(contractor)

        sync = _sync_funding_flags(agreement, heal_total=True, persist=True)
        total_required = sync["total_required"]
        monthly_volume = get_contractor_monthly_volume(contractor)

        try:
            summary = compute_fee_summary(
                project_amount=total_required,
                contractor_created_at=pricing_start,
                monthly_volume=monthly_volume,
                fee_payer="contractor",
                is_high_risk=getattr(agreement, "is_high_risk", False),
                today=timezone.now().date(),
            )
        except Exception as e:
            logger.exception("compute_fee_summary failed for Agreement %s: %s", pk, e)
            summary = None

        if summary is None:
            return Response(
                {
                    "total_required": f"{sync['total_required']:.2f}",
                    "escrow_funded_amount": f"{sync['funded']:.2f}",
                    "remaining_to_fund": f"{sync['remaining']:.2f}",
                    "escrow_funded": bool(sync["escrow_funded"]),
                    "project_amount": f"{sync['total_required']:.2f}",
                    "platform_fee": f"{Decimal('0.00'):.2f}",
                    "contractor_payout": f"{sync['total_required']:.2f}",
                    "homeowner_escrow": f"{sync['total_required']:.2f}",
                    "fee_payer": "contractor",
                    "rate": "0.0",
                    "is_intro": False,
                    "tier_name": "unknown",
                    "tier_label": "Fee summary unavailable",
                    "high_risk_applied": False,
                    "intro_days": INTRO_DAYS,
                },
                status=status.HTTP_200_OK,
            )

        return Response(
            {
                "total_required": f"{sync['total_required']:.2f}",
                "escrow_funded_amount": f"{sync['funded']:.2f}",
                "remaining_to_fund": f"{sync['remaining']:.2f}",
                "escrow_funded": bool(sync["escrow_funded"]),

                "project_amount": f"{summary.project_amount:.2f}",
                "platform_fee": f"{summary.platform_fee:.2f}",
                "contractor_payout": f"{summary.contractor_payout:.2f}",
                "homeowner_escrow": f"{summary.homeowner_escrow:.2f}",
                "fee_payer": "contractor",
                "rate": str(summary.rate_info.rate),
                "is_intro": summary.rate_info.is_intro,
                "tier_name": summary.rate_info.tier_name,
                "tier_label": getattr(summary.rate_info, "label", ""),
                "high_risk_applied": summary.rate_info.high_risk_applied,
                "intro_days": INTRO_DAYS,
            },
            status=status.HTTP_200_OK,
        )
