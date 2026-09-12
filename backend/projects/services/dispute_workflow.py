from __future__ import annotations

from datetime import timedelta
from decimal import Decimal, InvalidOperation
from typing import Iterable

from django.conf import settings
from django.db import transaction
from django.db.models import Q
from django.utils import timezone

from projects.models_dispute import Dispute, DisputeClaim, DisputePaymentHold, ResolutionCaseTimelineEvent
from projects.services.dispute_status import is_active_dispute_status


ACTIVE_HOLD_STATUSES = {
    DisputePaymentHold.STATUS_TEMPORARY,
    DisputePaymentHold.STATUS_CONTINUED,
    DisputePaymentHold.STATUS_EXPIRATION_PENDING,
}

URGENT_TERMS = {
    "active damage",
    "active leak",
    "code danger",
    "electrical danger",
    "fire hazard",
    "fraud",
    "harassment",
    "immediate danger",
    "serious misconduct",
    "threat",
    "unsafe",
    "unauthorized payment",
}


def _money_to_cents(value) -> int:
    try:
        amount = Decimal(str(value or "0"))
    except (InvalidOperation, TypeError, ValueError):
        return 0
    return max(int((amount * Decimal("100")).quantize(Decimal("1"))), 0)


def add_business_days(value, days: int):
    """Add weekdays while preserving the supplied local time."""
    current = value
    remaining = max(int(days or 0), 0)
    while remaining:
        current += timedelta(days=1)
        if current.weekday() < 5:
            remaining -= 1
    return current


def qualification_business_days() -> int:
    return max(int(getattr(settings, "DISPUTE_QUALIFICATION_BUSINESS_DAYS", 3)), 1)


def qualification_grace_hours() -> int:
    return max(int(getattr(settings, "DISPUTE_QUALIFICATION_GRACE_HOURS", 24)), 1)


def contractor_response_business_days() -> int:
    return max(int(getattr(settings, "DISPUTE_CONTRACTOR_RESPONSE_BUSINESS_DAYS", 3)), 1)


def dispute_has_financial_source(dispute: Dispute) -> bool:
    return bool(
        getattr(dispute, "milestone_id", None)
        or getattr(dispute, "payment_request_id", None)
        or getattr(dispute, "draw_request_id", None)
        or getattr(dispute, "expense_id", None)
    )


def source_is_hold_eligible(dispute: Dispute) -> bool:
    """Return whether the identified source is still in a platform-controlled review/payment state."""
    invoice = getattr(dispute, "payment_request", None)
    if invoice is not None:
        status = str(getattr(invoice, "status", "") or "").lower()
        return not bool(getattr(invoice, "escrow_released", False)) and status != "paid"
    draw = getattr(dispute, "draw_request", None)
    if draw is not None:
        return str(getattr(draw, "status", "") or "").lower() not in {"released", "paid", "refunded"}
    expense = getattr(dispute, "expense", None)
    if expense is not None:
        return str(getattr(expense, "status", "") or "").lower() not in {"paid", "refunded"}
    milestone = getattr(dispute, "milestone", None)
    if milestone is not None:
        try:
            linked_invoice = milestone.invoice
        except Exception:
            linked_invoice = None
        if linked_invoice is not None:
            status = str(getattr(linked_invoice, "status", "") or "").lower()
            if getattr(linked_invoice, "escrow_released", False) or status == "paid":
                return False
        return True
    return False


def infer_hold_amount_cents(dispute: Dispute) -> int:
    for obj_name, amount_fields in (
        ("payment_request", ("amount",)),
        ("draw_request", ("net_amount", "current_requested_amount", "this_draw_amount")),
        ("expense", ("approved_amount", "amount")),
        ("milestone", ("amount",)),
    ):
        obj = getattr(dispute, obj_name, None)
        if obj is None:
            continue
        for field_name in amount_fields:
            cents = _money_to_cents(getattr(obj, field_name, None))
            if cents:
                return cents
    return 0


def _initial_claim(dispute: Dispute) -> DisputeClaim:
    claim, _ = DisputeClaim.objects.get_or_create(
        dispute=dispute,
        sequence=1,
        defaults={
            "description": (dispute.description or dispute.reason or "Reported concern").strip(),
            "expected_result": (getattr(dispute, "expected_result", "") or "").strip(),
            "requested_remedy": (getattr(dispute, "requested_resolution", "") or "").strip(),
        },
    )
    return claim


def detect_urgent_review(dispute: Dispute) -> tuple[bool, str]:
    if getattr(dispute, "urgent_review", False):
        return True, (getattr(dispute, "urgent_reason", "") or "Urgent review requested.").strip()
    text = " ".join(
        str(value or "").lower()
        for value in (dispute.reason, dispute.description, getattr(dispute, "urgent_reason", ""))
    )
    matches = sorted(term for term in URGENT_TERMS if term in text)
    if matches:
        return True, f"Potential urgent condition reported: {', '.join(matches)}."
    return False, ""


def qualification_missing_information(dispute: Dispute) -> list[str]:
    missing: list[str] = []
    description = str(dispute.description or "").strip()
    expected = str(getattr(dispute, "expected_result", "") or "").strip()
    remedy = str(getattr(dispute, "requested_resolution", "") or "").strip()
    unavailable = str(getattr(dispute, "evidence_unavailable_reason", "") or "").strip()
    prior_notice = str(getattr(dispute, "prior_notice_explanation", "") or "").strip()

    if not dispute_has_financial_source(dispute) and dispute.source_type != Dispute.SOURCE_GENERAL_PROJECT_ISSUE:
        missing.append("Identify the milestone or payment connected to this concern.")
    elif dispute_has_financial_source(dispute) and not source_is_hold_eligible(dispute):
        missing.append(
            "This payment source is outside the platform review window. Preserve the concern as a project or warranty record instead."
        )
    if len(description) < 15:
        missing.append("Describe the specific defective, incomplete, delayed, damaged, or unauthorized condition.")
    if not expected:
        missing.append("Explain what the agreement or milestone required instead.")
    if not remedy:
        missing.append("State the correction or resolution requested.")
    has_evidence = bool(dispute.attachments.exists() or dispute.evidence_index.exists())
    if not has_evidence and not unavailable:
        missing.append("Provide relevant supporting information or explain why it is unavailable or not applicable.")
    if getattr(dispute, "contractor_notified", None) is None and not prior_notice:
        missing.append("Confirm whether the contractor was notified, or explain why prior notice was impractical.")
    return missing


@transaction.atomic
def initialize_dispute_workflow(dispute: Dispute, *, now=None) -> Dispute:
    """Initialize qualification and a source-scoped administrative hold."""
    now = now or timezone.now()
    dispute = Dispute.objects.select_for_update().get(pk=dispute.pk)
    if dispute.qualification_started_at:
        # Older clients may still call the retired pay-fee endpoint. Never let
        # that reset a live qualification clock or reactivate a released hold.
        _initial_claim(dispute)
        return dispute
    dispute.ensure_public_token()
    urgent, urgent_reason = detect_urgent_review(dispute)
    has_source = dispute_has_financial_source(dispute)
    payment_mode = str(getattr(dispute.agreement, "payment_mode", "escrow") or "escrow").strip().lower()
    has_platform_hold = has_source and source_is_hold_eligible(dispute) and payment_mode != "direct"

    dispute.fee_amount = Decimal("0.00")
    dispute.fee_paid = True  # compatibility: participation is no longer fee-gated
    dispute.fee_paid_at = now
    dispute.status = "open"
    dispute.qualification_started_at = now
    dispute.qualification_due_at = add_business_days(now, qualification_business_days())
    dispute.workflow_stage = Dispute.STAGE_CUSTOMER_INFORMATION
    dispute.urgent_review = urgent
    dispute.urgent_reason = urgent_reason
    dispute.qualification_status = (
        Dispute.QUALIFICATION_URGENT_REVIEW if urgent else Dispute.QUALIFICATION_PENDING
    )
    dispute.escrow_frozen = bool(has_platform_hold)
    dispute.last_activity_at = now
    dispute.save(
        update_fields=[
            "public_token",
            "fee_amount",
            "fee_paid",
            "fee_paid_at",
            "status",
            "qualification_started_at",
            "qualification_due_at",
            "qualification_status",
            "workflow_stage",
            "urgent_review",
            "urgent_reason",
            "escrow_frozen",
            "last_activity_at",
            "updated_at",
        ]
    )

    hold_status = DisputePaymentHold.STATUS_TEMPORARY if has_platform_hold else DisputePaymentHold.STATUS_NO_HOLD
    DisputePaymentHold.objects.update_or_create(
        dispute=dispute,
        defaults={
            "milestone": dispute.milestone,
            "invoice": dispute.payment_request,
            "draw_request": dispute.draw_request,
            "expense": dispute.expense,
            "amount_cents": infer_hold_amount_cents(dispute),
            "status": hold_status,
            "release_due_at": None,
            "released_at": None,
            "release_reason": "",
        },
    )
    _initial_claim(dispute)
    assessed = assess_dispute_qualification(dispute, now=now)
    hold = assessed.payment_hold
    ResolutionCaseTimelineEvent.objects.create(
        dispute=assessed,
        event_type=ResolutionCaseTimelineEvent.EVENT_PAYMENT_HOLD_APPLIED,
        title="Source-specific administrative hold evaluated",
        description=(
            "A temporary hold was applied only to the identified payment source."
            if hold.is_active
            else "No platform payment hold was applied to this documentation record."
        ),
        related_object_type="DisputePaymentHold",
        related_object_id=hold.id,
        metadata={
            "hold_status": hold.status,
            "amount_cents": hold.amount_cents,
            "qualification_due_at": assessed.qualification_due_at.isoformat() if assessed.qualification_due_at else None,
            "agreement_wide_hold": False,
            "money_moved": False,
        },
    )
    ResolutionCaseTimelineEvent.objects.create(
        dispute=assessed,
        event_type=ResolutionCaseTimelineEvent.EVENT_QUALIFICATION_UPDATED,
        title="Initial deterministic qualification completed",
        description=assessed.qualification_explanation,
        related_object_type="Dispute",
        related_object_id=assessed.id,
        metadata={
            "qualification_status": assessed.qualification_status,
            "missing_information": assessed.missing_information,
            "ai_decision": False,
        },
    )
    return assessed


@transaction.atomic
def assess_dispute_qualification(dispute: Dispute, *, actor=None, explanation: str = "", now=None) -> Dispute:
    """Apply deterministic completeness rules; AI output is advisory only."""
    now = now or timezone.now()
    dispute = Dispute.objects.select_for_update().get(pk=dispute.pk)
    missing = qualification_missing_information(dispute)
    urgent, urgent_reason = detect_urgent_review(dispute)

    dispute.missing_information = missing
    dispute.qualification_explanation = str(explanation or "").strip()
    dispute.qualification_decided_at = now
    dispute.last_activity_at = now
    if urgent:
        dispute.qualification_status = Dispute.QUALIFICATION_URGENT_REVIEW
        dispute.urgent_review = True
        dispute.urgent_reason = urgent_reason
    elif missing:
        dispute.qualification_status = Dispute.QUALIFICATION_INFORMATION_NEEDED
        dispute.workflow_stage = Dispute.STAGE_CUSTOMER_INFORMATION
    else:
        dispute.qualification_status = Dispute.QUALIFICATION_QUALIFIED
        dispute.workflow_stage = Dispute.STAGE_CONTRACTOR_RESPONSE
        if not dispute.response_due_at:
            dispute.response_due_at = add_business_days(now, contractor_response_business_days())

    dispute.save(update_fields=[
        "missing_information", "qualification_explanation", "qualification_decided_at",
        "qualification_status", "workflow_stage", "urgent_review", "urgent_reason",
        "response_due_at", "last_activity_at", "updated_at",
    ])

    claim = _initial_claim(dispute)
    claim.expected_result = dispute.expected_result
    claim.requested_remedy = dispute.requested_resolution
    claim.missing_information = missing
    claim.evidence_status = "incomplete" if missing else "sufficient"
    claim.status = (
        DisputeClaim.STATUS_INFORMATION_NEEDED if missing else DisputeClaim.STATUS_QUALIFIED
    )
    claim.save()

    try:
        hold = DisputePaymentHold.objects.select_for_update().get(dispute=dispute)
    except DisputePaymentHold.DoesNotExist:
        hold = None
    if hold and hold.status == DisputePaymentHold.STATUS_RELEASED:
        dispute.escrow_frozen = False
        dispute.save(update_fields=["escrow_frozen", "updated_at"])
    elif hold and hold.status != DisputePaymentHold.STATUS_NO_HOLD:
        if dispute.qualification_status == Dispute.QUALIFICATION_QUALIFIED:
            if hold.status != DisputePaymentHold.STATUS_RELEASED:
                hold.status = DisputePaymentHold.STATUS_CONTINUED
                hold.expiration_pending_at = None
                hold.release_due_at = None
                hold.release_reason = ""
                hold.save(update_fields=["status", "expiration_pending_at", "release_due_at", "release_reason"])
                dispute.escrow_frozen = True
            dispute.save(update_fields=["escrow_frozen", "updated_at"])
    return dispute


@transaction.atomic
def extend_qualification_deadline(dispute: Dispute, *, reason: str, actor=None, business_days: int = 1, now=None) -> Dispute:
    reason = str(reason or "").strip()
    if not reason:
        raise ValueError("An extension reason is required.")
    now = now or timezone.now()
    dispute = Dispute.objects.select_for_update().get(pk=dispute.pk)
    base = max(filter(None, [dispute.qualification_due_at, now]))
    dispute.qualification_due_at = add_business_days(base, max(int(business_days or 1), 1))
    dispute.qualification_extension_count += 1
    dispute.qualification_extension_reason = reason
    dispute.qualification_decided_at = None
    dispute.save(update_fields=[
        "qualification_due_at", "qualification_extension_count",
        "qualification_extension_reason", "qualification_decided_at", "updated_at",
    ])
    try:
        hold = DisputePaymentHold.objects.select_for_update().get(dispute=dispute)
    except DisputePaymentHold.DoesNotExist:
        hold = None
    if hold and hold.status == DisputePaymentHold.STATUS_EXPIRATION_PENDING:
        hold.status = DisputePaymentHold.STATUS_TEMPORARY
        hold.expiration_pending_at = None
        hold.release_due_at = None
        hold.release_reason = ""
        hold.save(update_fields=["status", "expiration_pending_at", "release_due_at", "release_reason"])
    return dispute


@transaction.atomic
def override_dispute_qualification(
    dispute: Dispute,
    *,
    qualification_status: str,
    reason: str,
    reactivate_source_hold: bool = False,
    now=None,
) -> Dispute:
    """Apply an audited human qualification decision without moving funds."""
    reason = str(reason or "").strip()
    allowed = {
        Dispute.QUALIFICATION_QUALIFIED,
        Dispute.QUALIFICATION_NOT_QUALIFIED,
        Dispute.QUALIFICATION_URGENT_REVIEW,
    }
    if qualification_status not in allowed:
        raise ValueError("Unsupported qualification decision.")
    if not reason:
        raise ValueError("A reason is required for a human override.")
    now = now or timezone.now()
    dispute = Dispute.objects.select_for_update().get(pk=dispute.pk)
    if is_active_dispute_status(dispute.status) is False:
        raise ValueError("A closed dispute cannot be requalified.")

    try:
        hold = DisputePaymentHold.objects.select_for_update().get(dispute=dispute)
    except DisputePaymentHold.DoesNotExist:
        hold = None

    if reactivate_source_hold:
        if qualification_status == Dispute.QUALIFICATION_NOT_QUALIFIED:
            raise ValueError("A source hold cannot be reactivated for a non-qualified claim.")
        if not hold or hold.status == DisputePaymentHold.STATUS_NO_HOLD or hold.amount_cents <= 0:
            raise ValueError("This dispute has no platform-controlled source eligible for a hold.")
        hold.status = DisputePaymentHold.STATUS_CONTINUED
        hold.released_at = None
        hold.expiration_pending_at = None
        hold.release_due_at = None
        hold.release_reason = ""
        hold.save(update_fields=[
            "status", "released_at", "expiration_pending_at", "release_due_at", "release_reason"
        ])

    if qualification_status == Dispute.QUALIFICATION_NOT_QUALIFIED:
        if hold and hold.status not in {DisputePaymentHold.STATUS_RELEASED, DisputePaymentHold.STATUS_NO_HOLD}:
            hold.status = DisputePaymentHold.STATUS_RELEASED
            hold.released_at = now
            hold.release_reason = f"Human qualification decision: {reason}"
            hold.save(update_fields=["status", "released_at", "release_reason"])
        dispute.escrow_frozen = False
        dispute.workflow_stage = Dispute.STAGE_CLOSED
    else:
        dispute.workflow_stage = (
            Dispute.STAGE_CUSTOMER_INFORMATION
            if qualification_status == Dispute.QUALIFICATION_URGENT_REVIEW
            else Dispute.STAGE_CONTRACTOR_RESPONSE
        )
        dispute.urgent_review = qualification_status == Dispute.QUALIFICATION_URGENT_REVIEW
        dispute.urgent_reason = reason if dispute.urgent_review else ""
        dispute.escrow_frozen = bool(hold and hold.is_active)
        if qualification_status == Dispute.QUALIFICATION_QUALIFIED and not dispute.response_due_at:
            dispute.response_due_at = add_business_days(now, contractor_response_business_days())

    dispute.qualification_status = qualification_status
    dispute.qualification_explanation = reason
    dispute.qualification_decided_at = now
    dispute.last_activity_at = now
    dispute.save(update_fields=[
        "qualification_status", "qualification_explanation", "qualification_decided_at",
        "workflow_stage", "urgent_review", "urgent_reason", "escrow_frozen",
        "response_due_at", "last_activity_at", "updated_at",
    ])
    return dispute


@transaction.atomic
def begin_hold_expiration(dispute: Dispute, *, now=None) -> bool:
    """Start the final grace period once an incomplete case misses its deadline."""
    now = now or timezone.now()
    dispute = Dispute.objects.select_for_update().get(pk=dispute.pk)
    if dispute.urgent_review or dispute.qualification_status in {
        Dispute.QUALIFICATION_QUALIFIED,
        Dispute.QUALIFICATION_URGENT_REVIEW,
    }:
        return False
    if not dispute.qualification_due_at or dispute.qualification_due_at > now:
        return False
    try:
        hold = DisputePaymentHold.objects.select_for_update().get(dispute=dispute)
    except DisputePaymentHold.DoesNotExist:
        return False
    if hold.status != DisputePaymentHold.STATUS_TEMPORARY:
        return False
    hold.status = DisputePaymentHold.STATUS_EXPIRATION_PENDING
    hold.expiration_pending_at = now
    hold.release_due_at = now + timedelta(hours=qualification_grace_hours())
    hold.release_reason = "Qualification information was not completed by the deadline."
    hold.save(update_fields=["status", "expiration_pending_at", "release_due_at", "release_reason"])
    return True


@transaction.atomic
def release_expired_hold(dispute: Dispute, *, now=None) -> bool:
    """Release only the administrative hold; never initiate a money movement."""
    now = now or timezone.now()
    dispute = Dispute.objects.select_for_update().get(pk=dispute.pk)
    try:
        hold = DisputePaymentHold.objects.select_for_update().get(dispute=dispute)
    except DisputePaymentHold.DoesNotExist:
        return False
    if hold.status != DisputePaymentHold.STATUS_EXPIRATION_PENDING:
        return False
    if not hold.release_due_at or hold.release_due_at > now:
        return False
    hold.status = DisputePaymentHold.STATUS_RELEASED
    hold.released_at = now
    hold.save(update_fields=["status", "released_at"])
    dispute.escrow_frozen = False
    dispute.qualification_status = Dispute.QUALIFICATION_NOT_QUALIFIED
    dispute.qualification_decided_at = now
    dispute.workflow_stage = Dispute.STAGE_CLOSED
    dispute.qualification_explanation = (
        "The temporary payment hold closed after the qualification deadline and grace period. "
        "This does not decide warranty rights or the underlying merits."
    )
    dispute.save(update_fields=[
        "escrow_frozen", "qualification_status", "qualification_decided_at",
        "workflow_stage", "qualification_explanation", "updated_at",
    ])
    return True


@transaction.atomic
def close_payment_hold(dispute: Dispute, *, reason: str, now=None) -> bool:
    """Close the source-scoped block without initiating a release/refund/transfer."""
    now = now or timezone.now()
    dispute = Dispute.objects.select_for_update().get(pk=dispute.pk)
    try:
        hold = DisputePaymentHold.objects.select_for_update().get(dispute=dispute)
    except DisputePaymentHold.DoesNotExist:
        if dispute.escrow_frozen:
            dispute.escrow_frozen = False
            dispute.save(update_fields=["escrow_frozen", "updated_at"])
            return True
        return False
    if hold.status in {DisputePaymentHold.STATUS_RELEASED, DisputePaymentHold.STATUS_NO_HOLD}:
        return False
    hold.status = DisputePaymentHold.STATUS_RELEASED
    hold.released_at = now
    hold.release_reason = str(reason or "Administrative hold closed.").strip()
    hold.save(update_fields=["status", "released_at", "release_reason"])
    dispute.escrow_frozen = False
    dispute.save(update_fields=["escrow_frozen", "updated_at"])
    ResolutionCaseTimelineEvent.objects.create(
        dispute=dispute,
        event_type=ResolutionCaseTimelineEvent.EVENT_PAYMENT_HOLD_RELEASED,
        title="Source-specific administrative hold closed",
        description=hold.release_reason,
        related_object_type="DisputePaymentHold",
        related_object_id=hold.id,
        metadata={"money_moved": False, "agreement_wide_hold": False},
    )
    return True


def _active_disputes():
    return Dispute.objects.filter(is_archived=False).exclude(
        status__in=["resolved_contractor", "resolved_homeowner", "resolved_partial", "canceled", "cancelled", "closed"]
    )


def active_dispute_for_source(*, agreement, milestone=None, invoice=None, draw_request=None, expense=None):
    if agreement is None:
        return None
    qs = _active_disputes().filter(agreement=agreement)
    clauses = Q()
    has_clause = False
    if invoice is not None:
        clauses |= Q(payment_request=invoice) | Q(source_type=Dispute.SOURCE_PAYMENT_REQUEST, source_object_id=invoice.id)
        milestone_id = getattr(invoice, "milestone_id_snapshot", None)
        if milestone_id:
            clauses |= Q(milestone_id=milestone_id)
        has_clause = True
    if milestone is not None:
        clauses |= Q(milestone=milestone) | Q(source_type=Dispute.SOURCE_MILESTONE, source_object_id=milestone.id)
        has_clause = True
    if draw_request is not None:
        clauses |= Q(draw_request=draw_request) | Q(source_object_id=draw_request.id, source_type="draw_request")
        has_clause = True
    if expense is not None:
        clauses |= Q(expense=expense) | Q(source_type=Dispute.SOURCE_EXPENSE, source_object_id=expense.id)
        has_clause = True
    if not has_clause:
        return None
    return qs.filter(clauses).order_by("-created_at", "-id").first()


def invoice_has_active_dispute_hold(invoice) -> bool:
    dispute = active_dispute_for_source(agreement=getattr(invoice, "agreement", None), invoice=invoice)
    if dispute is not None:
        try:
            hold = dispute.payment_hold
        except DisputePaymentHold.DoesNotExist:
            return bool(dispute.escrow_frozen)
        return hold.is_active

    # Preserve unresolved legacy cases that asserted an agreement-wide hold but
    # did not identify any source. New workflow records never use this fallback.
    return _active_disputes().filter(
        agreement=getattr(invoice, "agreement", None),
        escrow_frozen=True,
        milestone__isnull=True,
        payment_request__isnull=True,
        draw_request__isnull=True,
        expense__isnull=True,
    ).exists()


def active_disputes_for_agreement(agreement) -> Iterable[Dispute]:
    if agreement is None:
        return Dispute.objects.none()
    return _active_disputes().filter(agreement=agreement).order_by("-created_at", "-id")


def is_active_case(dispute: Dispute) -> bool:
    return is_active_dispute_status(getattr(dispute, "status", "")) and not dispute.is_archived
