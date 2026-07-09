from __future__ import annotations

from typing import Any, Dict, Iterable, List


PLATFORM_HEALTH_CATEGORIES = [
    ("payments_stripe", "Payments / Stripe"),
    ("webhooks", "Webhooks"),
    ("notifications", "Notifications"),
    ("documents_pdfs", "Documents / PDFs"),
    ("background_jobs", "Background jobs"),
    ("support_sync", "Support sync"),
    ("storage", "Storage"),
    ("api_errors", "API errors"),
]


HUMAN_ONLY_ADMIN_ACTIONS = [
    "Verify, reject, suspend, or unsuspend contractors",
    "Route marketplace requests",
    "Release reimbursements, refunds, payouts, or held funds",
    "Close resolution cases or decide warranty coverage",
    "Send customer, contractor, or marketplace-wide messages",
    "Change marketplace, payment, or platform settings",
]


def _num(value: Any) -> float:
    if value is None:
        return 0
    try:
        return float(str(value).replace(",", ""))
    except (TypeError, ValueError):
        return 0


def _int(value: Any) -> int:
    return int(_num(value))


def _items(rows: Iterable[dict] | None, limit: int = 5) -> List[dict]:
    return [row for row in list(rows or [])[:limit] if isinstance(row, dict)]


def _attention_item(
    key: str,
    category: str,
    severity: str,
    title: str,
    why: str,
    source: str,
    route: str,
    count: int | None = None,
) -> dict:
    return {
        "key": key,
        "category": category,
        "severity": severity,
        "title": title,
        "why": why,
        "source": source,
        "route": route,
        "count": count,
        "requires_human_approval": True,
    }


def build_marketplace_operations_center(
    *,
    operations: Dict[str, Any] | None,
    summary: Dict[str, Any] | None = None,
    money: Dict[str, Any] | None = None,
    warranty: Dict[str, Any] | None = None,
    support: Dict[str, Any] | None = None,
    generated_at: str | None = None,
) -> dict:
    """
    Compose the Admin overview's operational data into a stable Operations Center
    contract. This is an advisory/read-only layer: it does not perform admin,
    financial, marketplace, warranty, or resolution actions.
    """
    operations = operations or {}
    summary = summary or {}
    money = money or {}
    warranty = warranty or {}
    support = support or {}

    marketplace = operations.get("marketplace") or {}
    payments = operations.get("payments") or {}
    maintenance = operations.get("maintenance") or {}
    disputes = operations.get("disputes") or {}
    reviews = operations.get("reviews") or {}
    users = operations.get("users") or {}
    recommendations = [row for row in operations.get("recommendations") or [] if isinstance(row, dict)]

    marketplace_kpis = marketplace.get("kpis") or {}
    marketplace_health = marketplace.get("health") or {}
    payment_kpis = payments.get("kpis") or {}
    maintenance_kpis = maintenance.get("kpis") or {}
    dispute_kpis = disputes.get("kpis") or {}
    review_kpis = reviews.get("kpis") or {}
    user_kpis = users.get("kpis") or {}
    warranty_kpis = warranty.get("kpis") or {}
    support_kpis = support.get("kpis") or {}

    attention_queue: List[dict] = []
    pending_verification = _int(marketplace_kpis.get("verification_queue") or user_kpis.get("contractors_pending_verification"))
    if pending_verification:
        attention_queue.append(_attention_item(
            "contractor-verification",
            "Marketplace",
            "high" if pending_verification >= 5 else "medium",
            f"{pending_verification} contractor verification item(s)",
            "Marketplace readiness depends on human review of contractor verification state.",
            "Contractor marketplace verification",
            "/app/admin/marketplace/verification",
            pending_verification,
        ))

    saved_backlog = _int(marketplace_kpis.get("saved_request_backlog"))
    if saved_backlog:
        attention_queue.append(_attention_item(
            "saved-marketplace-routing",
            "Marketplace",
            "high" if saved_backlog >= 5 else "medium",
            f"{saved_backlog} saved marketplace request(s)",
            "Saved intake should be reviewed before routing to contractors.",
            "Saved marketplace request backlog",
            "/app/admin/marketplace",
            saved_backlog,
        ))

    zero_bid = _int(marketplace_health.get("requests_with_zero_bids"))
    if zero_bid:
        attention_queue.append(_attention_item(
            "zero-bid-requests",
            "Marketplace",
            "high",
            f"{zero_bid} zero-bid request(s)",
            "Requests with no bid coverage can stall demand and damage marketplace trust.",
            "Marketplace analytics",
            "/app/admin/marketplace/analytics",
            zero_bid,
        ))

    failed_releases = _int(payment_kpis.get("failed_releases"))
    if failed_releases:
        attention_queue.append(_attention_item(
            "failed-reimbursement-release",
            "Financial Operations",
            "high",
            f"{failed_releases} failed reimbursement release(s)",
            "Failed transfer records need investigation before any retry or manual release.",
            "Escrow reimbursement release queue",
            "/app/admin/reimbursements",
            failed_releases,
        ))

    held_reimbursements = _int(payment_kpis.get("held_reimbursements"))
    if held_reimbursements:
        attention_queue.append(_attention_item(
            "held-reimbursements",
            "Financial Operations",
            "medium",
            f"{held_reimbursements} held reimbursement(s)",
            "Held reimbursements may be blocked by disputes, escrow availability, or admin hold reasons.",
            "Escrow reimbursement holds",
            "/app/admin/reimbursements",
            held_reimbursements,
        ))

    awaiting_review = _int(dispute_kpis.get("awaiting_review"))
    open_resolution = _int(dispute_kpis.get("open_disputes") or summary.get("open_disputes"))
    if awaiting_review or open_resolution:
        attention_queue.append(_attention_item(
            "resolution-review",
            "Resolution",
            "high" if awaiting_review else "medium",
            f"{awaiting_review or open_resolution} resolution case(s) need review",
            "Open cases can affect customer trust, contractor trust, and payment holds.",
            "Resolution case queue",
            "/app/admin?view=disputes&status=active",
            awaiting_review or open_resolution,
        ))

    overdue_warranty = _int(warranty_kpis.get("overdue_requests") or 0)
    escalated_warranty = _int(warranty_kpis.get("escalated_requests") or 0)
    if overdue_warranty or escalated_warranty:
        attention_queue.append(_attention_item(
            "warranty-oversight",
            "Warranty",
            "high" if escalated_warranty else "medium",
            f"{overdue_warranty + escalated_warranty} warranty item(s) need oversight",
            "Overdue or escalated warranty work can become resolution pressure.",
            "Warranty request records",
            "/app/admin?view=overview#warranty-oversight",
            overdue_warranty + escalated_warranty,
        ))

    overdue_work_orders = _int(maintenance_kpis.get("overdue_work_orders"))
    if overdue_work_orders:
        attention_queue.append(_attention_item(
            "overdue-maintenance",
            "Property Operations",
            "medium",
            f"{overdue_work_orders} overdue maintenance work order(s)",
            "Overdue service should be reviewed for contractor/customer follow-up risk.",
            "Maintenance work order queue",
            "/app/admin/maintenance",
            overdue_work_orders,
        ))

    pending_reviews = _int(review_kpis.get("pending_reviews"))
    if pending_reviews:
        attention_queue.append(_attention_item(
            "review-moderation",
            "Trust",
            "medium",
            f"{pending_reviews} review(s) awaiting moderation",
            "Pending reviews affect public trust and contractor reputation.",
            "Contractor review moderation",
            "/app/admin/reviews",
            pending_reviews,
        ))

    open_support = _int(support_kpis.get("open_tickets"))
    urgent_support = _int(support_kpis.get("urgent_tickets"))
    if open_support:
        attention_queue.append(_attention_item(
            "support-pressure",
            "Support",
            "high" if urgent_support else "medium",
            f"{open_support} open support ticket(s)",
            "Support pressure can reveal account, payment, or technical problems before metrics catch up.",
            "Support ticket queue",
            "/app/support",
            open_support,
        ))

    platform_health = {
        "summary": "No connected platform-health monitor is configured yet. Available records are shown without inventing monitoring data.",
        "categories": [
            {
                "key": key,
                "label": label,
                "status": "not_connected",
                "message": "Not connected yet",
                "source": "No dedicated monitoring source configured",
            }
            for key, label in PLATFORM_HEALTH_CATEGORIES
        ],
    }
    if failed_releases:
        platform_health["categories"][0].update({
            "status": "attention",
            "message": f"{failed_releases} failed reimbursement release(s) from available payment records",
            "source": "Expense reimbursement release records",
        })
    if urgent_support or open_support:
        platform_health["categories"][5].update({
            "status": "attention" if urgent_support else "ok",
            "message": f"{urgent_support or open_support} support ticket signal(s) from available records",
            "source": "Support tickets",
        })

    financial_operations = {
        "kpis": {
            "pending_reimbursements": _int(payment_kpis.get("pending_reimbursement_releases")),
            "failed_releases": failed_releases,
            "held_funds": held_reimbursements,
            "dispute_payment_holds": _int(dispute_kpis.get("escalated_disputes")),
            "fee_mismatches": _int(payment_kpis.get("fee_mismatches")),
            "escrow_in_flight_total": money.get("escrow_in_flight_total", "0.00"),
        },
        "queues": {
            "pending_releases": _items(payments.get("pending_releases")),
            "failed": _items(payments.get("failed")),
            "held": _items(payments.get("held")),
        },
        "links": [
            {"label": "Reimbursements", "route": "/app/admin/reimbursements"},
            {"label": "Fee ledger", "route": "/app/admin?view=fee_audit"},
            {"label": "Agreements with escrow", "route": "/app/admin?view=agreements&escrow_status=in_flight"},
        ],
    }

    resolution_oversight = {
        "kpis": {
            "open_cases": open_resolution,
            "awaiting_admin_review": awaiting_review,
            "payment_impact_cases": _int(dispute_kpis.get("escalated_disputes")),
            "missing_evidence_cases": _int(dispute_kpis.get("missing_evidence_cases")),
            "oldest_case_age_days": max([_int(row.get("age_days")) for row in disputes.get("open", [])] or [0]),
        },
        "queues": {
            "awaiting_admin_review": _items(disputes.get("awaiting_admin_review")),
            "awaiting_response": _items(disputes.get("awaiting_response")),
            "open": _items(disputes.get("open")),
        },
        "guardrail": "Resolution recommendations are advisory. Humans decide accept, reject, counter, or escalate.",
    }

    warranty_oversight = {
        "kpis": {
            "open_requests": _int(warranty_kpis.get("open_requests")),
            "overdue_requests": overdue_warranty,
            "escalated_requests": escalated_warranty,
            "repair_overdue": _int(warranty_kpis.get("repair_overdue")),
            "warranty_to_resolution": _int(warranty_kpis.get("warranty_to_resolution")),
            "maintenance_overdue": overdue_work_orders,
        },
        "queues": {
            "overdue": _items(warranty.get("overdue")),
            "escalated": _items(warranty.get("escalated")),
            "repair_overdue": _items(warranty.get("repair_overdue")),
        },
        "fallback": "Maintenance overdue counts are shown as property-operations context when warranty request data is not available.",
    }

    audit_activity = {
        "status": "foundation",
        "summary": "Unified admin action audit log is not connected yet. Showing recent advisory and operations signals only.",
        "items": [
            {
                "label": row.get("title") or "Admin advisory signal",
                "source": row.get("source") or "admin_operations",
                "generated_at": row.get("generated_at") or generated_at,
                "route": row.get("action_target") or "",
            }
            for row in recommendations[:5]
        ],
    }

    top_categories = sorted(
        {item["category"]: item for item in attention_queue}.values(),
        key=lambda row: ["critical", "high", "medium", "low"].index(row["severity"]) if row["severity"] in {"critical", "high", "medium", "low"} else 4,
    )
    highest = top_categories[0] if top_categories else None
    advisor = {
        "role": "Marketplace Operations Advisor",
        "summary": (
            f"{highest['category']} is the highest-priority area from available admin records: {highest['title']}."
            if highest
            else "No urgent marketplace operations issues were detected from available admin records."
        ),
        "recommendations": [
            {
                "title": item["title"],
                "why": item["why"],
                "route": item["route"],
                "category": item["category"],
                "severity": item["severity"],
            }
            for item in attention_queue[:5]
        ],
        "evidence": [
            {"label": "Admin overview operations payload", "type": "source", "status": "available"},
            {"label": "Marketplace analytics and routing queues", "type": "source", "status": "available"},
            {"label": "Payment/reimbursement queues", "type": "source", "status": "available"},
            {"label": "Dedicated platform monitoring", "type": "source", "status": "not connected yet"},
        ],
        "confidence": "medium" if attention_queue else "needs_more_information",
        "missing_information": [
            "Dedicated webhook, notification, PDF, background job, storage, and API error monitoring",
            "Granular admin action audit log",
            "Granular admin role permissions",
        ],
        "human_only_actions": HUMAN_ONLY_ADMIN_ACTIONS,
        "safe_prepared_actions": [
            "Prepare investigation checklist",
            "Open source records for human review",
            "Summarize risks and missing evidence",
            "Draft internal notes for review",
        ],
    }

    return {
        "label": "Marketplace Operations Center",
        "generated_at": generated_at,
        "attention_queue": attention_queue[:12],
        "financial_operations": financial_operations,
        "resolution_oversight": resolution_oversight,
        "warranty_oversight": warranty_oversight,
        "platform_health": platform_health,
        "audit_activity": audit_activity,
        "advisor": advisor,
    }
