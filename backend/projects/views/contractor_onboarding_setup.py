from __future__ import annotations

from django.utils import timezone
from rest_framework.parsers import JSONParser
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

from projects.models import ContractorOnboardingSetup
from projects.services.contractor_activation_analytics import FUNNEL_EVENT_ONBOARDING_STARTED, track_activation_event
from projects.services.contractor_onboarding_setup import (
    get_contractor_onboarding_setup,
    save_contractor_onboarding_setup,
)
from projects.services.template_apply import get_request_contractor


class ContractorOnboardingSetupView(APIView):
    permission_classes = [IsAuthenticated]
    parser_classes = [JSONParser]

    def get(self, request, *args, **kwargs):
        contractor = get_request_contractor(request.user)
        if contractor is None:
            return Response({"detail": "Contractor profile not found."}, status=404)

        track_activation_event(
            contractor,
            event_type=FUNNEL_EVENT_ONBOARDING_STARTED,
            step="setup",
            context={"source": "intelligent_onboarding"},
            user=request.user,
            once=True,
        )
        snapshot = get_contractor_onboarding_setup(contractor)
        return Response(snapshot)

    def patch(self, request, *args, **kwargs):
        contractor = get_request_contractor(request.user)
        if contractor is None:
            return Response({"detail": "Contractor profile not found."}, status=404)

        payload = request.data if isinstance(request.data, dict) else {}
        existing_setup = ContractorOnboardingSetup.objects.filter(contractor=contractor).first()
        work_description = payload.get("work_description")
        if work_description is None:
            work_description = getattr(existing_setup, "work_description", "") or ""
        clarification_answers = payload.get("clarification_answers")
        if clarification_answers is None:
            clarification_answers = getattr(existing_setup, "clarification_answers", {}) or {}
        result = save_contractor_onboarding_setup(
            contractor,
            work_description=str(work_description or "").strip(),
            clarification_answers=clarification_answers if isinstance(clarification_answers, dict) else {},
            completed=bool(payload.get("completed")),
            quick_adjustment_notes=str(payload.get("quick_adjustment_notes") or "").strip(),
        )
        if result is None:
            return Response({"detail": "Unable to save onboarding setup."}, status=400)

        snapshot = dict(result.snapshot)
        snapshot["last_saved_at"] = timezone.now().isoformat()
        return Response(snapshot)
