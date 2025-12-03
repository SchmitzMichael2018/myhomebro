# backend/projects/views/funding.py
# v2025-12-02 — Funding helpers + views
#
# 1) send_funding_link_for_agreement(agreement, request=None, amount=None, currency="usd")
#    - reusable helper (email-only for now)
#
# 2) SendFundingLinkView            — contractor button
# 3) PublicFundingInfoView          — PublicFund summary page
# 4) CreateFundingPaymentIntentView — PublicFund Stripe PaymentIntent

import logging
from decimal import Decimal

from django.conf import settings
from django.core.mail import send_mail

from rest_framework import permissions, status
from rest_framework.response import Response
from rest_framework.views import APIView

from ..models import Agreement, AgreementFundingLink

import stripe

logger = logging.getLogger(__name__)

# Use your Stripe TEST secret key in settings.STRIPE_SECRET_KEY
stripe.api_key = getattr(settings, "STRIPE_SECRET_KEY", None)


def send_funding_link_for_agreement(
    agreement: Agreement,
    request=None,
    amount=None,
    currency: str | None = None,
) -> dict:
    """
    Core helper to create + email a funding link for an Agreement.

    Returns a dict:
    {
      "agreement_id": ...,
      "amount": "1200.00",
      "currency": "usd",
      "public_fund_url": "https://.../public-fund/<token>",
      "expires_at": "...iso..."
    }

    Raises ValueError if the agreement is not eligible.
    Any email errors are logged but do NOT raise.
    """

    # Basic eligibility checks
    if not getattr(agreement, "is_fully_signed", False):
        raise ValueError("Agreement must be fully signed before funding.")

    if getattr(agreement, "escrow_funded", False):
        raise ValueError("Escrow is already funded for this agreement.")

    homeowner_email = ""
    if getattr(agreement, "homeowner", None):
        homeowner_email = getattr(agreement.homeowner, "email", "") or ""
    if not homeowner_email:
        homeowner_email = getattr(agreement, "homeowner_email", "") or ""

    if not homeowner_email:
        raise ValueError("Agreement is missing a homeowner email address.")

    # Determine amount & currency
    currency = (currency or "usd").lower()

    if amount is not None:
        try:
            amount = Decimal(str(amount))
        except Exception:
            raise ValueError("Invalid amount provided.")
    else:
        agreement_total = getattr(agreement, "total_cost", None)
        if agreement_total is None:
            agreement_total = getattr(agreement, "display_milestone_total", None)
        if agreement_total is None:
            raise ValueError(
                "Agreement has no total amount. Provide 'amount' in the request body."
            )
        amount = Decimal(agreement_total)

    if amount <= 0:
        raise ValueError("Funding amount must be greater than zero.")

    # Deactivate prior active funding links
    AgreementFundingLink.objects.filter(
        agreement=agreement, is_active=True, used_at__isnull=True
    ).update(is_active=False)

    link = AgreementFundingLink.create_for_agreement(
        agreement=agreement,
        amount=amount,
        currency=currency,
    )

    # Build public URL
    base_url = getattr(settings, "PUBLIC_FRONTEND_BASE_URL", "").rstrip("/")
    if not base_url and request is not None:
        base_url = request.build_absolute_uri("/").rstrip("/")

    if not base_url:
        public_fund_url = f"/public-fund/{link.token}"
    else:
        public_fund_url = f"{base_url}/public-fund/{link.token}"

    # Email contents
    project_title = ""
    if getattr(agreement, "project", None):
        project_title = getattr(agreement.project, "title", "") or ""
    project_title = (
        project_title
        or getattr(agreement, "project_title", "")
        or getattr(agreement, "description", "")
        or "Your project"
    )

    homeowner_name = ""
    if getattr(agreement, "homeowner", None):
        homeowner_name = agreement.homeowner.full_name or ""
    homeowner_name = homeowner_name or getattr(
        agreement, "homeowner_name", "homeowner"
    )

    subject = "Escrow funding request for your project"
    message_lines = [
        f"Hello {homeowner_name},",
        "",
        "Your contractor is requesting that you fund escrow for:",
        f"Project: {project_title}",
        f"Amount: ${amount:.2f} {currency.upper()}",
        "",
        "To securely fund this project, please open the link below:",
        public_fund_url,
        "",
        "If you were not expecting this email, you can ignore it.",
        "",
        "— MyHomeBro",
    ]
    message = "\n".join(message_lines)

    from_email = getattr(settings, "DEFAULT_FROM_EMAIL", None)

    # Email is best-effort: log failures, don't raise.
    try:
        if from_email:
            send_mail(
                subject,
                message,
                from_email,
                [homeowner_email],
                fail_silently=False,
            )
    except Exception:
        logger.exception(
            "Failed to send escrow funding email for Agreement %s", agreement.id
        )

    return {
        "agreement_id": agreement.id,
        "amount": f"{amount:.2f}",
        "currency": currency,
        "public_fund_url": public_fund_url,
        "expires_at": link.expires_at.isoformat(),
    }


class IsContractorOrReadOnly(permissions.BasePermission):
    """For now just checks IsAuthenticated; tighten later if needed."""

    def has_permission(self, request, view):
        return request.user and request.user.is_authenticated


class SendFundingLinkView(APIView):
    """
    Contractor-side endpoint to send a funding link.

    URL: POST /api/projects/agreements/<pk>/send_funding_link/
    """

    permission_classes = [IsContractorOrReadOnly]

    def post(self, request, pk: int, *args, **kwargs):
        try:
            agreement = Agreement.objects.get(pk=pk)
        except Agreement.DoesNotExist:
            return Response(
                {"detail": "Agreement not found."},
                status=status.HTTP_404_NOT_FOUND,
            )

        body_amount = request.data.get("amount")
        body_currency = request.data.get("currency") or "usd"

        try:
            payload = send_funding_link_for_agreement(
                agreement,
                request=request,
                amount=body_amount,
                currency=body_currency,
            )
        except ValueError as exc:
            return Response(
                {"detail": str(exc)},
                status=status.HTTP_400_BAD_REQUEST,
            )

        return Response(payload, status=status.HTTP_201_CREATED)


class PublicFundingInfoView(APIView):
    """
    Public info endpoint for a funding token.

    GET /api/projects/funding/public_fund/?token=...
    """

    permission_classes = []  # no auth; token-based

    def get(self, request, *args, **kwargs):
        token = request.query_params.get("token") or ""
        if not token:
            return Response(
                {"detail": "Missing funding token."},
                status=status.HTTP_400_BAD_REQUEST,
            )

        try:
            link = (
                AgreementFundingLink.objects.select_related(
                    "agreement",
                    "agreement__project",
                    "agreement__contractor",
                    "agreement__homeowner",
                )
                .all()
                .get(token=token)
            )
        except AgreementFundingLink.DoesNotExist:
            return Response(
                {"detail": "Funding link not found."},
                status=status.HTTP_404_NOT_FOUND,
            )

        if not link.is_valid():
            return Response(
                {"detail": "This funding link is no longer valid."},
                status=status.HTTP_400_BAD_REQUEST,
            )

        agreement = link.agreement
        contractor_name = ""
        if getattr(agreement, "contractor", None):
            contractor_name = (
                agreement.contractor.business_name
                or agreement.contractor.name
                or getattr(agreement.contractor, "email", "")
            )

        homeowner_name = ""
        if getattr(agreement, "homeowner", None):
            homeowner_name = agreement.homeowner.full_name or ""
        homeowner_name = homeowner_name or getattr(
            agreement, "homeowner_name", "Homeowner"
        )

        project_title = ""
        if getattr(agreement, "project", None):
            project_title = agreement.project.title or ""
        project_title = project_title or getattr(
            agreement, "project_title", "Your project"
        )

        data = {
            "token": link.token,
            "amount": f"{link.amount:.2f}",
            "currency": link.currency,
            "project_title": project_title,
            "contractor_name": contractor_name or "Your contractor",
            "homeowner_name": homeowner_name,
            "agreement_id": agreement.id,
            "escrow_funded": bool(getattr(agreement, "escrow_funded", False)),
            "expires_at": link.expires_at.isoformat(),
            "expired": link.is_expired,
        }
        return Response(data, status=status.HTTP_200_OK)


class CreateFundingPaymentIntentView(APIView):
    """
    Create or reuse a Stripe PaymentIntent for a funding token.

    POST /api/projects/funding/create_payment_intent/
      { "token": "<funding_token>" }

    Returns:
      {
        "client_secret": "...",
        "amount": "1200.00",
        "currency": "usd",
        "already_paid": false
      }
    """

    permission_classes = []  # token-based; no auth needed

    def post(self, request, *args, **kwargs):
        if stripe.api_key is None:
            return Response(
                {"detail": "Stripe API key not configured."},
                status=status.HTTP_503_SERVICE_UNAVAILABLE,
            )

        token = (request.data.get("token") or "").strip()
        if not token:
            return Response(
                {"detail": "Missing funding token."},
                status=status.HTTP_400_BAD_REQUEST,
            )

        try:
            link = (
                AgreementFundingLink.objects.select_related(
                    "agreement",
                    "agreement__project",
                    "agreement__contractor",
                )
                .all()
                .get(token=token)
            )
        except AgreementFundingLink.DoesNotExist:
            return Response(
                {"detail": "Funding link not found."},
                status=status.HTTP_404_NOT_FOUND,
            )

        if not link.is_valid():
            return Response(
                {"detail": "This funding link is no longer valid."},
                status=status.HTTP_400_BAD_REQUEST,
            )

        agreement = link.agreement
        amount_cents = int(Decimal(link.amount) * 100)
        currency = (link.currency or "usd").lower()

        # If we already have a PaymentIntent, reuse it.
        if link.payment_intent_id:
            try:
                pi = stripe.PaymentIntent.retrieve(link.payment_intent_id)
            except Exception:
                pi = None

            if pi is not None:
                if pi.status in ("succeeded", "processing", "requires_capture"):
                    return Response(
                        {
                            "already_paid": True,
                            "status": pi.status,
                        },
                        status=status.HTTP_200_OK,
                    )
                # Otherwise reuse its client_secret
                return Response(
                    {
                        "client_secret": pi.client_secret,
                        "amount": f"{link.amount:.2f}",
                        "currency": currency,
                        "already_paid": False,
                    },
                    status=status.HTTP_200_OK,
                )

        # Create a fresh PaymentIntent
        project_title = ""
        if getattr(agreement, "project", None):
            project_title = agreement.project.title or ""
        project_title = project_title or getattr(
            agreement, "project_title", "Your project"
        )

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

        # If you want Connect-style direct-to-contractor charges in the future,
        # you can add application_fee_amount + transfer_data here.
        if acct_id:
            # For now we charge on the platform and can later set up transfers.
            stripe_kwargs["transfer_group"] = f"agreement-{agreement.id}"

        try:
            pi = stripe.PaymentIntent.create(**stripe_kwargs)
        except Exception as exc:
            logger.exception(
                "Failed to create PaymentIntent for funding link %s: %s",
                link.id,
                exc,
            )
            return Response(
                {"detail": "Unable to create payment intent."},
                status=status.HTTP_500_INTERNAL_SERVER_ERROR,
            )

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
