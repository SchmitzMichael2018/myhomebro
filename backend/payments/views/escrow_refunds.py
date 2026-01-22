import stripe

from django.apps import apps
from django.conf import settings
from django.db import transaction
from rest_framework import status
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

from payments.models import Payment, Refund


def _get_model(app_label: str, model_name: str):
    try:
        return apps.get_model(app_label, model_name)
    except Exception:
        return None


def _get_allowed_contractor_ids_for_user(user) -> list[int]:
    """
    Returns contractor IDs this user can act as:
    - projects.Contractor.user == user
    - projects.ContractorSubAccount.user == user -> parent contractor
    """
    Contractor = _get_model("projects", "Contractor")
    ContractorSubAccount = _get_model("projects", "ContractorSubAccount")

    allowed: set[int] = set()

    if Contractor is not None:
        try:
            ids = Contractor.objects.filter(user=user).values_list("id", flat=True)
            allowed.update(int(x) for x in ids)
        except Exception:
            pass

    if ContractorSubAccount is not None:
        try:
            qs = ContractorSubAccount.objects.filter(user=user)
            for sa in qs:
                parent = getattr(sa, "parent_contractor", None) or getattr(sa, "contractor", None)
                if parent is not None:
                    allowed.add(int(getattr(parent, "id")))
        except Exception:
            pass

    return sorted(allowed)


def _is_parent_contractor_owner(user) -> bool:
    """
    Only parent contractor owner (or staff) can refund escrow.
    If Contractor has is_owner field, enforce it; otherwise allow any contractor user.
    """
    if getattr(user, "is_staff", False):
        return True

    Contractor = _get_model("projects", "Contractor")
    if Contractor is None:
        return False

    contractor_ids = _get_allowed_contractor_ids_for_user(user)
    if not contractor_ids:
        return False

    try:
        field_names = {f.name for f in Contractor._meta.fields}
        if "is_owner" in field_names:
            return Contractor.objects.filter(id__in=contractor_ids, is_owner=True).exists()
    except Exception:
        pass

    return True


def _user_owns_agreement(user, agreement) -> bool:
    """
    Agreement belongs to a contractor the user can act as.
    """
    try:
        ag_contractor_id = getattr(agreement, "contractor_id", None)
        if not ag_contractor_id:
            contractor = getattr(agreement, "contractor", None)
            ag_contractor_id = getattr(contractor, "id", None)
        if not ag_contractor_id:
            return False

        allowed_ids = _get_allowed_contractor_ids_for_user(user)
        return int(ag_contractor_id) in set(int(x) for x in allowed_ids)
    except Exception:
        return False


def _get_agreement_or_404(agreement_id: int):
    Agreement = _get_model("projects", "Agreement")
    if Agreement is None:
        return None, Response({"detail": "Agreement model not available."}, status=status.HTTP_500_INTERNAL_SERVER_ERROR)

    try:
        ag = Agreement.objects.get(id=agreement_id)
        return ag, None
    except Exception:
        return None, Response({"detail": "Agreement not found."}, status=status.HTTP_404_NOT_FOUND)


def _ensure_payments_from_used_funding_links(agreement_id: int) -> list[str]:
    """
    Legacy repair:
    Create Payment rows ONLY for USED funding links (used_at != null), because those represent actual payments.

    Returns list of PI ids seen.
    """
    AgreementFundingLink = _get_model("projects", "AgreementFundingLink")
    if AgreementFundingLink is None:
        return []

    links = (
        AgreementFundingLink.objects
        .filter(agreement_id=agreement_id)
        .exclude(payment_intent_id__isnull=True)
        .exclude(payment_intent_id="")
        .exclude(used_at__isnull=True)  # ✅ only used links
        .order_by("-used_at", "-id")
    )

    pis = []
    for link in links:
        pi = getattr(link, "payment_intent_id", None)
        if not pi:
            continue
        pis.append(pi)

        if Payment.objects.filter(stripe_payment_intent_id=pi).exists():
            continue

        # Minimal row. Stripe is truth for refundable amounts.
        Payment.objects.create(
            agreement_id=agreement_id,
            stripe_payment_intent_id=pi,
            amount_cents=0,
            currency="usd",
            status="succeeded",
        )

    return pis


def _stripe_pi_refundable_info(pi_id: str):
    """
    Stripe source of truth for refundable balance.

    Returns:
      refundable_cents, currency, debug_dict

    Handles edge cases where PI.charges.data is empty but Stripe dashboard shows a charge:
    - expand charges
    - fallback to latest_charge -> retrieve Charge directly
    - final fallback to PI.amount_received/amount_refunded
    """
    pi = stripe.PaymentIntent.retrieve(
        pi_id,
        expand=["charges.data", "latest_charge"],
    )

    currency = (pi.get("currency") or "usd").lower()

    # 1) Preferred: expanded charges
    charges = (pi.get("charges") or {}).get("data") or []
    if charges:
        ch = charges[0] or {}
        charge_amount = int(ch.get("amount") or 0)
        refunded = int(ch.get("amount_refunded") or 0)
        refundable = max(charge_amount - refunded, 0)
        return refundable, currency, {
            "mode": "charge",
            "charge_id": ch.get("id"),
            "charge_amount": charge_amount,
            "charge_refunded": refunded,
            "pi_amount_received": int(pi.get("amount_received") or 0),
            "pi_amount_refunded": int(pi.get("amount_refunded") or 0),
            "pi_status": pi.get("status"),
        }

    # 2) Fallback: latest_charge (CRITICAL FIX)
    latest_charge = pi.get("latest_charge")
    if latest_charge:
        ch = stripe.Charge.retrieve(latest_charge)
        charge_amount = int(ch.get("amount") or 0)
        refunded = int(ch.get("amount_refunded") or 0)
        refundable = max(charge_amount - refunded, 0)
        return refundable, currency, {
            "mode": "latest_charge",
            "charge_id": ch.get("id"),
            "charge_amount": charge_amount,
            "charge_refunded": refunded,
            "pi_amount_received": int(pi.get("amount_received") or 0),
            "pi_amount_refunded": int(pi.get("amount_refunded") or 0),
            "pi_status": pi.get("status"),
        }

    # 3) Final fallback: PI-level amounts
    amount_received = int(pi.get("amount_received") or 0)
    amount_refunded = int(pi.get("amount_refunded") or 0)
    refundable = max(amount_received - amount_refunded, 0)

    return refundable, currency, {
        "mode": "pi_fallback",
        "charge_id": None,
        "charge_amount": 0,
        "charge_refunded": 0,
        "pi_amount_received": amount_received,
        "pi_amount_refunded": amount_refunded,
        "pi_status": pi.get("status"),
    }


class AgreementEscrowRefundView(APIView):
    """
    POST /api/payments/agreements/<agreement_id>/refund_escrow/

    Body:
      {
        "amount_cents": 5000,  # REQUIRED: refund amount (selected milestone total)
        "reason": "requested_by_customer" | "duplicate" | "fraudulent" | "" (optional)
        "note": "..."
        "milestone_ids": [..] (optional audit)
      }

    Multi-payment refund:
      - If the agreement was funded via multiple PaymentIntents, this endpoint refunds across them
        until amount_cents is satisfied.
      - Only uses USED funding links to avoid unpaid PIs.
      - Stripe is source of truth for refundable amounts per PI.
    """
    permission_classes = [IsAuthenticated]

    def post(self, request, agreement_id: int):
        if not _is_parent_contractor_owner(request.user):
            return Response(
                {"detail": "Only the parent contractor (owner) can refund escrow."},
                status=status.HTTP_403_FORBIDDEN,
            )

        agreement, err = _get_agreement_or_404(agreement_id)
        if err:
            return err

        if not request.user.is_staff and not _user_owns_agreement(request.user, agreement):
            return Response({"detail": "Not authorized to refund this agreement."}, status=status.HTTP_403_FORBIDDEN)

        # Amount is required and should be "selected milestone total" from UI
        requested_amount_cents = request.data.get("amount_cents", None)
        if requested_amount_cents is None:
            return Response({"detail": "amount_cents is required."}, status=status.HTTP_400_BAD_REQUEST)

        try:
            requested_amount_cents = int(requested_amount_cents)
            if requested_amount_cents <= 0:
                return Response({"detail": "amount_cents must be > 0"}, status=status.HTTP_400_BAD_REQUEST)
        except Exception:
            return Response({"detail": "amount_cents must be an integer."}, status=status.HTTP_400_BAD_REQUEST)

        reason = (request.data.get("reason") or "").strip()
        note = (request.data.get("note") or "").strip()
        milestone_ids = request.data.get("milestone_ids") or []

        stripe.api_key = settings.STRIPE_SECRET_KEY

        # Ensure Payment rows exist for USED funding links (legacy repair)
        with transaction.atomic():
            pis_from_links = _ensure_payments_from_used_funding_links(agreement_id)

        payments = list(
            Payment.objects
            .prefetch_related("refunds")
            .filter(agreement_id=agreement_id)
            .exclude(stripe_payment_intent_id__isnull=True)
            .exclude(stripe_payment_intent_id="")
            .order_by("-created_at", "-id")
        )

        if not payments:
            return Response({"detail": "No payment intents found for this agreement."}, status=status.HTTP_404_NOT_FOUND)

        # Block if any payment shows a payout transfer (your escrow rule)
        for p in payments:
            if getattr(p, "stripe_transfer_id", None):
                return Response(
                    {"detail": "Escrow has already been paid out. Refund requires admin review."},
                    status=status.HTTP_400_BAD_REQUEST,
                )

        # Build refundable buckets using Stripe truth
        buckets = []
        total_refundable = 0
        debug_checked = []

        for p in payments:
            pi = (p.stripe_payment_intent_id or "").strip()
            if not pi:
                continue

            try:
                refundable, currency, dbg = _stripe_pi_refundable_info(pi)
            except Exception as e:
                return Response(
                    {"detail": "Stripe lookup failed for PaymentIntent.", "error": str(e), "payment_intent": pi},
                    status=status.HTTP_400_BAD_REQUEST,
                )

            debug_checked.append({"pi": pi, "refundable": refundable, "currency": currency, **dbg})

            if refundable <= 0:
                continue

            buckets.append({
                "payment": p,
                "pi": pi,
                "currency": currency,
                "remaining": refundable,
            })
            total_refundable += refundable

        if total_refundable <= 0:
            return Response(
                {
                    "detail": "No refundable balance available on Stripe for this agreement.",
                    "checked_payment_intents": debug_checked[:12],
                    "funding_link_pis_seen": pis_from_links[:12],
                },
                status=status.HTTP_400_BAD_REQUEST,
            )

        if requested_amount_cents > total_refundable:
            return Response(
                {"detail": f"Refund exceeds refundable balance. Max refundable: {total_refundable} cents."},
                status=status.HTTP_400_BAD_REQUEST,
            )

        remaining_to_refund = requested_amount_cents
        results = []

        with transaction.atomic():
            for b in buckets:
                if remaining_to_refund <= 0:
                    break

                take = min(int(b["remaining"]), int(remaining_to_refund))
                if take <= 0:
                    continue

                p = b["payment"]
                pi = b["pi"]
                currency = b["currency"]

                refund_row = Refund.objects.create(
                    payment=p,
                    created_by=request.user,
                    amount_cents=int(take),
                    currency=currency,
                    reason=reason,
                    note=note,
                    status="pending",
                )

                # Stable per-chunk idempotency key
                idem_key = f"mHB_refund_ag_{agreement_id}_pay_{p.id}_amt_{int(take)}_db_{refund_row.id}"

                try:
                    refund_params = {
                        "payment_intent": pi,
                        "amount": int(take),
                        "reason": reason if reason else None,
                        "metadata": {
                            "agreement_id": str(agreement_id),
                            "payment_id": str(p.id),
                            "refund_db_id": str(refund_row.id),
                            "milestone_ids": ",".join(str(x) for x in (milestone_ids or []))[:450],
                            "note": (note or "")[:450],
                        },
                    }
                    refund_params = {k: v for k, v in refund_params.items() if v is not None}

                    stripe_refund = stripe.Refund.create(**refund_params, idempotency_key=idem_key)

                    refund_row.stripe_refund_id = getattr(stripe_refund, "id", None)
                    refund_row.status = str(getattr(stripe_refund, "status", "pending") or "pending").lower()

                    update_fields = ["stripe_refund_id", "status"]
                    if hasattr(refund_row, "error_message"):
                        failure_reason = getattr(stripe_refund, "failure_reason", None) or ""
                        if failure_reason:
                            refund_row.error_message = str(failure_reason)
                            update_fields.append("error_message")

                    refund_row.save(update_fields=update_fields)

                    results.append({
                        "payment_id": p.id,
                        "payment_intent": pi,
                        "refunded_cents": int(take),
                        "refund_id": refund_row.id,
                        "stripe_refund_id": refund_row.stripe_refund_id,
                        "refund_status": refund_row.status,
                    })

                    remaining_to_refund -= int(take)

                except Exception as e:
                    refund_row.status = "failed"
                    if hasattr(refund_row, "error_message"):
                        refund_row.error_message = str(e)
                        refund_row.save(update_fields=["status", "error_message"])
                    else:
                        refund_row.save(update_fields=["status"])
                    return Response(
                        {"detail": "Stripe refund failed.", "error": str(e), "partial_results": results},
                        status=status.HTTP_400_BAD_REQUEST,
                    )

        return Response(
            {
                "detail": "Refund requested. Status will sync via Stripe webhooks.",
                "agreement_id": agreement_id,
                "requested_refund_cents": int(requested_amount_cents),
                "refunded_cents": int(requested_amount_cents) - int(remaining_to_refund),
                "remaining_refund_cents": int(remaining_to_refund),
                "breakdown": results,
                "max_refundable_cents": int(total_refundable),
            },
            status=status.HTTP_201_CREATED,
        )
