# backend/projects/api/disputes_ai_views.py
# v2026-01-22 — Dispute AI endpoints with persistence + entitlement + paid unlock (Step B)

from __future__ import annotations

from django.conf import settings
from django.db import transaction
from django.http import JsonResponse
from rest_framework.decorators import api_view, permission_classes
from rest_framework.permissions import IsAuthenticated
from rest_framework.status import (
    HTTP_200_OK,
    HTTP_400_BAD_REQUEST,
    HTTP_402_PAYMENT_REQUIRED,
    HTTP_403_FORBIDDEN,
    HTTP_404_NOT_FOUND,
)

from projects.ai.disputes_recommendation import generate_dispute_recommendation
from projects.models_ai_artifacts import DisputeAIArtifact
from projects.models_ai_entitlements import ContractorAIEntitlement
from projects.models_ai_purchases import DisputeAIPurchase
from projects.services.ai.evidence_context import build_dispute_evidence_context


def _ai_enabled() -> bool:
    return bool(getattr(settings, "AI_ENABLED", False)) and bool(
        getattr(settings, "AI_DISPUTES_ENABLED", False)
    )


def _recommendations_enabled() -> bool:
    return bool(getattr(settings, "AI_DISPUTE_RECOMMENDATIONS_ENABLED", True))


def _get_dispute_model():
    from projects.models import Dispute  # type: ignore
    return Dispute


def _get_contractor_for_user(user):
    return getattr(user, "contractor_profile", None)


def _get_entitlement_for_request(request):
    contractor = _get_contractor_for_user(getattr(request, "user", None))
    if not contractor:
        return None
    ent, _ = ContractorAIEntitlement.objects.get_or_create(contractor_id=contractor.id)
    return ent


def _serialize_artifact(a: DisputeAIArtifact, include_payload: bool = False) -> dict:
    data = {
        "id": a.id,
        "dispute_id": a.dispute_id,
        "artifact_type": a.artifact_type,
        "version": a.version,
        "input_digest": a.input_digest,
        "model": a.model_name,
        "created_at": a.created_at.isoformat(),
        "created_by_user_id": getattr(a.created_by, "id", None) if a.created_by_id else None,
        "paid": bool(a.paid),
        "price_cents": a.price_cents,
        "stripe_payment_intent_id": a.stripe_payment_intent_id,
    }
    if include_payload:
        data["payload"] = a.payload
    return data


@api_view(["GET"])
@permission_classes([IsAuthenticated])
def dispute_ai_artifacts(request, dispute_id: int):
    Dispute = _get_dispute_model()

    try:
        dispute = Dispute.objects.get(id=dispute_id)
    except Dispute.DoesNotExist:
        return JsonResponse({"detail": "Dispute not found."}, status=HTTP_404_NOT_FOUND)

    artifact_type = (request.GET.get("artifact_type") or "").strip().lower()
    latest = (request.GET.get("latest") or "").strip() in ("1", "true", "yes")
    include_payload = (request.GET.get("include_payload") or "").strip() in ("1", "true", "yes")

    qs = DisputeAIArtifact.objects.filter(dispute_id=dispute.id)
    if artifact_type:
        qs = qs.filter(artifact_type=artifact_type)
    qs = qs.order_by("-created_at")

    if latest:
        a = qs.first()
        if not a:
            return JsonResponse({"detail": "No artifacts found.", "items": [], "count": 0}, status=HTTP_200_OK)
        return JsonResponse(
            {"detail": "OK", "count": 1, "items": [_serialize_artifact(a, include_payload=include_payload)]},
            status=HTTP_200_OK,
        )

    try:
        limit = int(request.GET.get("limit") or "20")
    except Exception:
        limit = 20
    limit = max(1, min(limit, 100))

    items = [_serialize_artifact(a, include_payload=False) for a in qs[:limit]]
    return JsonResponse({"detail": "OK", "count": qs.count(), "items": items}, status=HTTP_200_OK)


@api_view(["POST"])
@permission_classes([IsAuthenticated])
def dispute_ai_recommendation(request, dispute_id: int):
    """
    Generation rules:
      1) If stored artifact exists for digest and force=false => return it (no quota, no payment)
      2) Else if paid purchase exists for digest => allow generation (no quota consumed)
      3) Else require entitlement quota:
            - if quota ok => allow generation and consume quota
            - else 402 => frontend can start Stripe checkout
    """
    if not _ai_enabled() or not _recommendations_enabled():
        return JsonResponse({"detail": "AI dispute recommendations are disabled."}, status=HTTP_403_FORBIDDEN)

    Dispute = _get_dispute_model()

    try:
        dispute = Dispute.objects.get(id=dispute_id)
    except Dispute.DoesNotExist:
        return JsonResponse({"detail": "Dispute not found."}, status=HTTP_404_NOT_FOUND)

    try:
        force = bool(request.data.get("force"))
    except Exception:
        force = False

    # Build evidence context + digest
    try:
        evidence_context = build_dispute_evidence_context(dispute)
        if not isinstance(evidence_context, dict):
            raise RuntimeError("Evidence context builder must return a dict.")
        digest = DisputeAIArtifact.compute_digest(evidence_context)
    except Exception as e:
        return JsonResponse({"detail": f"Evidence context error: {e}"}, status=HTTP_400_BAD_REQUEST)

    # Return stored artifact if digest matches and not force
    if not force:
        existing = (
            DisputeAIArtifact.objects.filter(
                dispute_id=dispute.id,
                artifact_type=DisputeAIArtifact.ARTIFACT_RECOMMENDATION,
                input_digest=digest,
            )
            .order_by("-version", "-created_at")
            .first()
        )
        if existing:
            return JsonResponse(
                {
                    "artifact_type": existing.artifact_type,
                    "cached": True,
                    "stored": True,
                    "model": existing.model_name,
                    "payload": existing.payload,
                    "version": existing.version,
                    "created_at": existing.created_at.isoformat(),
                },
                status=HTTP_200_OK,
            )

    contractor = _get_contractor_for_user(request.user)
    if not contractor:
        return JsonResponse(
            {"detail": "AI recommendations are available to contractor accounts only."},
            status=HTTP_403_FORBIDDEN,
        )

    # ✅ Step B: if a PAID purchase exists for this dispute+digest, allow generation without consuming quota
    paid_purchase = DisputeAIPurchase.objects.filter(
        dispute_id=dispute.id,
        contractor_id=contractor.id,
        artifact_type="recommendation",
        input_digest=digest,
        status=DisputeAIPurchase.STATUS_PAID,
    ).order_by("-id").first()

    is_paid_unlock = bool(paid_purchase)

    # Step A entitlement gate (only if not paid unlock)
    ent = _get_entitlement_for_request(request)

    if not is_paid_unlock:
        if not ent or not ent.can_generate_recommendation():
            return JsonResponse(
                {
                    "detail": "AI recommendation quota exceeded.",
                    "code": "ai_quota_exceeded",
                    "tier": getattr(ent, "tier", "free") if ent else "free",
                    "free_recommendations_remaining": int(getattr(ent, "free_recommendations_remaining", 0) or 0) if ent else 0,
                    "monthly_recommendations_included": int(getattr(ent, "monthly_recommendations_included", 0) or 0) if ent else 0,
                    "monthly_recommendations_used": int(getattr(ent, "monthly_recommendations_used", 0) or 0) if ent else 0,
                    "suggested_price_cents": int(getattr(settings, "AI_RECOMMENDATION_PRICE_CENTS", 2900)),
                },
                status=HTTP_402_PAYMENT_REQUIRED,
            )

    # Generate fresh recommendation
    try:
        result = generate_dispute_recommendation(dispute=dispute, evidence_context=evidence_context, force=True)
    except Exception as e:
        return JsonResponse({"detail": f"AI recommendation failed: {e}"}, status=HTTP_400_BAD_REQUEST)

    # Store new version; consume quota only if NOT paid unlock
    try:
        with transaction.atomic():
            last = (
                DisputeAIArtifact.objects.filter(
                    dispute_id=dispute.id,
                    artifact_type=DisputeAIArtifact.ARTIFACT_RECOMMENDATION,
                )
                .order_by("-version")
                .first()
            )
            next_version = (last.version + 1) if last else 1

            stored = DisputeAIArtifact.objects.create(
                dispute_id=dispute.id,
                artifact_type=DisputeAIArtifact.ARTIFACT_RECOMMENDATION,
                version=next_version,
                input_digest=digest,
                model_name=result.model or "",
                payload=result.payload or {},
                created_by=request.user if request.user.is_authenticated else None,
                paid=bool(is_paid_unlock),
                price_cents=(paid_purchase.price_cents if paid_purchase else None),
                stripe_payment_intent_id=(paid_purchase.stripe_payment_intent_id if paid_purchase else ""),
            )

            if ent and (not is_paid_unlock):
                ent.consume_recommendation_quota()

    except Exception as e:
        return JsonResponse({"detail": f"DB save failed: {e}"}, status=HTTP_400_BAD_REQUEST)

    return JsonResponse(
        {
            "artifact_type": stored.artifact_type,
            "cached": False,
            "stored": True,
            "model": stored.model_name,
            "payload": stored.payload,
            "version": stored.version,
            "created_at": stored.created_at.isoformat(),
            "paid_unlock": bool(is_paid_unlock),
        },
        status=HTTP_200_OK,
    )
