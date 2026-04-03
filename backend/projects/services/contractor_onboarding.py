from __future__ import annotations

from typing import Any

from django.utils import timezone

from projects.models import Contractor
from projects.services.contractor_activation_analytics import build_activation_summary


ONBOARDING_STEP_WELCOME = "welcome"
ONBOARDING_STEP_REGION = "region"
ONBOARDING_STEP_FIRST_JOB = "first_job"
ONBOARDING_STEP_STRIPE = "stripe"
ONBOARDING_STEP_COMPLETE = "complete"
SERVICE_RADIUS_OPTIONS = {10, 25, 50, 100}


def _coerce_bool(value: Any) -> bool:
    if value is True:
        return True
    if value in (1, "1"):
        return True
    if isinstance(value, str) and value.strip().lower() in {"true", "yes", "on"}:
        return True
    return False


def _coerce_service_radius_miles(value: Any) -> int:
    try:
        miles = int(value)
    except (TypeError, ValueError):
        return 25
    return miles if miles in SERVICE_RADIUS_OPTIONS else 25


def contractor_profile_basics_complete(contractor: Contractor | None) -> bool:
    if contractor is None:
        return False
    has_trade = contractor.skills.exists()
    has_region = bool(str(getattr(contractor, "state", "") or "").strip())
    return bool(has_trade and has_region)


def contractor_first_value_reached(contractor: Contractor | None) -> bool:
    if contractor is None:
        return False
    return bool(getattr(contractor, "first_project_started_at", None) or getattr(contractor, "first_agreement_created_at", None))


def contractor_stripe_ready(contractor: Contractor | None) -> bool:
    if contractor is None:
        return False
    return bool(getattr(contractor, "payouts_enabled", False) and getattr(contractor, "details_submitted", False))


def determine_onboarding_step(contractor: Contractor | None) -> str:
    if contractor is None:
        return ONBOARDING_STEP_WELCOME
    if not contractor.skills.exists():
        return ONBOARDING_STEP_WELCOME
    if not str(getattr(contractor, "state", "") or "").strip():
        return ONBOARDING_STEP_REGION
    if not contractor_first_value_reached(contractor):
        return ONBOARDING_STEP_FIRST_JOB
    if not contractor_stripe_ready(contractor):
        return ONBOARDING_STEP_STRIPE
    return ONBOARDING_STEP_COMPLETE


def determine_onboarding_status(contractor: Contractor | None) -> str:
    step = determine_onboarding_step(contractor)
    if step == ONBOARDING_STEP_COMPLETE:
        return "complete"
    if step in {ONBOARDING_STEP_FIRST_JOB, ONBOARDING_STEP_STRIPE}:
        return "in_progress"
    return "not_started"


def update_onboarding_progress(contractor: Contractor, *, save: bool = True) -> Contractor:
    update_fields: list[str] = []
    status_value = determine_onboarding_status(contractor)
    step_value = determine_onboarding_step(contractor)
    if getattr(contractor, "contractor_onboarding_status", "") != status_value:
        contractor.contractor_onboarding_status = status_value
        update_fields.append("contractor_onboarding_status")
    if getattr(contractor, "contractor_onboarding_step", "") != step_value:
        contractor.contractor_onboarding_step = step_value
        update_fields.append("contractor_onboarding_step")
    if contractor_stripe_ready(contractor) and not getattr(contractor, "stripe_connected_at", None):
        contractor.stripe_connected_at = timezone.now()
        update_fields.append("stripe_connected_at")
    if save and update_fields:
        contractor.save(update_fields=update_fields)
    return contractor


def mark_first_project_started(contractor: Contractor, *, save: bool = True) -> Contractor:
    update_fields: list[str] = []
    now = timezone.now()
    if not getattr(contractor, "first_project_started_at", None):
        contractor.first_project_started_at = now
        update_fields.append("first_project_started_at")
    if not getattr(contractor, "first_agreement_created_at", None):
        contractor.first_agreement_created_at = now
        update_fields.append("first_agreement_created_at")
    update_onboarding_progress(contractor, save=False)
    if getattr(contractor, "contractor_onboarding_status", ""):
        update_fields.append("contractor_onboarding_status")
    if getattr(contractor, "contractor_onboarding_step", ""):
        update_fields.append("contractor_onboarding_step")
    if save and update_fields:
        contractor.save(update_fields=list(dict.fromkeys(update_fields)))
    return contractor


def mark_stripe_prompt_dismissed(contractor: Contractor, *, save: bool = True) -> Contractor:
    contractor.stripe_prompt_dismissed_at = timezone.now()
    update_onboarding_progress(contractor, save=False)
    if save:
        contractor.save(
            update_fields=[
                "stripe_prompt_dismissed_at",
                "contractor_onboarding_status",
                "contractor_onboarding_step",
            ]
        )
    return contractor


def build_onboarding_snapshot(contractor: Contractor | None) -> dict[str, Any]:
    if contractor is None:
        return {
            "status": "not_started",
            "step": ONBOARDING_STEP_WELCOME,
            "profile_basics_complete": False,
            "first_value_reached": False,
            "stripe_ready": False,
            "show_soft_stripe_prompt": False,
            "first_project_started_at": None,
            "first_agreement_created_at": None,
            "stripe_prompt_dismissed_at": None,
            "stripe_connected_at": None,
            "step_number": 1,
            "step_total": 4,
            "activation": build_activation_summary(contractor),
        }

    update_onboarding_progress(contractor)
    stripe_ready = contractor_stripe_ready(contractor)
    first_value_reached = contractor_first_value_reached(contractor)
    step_value = contractor.contractor_onboarding_step or determine_onboarding_step(contractor)
    step_number_map = {
        ONBOARDING_STEP_WELCOME: 1,
        ONBOARDING_STEP_REGION: 2,
        ONBOARDING_STEP_FIRST_JOB: 3,
        ONBOARDING_STEP_STRIPE: 4,
        ONBOARDING_STEP_COMPLETE: 4,
    }
    stripe_prompt_dismissed = bool(contractor.stripe_prompt_dismissed_at)
    return {
        "status": contractor.contractor_onboarding_status or determine_onboarding_status(contractor),
        "step": step_value,
        "profile_basics_complete": contractor_profile_basics_complete(contractor),
        "first_value_reached": first_value_reached,
        "stripe_ready": stripe_ready,
        "show_soft_stripe_prompt": bool(first_value_reached and not stripe_ready and not stripe_prompt_dismissed),
        "first_project_started_at": contractor.first_project_started_at.isoformat() if contractor.first_project_started_at else None,
        "first_agreement_created_at": contractor.first_agreement_created_at.isoformat() if contractor.first_agreement_created_at else None,
        "stripe_prompt_dismissed_at": contractor.stripe_prompt_dismissed_at.isoformat() if contractor.stripe_prompt_dismissed_at else None,
        "stripe_connected_at": contractor.stripe_connected_at.isoformat() if contractor.stripe_connected_at else None,
        "step_number": step_number_map.get(step_value, 1),
        "step_total": 4,
        "service_region_label": ", ".join(
            [part for part in [str(getattr(contractor, "city", "") or "").strip(), str(getattr(contractor, "state", "") or "").strip()] if part]
        ),
        "service_radius_miles": int(getattr(contractor, "service_radius_miles", 25) or 25),
        "trade_count": contractor.skills.count(),
        "activation": build_activation_summary(contractor),
    }


def build_stripe_requirement_payload(
    contractor: Contractor | None,
    *,
    action_key: str,
    action_label: str,
    source: str = "",
    return_path: str = "/app/onboarding",
) -> dict[str, Any]:
    onboarding = build_onboarding_snapshot(contractor)
    account_status = "connected" if onboarding["stripe_ready"] else "incomplete" if getattr(contractor, "stripe_account_id", "") else "not_started"
    return {
        "detail": "Connect Stripe to receive payments.",
        "code": "STRIPE_ONBOARDING_REQUIRED",
        "requirement_type": "stripe_connect",
        "action_attempted": action_key,
        "action_label": action_label,
        "source": source or action_key,
        "message": "You can keep exploring, but this payment action requires Stripe setup.",
        "resume_url": "/app/onboarding",
        "return_path": return_path,
        "stripe_status": {
            "account_status": account_status,
            "charges_enabled": bool(getattr(contractor, "charges_enabled", False)) if contractor else False,
            "payouts_enabled": bool(getattr(contractor, "payouts_enabled", False)) if contractor else False,
            "details_submitted": bool(getattr(contractor, "details_submitted", False)) if contractor else False,
            "requirements_due_count": int(getattr(contractor, "requirements_due_count", 0) or 0) if contractor else 0,
            "connected": onboarding["stripe_ready"],
        },
        "onboarding": onboarding,
        "available_actions": [
            {"key": "connect_stripe", "label": "Connect Stripe", "navigation_target": "/app/onboarding"},
            {"key": "skip_for_now", "label": "Keep exploring", "navigation_target": return_path},
        ],
        "confirmation_required": True,
    }


def apply_onboarding_patch(contractor: Contractor, payload: dict[str, Any]) -> Contractor:
    update_fields: list[str] = []
    scalar_fields = ("business_name", "city", "state", "zip")
    for field in scalar_fields:
        if field in payload:
            next_value = str(payload.get(field) or "").strip()
            if getattr(contractor, field) != next_value:
                setattr(contractor, field, next_value)
                update_fields.append(field)

    if "service_radius_miles" in payload:
        next_radius = _coerce_service_radius_miles(payload.get("service_radius_miles"))
        if getattr(contractor, "service_radius_miles", 25) != next_radius:
            contractor.service_radius_miles = next_radius
            update_fields.append("service_radius_miles")

    if "contractor_onboarding_step" in payload:
        next_step = str(payload.get("contractor_onboarding_step") or "").strip() or determine_onboarding_step(contractor)
        if contractor.contractor_onboarding_step != next_step:
            contractor.contractor_onboarding_step = next_step
            update_fields.append("contractor_onboarding_step")

    if _coerce_bool(payload.get("mark_first_project_started")) and not contractor.first_project_started_at:
        contractor.first_project_started_at = timezone.now()
        update_fields.append("first_project_started_at")

    update_onboarding_progress(contractor, save=False)
    if "contractor_onboarding_status" not in update_fields:
        update_fields.append("contractor_onboarding_status")
    if "contractor_onboarding_step" not in update_fields:
        update_fields.append("contractor_onboarding_step")

    if update_fields:
        contractor.save(update_fields=list(dict.fromkeys(update_fields)))
    return contractor
