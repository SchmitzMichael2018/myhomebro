from __future__ import annotations

from dataclasses import asdict, dataclass, field
from typing import Any

from django.db.models import Count
from django.utils import timezone

from projects.models import Contractor, PropertyProfile
from projects.models_dispute import Dispute
from projects.models_learning import ContractorEditEvent
from projects.services.contractor_reviews import contractor_performance_summary
from projects.services.property_intelligence import build_property_intelligence


VALID_CONFIDENCE = {"low", "medium", "high"}
VALID_SEVERITY = {"info", "low", "medium", "high"}
VALID_AUDIENCE = {"contractor", "customer", "admin", "internal"}


@dataclass(frozen=True)
class UnifiedRecommendation:
    key: str
    type: str
    category: str
    title: str
    summary: str
    explanation: str
    source: str
    confidence: str
    severity: str
    audience: str
    object_type: str = ""
    object_id: str | int | None = None
    action_label: str = ""
    action_target: str = ""
    dismissible: bool = True
    metadata: dict[str, Any] = field(default_factory=dict)
    generated_at: str = field(default_factory=lambda: timezone.now().isoformat())

    def to_dict(self) -> dict[str, Any]:
        payload = asdict(self)
        payload["id"] = self.key
        payload["created_at"] = self.generated_at
        return payload


def _safe_text(value: Any) -> str:
    return str(value or "").strip()


def _safe_int(value: Any) -> int:
    try:
        return int(value or 0)
    except (TypeError, ValueError):
        return 0


def _safe_float(value: Any) -> float:
    try:
        return float(value or 0)
    except (TypeError, ValueError):
        return 0.0


def _pct(value: Any) -> float:
    value = _safe_float(value)
    if value <= 1:
        value *= 100
    return round(value, 1)


def _normalize(value: str, valid: set[str], fallback: str) -> str:
    value = _safe_text(value).lower()
    return value if value in valid else fallback


def _recommendation(
    *,
    key: str,
    type: str,
    category: str,
    title: str,
    summary: str,
    explanation: str,
    source: str,
    confidence: str = "low",
    severity: str = "info",
    audience: str,
    object_type: str = "",
    object_id: str | int | None = None,
    action_label: str = "",
    action_target: str = "",
    dismissible: bool = True,
    metadata: dict[str, Any] | None = None,
) -> UnifiedRecommendation:
    return UnifiedRecommendation(
        key=key,
        type=type,
        category=category,
        title=title,
        summary=summary,
        explanation=explanation,
        source=source,
        confidence=_normalize(confidence, VALID_CONFIDENCE, "low"),
        severity=_normalize(severity, VALID_SEVERITY, "info"),
        audience=_normalize(audience, VALID_AUDIENCE, "internal"),
        object_type=object_type,
        object_id=object_id,
        action_label=action_label,
        action_target=action_target,
        dismissible=dismissible,
        metadata=metadata or {},
    )


def _sort_and_limit(rows: list[UnifiedRecommendation], limit: int = 5) -> list[dict[str, Any]]:
    severity_order = {"high": 0, "medium": 1, "low": 2, "info": 3}
    confidence_order = {"high": 0, "medium": 1, "low": 2}
    seen = set()
    deduped: list[UnifiedRecommendation] = []
    for row in rows:
        if row.key in seen:
            continue
        seen.add(row.key)
        deduped.append(row)
    deduped.sort(key=lambda row: (severity_order.get(row.severity, 9), confidence_order.get(row.confidence, 9), row.key))
    return [row.to_dict() for row in deduped[: max(0, limit)]]


def build_contractor_performance_recommendations(contractor: Contractor, *, limit: int = 5) -> list[dict[str, Any]]:
    if contractor is None:
        return []
    summary = contractor_performance_summary(contractor)
    confidence = summary.get("confidence") or "low"
    rows: list[UnifiedRecommendation] = []
    contractor_id = getattr(contractor, "id", None)

    if _safe_int(summary.get("review_count")) < 3:
        rows.append(
            _recommendation(
                key=f"contractor:{contractor_id}:reviews-confidence",
                type="contractor_performance",
                category="reviews",
                title="Build review confidence",
                summary="More approved customer reviews will make your performance score more reliable.",
                explanation="The performance score intentionally treats sparse review data as low-confidence rather than as a penalty.",
                source="contractor_performance_summary",
                confidence=confidence,
                severity="low",
                audience="contractor",
                object_type="contractor",
                object_id=contractor_id,
                action_label="Open Public Presence",
                action_target="/app/public-presence",
                metadata={"review_count": summary.get("review_count", 0)},
            )
        )

    if summary.get("learning_signals", {}).get("dispute_risk"):
        rows.append(
            _recommendation(
                key=f"contractor:{contractor_id}:dispute-risk",
                type="dispute_risk",
                category="scope_clarity",
                title="Reduce dispute risk",
                summary="Recent dispute patterns suggest scope clarity deserves attention.",
                explanation="This is an advisory signal from dispute frequency. Review agreement scope, exclusions, and customer expectations before scaling similar work.",
                source="contractor_performance_summary",
                confidence=confidence,
                severity="high",
                audience="contractor",
                object_type="contractor",
                object_id=contractor_id,
                action_label="Open Disputes",
                action_target="/app/disputes",
                metadata={"dispute_rate": summary.get("dispute_rate"), "dispute_count": summary.get("dispute_count")},
            )
        )

    if summary.get("learning_signals", {}).get("timeline_risk"):
        rows.append(
            _recommendation(
                key=f"contractor:{contractor_id}:milestone-timing",
                type="milestone_timing",
                category="delivery",
                title="Improve milestone timing",
                summary="Milestone snapshots show some delayed completion signals.",
                explanation="Use this as a planning cue. Tighter milestone descriptions and more realistic durations can help align homeowner expectations.",
                source="contractor_performance_summary",
                confidence=confidence,
                severity="medium",
                audience="contractor",
                object_type="contractor",
                object_id=contractor_id,
                action_label="Open Milestones",
                action_target="/app/milestones",
                metadata={
                    "on_time_milestone_rate": summary.get("on_time_milestone_rate"),
                    "delayed_milestones": summary.get("delayed_milestones"),
                },
            )
        )

    if summary.get("learning_signals", {}).get("marketplace_conversion_risk"):
        rows.append(
            _recommendation(
                key=f"contractor:{contractor_id}:marketplace-conversion",
                type="marketplace_conversion",
                category="bids",
                title="Review bid conversion",
                summary="Marketplace bid win rate is low after enough bids to form a signal.",
                explanation="Compare proposal detail, timing, warranty, and pricing clarity against bids that convert.",
                source="contractor_performance_summary",
                confidence=confidence,
                severity="medium",
                audience="contractor",
                object_type="contractor",
                object_id=contractor_id,
                action_label="Open Bids",
                action_target="/app/bids",
                metadata={
                    "bid_count": summary.get("marketplace_bid_count"),
                    "win_rate": summary.get("marketplace_bid_win_rate"),
                    "win_percent": summary.get("marketplace_bid_win_percent"),
                },
            )
        )

    if summary.get("learning_signals", {}).get("payment_release_risk"):
        rows.append(
            _recommendation(
                key=f"contractor:{contractor_id}:payment-release-risk",
                type="admin_attention",
                category="payments",
                title="Review payment release issues",
                summary="Reimbursement or invoice release issues are present.",
                explanation="This recommendation is advisory. Review the affected payment workflows before taking on more similar work.",
                source="contractor_performance_summary",
                confidence=confidence,
                severity="medium",
                audience="contractor",
                object_type="contractor",
                object_id=contractor_id,
                action_label="Open Payments",
                action_target="/app/invoices",
                metadata={
                    "reimbursement_issue_count": summary.get("reimbursement_issue_count"),
                    "payment_issue_count": summary.get("payment_issue_count"),
                },
            )
        )

    if summary.get("learning_signals", {}).get("consistently_strong_reviews"):
        rows.append(
            _recommendation(
                key=f"contractor:{contractor_id}:strong-rating",
                type="contractor_performance",
                category="reviews",
                title="Strong customer satisfaction signal",
                summary="Approved reviews show a strong customer experience pattern.",
                explanation="Use this signal to keep your public presence current and help customers understand your strengths.",
                source="contractor_performance_summary",
                confidence=confidence,
                severity="info",
                audience="contractor",
                object_type="contractor",
                object_id=contractor_id,
                action_label="Open Public Presence",
                action_target="/app/public-presence",
                metadata={"average_rating": summary.get("average_rating"), "review_count": summary.get("review_count")},
            )
        )

    return _sort_and_limit(rows, limit)


def build_property_recommendations(
    email: str,
    *,
    property_intelligence: dict[str, Any] | None = None,
    limit: int = 5,
) -> list[dict[str, Any]]:
    normalized_email = _safe_text(email).lower()
    if not normalized_email:
        return []
    intelligence = property_intelligence or build_property_intelligence(normalized_email, persist=False)
    insights = list(intelligence.get("insights") or [])
    rows: list[UnifiedRecommendation] = []
    for insight in insights:
        severity = insight.get("severity") or ("medium" if insight.get("bucket") == "needs_attention" else "low")
        category = _safe_text(insight.get("category") or insight.get("bucket") or "property")
        action_target = insight.get("action_target") or insight.get("target") or insight.get("action_tab") or ""
        if action_target and not str(action_target).startswith("/"):
            action_target = f"portal:{action_target}"
        property_id = insight.get("property_id") or intelligence.get("property_id")
        rows.append(
            _recommendation(
                key=f"customer:{normalized_email}:{property_id or 'property'}:{insight.get('key') or insight.get('title')}",
                type="property_intelligence" if category not in {"maintenance_due"} else "maintenance_due",
                category=category,
                title=_safe_text(insight.get("title")) or "Property recommendation",
                summary=_safe_text(insight.get("body") or insight.get("summary")),
                explanation=_safe_text(insight.get("reason") or insight.get("body") or "Generated from your property records and service history."),
                source="property_intelligence",
                confidence=intelligence.get("health", {}).get("confidence") or "low",
                severity=severity,
                audience="customer",
                object_type="property_profile",
                object_id=property_id,
                action_label=_safe_text(insight.get("action_label")) or "View Property Records",
                action_target=action_target or "portal:property",
                metadata={"bucket": insight.get("bucket"), "property_name": intelligence.get("property_name")},
            )
        )
    return _sort_and_limit(rows, limit)


def build_template_edit_lineage_recommendations(contractor: Contractor, *, limit: int = 5) -> list[dict[str, Any]]:
    if contractor is None:
        return []
    rows: list[UnifiedRecommendation] = []
    interesting_fields = {
        ContractorEditEvent.Field.SCOPE: "scope",
        ContractorEditEvent.Field.MILESTONES: "milestones",
        ContractorEditEvent.Field.EXCLUSIONS: "exclusions",
        ContractorEditEvent.Field.CLARIFICATION_QUESTIONS: "clarification questions",
    }
    counts = (
        ContractorEditEvent.objects.filter(contractor=contractor, source=ContractorEditEvent.Source.CONTRACTOR)
        .values("field_changed")
        .annotate(total=Count("id"))
    )
    for row in counts:
        field = row["field_changed"]
        total = _safe_int(row["total"])
        if field not in interesting_fields or total < 3:
            continue
        label = interesting_fields[field]
        rows.append(
            _recommendation(
                key=f"contractor:{contractor.id}:template-lineage:{field}",
                type="template_improvement",
                category=label,
                title=f"Review reusable {label} patterns",
                summary=f"Contractor edits have changed {label} on {total} agreements.",
                explanation="This is a learning signal from contractor edits. Consider updating a reusable template only after reviewing the actual edited agreements.",
                source="contractor_edit_lineage",
                confidence="medium" if total >= 6 else "low",
                severity="low",
                audience="contractor",
                object_type="contractor",
                object_id=contractor.id,
                action_label="Open Templates",
                action_target="/app/templates",
                metadata={"field_changed": field, "edit_count": total},
            )
        )
    return _sort_and_limit(rows, limit)


def build_contractor_dispute_recommendations(contractor: Contractor, *, limit: int = 5) -> list[dict[str, Any]]:
    if contractor is None:
        return []
    active = Dispute.objects.filter(agreement__contractor=contractor, is_archived=False).exclude(
        status__in=["resolved_contractor", "resolved_homeowner", "resolved_partial", "canceled"]
    )
    rows: list[UnifiedRecommendation] = []
    escrow_holds = active.filter(escrow_frozen=True).count()
    awaiting_response = active.filter(responded_at__isnull=True).count()
    if escrow_holds:
        rows.append(
            _recommendation(
                key=f"contractor:{contractor.id}:disputes:escrow-holds",
                type="dispute_risk",
                category="escrow_hold",
                title="Escrow hold active",
                summary=f"{escrow_holds} active dispute(s) have an escrow hold.",
                explanation="Review dispute details and evidence. This recommendation does not decide the outcome.",
                source="dispute_framework",
                confidence="high",
                severity="high",
                audience="contractor",
                object_type="contractor",
                object_id=contractor.id,
                action_label="Open Disputes",
                action_target="/app/disputes",
                metadata={"escrow_hold_count": escrow_holds},
            )
        )
    if awaiting_response:
        rows.append(
            _recommendation(
                key=f"contractor:{contractor.id}:disputes:awaiting-response",
                type="dispute_risk",
                category="awaiting_response",
                title="Dispute response may be needed",
                summary=f"{awaiting_response} active dispute(s) have no recorded response yet.",
                explanation="Add facts, evidence, or project context where appropriate. AI and recommendations remain advisory.",
                source="dispute_framework",
                confidence="medium",
                severity="medium",
                audience="contractor",
                object_type="contractor",
                object_id=contractor.id,
                action_label="Open Disputes",
                action_target="/app/disputes",
                metadata={"awaiting_response_count": awaiting_response},
            )
        )
    return _sort_and_limit(rows, limit)


def build_marketplace_recommendations(*, params: dict[str, Any] | None = None, limit: int = 5) -> list[dict[str, Any]]:
    from adminpanel.marketplace_analytics import build_marketplace_analytics

    analytics = build_marketplace_analytics(params or {})
    queues = analytics.get("attention_queues") or {}
    funnel = analytics.get("funnel") or {}
    conversion = analytics.get("conversion_rates") or {}
    rows: list[UnifiedRecommendation] = []

    zero_bid_count = len(queues.get("zero_bid_requests") or [])
    if zero_bid_count:
        rows.append(
            _recommendation(
                key="admin:marketplace:zero-bid-requests",
                type="marketplace_conversion",
                category="zero_bid",
                title="Requests have zero bids",
                summary=f"{zero_bid_count} marketplace request(s) need bid coverage review.",
                explanation="Use marketplace analytics to inspect location readiness, contractor eligibility, and routing health.",
                source="marketplace_analytics",
                confidence="high",
                severity="high",
                audience="admin",
                object_type="marketplace",
                action_label="Open Marketplace Analytics",
                action_target="/app/admin/marketplace/analytics",
                metadata={"count": zero_bid_count, "funnel": funnel},
            )
        )

    awaiting_award_count = len(queues.get("requests_awaiting_award") or [])
    if awaiting_award_count:
        rows.append(
            _recommendation(
                key="admin:marketplace:awaiting-award",
                type="marketplace_conversion",
                category="awaiting_award",
                title="Requests are awaiting award",
                summary=f"{awaiting_award_count} request(s) have bids but no awarded contractor.",
                explanation="This is a follow-up queue. It does not select a contractor; it points admins to requests where customers may need help moving forward.",
                source="marketplace_analytics",
                confidence="high",
                severity="medium",
                audience="admin",
                object_type="marketplace",
                action_label="Open Marketplace Analytics",
                action_target="/app/admin/marketplace/analytics",
                metadata={"count": awaiting_award_count},
            )
        )

    unsigned_count = len(queues.get("awarded_not_signed_or_funded") or [])
    if unsigned_count:
        rows.append(
            _recommendation(
                key="admin:marketplace:awarded-not-signed-funded",
                type="marketplace_conversion",
                category="agreement_followthrough",
                title="Awarded work needs agreement follow-through",
                summary=f"{unsigned_count} awarded marketplace agreement(s) are not fully signed or funded.",
                explanation="Review agreement status and customer/contractor next actions. Do not manually alter financial state from this recommendation.",
                source="marketplace_analytics",
                confidence="high",
                severity="medium",
                audience="admin",
                object_type="marketplace",
                action_label="Open Marketplace Analytics",
                action_target="/app/admin/marketplace/analytics",
                metadata={"count": unsigned_count},
            )
        )

    if _safe_int(funnel.get("requests_routed")) >= 5 and _safe_float(conversion.get("routed_to_bid_received")) < 35:
        rows.append(
            _recommendation(
                key="admin:marketplace:low-routed-bid-conversion",
                type="marketplace_conversion",
                category="conversion_rate",
                title="Routed requests are not receiving enough bids",
                summary=f"Routed-to-bid conversion is {_pct(conversion.get('routed_to_bid_received'))}%.",
                explanation="Inspect city readiness and eligible contractor coverage before expanding marketplace routing.",
                source="marketplace_analytics",
                confidence="medium",
                severity="medium",
                audience="admin",
                object_type="marketplace",
                action_label="Open Marketplace Analytics",
                action_target="/app/admin/marketplace/analytics",
                metadata={"routed_to_bid_received": conversion.get("routed_to_bid_received")},
            )
        )

    return _sort_and_limit(rows, limit)


def build_admin_dispute_recommendations(*, limit: int = 5) -> list[dict[str, Any]]:
    active = Dispute.objects.filter(is_archived=False).exclude(
        status__in=["resolved_contractor", "resolved_homeowner", "resolved_partial", "canceled"]
    )
    rows: list[UnifiedRecommendation] = []
    under_review = active.filter(status="under_review").count()
    escrow_holds = active.filter(escrow_frozen=True).count()
    awaiting_response = active.filter(responded_at__isnull=True).count()
    if under_review:
        rows.append(
            _recommendation(
                key="admin:disputes:under-review",
                type="dispute_risk",
                category="awaiting_admin_review",
                title="Disputes awaiting admin review",
                summary=f"{under_review} dispute(s) are under review.",
                explanation="Review evidence and response status. Recommendations remain advisory and do not determine liability.",
                source="dispute_framework",
                confidence="high",
                severity="high",
                audience="admin",
                object_type="dispute",
                action_label="Open Disputes",
                action_target="/app/admin?view=disputes&status=active",
                metadata={"under_review_count": under_review},
            )
        )
    if escrow_holds:
        rows.append(
            _recommendation(
                key="admin:disputes:escrow-holds",
                type="dispute_risk",
                category="escrow_hold",
                title="Escrow holds need monitoring",
                summary=f"{escrow_holds} active dispute(s) have escrow holds.",
                explanation="Track financial disposition and resolution status before any release/refund action.",
                source="dispute_framework",
                confidence="high",
                severity="high",
                audience="admin",
                object_type="dispute",
                action_label="Open Disputes",
                action_target="/app/admin?view=disputes&status=active",
                metadata={"escrow_hold_count": escrow_holds},
            )
        )
    if awaiting_response:
        rows.append(
            _recommendation(
                key="admin:disputes:awaiting-response",
                type="dispute_risk",
                category="awaiting_response",
                title="Disputes may need party response",
                summary=f"{awaiting_response} active dispute(s) do not have a recorded response.",
                explanation="Use this as an operations queue only; do not infer fault from missing response alone.",
                source="dispute_framework",
                confidence="medium",
                severity="medium",
                audience="admin",
                object_type="dispute",
                action_label="Open Disputes",
                action_target="/app/admin?view=disputes&status=active",
                metadata={"awaiting_response_count": awaiting_response},
            )
        )
    return _sort_and_limit(rows, limit)


def build_admin_recommendations(*, params: dict[str, Any] | None = None, limit: int = 10) -> list[dict[str, Any]]:
    rows: list[dict[str, Any]] = []
    rows.extend(build_marketplace_recommendations(params=params, limit=limit))
    rows.extend(build_admin_dispute_recommendations(limit=limit))
    return _sort_dict_recommendations(rows, limit)


def _sort_dict_recommendations(rows: list[dict[str, Any]], limit: int) -> list[dict[str, Any]]:
    severity_order = {"high": 0, "medium": 1, "low": 2, "info": 3}
    seen = set()
    deduped = []
    for row in rows:
        key = row.get("key") or row.get("id")
        if key in seen:
            continue
        seen.add(key)
        deduped.append(row)
    deduped.sort(key=lambda row: (severity_order.get(row.get("severity"), 9), row.get("title", "")))
    return deduped[: max(0, limit)]


def build_recommendations_for_user(user, *, limit: int = 5) -> list[dict[str, Any]]:
    if not user or not getattr(user, "is_authenticated", False):
        return []
    if getattr(user, "is_staff", False) or getattr(user, "is_superuser", False):
        return build_admin_recommendations(limit=limit)

    contractor = getattr(user, "contractor_profile", None)
    if not contractor:
        return []
    rows: list[dict[str, Any]] = []
    rows.extend(build_contractor_dispute_recommendations(contractor, limit=limit))
    rows.extend(build_contractor_performance_recommendations(contractor, limit=limit))
    rows.extend(build_template_edit_lineage_recommendations(contractor, limit=limit))
    return _sort_dict_recommendations(rows, limit)


def build_customer_recommendations(
    email: str,
    *,
    property_intelligence: dict[str, Any] | None = None,
    limit: int = 5,
) -> list[dict[str, Any]]:
    normalized_email = _safe_text(email).lower()
    if not normalized_email:
        return []
    if not PropertyProfile.objects.filter(customer_email__iexact=normalized_email).exists():
        return [
            _recommendation(
                key=f"customer:{normalized_email}:property-profile",
                type="property_intelligence",
                category="missing_records",
                title="Create a property profile",
                summary="Add the property address and basic details so future recommendations can use the right home record.",
                explanation="Property recommendations are strongest when documents, service history, warranties, and property details are tied to a property profile.",
                source="property_intelligence",
                confidence="low",
                severity="low",
                audience="customer",
                object_type="customer",
                object_id=normalized_email,
                action_label="Open Property Records",
                action_target="portal:property",
                metadata={"has_property_profile": False},
            ).to_dict()
        ][:limit]
    return build_property_recommendations(normalized_email, property_intelligence=property_intelligence, limit=limit)


def recommendation_audit_summary() -> list[dict[str, str]]:
    return [
        {"surface": "Property intelligence", "source": "build_property_intelligence", "shape": "health, insights, buckets", "usage": "Customer Portal Home Records"},
        {"surface": "Contractor performance", "source": "contractor_performance_summary", "shape": "score, confidence, insights, learning_signals", "usage": "Contractor insights/dashboard"},
        {"surface": "Template recommendation", "source": "TemplateRecommendView / template_recommend.py", "shape": "match tier, score, template candidates", "usage": "Agreement Wizard Step 1"},
        {"surface": "Marketplace analytics", "source": "build_marketplace_analytics", "shape": "funnel, city/contractor analytics, attention queues", "usage": "Admin marketplace analytics"},
        {"surface": "Admin operations queues", "source": "_admin_operations_payload", "shape": "kpis and operational queues", "usage": "Admin Operations Center"},
        {"surface": "Project Assistant actions", "source": "buildProjectAssistantActions", "shape": "step actions and other helpful actions", "usage": "Agreement Wizard page guide"},
        {"surface": "Dispute AI advisory", "source": "disputes_recommendation.py", "shape": "neutral advisory option", "usage": "Dispute AI panel"},
        {"surface": "Business dashboard insights", "source": "business_dashboard_insights.py", "shape": "benchmark recommendations", "usage": "Contractor dashboard insights"},
    ]
