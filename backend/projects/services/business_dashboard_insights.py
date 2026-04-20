from __future__ import annotations

from collections import Counter
from decimal import Decimal
from typing import Any

from django.utils import timezone

from projects.models_learning import ProjectOutcomeSnapshot
from projects.services.contractor_insights import build_contractor_insights
from projects.services.regions import build_region_context_from_key


RELIABLE_STATUSES = {"completed", "payment_released"}
MIN_FAMILY_SAMPLE_SIZE = 3


def _safe_text(value: Any) -> str:
    return "" if value is None else str(value).strip()


def _safe_int(value: Any, default: int = 0) -> int:
    try:
        if value in (None, "", []):
            return default
        return max(int(value), 0)
    except (TypeError, ValueError):
        return default


def _safe_decimal(value: Any, default: Decimal | None = None) -> Decimal | None:
    if value in (None, "", []):
        return default
    try:
        return Decimal(str(value))
    except Exception:
        return default


def _family_key_from_snapshot(snapshot: ProjectOutcomeSnapshot | None) -> str:
    return _safe_text(getattr(snapshot, "project_family_key", "")) or "general"


def _family_label_from_snapshot(snapshot: ProjectOutcomeSnapshot | None, family_key: str) -> str:
    if snapshot is None:
        return family_key.replace("_", " ").title()
    return _safe_text(getattr(snapshot, "project_family_label", "")) or family_key.replace("_", " ").title()


def _build_available_family_options(snapshots: list[ProjectOutcomeSnapshot]) -> list[dict[str, Any]]:
    family_counts = Counter(_family_key_from_snapshot(snapshot) for snapshot in snapshots)
    family_labels: dict[str, str] = {}
    for snapshot in snapshots:
        family_key = _family_key_from_snapshot(snapshot)
        if family_key not in family_labels:
            family_labels[family_key] = _family_label_from_snapshot(snapshot, family_key)

    options: list[dict[str, Any]] = [
        {
            "key": "all",
            "label": "All Projects",
            "count": sum(family_counts.values()),
        }
    ]
    for family_key, count in family_counts.most_common():
        options.append(
            {
                "key": family_key,
                "label": family_labels.get(family_key, family_key.replace("_", " ").title()),
                "count": count,
            }
        )
    return options


def _resolve_scope_snapshots(
    snapshots: list[ProjectOutcomeSnapshot],
    requested_family_key: str,
) -> tuple[list[ProjectOutcomeSnapshot], dict[str, Any]]:
    requested = _safe_text(requested_family_key).lower()
    all_snapshots = list(snapshots)
    if not all_snapshots:
        return [], {
            "selected_family_key": "all",
            "selected_family_label": "All Projects",
            "effective_family_key": "general",
            "effective_family_label": "General Project",
            "scope_mode": "all_projects",
            "scope_notice": "",
        }

    available_options = _build_available_family_options(all_snapshots)
    family_keys = [option["key"] for option in available_options if option["key"] != "all"]
    family_map = {
        option["key"]: option
        for option in available_options
        if option["key"] != "all"
    }

    dominant_snapshot = _focus_snapshot(all_snapshots)
    dominant_key = _family_key_from_snapshot(dominant_snapshot)
    dominant_label = _family_label_from_snapshot(dominant_snapshot, dominant_key)

    if requested in {"", "all"}:
        return all_snapshots, {
            "selected_family_key": "all",
            "selected_family_label": "All Projects",
            "effective_family_key": dominant_key,
            "effective_family_label": dominant_label,
            "scope_mode": "all_projects",
            "scope_notice": "",
        }

    if requested not in family_keys:
        return all_snapshots, {
            "selected_family_key": requested,
            "selected_family_label": requested.replace("_", " ").title() or "Project Family",
            "effective_family_key": dominant_key,
            "effective_family_label": dominant_label,
            "scope_mode": "fallback_all",
            "scope_notice": "",
        }

    family_snapshots = [
        snapshot for snapshot in all_snapshots if _family_key_from_snapshot(snapshot) == requested
    ]
    if len(family_snapshots) >= MIN_FAMILY_SAMPLE_SIZE:
        selected_option = family_map.get(requested, {})
        return family_snapshots, {
            "selected_family_key": requested,
            "selected_family_label": _safe_text(selected_option.get("label")) or requested.replace("_", " ").title(),
            "effective_family_key": requested,
            "effective_family_label": _safe_text(selected_option.get("label")) or requested.replace("_", " ").title(),
            "scope_mode": "family",
            "scope_notice": "",
        }

    selected_option = family_map.get(requested, {})
    selected_label = _safe_text(selected_option.get("label")) or requested.replace("_", " ").title()
    return all_snapshots, {
        "selected_family_key": requested,
        "selected_family_label": selected_label,
        "effective_family_key": dominant_key,
        "effective_family_label": dominant_label,
        "scope_mode": "fallback_all",
        "scope_notice": f"Not enough {selected_label.lower()} data in this date range yet, so showing a broader view for now.",
    }


def _project_context_from_snapshot(snapshot: ProjectOutcomeSnapshot) -> dict[str, str]:
    intelligence = snapshot.original_intelligence_payload if isinstance(snapshot.original_intelligence_payload, dict) else {}
    analysis = intelligence.get("analysis") if isinstance(intelligence.get("analysis"), dict) else {}
    suggested_plan = snapshot.original_suggested_plan if isinstance(snapshot.original_suggested_plan, dict) else {}
    region_context = build_region_context_from_key(_safe_text(getattr(snapshot, "region_key", "")))

    scope_summary = (
        _safe_text(analysis.get("project_scope_summary"))
        or _safe_text(analysis.get("description"))
        or _safe_text(suggested_plan.get("project_scope_summary"))
        or _safe_text(getattr(snapshot, "final_project_state", {}).get("project_scope_summary"))
    )

    return {
        "project_type": _safe_text(analysis.get("project_type")),
        "project_subtype": _safe_text(analysis.get("project_subtype")),
        "project_scope_summary": scope_summary,
        "description": scope_summary,
        "scope_mode": _safe_text(getattr(snapshot, "scope_mode", "")),
        "template_used": _safe_text(getattr(snapshot, "template_used", "")),
        "template_name": _safe_text(getattr(snapshot, "template_used", "")),
        "region_state": _safe_text(region_context.get("state", "")),
        "region_city": _safe_text(region_context.get("city", "")),
        "region_country": _safe_text(region_context.get("country", "US")),
    }


def _focus_snapshot(snapshots: list[ProjectOutcomeSnapshot]) -> ProjectOutcomeSnapshot | None:
    if not snapshots:
        return None
    family_counts = Counter(_family_key_from_snapshot(snapshot) for snapshot in snapshots)
    dominant_family = family_counts.most_common(1)[0][0]
    family_snapshots = [snapshot for snapshot in snapshots if _family_key_from_snapshot(snapshot) == dominant_family]
    family_snapshots.sort(key=lambda item: getattr(item, "created_at", timezone.now()), reverse=True)
    return family_snapshots[0] if family_snapshots else snapshots[0]


def _headline_from_direction(label: str, direction: str, *, positive_when_below: bool = False) -> str:
    source = _safe_text(direction).lower()
    if source == "above":
        return f"{label} trends above the benchmark" if not positive_when_below else f"{label} trends below the benchmark"
    if source == "below":
        return f"{label} trends below the benchmark" if not positive_when_below else f"{label} trends above the benchmark"
    return f"{label} stays close to the benchmark"


def _support_from_comparison(comparison: dict[str, Any], fallback: str) -> str:
    text = _safe_text(comparison.get("explanation"))
    return text or fallback


def _confidence_label(value: str) -> str:
    confidence = _safe_text(value).lower()
    if confidence == "high":
        return "High confidence"
    if confidence == "medium":
        return "Moderate confidence"
    return "Preliminary view"


def _source_label(source_type: str) -> str:
    source = _safe_text(source_type).lower()
    if source == "blended_all":
        return "Based on similar projects on MyHomeBro, your market, and your past work."
    if source == "blended_platform_regional":
        return "Based on similar projects on MyHomeBro and your market."
    if source == "blended_platform_contractor":
        return "Based on similar projects on MyHomeBro and your past work."
    if source == "regional":
        return "Based on similar projects in your market."
    if source == "contractor":
        return "Based on your past work for similar projects."
    return "Based on similar projects on MyHomeBro."


def _comparison_meter(direction: str, magnitude: str) -> int:
    mag = abs(_safe_decimal(magnitude, Decimal("0.0")) or Decimal("0.0"))
    if _safe_text(direction).lower() == "similar":
        return 50
    if mag <= Decimal("3"):
        return 58 if direction == "above" else 42
    if mag <= Decimal("8"):
        return 68 if direction == "above" else 32
    return 78 if direction == "above" else 22


def _build_summary_cards(insights: dict[str, Any]) -> list[dict[str, Any]]:
    pricing = insights.get("pricing_delta_vs_platform", {}) or {}
    duration = insights.get("duration_delta_vs_platform", {}) or {}
    milestones = insights.get("milestone_count_delta", {}) or {}
    dispute = insights.get("dispute_rate_comparison", {}) or {}
    confidence = _safe_text(insights.get("confidence"))

    pricing_dir = _safe_text(pricing.get("direction"))
    duration_dir = _safe_text(duration.get("direction"))
    milestone_dir = _safe_text(milestones.get("direction"))
    dispute_dir = _safe_text(dispute.get("direction"))

    return [
        {
            "key": "pricing",
            "label": "Pricing Position",
            "headline": _headline_from_direction("You typically price", pricing_dir),
            "support": _support_from_comparison(
                pricing,
                "Your completed projects in this category are being compared against similar work.",
            ),
            "badge": "Benchmark",
            "confidence": confidence,
        },
        {
            "key": "pace",
            "label": "Project Pace",
            "headline": _headline_from_direction("Your timelines", duration_dir),
            "support": _support_from_comparison(
                duration,
                "Your completed projects in this category are being compared against similar work.",
            ),
            "badge": "Timing",
            "confidence": confidence,
        },
        {
            "key": "milestones",
            "label": "Milestone Style",
            "headline": _headline_from_direction("Your milestone plans", milestone_dir),
            "support": _support_from_comparison(
                milestones,
                "Your agreements are being compared against similar project structures.",
            ),
            "badge": "Structure",
            "confidence": confidence,
        },
        {
            "key": "reliability",
            "label": "Reliability Signals",
            "headline": _headline_from_direction("Your change patterns", dispute_dir, positive_when_below=True),
            "support": _support_from_comparison(
                dispute,
                "Completed jobs are being compared for dispute and amendment patterns.",
            ),
            "badge": "Quality",
            "confidence": confidence,
        },
    ]


def _build_comparison_rows(insights: dict[str, Any]) -> list[dict[str, Any]]:
    pricing = insights.get("pricing_delta_vs_platform", {}) or {}
    duration = insights.get("duration_delta_vs_platform", {}) or {}
    milestones = insights.get("milestone_count_delta", {}) or {}
    dispute = insights.get("dispute_rate_comparison", {}) or {}
    confidence = _confidence_label(insights.get("confidence", ""))

    rows = [
        {
            "key": "pricing",
            "label": "Pricing vs benchmark",
            "comparison": _support_from_comparison(pricing, "Comparing against similar completed jobs."),
            "meter": _comparison_meter(pricing.get("direction", ""), pricing.get("value", "0")),
            "confidence": confidence,
        },
        {
            "key": "pace",
            "label": "Project pace vs benchmark",
            "comparison": _support_from_comparison(duration, "Comparing timeline expectations against similar completed jobs."),
            "meter": _comparison_meter(duration.get("direction", ""), duration.get("value", "0")),
            "confidence": confidence,
        },
        {
            "key": "structure",
            "label": "Milestone count vs peers",
            "comparison": _support_from_comparison(milestones, "Comparing milestone structure against similar projects."),
            "meter": _comparison_meter(milestones.get("direction", ""), str(_safe_int(milestones.get("value", 0)))),
            "confidence": confidence,
        },
        {
            "key": "reliability",
            "label": "Reliability signals",
            "comparison": _support_from_comparison(dispute, "Comparing dispute and amendment patterns against similar work."),
            "meter": _comparison_meter(dispute.get("direction", ""), "0"),
            "confidence": confidence,
        },
    ]
    return rows


def _build_recommendations(insights: dict[str, Any]) -> list[str]:
    bullets: list[str] = []
    for item in insights.get("suggested_adjustments", [])[:4]:
        text = _safe_text(item.get("suggestion_text"))
        if text:
            bullets.append(text)
    if bullets:
        return bullets[:4]

    if _safe_text(insights.get("confidence")).lower() == "low":
        return [
            "Complete a few more similar projects to sharpen these comparisons.",
            "Use the benchmark view as a starting point, then keep your edits flexible.",
        ]
    return [
        "Keep using your best-performing structure as a baseline for similar jobs.",
    ]


def build_business_dashboard_contractor_insights(
    contractor,
    start_dt,
    end_dt,
    project_family_key: str | None = None,
) -> dict[str, Any]:
    if contractor is None:
        return {
            "available": False,
            "source_type": "platform",
            "source_label": "Based on similar projects on MyHomeBro.",
            "confidence": "low",
            "project_family_key": "general",
            "project_family_label": "General Project",
            "selected_family_key": "all",
            "selected_family_label": "All Projects",
            "effective_family_key": "general",
            "effective_family_label": "General Project",
            "scope_mode": "all_projects",
            "scope_notice": "",
            "available_families": [{"key": "all", "label": "All Projects", "count": 0}],
            "sample_sizes": {"platform": 0, "regional": 0, "contractor": 0},
            "summary_cards": _build_summary_cards(
                {
                    "confidence": "low",
                    "pricing_delta_vs_platform": {"direction": "similar", "explanation": "More completed jobs will sharpen this view."},
                    "duration_delta_vs_platform": {"direction": "similar", "explanation": "More completed jobs will sharpen this view."},
                    "milestone_count_delta": {"direction": "similar", "explanation": "More completed jobs will sharpen this view."},
                    "dispute_rate_comparison": {"direction": "similar", "explanation": "More completed jobs will sharpen this view."},
                }
            ),
            "comparison_rows": _build_comparison_rows(
                {
                    "confidence": "low",
                    "pricing_delta_vs_platform": {"direction": "similar", "value": "0", "explanation": "More completed jobs will sharpen this view."},
                    "duration_delta_vs_platform": {"direction": "similar", "value": "0", "explanation": "More completed jobs will sharpen this view."},
                    "milestone_count_delta": {"direction": "similar", "value": 0, "explanation": "More completed jobs will sharpen this view."},
                    "dispute_rate_comparison": {"direction": "similar", "value": "0", "explanation": "More completed jobs will sharpen this view."},
                }
            ),
            "recommendations": [
                "Complete more jobs to unlock contractor-specific insights.",
            ],
            "available": False,
        }

    snapshots = list(
        ProjectOutcomeSnapshot.objects.filter(
            contractor=contractor,
            completion_status__in=RELIABLE_STATUSES,
            created_at__gte=start_dt,
            created_at__lte=end_dt,
        ).order_by("-created_at", "-id")[:40]
    )
    if not snapshots:
        snapshots = list(
            ProjectOutcomeSnapshot.objects.filter(
                contractor=contractor,
                completion_status__in=RELIABLE_STATUSES,
            ).order_by("-created_at", "-id")[:20]
        )

    available_families = _build_available_family_options(snapshots)
    effective_snapshots, scope_state = _resolve_scope_snapshots(snapshots, project_family_key)
    focus_snapshot = _focus_snapshot(effective_snapshots)
    effective_family_key = _family_key_from_snapshot(focus_snapshot)
    effective_family_label = _family_label_from_snapshot(focus_snapshot, effective_family_key)
    project_context = _project_context_from_snapshot(focus_snapshot) if focus_snapshot is not None else {
        "project_type": "",
        "project_subtype": "",
        "project_scope_summary": "",
        "description": "",
        "scope_mode": "",
        "template_used": "",
        "template_name": "",
        "region_state": "",
        "region_city": "",
        "region_country": "US",
    }
    project_context["project_family_label"] = effective_family_label

    insights = build_contractor_insights(
        contractor_id=getattr(contractor, "id", None),
        project_family_key=effective_family_key,
        project_context=project_context,
    )

    source_type = _safe_text(insights.get("source_type"))
    selected_family_key = _safe_text(scope_state.get("selected_family_key")) or "all"
    selected_family_label = _safe_text(scope_state.get("selected_family_label")) or "All Projects"
    scope_mode = _safe_text(scope_state.get("scope_mode")) or "all_projects"
    result = {
        "available": bool(snapshots),
        "project_family_key": effective_family_key,
        "project_family_label": effective_family_label,
        "selected_family_key": selected_family_key,
        "selected_family_label": selected_family_label,
        "effective_family_key": effective_family_key,
        "effective_family_label": effective_family_label,
        "scope_mode": scope_mode,
        "scope_label": selected_family_label if selected_family_key != "all" else "All Projects",
        "scope_notice": _safe_text(scope_state.get("scope_notice")),
        "available_families": available_families,
        "source_type": source_type,
        "source_label": _source_label(source_type),
        "confidence": _safe_text(insights.get("confidence")),
        "sample_sizes": insights.get("sample_sizes", {"platform": 0, "regional": 0, "contractor": 0}),
        "summary_cards": _build_summary_cards(insights),
        "comparison_rows": _build_comparison_rows(insights),
        "recommendations": _build_recommendations(insights),
        "explanations": insights.get("explanation_strings", []),
    }
    if focus_snapshot is not None:
        result["region"] = {
            "region_key": _safe_text(getattr(focus_snapshot, "region_key", "")),
            "region_label": _safe_text(getattr(focus_snapshot, "region_label", "")),
            "region_granularity": _safe_text(getattr(focus_snapshot, "region_granularity", "")) or "unknown",
        }
    return result
