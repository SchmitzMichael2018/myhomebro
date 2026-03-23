# backend/projects/views/ai_agreement_description.py
# v2026-03-23 — AI Description endpoint keeps legacy route but treats AI as included

from __future__ import annotations

from rest_framework.views import APIView
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework import status

from projects.views.contractor_me import _contractor_for_user
from projects.ai.agreement_description_writer import generate_or_improve_description
class AIAgreementDescriptionView(APIView):
    permission_classes = [IsAuthenticated]

    def post(self, request, *args, **kwargs):
        contractor = _contractor_for_user(request.user)
        if contractor is None:
            return Response({"detail": "Contractor profile not found."}, status=status.HTTP_404_NOT_FOUND)

        data = request.data or {}

        agreement_id = data.get("agreement_id")
        try:
            agreement_id = int(agreement_id)
        except Exception:
            agreement_id = None

        if not agreement_id:
            return Response({"detail": "agreement_id is required."}, status=status.HTTP_400_BAD_REQUEST)

        mode = (data.get("mode") or "").strip()
        project_title = data.get("project_title") or ""
        project_type = data.get("project_type") or ""
        project_subtype = data.get("project_subtype") or ""
        current_description = data.get("current_description") or ""

        # 1) Generate AI first (if AI fails, we do NOT charge)
        result = generate_or_improve_description(
            mode=mode,
            project_title=project_title,
            project_type=project_type,
            project_subtype=project_subtype,
            current_description=current_description,
        )

        return Response(
            {
                "agreement_id": agreement_id,
                "description": result.get("description"),
                "model": result.get("_model"),
                "mode": result.get("_mode"),
                "ai_access": "included",
                "ai_enabled": True,
                "ai_unlimited": True,
                "rule": "AI is included with your account.",
            },
            status=status.HTTP_200_OK,
        )
