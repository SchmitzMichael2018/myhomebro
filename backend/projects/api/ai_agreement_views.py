# backend/projects/api/ai_agreement_views.py
# v2026-01-25 — AI endpoints for Agreement Step 1 (description) and Step 2 (milestones)
# FIX: include questions[] in milestone response

from __future__ import annotations

from django.conf import settings
from django.http import JsonResponse
from rest_framework.decorators import api_view, permission_classes
from rest_framework.permissions import IsAuthenticated
from rest_framework.status import (
    HTTP_200_OK,
    HTTP_400_BAD_REQUEST,
    HTTP_403_FORBIDDEN,
    HTTP_404_NOT_FOUND,
)

from projects.ai.agreement_description_writer import generate_or_improve_description
from projects.ai.agreement_milestone_writer import suggest_scope_and_milestones
from projects.models_ai_entitlements import ContractorAIEntitlement


def _ai_enabled() -> bool:
    return bool(getattr(settings, "AI_ENABLED", False))


def _get_contractor_for_user(user):
    return getattr(user, "contractor_profile", None)


def _require_entitlement(contractor):
    ent, _ = ContractorAIEntitlement.objects.get_or_create(contractor_id=contractor.id)
    if not getattr(ent, "allow_scope_assistant", False):
        return None, JsonResponse(
            {"detail": "AI scope assistant not enabled for your plan."},
            status=HTTP_403_FORBIDDEN,
        )
    return ent, None


@api_view(["POST"])
@permission_classes([IsAuthenticated])
def ai_agreement_description(request):
    if not _ai_enabled():
        return JsonResponse({"detail": "AI is disabled."}, status=HTTP_403_FORBIDDEN)

    contractor = _get_contractor_for_user(request.user)
    if not contractor:
        return JsonResponse({"detail": "Contractor only."}, status=HTTP_403_FORBIDDEN)

    _ent, err = _require_entitlement(contractor)
    if err:
        return err

    try:
        out = generate_or_improve_description(
            mode=(request.data.get("mode") or "").strip(),
            project_title=request.data.get("project_title") or "",
            project_type=request.data.get("project_type") or "",
            project_subtype=request.data.get("project_subtype") or "",
            current_description=request.data.get("current_description") or "",
        )
    except Exception as e:
        return JsonResponse({"detail": str(e)}, status=HTTP_400_BAD_REQUEST)

    return JsonResponse(
        {
            "detail": "OK",
            "description": out["description"],
            "_mode": out.get("_mode"),
            "_model": out.get("_model"),
        },
        status=HTTP_200_OK,
    )


@api_view(["POST"])
@permission_classes([IsAuthenticated])
def ai_suggest_milestones(request, agreement_id: int):
    """
    POST /api/projects/agreements/<id>/ai/suggest-milestones/

    Returns:
      {
        "scope_text": "...",
        "milestones": [...],
        "questions": [...]
      }
    """
    if not _ai_enabled():
        return JsonResponse({"detail": "AI is disabled."}, status=HTTP_403_FORBIDDEN)

    contractor = _get_contractor_for_user(request.user)
    if not contractor:
        return JsonResponse({"detail": "Contractor only."}, status=HTTP_403_FORBIDDEN)

    _ent, err = _require_entitlement(contractor)
    if err:
        return err

    from projects.models import Agreement

    try:
        agreement = Agreement.objects.get(id=agreement_id)
    except Agreement.DoesNotExist:
        return JsonResponse({"detail": "Agreement not found."}, status=HTTP_404_NOT_FOUND)

    notes = request.data.get("notes", "") if hasattr(request, "data") else ""

    try:
        out = suggest_scope_and_milestones(agreement=agreement, notes=notes)
    except Exception as e:
        return JsonResponse({"detail": str(e)}, status=HTTP_400_BAD_REQUEST)

    # ✅ IMPORTANT FIX: include questions[]
    return JsonResponse(
        {
            "detail": "OK",
            "scope_text": out["scope_text"],
            "milestones": out["milestones"],
            "questions": out.get("questions", []),
            "_model": out.get("_model"),
        },
        status=HTTP_200_OK,
    )
