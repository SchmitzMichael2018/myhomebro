from __future__ import annotations

from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

from projects.services.compliance import (
    get_compliance_warning_for_trade,
    normalize_trade_key,
)


def _contractor_for_user(user):
    return getattr(user, "contractor", None) or getattr(user, "contractor_profile", None)


class ContractorCompliancePreviewView(APIView):
    permission_classes = [IsAuthenticated]

    def post(self, request, *args, **kwargs):
        contractor = _contractor_for_user(request.user)
        if contractor is None:
            return Response({"detail": "Contractor profile not found."}, status=404)

        raw_state = request.data.get("state", getattr(contractor, "state", ""))
        state_code = str(raw_state or "").strip().upper()
        raw_skills = request.data.get("skills", [])
        if isinstance(raw_skills, str):
            raw_skills = [part.strip() for part in raw_skills.split(",") if part.strip()]
        elif not isinstance(raw_skills, (list, tuple)):
            raw_skills = []

        trade_requirements = []
        seen = set()
        for skill in raw_skills:
            trade_key = normalize_trade_key(skill)
            if not trade_key or trade_key in seen:
                continue
            seen.add(trade_key)
            trade_requirements.append(
                get_compliance_warning_for_trade(
                    state_code=state_code,
                    trade_key=trade_key,
                    contractor=contractor,
                )
            )

        return Response(
            {
                "state_code": state_code,
                "trade_requirements": trade_requirements,
            }
        )
