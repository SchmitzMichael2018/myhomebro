import stripe

from django.conf import settings
from django.db import transaction
from rest_framework import status
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

from payments.models import Payment, Refund


def _is_parent_contractor_owner(user) -> bool:
    """
    Adjust this to match your role system.
    Safe default:
      - allow staff
      - allow users with attribute role == 'contractor_owner'
      - allow users who have a linked contractor object and are marked as owner
    """
    if getattr(user, "is_staff", False):
        return True

    # If you store a 'role' on the user payload (you mentioned contractor_owner in whoami)
    if getattr(user, "role", None) == "contractor_owner":
        return True

    # If you have a Contractor profile with an owner flag
    contractor = getattr(user, "contractor", None)
    if contractor and getattr(contractor, "is_owner", False):
        return True

    return False


def _user_owns_agreement(user, agreement) -> bool:
    """
    Typical MyHomeBro pattern:
      agreement.contractor.user == request.user

    Update here if your Agreement links differently.
    """
    try:
        contractor = getattr(agreement, "contractor", None)
        if not contractor:
            return False
        return getattr(contractor, "user", None) == user
    except Exception:
        return False


def _calc_unreleased_escrow_cents(payment: Payment) -> int:
    """
    Unreleased escrow = original funded amount - amounts already transferred out - amounts already refunded
    This is what you're allowing the parent contractor to refund.

    Assumptions:
      - payment.amount_cents is the funded amount
      - payment.stripe_transfer_id is set if payout happened (single transfer model)
        OR you can later extend to track multiple transfers in a Transfer table.
      - refunds table tracks refunds already created
    """
    funded = int(payment.amount_cents or 0)

    # If you do partial transfers, replace this with sum of transfers.
    # For now, if transfer_id exists we treat as "already paid out" (not eligible for contractor-issued escrow refund).
    transferred_out = 0
    if payment.stripe_transfer_id:
        transferred_out = funded

    already_refunded = int(sum(r.amount_cents for r in payment.refunds.all() if r.status == "succeeded"))

    unreleased = funded - transferred_out - already_refunded
    return max(unreleased, 0)


class AgreementEscrowRefundView(APIView):
    """
    POST /api/payments/agreements/<agreement_id>/refund_escrow/

    Body (optional):
      {
        "amount_cents": 2500,  # omit => refund all unreleased escrow
        "reason": "requested_by_customer" | "duplicate" | "fraudulent" | "" (optional)
        "note": "Contractor sick, refund remaining escrow"
      }

    Rules:
      - Only parent contractor owner (or staff) can do this.
      - Only if payment succeeded AND funds are not transferred.
      - Refund amount cannot exceed unreleased escrow.
    """
    permission_classes = [IsAuthenticated]

    def post(self, request, agreement_id: int):
        if not _is_parent_contractor_owner(request.user):
            return Response(
                {"detail": "Only the parent contractor (owner) can refund escrow."},
                status=status.HTTP_403_FORBIDDEN,
            )

        # Find the most relevant successful payment for this agreement
        payment = (
            Payment.objects.select_related("agreement")
            .prefetch_related("refunds")
            .filter(agreement_id=agreement_id)
            .order_by("-created_at")
            .first()
        )

        if not payment:
            return Response({"detail": "No payment found for this agreement."}, status=status.HTTP_404_NOT_FOUND)

        agreement = payment.agreement

        # Ownership check (unless staff)
        if not request.user.is_staff and not _user_owns_agreement(request.user, agreement):
            return Response({"detail": "Not authorized to refund this agreement."}, status=status.HTTP_403_FORBIDDEN)

        if payment.status != "succeeded":
            return Response(
                {"detail": f"Payment must be succeeded to refund. Current: {payment.status}"},
                status=status.HTTP_400_BAD_REQUEST,
            )

        # If a payout has occurred, we do NOT allow contractor escrow refund (admin-only later if desired)
        if payment.stripe_transfer_id:
            return Response(
                {"detail": "Escrow has already been paid out. Refund requires admin review."},
                status=status.HTTP_400_BAD_REQUEST,
            )

        if not payment.stripe_payment_intent_id and not payment.stripe_charge_id:
            return Response(
                {"detail": "Missing Stripe payment identifiers for refund (payment_intent_id/charge_id)."},
                status=status.HTTP_400_BAD_REQUEST,
            )

        try:
            requested_amount_cents = request.data.get("amount_cents", None)
            if requested_amount_cents is not None:
                requested_amount_cents = int(requested_amount_cents)
                if requested_amount_cents <= 0:
                    return Response({"detail": "amount_cents must be > 0"}, status=status.HTTP_400_BAD_REQUEST)
        except Exception:
            return Response({"detail": "amount_cents must be an integer."}, status=status.HTTP_400_BAD_REQUEST)

        reason = (request.data.get("reason") or "").strip()
        note = (request.data.get("note") or "").strip()

        unreleased = _calc_unreleased_escrow_cents(payment)
        if unreleased <= 0:
            return Response(
                {"detail": "No unreleased escrow available to refund."},
                status=status.HTTP_400_BAD_REQUEST,
            )

        # Refund all unreleased by default
        refund_amount = requested_amount_cents if requested_amount_cents is not None else unreleased

        if refund_amount > unreleased:
            return Response(
                {"detail": f"Refund exceeds unreleased escrow. Max refundable: {unreleased} cents."},
                status=status.HTTP_400_BAD_REQUEST,
            )

        stripe.api_key = settings.STRIPE_SECRET_KEY

        with transaction.atomic():
            refund_row = Refund.objects.create(
                payment=payment,
                created_by=request.user,
                amount_cents=refund_amount,
                currency=payment.currency,
                reason=reason,
                note=note,
                status="pending",
            )

            try:
                refund_params = {
                    # Stripe only accepts specific strings; empty means "no reason"
                    "reason": reason if reason else None,
                    "amount": int(refund_amount),
                    # If you charge a platform fee and want to refund it too (optional):
                    # "refund_application_fee": True,
                    # No transfer to reverse because we blocked payout cases:
                    # "reverse_transfer": False,
                }
                refund_params = {k: v for k, v in refund_params.items() if v is not None}

                if payment.stripe_payment_intent_id:
                    refund_params["payment_intent"] = payment.stripe_payment_intent_id
                else:
                    refund_params["charge"] = payment.stripe_charge_id

                stripe_refund = stripe.Refund.create(**refund_params)

                refund_row.stripe_refund_id = getattr(stripe_refund, "id", None)
                refund_row.status = "succeeded"
                refund_row.save()

            except Exception as e:
                refund_row.status = "failed"
                refund_row.error_message = str(e)
                refund_row.save()
                return Response(
                    {"detail": "Stripe refund failed.", "error": str(e)},
                    status=status.HTTP_400_BAD_REQUEST,
                )

        return Response(
            {
                "detail": "Escrow refund issued.",
                "agreement_id": agreement_id,
                "payment_id": payment.id,
                "refunded_amount_cents": refund_amount,
                "remaining_unreleased_escrow_cents": max(unreleased - refund_amount, 0),
                "refund_id": refund_row.id,
                "stripe_refund_id": refund_row.stripe_refund_id,
            },
            status=status.HTTP_201_CREATED,
        )
