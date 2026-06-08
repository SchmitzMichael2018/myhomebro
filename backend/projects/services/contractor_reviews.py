from __future__ import annotations

from django.db import transaction
from django.db.models import Count, Q, Avg
from django.utils import timezone

from projects.models import Agreement, ContractorPublicProfile, ContractorReview, DrawRequest, ExpenseRequest, Homeowner, Invoice, Milestone, ProjectStatus
from projects.models_contractor_discovery import ContractorOpportunity
from projects.models_dispute import Dispute
from projects.models_learning import MilestonePerformanceSnapshot


def _safe_text(value) -> str:
    return ("" if value is None else str(value)).strip()


def _email(value) -> str:
    return _safe_text(value).lower()


def _project_title(agreement: Agreement | None) -> str:
    project = getattr(agreement, "project", None) if agreement else None
    return _safe_text(getattr(project, "title", "")) or f"Agreement #{getattr(agreement, 'id', '')}"


def _is_customer_for_agreement(agreement: Agreement | None, customer_email: str) -> bool:
    if not agreement:
        return False
    normalized = _email(customer_email)
    if not normalized:
        return False
    candidates = {
        _email(getattr(getattr(agreement, "homeowner", None), "email", "")),
        _email(getattr(getattr(agreement, "project", None), "homeowner", None) and getattr(getattr(agreement.project, "homeowner", None), "email", "")),
        _email(getattr(agreement, "report_recipient_email", "")),
    }
    return normalized in {candidate for candidate in candidates if candidate}


def _has_payment_blocker(agreement: Agreement) -> bool:
    invoice_blocker = Invoice.objects.filter(agreement=agreement).exclude(status__in=["paid"]).exists()
    draw_blocker = DrawRequest.objects.filter(agreement=agreement).exclude(status__in=["released", "paid", "rejected"]).exists()
    reimbursement_blocker = ExpenseRequest.objects.filter(agreement=agreement).exclude(
        status__in=[
            ExpenseRequest.Status.RELEASED,
            ExpenseRequest.Status.DENIED,
            ExpenseRequest.Status.CANCELLED,
        ]
    ).exists()
    return bool(invoice_blocker or draw_blocker or reimbursement_blocker)


def review_eligibility(agreement: Agreement | None, customer_email: str) -> dict:
    if not agreement:
        return {"eligible": False, "reason": "Agreement was not found.", "existing_review": None}
    if not _is_customer_for_agreement(agreement, customer_email):
        return {"eligible": False, "reason": "This project is not connected to your customer email.", "existing_review": None}

    normalized_email = _email(customer_email)
    existing_review = (
        ContractorReview.objects.filter(agreement=agreement, customer_email__iexact=normalized_email)
        .order_by("-created_at", "-id")
        .first()
    )
    if existing_review:
        return {
            "eligible": False,
            "reason": "You have already shared feedback for this project.",
            "existing_review": serialize_review(existing_review),
        }

    project = getattr(agreement, "project", None)
    if _safe_text(getattr(agreement, "status", "")).lower() == ProjectStatus.COMPLETED:
        return {"eligible": True, "reason": "Project is complete.", "existing_review": None}
    if project and _safe_text(getattr(project, "status", "")).lower() == ProjectStatus.COMPLETED:
        return {"eligible": True, "reason": "Project is complete.", "existing_review": None}

    milestones = list(Milestone.objects.filter(agreement=agreement).only("id", "completed", "completed_at"))
    if milestones and all(bool(m.completed) or bool(m.completed_at) for m in milestones) and not _has_payment_blocker(agreement):
        return {"eligible": True, "reason": "Project milestones and payment reviews are complete.", "existing_review": None}

    return {"eligible": False, "reason": "Reviews unlock after the project and final payment/release are complete.", "existing_review": None}


def serialize_review(review: ContractorReview | None) -> dict | None:
    if not review:
        return None
    return {
        "id": review.id,
        "rating": review.rating,
        "title": review.title,
        "review_text": review.review_text,
        "customer_name": review.customer_name,
        "customer_email": review.customer_email,
        "moderation_status": review.moderation_status,
        "status_label": review.get_moderation_status_display(),
        "is_public": bool(review.is_public),
        "is_verified": bool(review.is_verified),
        "submitted_at": review.submitted_at.isoformat() if review.submitted_at else None,
        "published_at": review.published_at.isoformat() if review.published_at else None,
    }


@transaction.atomic
def submit_customer_review(*, agreement: Agreement, customer_email: str, rating: int, title: str = "", review_text: str = "", customer_name: str = "") -> ContractorReview:
    eligibility = review_eligibility(agreement, customer_email)
    if not eligibility.get("eligible"):
        raise ValueError(eligibility.get("reason") or "This project is not eligible for review yet.")
    try:
        rating_value = int(rating)
    except Exception as exc:
        raise ValueError("Rating must be between 1 and 5.") from exc
    if rating_value < 1 or rating_value > 5:
        raise ValueError("Rating must be between 1 and 5.")

    contractor = getattr(agreement, "contractor", None) or getattr(getattr(agreement, "project", None), "contractor", None)
    if not contractor:
        raise ValueError("Agreement is missing contractor.")
    homeowner = getattr(agreement, "homeowner", None)
    if homeowner and not _is_customer_for_agreement(agreement, customer_email):
        raise ValueError("Only the project customer can leave a review.")
    if getattr(contractor, "user", None) and _email(getattr(contractor.user, "email", "")) == _email(customer_email):
        raise ValueError("Contractors cannot review their own projects.")

    profile, _created = ContractorPublicProfile.objects.get_or_create(contractor=contractor)
    review, created = ContractorReview.objects.get_or_create(
        agreement=agreement,
        customer_email=_email(customer_email),
        defaults={
            "contractor": contractor,
            "public_profile": profile,
            "homeowner": homeowner,
            "customer_name": _safe_text(customer_name) or _safe_text(getattr(homeowner, "full_name", "")) or "Customer",
            "rating": rating_value,
            "title": _safe_text(title)[:255],
            "review_text": _safe_text(review_text),
            "project_type": _safe_text(getattr(agreement, "project_type", "")),
            "project_subtype": _safe_text(getattr(agreement, "project_subtype", "")),
            "is_verified": True,
            "is_public": False,
            "moderation_status": ContractorReview.MODERATION_PENDING,
        },
    )
    if not created:
        raise ValueError("You have already shared feedback for this project.")
    return review


def moderate_review(review: ContractorReview, *, action: str, moderator=None, notes: str = "") -> ContractorReview:
    normalized = _safe_text(action).lower()
    status_map = {
        "approve": ContractorReview.MODERATION_APPROVED,
        "publish": ContractorReview.MODERATION_APPROVED,
        "hide": ContractorReview.MODERATION_HIDDEN,
        "unpublish": ContractorReview.MODERATION_HIDDEN,
        "reject": ContractorReview.MODERATION_REJECTED,
    }
    if normalized not in status_map:
        raise ValueError("Unknown review moderation action.")
    review.moderation_status = status_map[normalized]
    review.moderation_notes = _safe_text(notes)
    review.moderated_by = moderator
    review.moderated_at = timezone.now()
    review.save(update_fields=[
        "moderation_status",
        "moderation_notes",
        "moderated_by",
        "moderated_at",
        "is_public",
        "published_at",
        "updated_at",
    ])
    return review


def _clamp(value: float, low: float = 0.0, high: float = 1.0) -> float:
    try:
        number = float(value)
    except Exception:
        number = 0.0
    return max(low, min(high, number))


def _percent(value: float | None) -> int | None:
    if value is None:
        return None
    return int(round(_clamp(value) * 100))


def _average(values) -> float | None:
    numbers = [float(value) for value in values if value is not None]
    if not numbers:
        return None
    return round(sum(numbers) / len(numbers), 2)


def _confidence_level(*, completed_projects: int, review_count: int, completed_milestones: int, marketplace_bid_count: int) -> str:
    activity_points = completed_projects + min(completed_milestones, 20) / 5 + min(marketplace_bid_count, 20) / 4
    if completed_projects >= 10 and review_count >= 10 and activity_points >= 16:
        return "high"
    if completed_projects >= 3 or review_count >= 3 or marketplace_bid_count >= 5 or completed_milestones >= 10:
        return "medium"
    return "low"


def _confidence_label(level: str) -> str:
    return {
        "high": "High Confidence",
        "medium": "Medium Confidence",
        "low": "Low Confidence",
    }.get(level, "Low Confidence")


def _build_performance_insights(summary: dict) -> list[dict]:
    insights: list[dict] = []
    review_count = int(summary.get("review_count") or 0)
    avg = summary.get("average_rating")
    dispute_rate = float(summary.get("dispute_rate") or 0)
    on_time_rate = summary.get("on_time_milestone_rate")
    win_rate = summary.get("marketplace_bid_win_rate")
    payment_issues = int(summary.get("reimbursement_issue_count") or 0) + int(summary.get("payment_issue_count") or 0)

    if avg is not None and review_count >= 3 and float(avg) >= 4.7:
        insights.append({"tone": "positive", "title": "Strong customer satisfaction", "body": "Recent approved reviews point to a consistently strong customer experience."})
    if review_count < 3:
        insights.append({"tone": "info", "title": "Build review confidence", "body": "More completed projects and approved reviews will make this score more reliable."})
    if dispute_rate >= 0.15:
        insights.append({"tone": "warning", "title": "Reduce dispute risk", "body": "Open or recent disputes are pulling down reliability. Review scope clarity and customer expectations."})
    if on_time_rate is not None and on_time_rate < 0.8:
        insights.append({"tone": "warning", "title": "Improve milestone completion timing", "body": "Milestone snapshots show delayed completion. Tighten schedules or set clearer timeline expectations."})
    if win_rate is not None and summary.get("marketplace_bid_count", 0) >= 5 and win_rate < 0.2:
        insights.append({"tone": "info", "title": "Improve bid conversion", "body": "Bid win rate is low. Review proposal detail, timing, and pricing clarity."})
    if payment_issues:
        insights.append({"tone": "warning", "title": "Resolve payment release issues", "body": "Reimbursement or payment release issues should be reviewed before scaling more marketplace work."})
    if not insights:
        insights.append({"tone": "neutral", "title": "No major performance flags", "body": "Current available data does not show a clear performance issue."})
    return insights[:5]


def contractor_performance_summary(contractor) -> dict:
    agreement_qs = Agreement.objects.filter(contractor=contractor)
    agreement_count = agreement_qs.count()
    completed_projects = agreement_qs.filter(status=ProjectStatus.COMPLETED).count()
    dispute_count = Dispute.objects.filter(agreement__contractor=contractor).exclude(status="canceled").count()
    snapshots = MilestonePerformanceSnapshot.objects.filter(contractor=contractor)
    completed_milestones = snapshots.filter(contractor_completed_at__isnull=False).count()
    delayed_milestones = snapshots.filter(is_delayed=True).count()
    on_time_rate = None
    if completed_milestones:
        on_time_rate = round((completed_milestones - delayed_milestones) / completed_milestones, 3)
    avg_completion_lag = _average(snapshots.exclude(planned_vs_actual_completion_days__isnull=True).values_list("planned_vs_actual_completion_days", flat=True)[:200])
    review_stats = ContractorReview.objects.filter(contractor=contractor, is_verified=True, is_public=True).aggregate(
        review_count=Count("id"),
        average_rating=Avg("rating"),
    )
    review_count = int(review_stats.get("review_count") or getattr(contractor, "review_count", 0) or 0)
    average_rating = review_stats.get("average_rating")
    if average_rating is None and getattr(contractor, "review_count", 0):
        average_rating = getattr(contractor, "average_rating", None)
    bid_count = 0
    win_count = 0
    opportunity_count = ContractorOpportunity.objects.filter(
        Q(accepted_by_contractor=contractor) | Q(directory_entry__claimed_by_contractor=contractor)
    ).distinct().count()
    try:
        from projects.models import PublicContractorLead

        bid_count = PublicContractorLead.objects.filter(contractor=contractor).count()
        win_count = PublicContractorLead.objects.filter(contractor=contractor, converted_agreement__isnull=False).count()
    except Exception:
        pass
    reimbursement_issue_count = ExpenseRequest.objects.filter(
        agreement__contractor=contractor,
    ).filter(Q(status=ExpenseRequest.Status.HELD) | ~Q(release_error="")).count()
    payment_issue_count = Invoice.objects.filter(agreement__contractor=contractor).filter(
        Q(status__in=["failed", "disputed"]) | Q(disputed=True)
    ).count()
    completion_rate = round(completed_projects / agreement_count, 3) if agreement_count else None
    dispute_rate = round(dispute_count / agreement_count, 3) if agreement_count else 0
    marketplace_win_rate = round(win_count / bid_count, 3) if bid_count else None

    # Advisory score formula, 0-100:
    # Customer Satisfaction 35%: approved review rating, neutral when sparse.
    # Reliability 30%: dispute rate and completion rate.
    # Delivery 20%: milestone on-time rate and average completion lag when available.
    # Marketplace 15%: bid win rate once enough bids exist.
    # Missing data uses neutral defaults so new contractors are low-confidence, not unfairly low-score.
    satisfaction_base = _clamp((float(average_rating) / 5) if average_rating is not None else 0.78)
    reliability_base = _clamp(((1 - min(dispute_rate * 2, 1)) * 0.65) + ((completion_rate if completion_rate is not None else 0.75) * 0.35))
    delivery_base = on_time_rate if on_time_rate is not None else 0.75
    if avg_completion_lag is not None and avg_completion_lag > 0:
        delivery_base = _clamp(float(delivery_base) - min(float(avg_completion_lag) * 0.03, 0.25))
    delivery_base = _clamp(delivery_base)
    marketplace_base = marketplace_win_rate if marketplace_win_rate is not None else 0.75
    component_scores = {
        "customer_satisfaction": round(satisfaction_base * 35, 1),
        "reliability": round(reliability_base * 30, 1),
        "delivery": round(delivery_base * 20, 1),
        "marketplace": round(_clamp(marketplace_base) * 15, 1),
    }
    performance_score = int(round(sum(component_scores.values())))
    confidence = _confidence_level(
        completed_projects=completed_projects,
        review_count=review_count,
        completed_milestones=completed_milestones,
        marketplace_bid_count=bid_count,
    )
    summary = {
        "performance_score": performance_score,
        "score": performance_score,
        "score_components": component_scores,
        "score_formula": "35% customer satisfaction, 30% reliability, 20% delivery, 15% marketplace conversion; sparse data uses neutral defaults and lowers confidence instead of hard-penalizing score.",
        "confidence": confidence,
        "confidence_label": _confidence_label(confidence),
        "average_rating": round(float(average_rating), 2) if average_rating is not None else None,
        "review_rating": round(float(average_rating), 2) if average_rating is not None else None,
        "review_count": review_count,
        "completed_projects": completed_projects,
        "completed_milestones": completed_milestones,
        "dispute_count": dispute_count,
        "dispute_rate": dispute_rate,
        "completion_rate": completion_rate,
        "on_time_milestone_rate": on_time_rate,
        "on_time_milestone_percent": _percent(on_time_rate),
        "delayed_milestones": delayed_milestones,
        "avg_milestone_completion_lag_days": avg_completion_lag,
        "average_completion_lag_days": avg_completion_lag,
        "marketplace_opportunities": opportunity_count,
        "marketplace_bid_count": bid_count,
        "marketplace_bid_win_count": win_count,
        "marketplace_bid_win_rate": marketplace_win_rate,
        "marketplace_bid_win_percent": _percent(marketplace_win_rate),
        "reimbursement_issue_count": reimbursement_issue_count,
        "payment_issue_count": payment_issue_count,
        "data_status": "limited" if confidence == "low" else "established" if confidence == "high" else "developing",
    }
    summary["insights"] = _build_performance_insights(summary)
    summary["learning_signals"] = {
        "consistently_strong_reviews": bool(summary["average_rating"] is not None and summary["average_rating"] >= 4.7 and review_count >= 3),
        "timeline_risk": bool(on_time_rate is not None and on_time_rate < 0.8),
        "dispute_risk": bool(dispute_rate >= 0.15),
        "marketplace_conversion_risk": bool(marketplace_win_rate is not None and bid_count >= 5 and marketplace_win_rate < 0.2),
        "payment_release_risk": bool(reimbursement_issue_count or payment_issue_count),
    }
    return summary
