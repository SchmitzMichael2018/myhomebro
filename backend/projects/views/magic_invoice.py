# backend/projects/views/magic_invoice.py
# v2025-12-30c — Escrow-aware magic invoice + GET returns escrow flags for public UI
#
# Endpoints:
#   GET    /api/projects/invoices/magic/<token>/
#   PATCH  /api/projects/invoices/magic/<token>/approve/
#   PATCH  /api/projects/invoices/magic/<token>/dispute/
#
# Behavior:
# - GET includes: agreement_id, agreement_status, escrow_funded
# - approve:
#     * if agreement escrow is funded (agreement.status == "funded" or agreement.escrow_funded true):
#         - release escrow via Stripe Transfer (net of platform fee)
#         - returns mode="escrow_release"
#     * else:
#         - fallback card PaymentIntent (legacy)
#         - returns stripe_client_secret + mode="card_payment"

import logging
from decimal import Decimal, ROUND_HALF_UP

from django.conf import settings
from django.db import transaction
from django.shortcuts import get_object_or_404
from django.utils import timezone
from rest_framework import status
from rest_framework.response import Response
from rest_framework.views import APIView

from ..models import Invoice, InvoiceStatus
from ..serializers.invoices import InvoiceSerializer

logger = logging.getLogger(__name__)


def _to_cents(amount) -> int:
    try:
        return int(
            (Decimal(str(amount or "0")) * Decimal("100"))
            .quantize(Decimal("1"), rounding=ROUND_HALF_UP)
        )
    except Exception:
        return 0


def _truthy(v) -> bool:
    if v is True:
        return True
    if v in (1, "1"):
        return True
    if isinstance(v, str) and v.strip().lower() == "true":
        return True
    return False


def _agreement_status(agreement) -> str:
    try:
        return str(getattr(agreement, "status", "") or "").strip().lower()
    except Exception:
        return ""


class MagicInvoiceView(APIView):
    permission_classes = []  # AllowAny

    def get(self, request, token=None):
        invoice = get_object_or_404(Invoice, public_token=token)

        data = InvoiceSerializer(invoice, context={"request": request}).data

        agreement = getattr(invoice, "agreement", None)
        if agreement:
            ag_status = _agreement_status(agreement)
            escrow_funded = _truthy(getattr(agreement, "escrow_funded", False)) or ag_status == "funded"

            # ✅ these are REQUIRED so the public UI can hide card payment fields
            data["agreement_id"] = getattr(agreement, "id", None)
            data["agreement_status"] = ag_status
            data["escrow_funded"] = escrow_funded

        return Response(data)


class MagicInvoiceApproveView(APIView):
    permission_classes = []  # AllowAny

    def patch(self, request, token=None):
        invoice = get_object_or_404(Invoice, public_token=token)

        status_lower = str(invoice.status or "").lower()
        if "dispute" in status_lower:
            return Response({"detail": "This invoice is disputed."}, status=400)

        if getattr(invoice, "escrow_released", False):
            return Response({"detail": "Escrow already released."}, status=400)

        if "paid" in status_lower or "released" in status_lower:
            return Response({"detail": "This invoice has already been paid/released."}, status=400)

        if invoice.status not in (InvoiceStatus.PENDING, InvoiceStatus.APPROVED):
            return Response({"detail": "This invoice cannot be approved in its current status."}, status=400)

        agreement = getattr(invoice, "agreement", None)
        if not agreement:
            return Response({"detail": "Invoice is missing agreement."}, status=400)

        contractor = getattr(agreement, "contractor", None)
        if not contractor:
            return Response({"detail": "Agreement is missing contractor."}, status=400)

        destination_acct = getattr(contractor, "stripe_account_id", None)
        if not destination_acct or not str(destination_acct).startswith("acct_"):
            return Response({"detail": "Contractor is not connected to Stripe."}, status=400)

        stripe_secret = getattr(settings, "STRIPE_SECRET_KEY", None) or ""
        if not stripe_secret:
            return Response({"detail": "Payment system is not configured."}, status=500)

        try:
            import stripe  # type: ignore
            stripe.api_key = stripe_secret
        except Exception as exc:
            logger.exception("Stripe init failed: %s", exc)
            return Response({"detail": "Payment system unavailable."}, status=500)

        amount_cents = _to_cents(getattr(invoice, "amount", None))
        if amount_cents <= 0:
            return Response({"detail": "Invoice amount is invalid."}, status=400)

        # Platform fee (tiered + $1 + cap rules)
        try:
            from payments.fees import calculate_platform_fee_cents_for_invoice  # type: ignore

            platform_fee_cents = int(
                calculate_platform_fee_cents_for_invoice(
                    amount_cents=amount_cents,
                    contractor=contractor,
                    agreement_id=getattr(invoice, "agreement_id", None),
                    is_high_risk=False,
                )
            )
        except Exception:
            logger.exception("Fee engine failed; using platform_fee_cents=0")
            platform_fee_cents = 0

        if platform_fee_cents < 0:
            platform_fee_cents = 0
        if platform_fee_cents >= amount_cents:
            return Response({"detail": "Platform fee is invalid for this invoice amount."}, status=400)

        ag_status = _agreement_status(agreement)
        escrow_funded = _truthy(getattr(agreement, "escrow_funded", False)) or ag_status == "funded"

        # ==========================================================
        # ✅ ESCROW FUNDED → RELEASE FUNDS (NO CARD)
        # ==========================================================
        if escrow_funded:
            if getattr(invoice, "stripe_transfer_id", None):
                # idempotent: make sure flags are set
                with transaction.atomic():
                    if invoice.status == InvoiceStatus.PENDING:
                        invoice.status = InvoiceStatus.APPROVED
                        invoice.approved_at = timezone.now()
                    invoice.escrow_released = True
                    invoice.escrow_released_at = invoice.escrow_released_at or timezone.now()

                    # ✅ NEW: if audit fields exist, ensure they are populated even in idempotent path
                    payout_cents = amount_cents - platform_fee_cents
                    update_fields = ["status", "approved_at", "escrow_released", "escrow_released_at"]

                    if hasattr(invoice, "platform_fee_cents"):
                        try:
                            invoice.platform_fee_cents = int(platform_fee_cents)
                            update_fields.append("platform_fee_cents")
                        except Exception:
                            pass

                    if hasattr(invoice, "payout_cents"):
                        try:
                            invoice.payout_cents = int(payout_cents)
                            update_fields.append("payout_cents")
                        except Exception:
                            pass

                    invoice.save(update_fields=update_fields)

                return Response(
                    {
                        "invoice": InvoiceSerializer(invoice, context={"request": request}).data,
                        "mode": "escrow_release",
                        "stripe_transfer_id": invoice.stripe_transfer_id,
                        "detail": "Already released (idempotent).",
                    },
                    status=200,
                )

            payout_cents = amount_cents - platform_fee_cents

            try:
                transfer = stripe.Transfer.create(
                    amount=int(payout_cents),
                    currency="usd",
                    destination=str(destination_acct),
                    metadata={
                        "kind": "milestone_escrow_release",
                        "invoice_id": str(invoice.id),
                        "invoice_number": str(getattr(invoice, "invoice_number", "")),
                        "agreement_id": str(getattr(invoice, "agreement_id", "")),
                        "contractor_id": str(getattr(contractor, "id", "")),
                        "amount_cents": str(amount_cents),
                        "platform_fee_cents": str(platform_fee_cents),
                        "payout_cents": str(payout_cents),
                    },
                )
            except Exception as exc:
                logger.exception("Stripe Transfer failed for invoice %s: %s", invoice.id, exc)
                return Response({"detail": "Unable to release escrow. Please try again."}, status=500)

            with transaction.atomic():
                if invoice.status == InvoiceStatus.PENDING:
                    invoice.status = InvoiceStatus.APPROVED
                    invoice.approved_at = timezone.now()

                invoice.stripe_transfer_id = transfer.id
                invoice.escrow_released = True
                invoice.escrow_released_at = timezone.now()

                # ✅ NEW: persist both fee and payout audit trail if fields exist
                update_fields = [
                    "status",
                    "approved_at",
                    "stripe_transfer_id",
                    "escrow_released",
                    "escrow_released_at",
                ]

                if hasattr(invoice, "platform_fee_cents"):
                    try:
                        invoice.platform_fee_cents = int(platform_fee_cents)
                        update_fields.append("platform_fee_cents")
                    except Exception:
                        pass

                if hasattr(invoice, "payout_cents"):
                    try:
                        invoice.payout_cents = int(payout_cents)
                        update_fields.append("payout_cents")
                    except Exception:
                        pass

                invoice.save(update_fields=update_fields)

            return Response(
                {
                    "invoice": InvoiceSerializer(invoice, context={"request": request}).data,
                    "mode": "escrow_release",
                    "stripe_transfer_id": transfer.id,
                    "amount_cents": amount_cents,
                    "platform_fee_cents": platform_fee_cents,
                    "payout_cents": payout_cents,
                },
                status=200,
            )

        # ==========================================================
        # ❗ NOT FUNDED → CARD PAYMENT (legacy)
        # ==========================================================
        try:
            with transaction.atomic():
                if invoice.status == InvoiceStatus.PENDING:
                    invoice.status = InvoiceStatus.APPROVED
                    invoice.approved_at = timezone.now()
                    invoice.save(update_fields=["status", "approved_at"])

                intent = stripe.PaymentIntent.create(
                    amount=amount_cents,
                    currency="usd",
                    payment_method_types=["card"],
                    application_fee_amount=platform_fee_cents,
                    transfer_data={"destination": str(destination_acct)},
                    metadata={
                        "kind": "milestone_card_payment",
                        "invoice_id": str(invoice.id),
                        "invoice_number": str(getattr(invoice, "invoice_number", "")),
                        "agreement_id": str(getattr(invoice, "agreement_id", "")),
                        "platform_fee_cents": str(platform_fee_cents),
                    },
                )

                if hasattr(invoice, "stripe_payment_intent_id"):
                    invoice.stripe_payment_intent_id = intent.id
                    invoice.save(update_fields=["stripe_payment_intent_id"])

        except Exception as exc:
            logger.exception("Failed to create PaymentIntent for invoice %s: %s", invoice.id, exc)
            return Response({"detail": "Unable to start payment. Please try again."}, status=500)

        return Response(
            {
                "invoice": InvoiceSerializer(invoice, context={"request": request}).data,
                "mode": "card_payment",
                "stripe_payment_intent_id": intent.id,
                "stripe_client_secret": intent.client_secret,
            },
            status=200,
        )


class MagicInvoiceDisputeView(APIView):
    permission_classes = []  # AllowAny

    def patch(self, request, token=None):
        invoice = get_object_or_404(Invoice, public_token=token)

        if invoice.status != InvoiceStatus.PENDING:
            return Response(
                {"detail": f"Only invoices with status '{InvoiceStatus.PENDING.label}' can be disputed."},
                status=status.HTTP_400_BAD_REQUEST,
            )

        dispute_reason = request.data.get("reason", "No reason provided.")
        description = request.data.get("description", "")
        full_reason = dispute_reason if not description else f"{dispute_reason}\n\n{description}"

        with transaction.atomic():
            invoice.status = InvoiceStatus.DISPUTED
            invoice.disputed = True
            invoice.disputed_at = timezone.now()
            invoice.dispute_by = "homeowner"
            invoice.dispute_reason = full_reason
            invoice.save(update_fields=["status", "disputed", "disputed_at", "dispute_by", "dispute_reason"])

        return Response(InvoiceSerializer(invoice, context={"request": request}).data)
