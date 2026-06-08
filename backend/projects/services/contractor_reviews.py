from __future__ import annotations

from decimal import Decimal

from django.db import transaction
from django.db.models import Count, Q
from django.utils import timezone

from projects.models import Agreement, ContractorPublicProfile, ContractorReview, DrawRequest, ExpenseRequest, Homeowner, Invoice, Milestone, ProjectStatus
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


def contractor_performance_summary(contractor) -> dict:
    agreement_qs = Agreement.objects.filter(contractor=contractor)
    completed_projects = agreement_qs.filter(status=ProjectStatus.COMPLETED).count()
    dispute_count = Dispute.objects.filter(agreement__contractor=contractor).exclude(status="canceled").count()
    agreement_count = agreement_qs.count()
    snapshots = MilestonePerformanceSnapshot.objects.filter(contractor=contractor)
    completed_milestones = snapshots.filter(contractor_completed_at__isnull=False).count()
    delayed_milestones = snapshots.filter(is_delayed=True).count()
    on_time_rate = None
    if completed_milestones:
        on_time_rate = round((completed_milestones - delayed_milestones) / completed_milestones, 3)
    review_stats = ContractorReview.objects.filter(contractor=contractor, is_verified=True, is_public=True).aggregate(
        review_count=Count("id"),
    )
    bid_count = 0
    win_count = 0
    try:
        from projects.models import PublicContractorLead

        bid_count = PublicContractorLead.objects.filter(contractor=contractor).count()
        win_count = PublicContractorLead.objects.filter(contractor=contractor, converted_agreement__isnull=False).count()
    except Exception:
        pass
    return {
        "average_rating": round(float(getattr(contractor, "average_rating", 0) or 0), 2) if getattr(contractor, "review_count", 0) else None,
        "review_count": int(review_stats.get("review_count") or getattr(contractor, "review_count", 0) or 0),
        "completed_projects": completed_projects,
        "completed_milestones": completed_milestones,
        "dispute_count": dispute_count,
        "dispute_rate": round(dispute_count / agreement_count, 3) if agreement_count else 0,
        "on_time_milestone_rate": on_time_rate,
        "delayed_milestones": delayed_milestones,
        "marketplace_bid_count": bid_count,
        "marketplace_bid_win_count": win_count,
        "marketplace_bid_win_rate": round(win_count / bid_count, 3) if bid_count else None,
        "data_status": "limited" if completed_projects < 3 or int(getattr(contractor, "review_count", 0) or 0) < 3 else "established",
    }
