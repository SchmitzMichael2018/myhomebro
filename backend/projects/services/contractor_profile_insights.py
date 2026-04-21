from __future__ import annotations

from collections import Counter
from typing import Any

from projects.models_learning import ProjectOutcomeSnapshot
from projects.services.contractor_insights import build_contractor_insights


RELIABLE_STATUSES = {"completed", "payment_released"}
MIN_SAMPLE_SIZE = 5


def _safe_text(value: Any) -> str:
    return "" if value is None else str(value).strip()


def _safe_int(value: Any, default: int = 0) -> int:
    try:
        if value in (None, "", []):
            return default
        return max(int(value), 0)
    except (TypeError, ValueError):
        return default


def _family_key(snapshot: ProjectOutcomeSnapshot | None) -> str:
    return _safe_text(getattr(snapshot, "project_family_key", "")) or "general"


def _family_label(snapshot: ProjectOutcomeSnapshot | None, family_key: str) -> str:
    if snapshot is not None:
        label = _safe_text(getattr(snapshot, "project_family_label", ""))
        if label:
            return label
    return family_key.replace("_", " ").title()


def _latest_snapshot(snapshots: list[ProjectOutcomeSnapshot]) -> ProjectOutcomeSnapshot | None:
    if not snapshots:
        return None
    snapshots = sorted(
        snapshots,
        key=lambda item: getattr(item, "created_at", None) or 0,
        reverse=True,
    )
    return snapshots[0]


def _project_context(snapshot: ProjectOutcomeSnapshot | None, family_label: str) -> dict[str, str]:
    intelligence = snapshot.original_intelligence_payload if isinstance(getattr(snapshot, "original_intelligence_payload", None), dict) else {}
    analysis = intelligence.get("analysis") if isinstance(intelligence.get("analysis"), dict) else {}
    suggested_plan = snapshot.original_suggested_plan if isinstance(getattr(snapshot, "original_suggested_plan", None), dict) else {}
    return {
        "project_family_label": family_label,
        "project_type": _safe_text(analysis.get("project_type") or suggested_plan.get("project_type")),
        "project_subtype": _safe_text(analysis.get("project_subtype") or suggested_plan.get("project_subtype")),
        "project_scope_summary": _safe_text(
            analysis.get("project_scope_summary")
            or analysis.get("description")
            or suggested_plan.get("project_scope_summary")
            or getattr(snapshot, "final_project_state", {}).get("project_scope_summary")
        ),
        "description": _safe_text(
            analysis.get("description")
            or suggested_plan.get("project_scope_summary")
            or getattr(snapshot, "final_project_state", {}).get("project_scope_summary")
        ),
        "scope_mode": _safe_text(getattr(snapshot, "scope_mode", "")),
        "template_used": _safe_text(getattr(snapshot, "template_used", "")),
        "template_name": _safe_text(getattr(snapshot, "template_used", "")),
        "region_state": "",
        "region_city": "",
        "region_country": "US",
    }


def _positive_pricing_insight(direction: str, family_label: str) -> str | None:
    normalized = _safe_text(direction).lower()
    if normalized == "above":
        return f"Often positions pricing toward the premium end for {family_label.lower()} work."
    if normalized == "below":
        return f"Keeps pricing competitive for {family_label.lower()} projects."
    if normalized == "similar":
        return f"Usually keeps pricing aligned with similar {family_label.lower()} projects."
    return None


def _positive_timeline_insight(direction: str, family_label: str) -> str | None:
    normalized = _safe_text(direction).lower()
    if normalized == "above":
        return f"Builds in a more thorough timeline for {family_label.lower()} projects when the scope needs extra coordination."
    if normalized == "below":
        return f"Usually keeps timelines efficient for similar {family_label.lower()} jobs."
    if normalized == "similar":
        return f"Typically keeps timelines steady and predictable for {family_label.lower()} work."
    return None


def _positive_milestone_insight(direction: str, family_label: str) -> str | None:
    normalized = _safe_text(direction).lower()
    if normalized == "above":
        return f"Uses a detailed milestone structure that gives clients clearer progress checkpoints on {family_label.lower()} projects."
    if normalized == "below":
        return f"Keeps milestone plans streamlined for straightforward {family_label.lower()} jobs."
    if normalized == "similar":
        return f"Usually uses a balanced milestone structure for {family_label.lower()} work."
    return None


def _positive_reliability_insight(direction: str, family_label: str, amendment_rate: str) -> str | None:
    normalized = _safe_text(direction).lower()
    rate_value = _safe_text(amendment_rate)
    if normalized in {"below", "similar"}:
        return f"Completed {family_label.lower()} projects show a steady, low-friction closeout pattern."
    if normalized == "above":
        return f"Treats scope details carefully so {family_label.lower()} projects stay organized from start to finish."
    if rate_value:
        return f"Pays close attention to scope details on {family_label.lower()} projects."
    return None


def _positive_specialization_insight(family_label: str, family_count: int) -> str | None:
    if family_count < MIN_SAMPLE_SIZE:
        return None
    return f"Frequently works on {family_label.lower()} projects and related scope."


def get_contractor_profile_insights(contractor_id) -> list[str]:
    if not contractor_id:
        return []

    snapshots = list(
        ProjectOutcomeSnapshot.objects.filter(
            contractor_id=contractor_id,
            completion_status__in=RELIABLE_STATUSES,
        ).order_by("-created_at", "-id")[:200]
    )
    if not snapshots:
        return []

    family_counts = Counter(_family_key(snapshot) for snapshot in snapshots)
    if not family_counts:
        return []

    dominant_family_key, dominant_family_count = family_counts.most_common(1)[0]
    if dominant_family_count < MIN_SAMPLE_SIZE:
        return []

    family_snapshots = [snapshot for snapshot in snapshots if _family_key(snapshot) == dominant_family_key]
    focus_snapshot = _latest_snapshot(family_snapshots)
    family_label = _family_label(focus_snapshot, dominant_family_key)
    context = _project_context(focus_snapshot, family_label)

    insights = build_contractor_insights(
        contractor_id=contractor_id,
        project_family_key=dominant_family_key,
        project_context=context,
    )
    if _safe_text(insights.get("confidence")).lower() == "low":
        return []
    if _safe_int(insights.get("sample_sizes", {}).get("contractor"), 0) < MIN_SAMPLE_SIZE:
        return []

    result: list[str] = []

    specialization = _positive_specialization_insight(family_label, dominant_family_count)
    if specialization:
        result.append(specialization)

    pricing = insights.get("pricing_delta_vs_platform", {}) or {}
    pricing_text = _positive_pricing_insight(pricing.get("direction", ""), family_label)
    if pricing_text:
        result.append(pricing_text)

    duration = insights.get("duration_delta_vs_platform", {}) or {}
    duration_text = _positive_timeline_insight(duration.get("direction", ""), family_label)
    if duration_text:
        result.append(duration_text)

    milestones = insights.get("milestone_count_delta", {}) or {}
    milestone_text = _positive_milestone_insight(milestones.get("direction", ""), family_label)
    if milestone_text:
        result.append(milestone_text)

    reliability = insights.get("dispute_rate_comparison", {}) or {}
    amendment_rate = _safe_text((insights.get("amendment_rate", {}) or {}).get("value"))
    reliability_text = _positive_reliability_insight(
        reliability.get("direction", ""),
        family_label,
        amendment_rate,
    )
    if reliability_text:
        result.append(reliability_text)

    return result[:6]
