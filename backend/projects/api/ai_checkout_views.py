# backend/projects/api/ai_checkout_views.py
# v2026-01-22 — Stripe Checkout for AI (Step B, no webhook required)

from __future__ import annotations

from django.conf import settings
from django.http import JsonResponse
from rest_framework.decorators import api_view, permission_classes
from rest_framework.permissions import IsAuthenticated
from rest_framework.status import HTTP_200_OK, HTTP_400_BAD_REQUEST, HTTP_403_FORBIDDEN

from projects.models_ai_purchases import DisputeAIPurchase
from projects.models_ai_artifacts import DisputeAIArtifact
from projects.services.ai.evidence_context import build_dispute_evidence_context


def _get_dispute_model():
    from projects.models import Dispute  # type: ignore
    return Dispute


def _get_contractor_for_user(user):
    return getattr(user, "contractor_profile", None)


def _stripe():
    try:
        import stripe  # type: ignore
    except Exception as e:
        raise RuntimeError("stripe package not installed. Run: pip install stripe") from e

    key = getattr(settings, "STRIPE_SECRET_KEY", None)
    if not key:
        raise RuntimeError("STRIPE_SECRET_KEY not set in settings/env.")
    stripe.api_key = key
    return stripe


def _site_base_url() -> str:
    """
    Used to build success/cancel URLs for Stripe Checkout.
    Set SITE_BASE_URL in settings for correctness behind proxies.
    """
    return getattr(settings, "SITE_BASE_URL", "https://www.myhomebro.com").rstrip("/")


def _ai_price_cents() -> int:
    # You can override later
    return int(getattr(settings, "AI_RECOMMENDATION_PRICE_CENTS", 2900))


@api_view(["POST"])
@permission_classes([IsAuthenticated])
def create_ai_recommendation_checkout(request):
    """
    Creates a Stripe Checkout session for AI recommendation generation.

    Request JSON:
      { "dispute_id": 123 }

    Response:
      { "checkout_url": "https://checkout.stripe.com/...", "session_id": "...", "price_cents": 2900 }
    """
    contractor = _get_contractor_for_user(request.user)
    if not contractor:
        return JsonResponse(
            {"detail": "AI checkout is available to contractor accounts only."},
            status=HTTP_403_FORBIDDEN,
        )

    dispute_id = None
    try:
        dispute_id = int(request.data.get("dispute_id"))
    except Exception:
        dispute_id = None

    if not dispute_id:
        return JsonResponse({"detail": "dispute_id is required."}, status=HTTP_400_BAD_REQUEST)

    Dispute = _get_dispute_model()
    try:
        dispute = Dispute.objects.get(id=dispute_id)
    except Dispute.DoesNotExist:
        return JsonResponse({"detail": "Dispute not found."}, status=HTTP_400_BAD_REQUEST)

    # Build digest (so payment unlocks THIS evidence state)
    try:
        evidence_context = build_dispute_evidence_context(dispute)
        if not isinstance(evidence_context, dict):
            raise RuntimeError("Evidence context builder must return a dict.")
        digest = DisputeAIArtifact.compute_digest(evidence_context)
    except Exception as e:
        return JsonResponse({"detail": f"Evidence context error: {e}"}, status=HTTP_400_BAD_REQUEST)

    # If already paid purchase exists for this digest, return success (no need to pay again)
    existing_paid = DisputeAIPurchase.objects.filter(
        dispute_id=dispute.id,
        contractor_id=contractor.id,
        artifact_type="recommendation",
        input_digest=digest,
        status=DisputeAIPurchase.STATUS_PAID,
    ).order_by("-id").first()

    if existing_paid:
        return JsonResponse(
            {
                "detail": "Already paid for this recommendation.",
                "already_paid": True,
                "price_cents": existing_paid.price_cents,
                "currency": existing_paid.currency,
            },
            status=HTTP_200_OK,
        )

    stripe = _stripe()
    price_cents = _ai_price_cents()
    site = _site_base_url()

    # Stripe Checkout success will send them back to the dispute page with session_id
    # Your frontend panel can detect session_id and call /ai/checkout/status
    success_url = f"{site}/app/disputes/{dispute.id}?ai_checkout=success&session_id={{CHECKOUT_SESSION_ID}}"
    cancel_url = f"{site}/app/disputes/{dispute.id}?ai_checkout=cancel"

    # Create a pending purchase row first
    purchase = DisputeAIPurchase.objects.create(
        artifact_type="recommendation",
        dispute_id=dispute.id,
        contractor_id=contractor.id,
        input_digest=digest,
        price_cents=price_cents,
        currency="usd",
        status=DisputeAIPurchase.STATUS_PENDING,
        created_by=request.user,
    )

    # Create Stripe Checkout Session
    session = stripe.checkout.Session.create(
        mode="payment",
        success_url=success_url,
        cancel_url=cancel_url,
        payment_method_types=["card"],
        line_items=[
            {
                "price_data": {
                    "currency": "usd",
                    "unit_amount": price_cents,
                    "product_data": {
                        "name": "AI Dispute Resolution Recommendation",
                        "description": f"Dispute #{dispute.id} — evidence-based options + draft resolution",
                    },
                },
                "quantity": 1,
            }
        ],
        metadata={
            "mhb_type": "ai_recommendation",
            "purchase_id": str(purchase.id),
            "dispute_id": str(dispute.id),
            "contractor_id": str(contractor.id),
            "input_digest": digest,
        },
    )

    purchase.stripe_session_id = session.id
    purchase.save(update_fields=["stripe_session_id", "updated_at"])

    return JsonResponse(
        {
            "detail": "OK",
            "checkout_url": session.url,
            "session_id": session.id,
            "price_cents": price_cents,
            "currency": "usd",
            "purchase_id": purchase.id,
        },
        status=HTTP_200_OK,
    )


@api_view(["GET"])
@permission_classes([IsAuthenticated])
def ai_checkout_status(request):
    """
    Verifies Stripe Checkout session status and marks purchase paid if paid.
    No webhook required for Step B.

    Query:
      ?session_id=cs_test_...

    Response:
      { "paid": true/false, "status": "...", "purchase_id": ..., "payment_intent_id": "pi_..." }
    """
    contractor = _get_contractor_for_user(request.user)
    if not contractor:
        return JsonResponse(
            {"detail": "AI checkout status is available to contractor accounts only."},
            status=HTTP_403_FORBIDDEN,
        )

    session_id = (request.GET.get("session_id") or "").strip()
    if not session_id:
        return JsonResponse({"detail": "session_id is required."}, status=HTTP_400_BAD_REQUEST)

    purchase = DisputeAIPurchase.objects.filter(
        stripe_session_id=session_id,
        contractor_id=contractor.id,
    ).first()

    if not purchase:
        return JsonResponse({"detail": "Purchase not found for this session."}, status=HTTP_400_BAD_REQUEST)

    stripe = _stripe()
    session = stripe.checkout.Session.retrieve(session_id)

    payment_status = getattr(session, "payment_status", "") or ""
    session_status = getattr(session, "status", "") or ""
    pi = getattr(session, "payment_intent", "") or ""

    # Mark paid if paid
    if payment_status == "paid" and purchase.status != DisputeAIPurchase.STATUS_PAID:
        purchase.status = DisputeAIPurchase.STATUS_PAID
        purchase.stripe_payment_intent_id = str(pi or "")
        purchase.save(update_fields=["status", "stripe_payment_intent_id", "updated_at"])

    return JsonResponse(
        {
            "detail": "OK",
            "paid": purchase.status == DisputeAIPurchase.STATUS_PAID,
            "purchase_status": purchase.status,
            "stripe_session_status": session_status,
            "stripe_payment_status": payment_status,
            "payment_intent_id": purchase.stripe_payment_intent_id,
            "purchase_id": purchase.id,
            "dispute_id": purchase.dispute_id,
            "artifact_type": purchase.artifact_type,
        },
        status=HTTP_200_OK,
    )
