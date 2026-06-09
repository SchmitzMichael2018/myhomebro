from __future__ import annotations

import hashlib
import json
from dataclasses import dataclass
from typing import Any

from django.db import IntegrityError, transaction
from django.db.models import Q
from django.utils import timezone

from projects.models import Agreement, Project
from projects.models_customer_portal import (
    PropertyDocument,
    PropertyIntelligenceSnapshot,
    PropertyPhoto,
    PropertyProfile,
)
from projects.models_maintenance import MaintenanceWorkOrder
from projects.services.maintenance_work_orders import customer_visible_work_order_queryset


def _safe_text(value: Any) -> str:
    return " ".join(str(value or "").split()).strip()


def _safe_dt(value: Any) -> str:
    if not value:
        return ""
    try:
        return value.isoformat()
    except Exception:
        return str(value)


def _contains_any(text: str, words: list[str]) -> bool:
    haystack = _safe_text(text).lower()
    return any(word in haystack for word in words)


def _days_since(value: Any) -> int | None:
    if not value:
        return None
    current = timezone.now()
    if hasattr(value, "date") and not hasattr(value, "hour"):
        value = timezone.datetime.combine(value, timezone.datetime.min.time(), tzinfo=current.tzinfo)
    if timezone.is_naive(value):
        value = timezone.make_aware(value)
    return max(0, (current - value).days)


@dataclass(frozen=True)
class InsightDraft:
    key: str
    category: str
    bucket: str
    severity: str
    title: str
    reason: str
    action_label: str
    action_target: str


def _insight_payload(draft: InsightDraft, profile: PropertyProfile) -> dict[str, Any]:
    return {
        "id": draft.key,
        "category": draft.category,
        "bucket": draft.bucket,
        "severity": draft.severity,
        "title": draft.title,
        "reason": draft.reason,
        "property_id": profile.id,
        "property_name": _safe_text(profile.display_name) or _safe_text(profile.address_line1) or "Property",
        "suggested_action": {
            "label": draft.action_label,
            "target": draft.action_target,
        },
    }


def _profile_record_context(profile: PropertyProfile, email: str) -> dict[str, Any]:
    documents = list(PropertyDocument.objects.filter(property_profile=profile).order_by("-uploaded_at", "-id"))
    photos = list(PropertyPhoto.objects.filter(property_profile=profile).order_by("-uploaded_at", "-id"))
    work_orders = list(
        customer_visible_work_order_queryset(email)
        .filter(Q(property_profile=profile) | Q(property_profile__isnull=True))
        .order_by("-completed_at", "-scheduled_date", "-id")
    )
    agreements = list(
        Agreement.objects.select_related("project", "contractor", "homeowner").filter(
            Q(homeowner__email__iexact=email) | Q(project__homeowner__email__iexact=email)
        )
    )
    projects = list(
        Project.objects.select_related("homeowner", "contractor").filter(homeowner__email__iexact=email)
    )
    text_parts = [
        profile.display_name,
        profile.property_type,
        profile.address_line1,
        profile.city,
        profile.state,
        profile.notes,
        *[f"{row.title} {row.document_type}" for row in documents],
        *[row.title for row in photos],
        *[f"{row.title} {row.description} {row.notes}" for row in work_orders],
        *[
            f"{getattr(row.project, 'title', '')} {row.project_type} {row.project_subtype} {row.description} {row.warranty_text_snapshot}"
            for row in agreements
        ],
        *[f"{row.title} {row.description}" for row in projects],
    ]
    return {
        "documents": documents,
        "photos": photos,
        "work_orders": work_orders,
        "agreements": agreements,
        "projects": projects,
        "text": " ".join(_safe_text(part) for part in text_parts),
    }


def _latest_completed_work_order(work_orders: list[MaintenanceWorkOrder], keywords: list[str]):
    matching = [
        row
        for row in work_orders
        if row.status == MaintenanceWorkOrder.STATUS_COMPLETED
        and _contains_any(f"{row.title} {row.description} {row.notes}", keywords)
    ]
    return max(matching, key=lambda row: row.completed_at or row.scheduled_date or row.created_at, default=None)


def _has_document_or_work(context: dict[str, Any], keywords: list[str]) -> bool:
    return _contains_any(context["text"], keywords)


def _seasonal_insight(now) -> InsightDraft:
    month = now.month
    if month in {3, 4, 5}:
        return InsightDraft(
            "seasonal-spring-exterior-check",
            "seasonal",
            "recommended",
            "low",
            "Spring exterior check recommended.",
            "Spring is a good time to check gutters, roof edges, drainage, and exterior caulking before heavy rain season.",
            "Create Request",
            "requests",
        )
    if month in {6, 7, 8}:
        return InsightDraft(
            "seasonal-summer-hvac-review",
            "seasonal",
            "recommended",
            "low",
            "Summer HVAC review recommended.",
            "Cooling systems work hardest in summer. A service visit can help catch filter, airflow, and condensate issues early.",
            "Schedule Maintenance",
            "requests",
        )
    if month in {9, 10, 11}:
        return InsightDraft(
            "seasonal-fall-prep",
            "seasonal",
            "recommended",
            "low",
            "Fall maintenance check recommended.",
            "Fall is a good time to review heating, roof drainage, exterior gaps, and winter preparation items.",
            "Create Request",
            "requests",
        )
    return InsightDraft(
        "seasonal-winter-prep",
        "seasonal",
        "recommended",
        "low",
        "Winter property check recommended.",
        "Cold weather can expose insulation, plumbing, roof, and heating issues. Review your records and request help if anything looks off.",
        "Create Request",
        "requests",
    )


def _generate_profile_insights(profile: PropertyProfile, email: str, *, now=None) -> dict[str, Any]:
    now = now or timezone.now()
    context = _profile_record_context(profile, email)
    work_orders = context["work_orders"]
    documents = context["documents"]
    agreements = context["agreements"]
    insights: list[InsightDraft] = []

    recent_hvac = _latest_completed_work_order(work_orders, ["hvac", "furnace", "air conditioner", "a/c", "filter"])
    recent_hvac_days = _days_since(getattr(recent_hvac, "completed_at", None) or getattr(recent_hvac, "scheduled_date", None))
    has_scheduled_hvac = any(
        row.status in {MaintenanceWorkOrder.STATUS_SCHEDULED, MaintenanceWorkOrder.STATUS_IN_PROGRESS}
        and _contains_any(f"{row.title} {row.description}", ["hvac", "furnace", "air conditioner", "a/c", "filter"])
        and (not row.scheduled_date or row.scheduled_date >= now.date())
        for row in work_orders
    )
    if not has_scheduled_hvac and (recent_hvac_days is None or recent_hvac_days > 365):
        insights.append(
            InsightDraft(
                "maintenance-hvac-service-due",
                "maintenance_due",
                "needs_attention",
                "medium",
                "HVAC service may be due.",
                "No recent completed HVAC service record was found for this property in the last year.",
                "Schedule Maintenance",
                "requests",
            )
        )

    if not _has_document_or_work(context, ["filter replacement", "air filter", "furnace filter", "hvac filter"]):
        insights.append(
            InsightDraft(
                "maintenance-filter-record-missing",
                "missing_records",
                "recommended",
                "low",
                "Filter replacement records are missing.",
                "Filter changes are easy to lose track of. Upload a record or create a maintenance request if replacement is due.",
                "Upload Document",
                "property",
            )
        )

    if not _has_document_or_work(context, ["roof", "shingle", "flashing", "gutter"]):
        insights.append(
            InsightDraft(
                "missing-roof-documentation",
                "missing_records",
                "recommended",
                "low",
                "No roof documentation found.",
                "Roof records, inspection notes, or warranty documents help future contractors understand prior work.",
                "Upload Document",
                "property",
            )
        )

    if not _has_document_or_work(context, ["water heater", "tankless", "heater inspection"]):
        insights.append(
            InsightDraft(
                "missing-water-heater-records",
                "missing_records",
                "recommended",
                "low",
                "No water heater records found.",
                "Water heater installation, warranty, and service records help track age and maintenance needs.",
                "Upload Document",
                "property",
            )
        )

    if not _has_document_or_work(context, ["warranty"]):
        insights.append(
            InsightDraft(
                "missing-warranty-records",
                "warranty_awareness",
                "recommended",
                "low",
                "Warranty records are missing.",
                "No warranty text or uploaded warranty document was found in this property record.",
                "Review Warranty",
                "property",
            )
        )

    property_age = now.year - int(profile.year_built) if profile.year_built else None
    if property_age is None:
        insights.append(
            InsightDraft(
                "missing-year-built",
                "missing_records",
                "informational",
                "info",
                "Year built is missing.",
                "Adding the year built helps MyHomeBro estimate which systems may need closer attention.",
                "View Property Records",
                "property",
            )
        )
    elif property_age >= 25:
        insights.append(
            InsightDraft(
                "age-roof-inspection-window",
                "property_age_signal",
                "upcoming",
                "medium",
                "Roof inspection may be worth reviewing.",
                f"This property is about {property_age} years old. If roof age is unknown, an inspection or uploaded roof record can reduce uncertainty.",
                "Create Request",
                "requests",
            )
        )
    elif property_age >= 12 and not _has_document_or_work(context, ["water heater"]):
        insights.append(
            InsightDraft(
                "age-water-heater-record-window",
                "property_age_signal",
                "upcoming",
                "medium",
                "Water heater age may need attention.",
                f"This property is about {property_age} years old and no water heater record was found.",
                "Create Request",
                "requests",
            )
        )

    active_warranties = [
        row
        for row in agreements
        if _safe_text(getattr(row, "warranty_text_snapshot", "")) or _safe_text(getattr(row, "warranty_type", ""))
    ]
    if active_warranties:
        insights.append(
            InsightDraft(
                "warranty-review-available",
                "warranty_awareness",
                "informational",
                "info",
                "Warranty information is available.",
                "Review saved warranty details and related documents before starting overlapping work.",
                "Review Warranty",
                "property",
            )
        )

    insights.append(_seasonal_insight(now))

    seen = set()
    payload_insights = []
    for insight in insights:
        if insight.key in seen:
            continue
        seen.add(insight.key)
        payload_insights.append(_insight_payload(insight, profile))

    severity_weights = {"high": 25, "medium": 15, "low": 7, "info": 0}
    score = max(0, 100 - sum(severity_weights.get(row["severity"], 0) for row in payload_insights))
    if score >= 82:
        health_status = "excellent"
        health_label = "Excellent"
    elif score >= 65:
        health_status = "good"
        health_label = "Good"
    else:
        health_status = "needs_attention"
        health_label = "Needs Attention"
    record_count = len(documents) + len(context["photos"]) + len(work_orders) + len(agreements) + len(context["projects"])
    confidence = "high" if record_count >= 8 else "medium" if record_count >= 3 else "low"
    buckets = {
        "needs_attention": [row for row in payload_insights if row["bucket"] == "needs_attention"],
        "upcoming": [row for row in payload_insights if row["bucket"] == "upcoming"],
        "recommended": [row for row in payload_insights if row["bucket"] == "recommended"],
        "informational": [row for row in payload_insights if row["bucket"] == "informational"],
    }
    learning_summary = {
        "record_counts": {
            "documents": len(documents),
            "photos": len(context["photos"]),
            "maintenance_work_orders": len(work_orders),
            "agreements": len(agreements),
            "projects": len(context["projects"]),
        },
        "categories": sorted({row["category"] for row in payload_insights}),
        "common_work_signals": _work_signals(context["text"]),
    }
    return {
        "property_id": profile.id,
        "property_name": _safe_text(profile.display_name) or _safe_text(profile.address_line1) or "Property",
        "health": {
            "status": health_status,
            "label": health_label,
            "score": score,
            "confidence": confidence,
            "summary": _health_summary(health_label, confidence, payload_insights),
        },
        "insights": payload_insights,
        "buckets": buckets,
        "learning_summary": learning_summary,
    }


def _work_signals(text: str) -> list[str]:
    signals = []
    for label, words in [
        ("HVAC", ["hvac", "furnace", "air conditioner", "a/c"]),
        ("Roofing", ["roof", "shingle", "flashing"]),
        ("Plumbing", ["plumbing", "water heater", "leak", "pipe"]),
        ("Electrical", ["electrical", "panel", "outlet", "breaker"]),
        ("Exterior", ["siding", "gutter", "trim", "paint"]),
    ]:
        if _contains_any(text, words):
            signals.append(label)
    return signals


def _health_summary(label: str, confidence: str, insights: list[dict[str, Any]]) -> str:
    needs_attention = sum(1 for row in insights if row["bucket"] == "needs_attention")
    recommended = sum(1 for row in insights if row["bucket"] == "recommended")
    if needs_attention:
        return f"{label}: {needs_attention} item may need attention. Confidence is {confidence} based on available records."
    if recommended:
        return f"{label}: records are building, with {recommended} recommended improvement."
    return f"{label}: no immediate advisory issues found from current records."


def _persist_snapshot(profile: PropertyProfile, customer_email: str, payload: dict[str, Any]) -> None:
    snapshot_payload = {
        "health": payload.get("health", {}),
        "insights": payload.get("insights", []),
        "learning_summary": payload.get("learning_summary", {}),
    }
    content = json.dumps(snapshot_payload, sort_keys=True, default=str)
    content_hash = hashlib.sha256(content.encode("utf-8")).hexdigest()
    if PropertyIntelligenceSnapshot.objects.filter(property_profile=profile, content_hash=content_hash).exists():
        return
    try:
        with transaction.atomic():
            PropertyIntelligenceSnapshot.objects.create(
                property_profile=profile,
                customer_email=customer_email,
                health_status=_safe_text(payload.get("health", {}).get("status")),
                health_score=int(payload.get("health", {}).get("score") or 0),
                confidence=_safe_text(payload.get("health", {}).get("confidence")),
                insights=payload.get("insights", []),
                learning_summary=payload.get("learning_summary", {}),
                content_hash=content_hash,
            )
    except IntegrityError:
        return


def build_property_intelligence(email: str, *, persist: bool = True, now=None) -> dict[str, Any]:
    normalized_email = _safe_text(email).lower()
    profiles = list(PropertyProfile.objects.filter(customer_email__iexact=normalized_email).order_by("-is_primary", "-updated_at", "-id"))
    if not profiles:
        return {
            "health": {
                "status": "needs_attention",
                "label": "Needs Attention",
                "score": 0,
                "confidence": "low",
                "summary": "No property profile is available yet.",
            },
            "insights": [],
            "buckets": {"needs_attention": [], "upcoming": [], "recommended": [], "informational": []},
            "properties": [],
            "learning_summary": {"record_counts": {}, "categories": [], "common_work_signals": []},
        }
    property_payloads = [_generate_profile_insights(profile, normalized_email, now=now) for profile in profiles]
    primary = next((row for row in property_payloads if row["property_id"] == profiles[0].id), property_payloads[0])
    for profile, payload in zip(profiles, property_payloads):
        if persist:
            _persist_snapshot(profile, normalized_email, payload)
    return {
        **primary,
        "properties": [
            {
                "property_id": row["property_id"],
                "property_name": row["property_name"],
                "health": row["health"],
                "insight_count": len(row["insights"]),
            }
            for row in property_payloads
        ],
    }
