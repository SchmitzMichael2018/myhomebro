from __future__ import annotations

from django.db import transaction
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

from projects.models import Contractor, Skill
from projects.services.contractor_activation_analytics import (
    FUNNEL_EVENT_AI_USED_FOR_PROJECT,
    FUNNEL_EVENT_ESTIMATE_PREVIEW_VIEWED,
    FUNNEL_EVENT_FIRST_PROJECT_STARTED,
    FUNNEL_EVENT_ONBOARDING_STARTED,
    FUNNEL_EVENT_TEMPLATE_SELECTED,
    FUNNEL_EVENT_TRADE_SELECTED,
    track_activation_event,
)
from projects.services.contractor_onboarding import (
    apply_onboarding_patch,
    build_onboarding_snapshot,
    mark_stripe_prompt_dismissed,
)


def _contractor_for_user(user):
    return getattr(user, "contractor_profile", None) or getattr(user, "contractor", None)


class ContractorOnboardingView(APIView):
    permission_classes = [IsAuthenticated]

    def get(self, request, *args, **kwargs):
        contractor = _contractor_for_user(request.user)
        if contractor is None:
            return Response({"detail": "Contractor profile not found."}, status=404)
        snapshot = build_onboarding_snapshot(contractor)
        track_activation_event(
            contractor,
            event_type=FUNNEL_EVENT_ONBOARDING_STARTED,
            step=snapshot.get("step") or "",
            context={"source": "onboarding_page"},
            user=request.user,
            once=True,
        )
        return Response(snapshot, status=200)

    def patch(self, request, *args, **kwargs):
        with transaction.atomic():
            contractor = _contractor_for_user(request.user)
            if contractor is None:
                contractor = Contractor.objects.create(
                    user=request.user,
                    business_name=(request.data.get("business_name") or "My Contractor").strip(),
                )

            apply_onboarding_patch(contractor, request.data or {})

            if "skills" in request.data:
                values = request.data.get("skills") or []
                if isinstance(values, str):
                    values = [item.strip() for item in values.split(",") if item.strip()]
                objs = []
                for name in values:
                    obj, _ = Skill.objects.get_or_create(
                        name=name,
                        defaults={"slug": str(name).lower().replace(" ", "-")},
                    )
                    objs.append(obj)
                contractor.skills.set(objs)
                if objs:
                    track_activation_event(
                        contractor,
                        event_type=FUNNEL_EVENT_TRADE_SELECTED,
                        step="welcome",
                        context={"trade_count": len(objs)},
                        user=request.user,
                    )

            if request.data.get("mark_first_project_started"):
                track_activation_event(
                    contractor,
                    event_type=FUNNEL_EVENT_FIRST_PROJECT_STARTED,
                    step="first_job",
                    context={"source": "onboarding_patch"},
                    user=request.user,
                )

        return Response(build_onboarding_snapshot(contractor), status=200)


class ContractorOnboardingDismissStripePromptView(APIView):
    permission_classes = [IsAuthenticated]

    def post(self, request, *args, **kwargs):
        contractor = _contractor_for_user(request.user)
        if contractor is None:
            return Response({"detail": "Contractor profile not found."}, status=404)
        mark_stripe_prompt_dismissed(contractor)
        return Response(build_onboarding_snapshot(contractor), status=200)


class ContractorOnboardingEventView(APIView):
    permission_classes = [IsAuthenticated]

    def post(self, request, *args, **kwargs):
        contractor = _contractor_for_user(request.user)
        if contractor is None:
            return Response({"detail": "Contractor profile not found."}, status=404)

        event_type = str(request.data.get("event_type") or "").strip()
        step = str(request.data.get("step") or "").strip()
        context = request.data.get("context") if isinstance(request.data.get("context"), dict) else {}

        if not event_type:
            return Response({"detail": "event_type is required."}, status=400)

        track_activation_event(
            contractor,
            event_type=event_type,
            step=step,
            context=context,
            user=request.user,
            once=bool(request.data.get("once")),
        )

        if event_type in {
            FUNNEL_EVENT_AI_USED_FOR_PROJECT,
            FUNNEL_EVENT_TEMPLATE_SELECTED,
            FUNNEL_EVENT_ESTIMATE_PREVIEW_VIEWED,
        } and not contractor.first_project_started_at:
            apply_onboarding_patch(contractor, {"mark_first_project_started": True})

        return Response(build_onboarding_snapshot(contractor), status=200)
