# backend/projects/views/ai_agreement_description.py
# v2026-02-19 — AI Description endpoint consumes 1 credit per agreement (bundle) and regenerate is free

from __future__ import annotations

from rest_framework.views import APIView
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework import status

from projects.views.contractor_me import _contractor_for_user
from projects.ai.agreement_description_writer import generate_or_improve_description
from projects.services.ai_credits import consume_agreement_bundle_credit_if_needed


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

        # 2) Charge “bundle credit” once per agreement (regenerate is free)
        try:
            charge = consume_agreement_bundle_credit_if_needed(
                contractor=contractor,
                agreement_id=agreement_id,
            )
        except ValueError as e:
            return Response({"detail": str(e)}, status=status.HTTP_402_PAYMENT_REQUIRED)

        return Response(
            {
                "agreement_id": agreement_id,
                "description": result.get("description"),
                "model": result.get("_model"),
                "mode": result.get("_mode"),
                "charged": charge["charged"],  # True only the first time for this agreement
                "ai_credits": charge["ai_credits"],
                "rule": "1 credit = 1 agreement (agreement bundle). Regenerate is free.",
            },
            status=status.HTTP_200_OK,
        )
