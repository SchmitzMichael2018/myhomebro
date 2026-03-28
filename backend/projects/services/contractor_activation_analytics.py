from __future__ import annotations

from typing import Any

from django.utils import timezone

from projects.models import Contractor, ContractorActivationEvent


FUNNEL_EVENT_ONBOARDING_STARTED = "onboarding_started"
FUNNEL_EVENT_TRADE_SELECTED = "trade_selected"
FUNNEL_EVENT_FIRST_PROJECT_STARTED = "first_project_started"
FUNNEL_EVENT_AI_USED_FOR_PROJECT = "ai_used_for_project"
FUNNEL_EVENT_TEMPLATE_SELECTED = "template_selected"
FUNNEL_EVENT_ESTIMATE_PREVIEW_VIEWED = "estimate_preview_viewed"
FUNNEL_EVENT_AGREEMENT_DRAFT_CREATED = "agreement_draft_created"
FUNNEL_EVENT_AGREEMENT_SENT = "agreement_sent"
FUNNEL_EVENT_STRIPE_PROMPT_SHOWN = "stripe_prompt_shown"
FUNNEL_EVENT_STRIPE_CONNECTED = "stripe_connected"
FUNNEL_EVENT_ONBOARDING_COMPLETED = "onboarding_completed"


def _safe_context(value: Any) -> dict[str, Any]:
    return value if isinstance(value, dict) else {}


def _merge_step_duration(contractor: Contractor, next_step: str, now) -> int | None:
    previous_step = str(getattr(contractor, "onboarding_last_step_reached", "") or "").strip()
    entered_at = getattr(contractor, "onboarding_step_entered_at", None)
    if not previous_step or not entered_at:
        contractor.onboarding_last_step_reached = next_step
        contractor.onboarding_step_entered_at = now
        return None

    if previous_step == next_step:
        return None

    elapsed = max(0, int((now - entered_at).total_seconds()))
    durations = dict(getattr(contractor, "onboarding_step_durations", {}) or {})
    durations[previous_step] = int(durations.get(previous_step, 0) or 0) + elapsed
    contractor.onboarding_step_durations = durations
    contractor.onboarding_last_step_reached = next_step
    contractor.onboarding_step_entered_at = now
    return elapsed


def track_activation_event(
    contractor: Contractor | None,
    *,
    event_type: str,
    step: str = "",
    context: dict[str, Any] | None = None,
    user=None,
    once: bool = False,
) -> ContractorActivationEvent | None:
    if contractor is None or not event_type:
        return None

    event_step = str(step or "").strip()
    payload = _safe_context(context)
    if once:
        existing = ContractorActivationEvent.objects.filter(
            contractor=contractor,
            event_type=event_type,
        )
        if event_step:
            existing = existing.filter(step=event_step)
        if existing.exists():
            return None

    now = timezone.now()
    seconds_in_step = None
    update_fields: list[str] = []

    if event_step:
        elapsed = _merge_step_duration(contractor, event_step, now)
        seconds_in_step = elapsed
        update_fields.extend(
            [
                "onboarding_last_step_reached",
                "onboarding_step_entered_at",
                "onboarding_step_durations",
            ]
        )

    if update_fields:
        contractor.save(update_fields=list(dict.fromkeys(update_fields)))

    return ContractorActivationEvent.objects.create(
        contractor=contractor,
        user=user,
        event_type=event_type,
        step=event_step,
        context=payload,
        seconds_in_step=seconds_in_step,
    )


def build_activation_summary(contractor: Contractor | None) -> dict[str, Any]:
    if contractor is None:
        return {
            "last_step_reached": "",
            "time_spent_per_step": {},
            "event_count": 0,
        }

    return {
        "last_step_reached": contractor.onboarding_last_step_reached or "",
        "time_spent_per_step": dict(getattr(contractor, "onboarding_step_durations", {}) or {}),
        "event_count": contractor.activation_events.count(),
    }
