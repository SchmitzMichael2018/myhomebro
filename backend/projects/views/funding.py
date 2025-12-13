# backend/projects/views/funding.py
# v2025-12-12-fixed+public+preview — Escrow funding + public fund + fee preview + amendment top-ups

from __future__ import annotations

from decimal import Decimal
import logging

from django.conf import settings
from django.core.mail import send_mail
from django.db.models import Sum
from django.utils import timezone

from rest_framework import permissions, status
from rest_framework.response import Response
from rest_framework.views import APIView

import stripe

from projects.models import Agreement, AgreementFundingLink, Milestone
from payments.fees import compute_fee_summary

logger = logging.getLogger(__name__)

stripe.api_key = getattr(settings, "STRIPE_SECRET_KEY", None)


# ─────────────────────────────────────────────────────────────
# Helpers
# ─────────────────────────────────────────────────────────────

def get_contractor_monthly_volume(contractor) -> Decimal:
    """
    Placeholder helper: return this contractor's processed volume for the current month.
    You can replace later with a real query that sums funded agreements.
    """
    return Decimal("0.00")


def _get_total_required(agreement: Agreement) -> Decimal:
    """Total escrow required for the current agreement version."""
    try:
        if agreement.total_cost and Decimal(str(agreement.total_cost)) > 0:
            return Decimal(str(agreement.total_cost))
    except Exception:
        pass

    milestone_sum = (
        Milestone.objects.filter(agreement=agreement).aggregate(total=Sum("amount"))["total"]
        or Decimal("0.00")
    )
    return Decimal(str(milestone_sum))


def _get_remaining_to_fund(agreement: Agreement) -> Decimal:
    """Remaining escrow for this agreement version (supports amendment top-ups)."""
    funded = getattr(agreement, "escrow_funded_amount", None)
    try:
        funded = Decimal(str(funded)) if funded is not None else Decimal("0.00")
    except Exception:
        funded = Decimal("0.00")

    total = _get_total_required(agreement)
    remaining = total - funded
    return max(remaining, Decimal("0.00"))


# ─────────────────────────────────────────────────────────────
# Core funding logic
# ─────────────────────────────────────────────────────────────

def send_funding_link_for_agreement(
    agreement: Agreement,
    request=None,
    amount=None,
    currency: str | None = None,
) -> dict:
    """
    Create + email a funding link for an Agreement.
    Supports amendments by funding only the remaining amount.
    """

    # IMPORTANT: Agreement.is_fully_signed is a @property on your model
    if not agreement.is_fully_signed:
        raise ValueError("Agreement must be fully signed before funding.")

    currency = (currency or "usd").lower()

    remaining = _get_remaining_to_fund(agreement)
    if remaining <= 0:
        raise ValueError("Escrow is already fully funded for this agreement.")

    if amount is not None:
        try:
            amount = Decimal(str(amount))
        except Exception:
            raise ValueError("Invalid amount provided.")
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
        # fallback if you ever store it directly
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

    # Build public URL (must match frontend route: /public-fund/:token)
    base_url = getattr(settings, "PUBLIC_FRONTEND_BASE_URL", "").rstrip("/")
    if not base_url and request is not None:
        base_url = request.build_absolute_uri("/").rstrip("/")
    public_fund_url = f"{base_url}/public-fund/{link.token}" if base_url else f"/public-fund/{link.token}"

    project_title = agreement.project.title if agreement.project else "Your project"
    homeowner_name = agreement.homeowner.full_name if agreement.homeowner else "Homeowner"

    subject = "Escrow funding request for your project"
    message = "\n".join(
        [
            f"Hello {homeowner_name},",
            "",
            "Your contractor is requesting escrow funding for:",
            f"Project: {project_title}",
            f"Amount due now: ${amount:.2f} {currency.upper()}",
            "",
            "To securely fund escrow, open the link below:",
            public_fund_url,
            "",
            "— MyHomeBro",
        ]
    )

    from_email = getattr(settings, "DEFAULT_FROM_EMAIL", None)
    try:
        if from_email:
            send_mail(subject, message, from_email, [homeowner_email], fail_silently=False)
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
        token = request.query_params.get("token") or ""
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

        data = {
            "token": link.token,
            "amount": f"{link.amount:.2f}",
            "currency": link.currency,
            "project_title": project_title or "Your project",
            "contractor_name": contractor_name or "Your contractor",
            "homeowner_name": homeowner_name or "Homeowner",
            "agreement_id": agreement.id,
            "escrow_funded": bool(getattr(agreement, "escrow_funded", False)),
            "expires_at": link.expires_at.isoformat(),
            "expired": link.is_expired,
        }
        return Response(data, status=status.HTTP_200_OK)


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
            ).get(token=token)
        except AgreementFundingLink.DoesNotExist:
            return Response({"detail": "Funding link not found."}, status=status.HTTP_404_NOT_FOUND)

        if not link.is_valid():
            return Response({"detail": "This funding link is no longer valid."}, status=status.HTTP_400_BAD_REQUEST)

        agreement = link.agreement
        amount_cents = int(Decimal(link.amount) * 100)
        currency = (link.currency or "usd").lower()

        # Reuse existing PaymentIntent if present (only if not succeeded)
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
                    },
                    status=status.HTTP_200_OK,
                )

        project_title = agreement.project.title if agreement.project else "Your project"
        description = f"MyHomeBro escrow funding for project: {project_title}"

        stripe_kwargs = {
            "amount": amount_cents,
            "currency": currency,
            "automatic_payment_methods": {"enabled": True},
            "description": description,
            "metadata": {
                "agreement_id": agreement.id,
                "funding_link_id": link.id,
            },
        }

        contractor = getattr(agreement, "contractor", None)
        acct_id = getattr(contractor, "stripe_account_id", "") if contractor else ""
        if acct_id:
            stripe_kwargs["transfer_group"] = f"agreement-{agreement.id}"

        try:
            pi = stripe.PaymentIntent.create(**stripe_kwargs)
        except Exception as exc:
            logger.exception("Failed to create PaymentIntent for funding link %s: %s", link.id, exc)
            return Response({"detail": "Unable to create payment intent."}, status=status.HTTP_500_INTERNAL_SERVER_ERROR)

        link.payment_intent_id = pi.id
        link.save(update_fields=["payment_intent_id"])

        return Response(
            {
                "client_secret": pi.client_secret,
                "amount": f"{link.amount:.2f}",
                "currency": currency,
                "already_paid": False,
            },
            status=status.HTTP_200_OK,
        )


class AgreementFundingPreviewView(APIView):
    """
    Contractor-side preview of fee + escrow numbers for an Agreement.
    GET /api/projects/agreements/<pk>/funding_preview/
    """

    permission_classes = [IsContractorOrReadOnly]

    def get(self, request, pk: int, *args, **kwargs):
        try:
            agreement = Agreement.objects.select_related("contractor").get(pk=pk)
        except Agreement.DoesNotExist:
            return Response({"detail": "Agreement not found."}, status=status.HTTP_404_NOT_FOUND)

        contractor = getattr(agreement, "contractor", None)
        if not contractor or not getattr(contractor, "created_at", None):
            return Response({"detail": "Agreement is missing contractor metadata."}, status=status.HTTP_400_BAD_REQUEST)

        # project_amount: total_cost -> sum(milestones)
        try:
            agreement_total = agreement.total_cost
            if agreement_total is None or Decimal(str(agreement_total)) <= 0:
                milestone_sum = Milestone.objects.filter(agreement=agreement).aggregate(total=Sum("amount"))["total"]
                agreement_total = milestone_sum or Decimal("0.00")
            project_amount = Decimal(str(agreement_total))
        except Exception as e:
            logger.exception("Error computing project_amount for Agreement %s: %s", pk, e)
            project_amount = Decimal("0.00")

        monthly_volume = get_contractor_monthly_volume(contractor)

        try:
            summary = compute_fee_summary(
                project_amount=project_amount,
                contractor_created_at=contractor.created_at,
                monthly_volume=monthly_volume,
                fee_payer="contractor",
                is_high_risk=getattr(agreement, "is_high_risk", False),
                today=timezone.now().date(),
            )
            data = {
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
            }
        except Exception as e:
            logger.exception("compute_fee_summary failed for Agreement %s: %s", pk, e)
            data = {
                "project_amount": f"{project_amount:.2f}",
                "platform_fee": f"{Decimal('0.00'):.2f}",
                "contractor_payout": f"{project_amount:.2f}",
                "homeowner_escrow": f"{project_amount:.2f}",
                "fee_payer": "contractor",
                "rate": "0.0",
                "is_intro": False,
                "tier_name": "unknown",
                "tier_label": "Fee summary unavailable",
                "high_risk_applied": False,
            }

        return Response(data, status=status.HTTP_200_OK)
