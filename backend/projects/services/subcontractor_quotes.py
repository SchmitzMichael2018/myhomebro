from __future__ import annotations

from decimal import Decimal, InvalidOperation, ROUND_HALF_UP
from typing import Any

from django.db import transaction
from django.utils import timezone

from projects.models import Agreement, Milestone, Notification
from projects.models_subcontractor import (
    SubcontractorInvitation,
    SubcontractorInvitationStatus,
    SubcontractorMilestoneAgreementStatus,
    SubcontractorPaymentReleaseMode,
    SubcontractorQuoteRequest,
    SubcontractorQuoteRequestStatus,
)
from projects.services.agreements.project_create import resolve_contractor_for_user
from projects.services.subcontractor_milestone_agreements import (
    upsert_subcontractor_milestone_agreement,
    serialize_subcontractor_milestone_agreement,
)


ACTIVE_QUOTE_STATUSES = {
    SubcontractorQuoteRequestStatus.SENT,
    SubcontractorQuoteRequestStatus.RESPONDED,
    SubcontractorQuoteRequestStatus.REVISION_REQUESTED,
}


def _normalize_money(value: Any) -> Decimal:
    if value is None or value == "":
        return Decimal("0.00")
    if isinstance(value, Decimal):
        return value.quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)
    try:
        return Decimal(str(value)).quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)
    except (InvalidOperation, ValueError, TypeError):
        return Decimal("0.00")


def _money_text(value: Any) -> str:
    return f"{_normalize_money(value):.2f}"


def _safe_display_name(user) -> str:
    if user is None:
        return ""
    name = getattr(user, "get_full_name", lambda: "")() or ""
    if name:
        return name
    return (getattr(user, "email", "") or "").strip()


def _contractor_name(contractor) -> str:
    if contractor is None:
        return ""
    business = (getattr(contractor, "business_name", "") or "").strip()
    if business:
        return business
    user = getattr(contractor, "user", None)
    return _safe_display_name(user)


def _agreement_title(agreement: Agreement | None) -> str:
    if agreement is None:
        return ""
    project = getattr(agreement, "project", None)
    return (
        getattr(project, "title", "")
        or getattr(project, "name", "")
        or getattr(agreement, "title", "")
        or getattr(agreement, "project_title_snapshot", "")
        or f"Agreement #{getattr(agreement, 'id', '')}"
    )


def build_quote_scope_snapshot(*, contractor, agreement: Agreement, milestone: Milestone, invitation: SubcontractorInvitation) -> dict[str, Any]:
    return {
        "contractor_name": _contractor_name(contractor),
        "subcontractor_name": _safe_display_name(getattr(invitation, "accepted_by_user", None)) or invitation.invite_name or invitation.invite_email,
        "subcontractor_email": invitation.invite_email,
        "agreement_title": _agreement_title(agreement),
        "milestone_title": getattr(milestone, "title", "") or "",
        "milestone_description": getattr(milestone, "description", "") or "",
        "milestone_due_date": getattr(milestone, "completion_date", None),
    }


def get_latest_subcontractor_quote_request(
    milestone: Milestone,
    invitation: SubcontractorInvitation | None = None,
) -> SubcontractorQuoteRequest | None:
    qs = SubcontractorQuoteRequest.objects.select_related(
        "contractor",
        "subcontractor_invitation",
        "subcontractor_invitation__accepted_by_user",
        "agreement",
        "milestone",
        "linked_subcontractor_milestone_agreement",
        "created_by",
        "responded_by",
        "accepted_by",
    ).filter(milestone=milestone)
    if invitation is not None:
        qs = qs.filter(subcontractor_invitation=invitation)
    return qs.order_by("-created_at", "-id").first()


def serialize_subcontractor_quote_request(
    obj: SubcontractorQuoteRequest | None,
    *,
    contractor_view: bool = False,
    subcontractor_view: bool = False,
) -> dict[str, Any] | None:
    if obj is None:
        return None

    invitation = getattr(obj, "subcontractor_invitation", None)
    contractor = getattr(obj, "contractor", None)
    agreement = getattr(obj, "agreement", None)
    milestone = getattr(obj, "milestone", None)
    linked_agreement = getattr(obj, "linked_subcontractor_milestone_agreement", None)
    payload = {
        "id": obj.id,
        "contractor_id": getattr(contractor, "id", None),
        "subcontractor_invitation_id": getattr(invitation, "id", None),
        "subcontractor_user_id": getattr(obj, "subcontractor_id", None),
        "agreement_id": getattr(agreement, "id", None),
        "milestone_id": getattr(milestone, "id", None),
        "agreement_title": _agreement_title(agreement),
        "milestone_title": getattr(milestone, "title", "") or "",
        "milestone_description": getattr(milestone, "description", "") or "",
        "contractor_message": obj.contractor_message or "",
        "subcontractor_message": obj.subcontractor_message or "",
        "quoted_amount": _money_text(obj.quoted_amount) if obj.quoted_amount is not None else "",
        "estimated_start_date": obj.estimated_start_date,
        "estimated_completion_date": obj.estimated_completion_date,
        "status": obj.status,
        "status_label": obj.get_status_display(),
        "revision_note": obj.revision_note or "",
        "override_reason": obj.override_reason or "",
        "scope_snapshot": obj.scope_snapshot or {},
        "linked_subcontractor_milestone_agreement_id": getattr(linked_agreement, "id", None),
        "linked_subcontractor_milestone_agreement": (
            serialize_subcontractor_milestone_agreement(
                linked_agreement,
                contractor_view=contractor_view,
                subcontractor_view=subcontractor_view,
            )
            if linked_agreement is not None
            else None
        ),
        "created_at": obj.created_at,
        "sent_at": obj.sent_at,
        "responded_at": obj.responded_at,
        "accepted_at": obj.accepted_at,
        "declined_at": obj.declined_at,
        "cancelled_at": obj.cancelled_at,
        "revision_requested_at": obj.revision_requested_at,
        "can_respond": obj.status in {SubcontractorQuoteRequestStatus.SENT, SubcontractorQuoteRequestStatus.REVISION_REQUESTED},
        "can_accept": obj.status in {SubcontractorQuoteRequestStatus.RESPONDED, SubcontractorQuoteRequestStatus.SENT},
        "can_decline": obj.status in {
            SubcontractorQuoteRequestStatus.SENT,
            SubcontractorQuoteRequestStatus.RESPONDED,
            SubcontractorQuoteRequestStatus.REVISION_REQUESTED,
        },
        "can_request_revision": obj.status in {SubcontractorQuoteRequestStatus.RESPONDED, SubcontractorQuoteRequestStatus.SENT},
        "can_cancel": obj.status in {
            SubcontractorQuoteRequestStatus.SENT,
            SubcontractorQuoteRequestStatus.RESPONDED,
            SubcontractorQuoteRequestStatus.REVISION_REQUESTED,
        },
        "is_active": obj.status in ACTIVE_QUOTE_STATUSES,
        "subcontractor_display_name": _safe_display_name(getattr(invitation, "accepted_by_user", None))
        or getattr(invitation, "invite_name", "")
        or getattr(invitation, "invite_email", "")
        or "",
        "subcontractor_email": getattr(invitation, "invite_email", "") or "",
    }

    if contractor_view:
        payload["customer_milestone_amount"] = _money_text(getattr(milestone, "amount", 0))
        payload["customer_agreement_total"] = _money_text(getattr(agreement, "total_cost", 0))

    if subcontractor_view:
        payload.pop("customer_milestone_amount", None)
        payload.pop("customer_agreement_total", None)

    return payload


def _validate_quote_access(*, quote: SubcontractorQuoteRequest, user, contractor=None) -> None:
    if contractor is not None:
        owner = getattr(getattr(getattr(quote, "agreement", None), "project", None), "contractor", None)
        if owner is None or owner.id != contractor.id:
            raise PermissionError("You do not own this quote request.")
        return

    if getattr(quote, "subcontractor_id", None) != getattr(user, "id", None):
        raise PermissionError("You are not allowed to access this quote request.")


@transaction.atomic
def create_quote_request(
    *,
    contractor,
    agreement: Agreement,
    milestone: Milestone,
    subcontractor_invitation: SubcontractorInvitation,
    contractor_message: str = "",
    scope_snapshot: dict[str, Any] | None = None,
    created_by=None,
) -> SubcontractorQuoteRequest:
    if subcontractor_invitation.status != SubcontractorInvitationStatus.ACCEPTED:
        raise ValueError("Only accepted subcontractors can receive quote requests.")
    if subcontractor_invitation.agreement_id != agreement.id:
        raise ValueError("The selected subcontractor must belong to the same agreement.")
    if milestone.agreement_id != agreement.id:
        raise ValueError("The milestone must belong to the same agreement.")
    subcontractor_user = getattr(subcontractor_invitation, "accepted_by_user", None)
    if subcontractor_user is None:
        raise ValueError("The accepted subcontractor does not have a linked user account.")

    current_active = (
        SubcontractorQuoteRequest.objects.filter(
            contractor=contractor,
            agreement=agreement,
            milestone=milestone,
            subcontractor=subcontractor_user,
            status__in=ACTIVE_QUOTE_STATUSES,
        )
        .order_by("-created_at", "-id")
        .first()
    )
    if current_active is not None:
        raise ValueError("An active quote request already exists for this milestone and subcontractor.")

    obj = SubcontractorQuoteRequest.objects.create(
        contractor=contractor,
        subcontractor_invitation=subcontractor_invitation,
        subcontractor=subcontractor_user,
        agreement=agreement,
        milestone=milestone,
        contractor_message=(contractor_message or "").strip(),
        scope_snapshot=scope_snapshot or build_quote_scope_snapshot(
            contractor=contractor,
            agreement=agreement,
            milestone=milestone,
            invitation=subcontractor_invitation,
        ),
        status=SubcontractorQuoteRequestStatus.SENT,
        sent_at=timezone.now(),
        created_by=created_by,
    )

    Notification.objects.create(
        user=subcontractor_user,
        contractor=contractor,
        agreement=agreement,
        milestone=milestone,
        category=Notification.EVENT_QUOTE_REQUEST_RECEIVED,
        event_type=Notification.EVENT_QUOTE_REQUEST_RECEIVED,
        link="/app/subcontractor/assigned-work",
        title="Quote request received",
        message=f"{_contractor_name(contractor)} requested a quote for {getattr(milestone, 'title', '') or 'a milestone'}.",
        actor_user=created_by,
        actor_display_name=_safe_display_name(created_by),
        actor_email=getattr(created_by, "email", "") or "",
    )
    return obj


@transaction.atomic
def respond_to_quote_request(
    *,
    quote: SubcontractorQuoteRequest,
    user,
    quoted_amount,
    subcontractor_message: str = "",
    estimated_start_date=None,
    estimated_completion_date=None,
) -> SubcontractorQuoteRequest:
    _validate_quote_access(quote=quote, user=user)
    if quote.status not in {SubcontractorQuoteRequestStatus.SENT, SubcontractorQuoteRequestStatus.REVISION_REQUESTED}:
        raise ValueError("This quote request is not waiting for a response.")

    amount = _normalize_money(quoted_amount)
    if amount <= Decimal("0.00"):
        raise ValueError("quoted_amount must be greater than 0.")

    quote.quoted_amount = amount
    quote.subcontractor_message = (subcontractor_message or "").strip()
    quote.estimated_start_date = estimated_start_date or None
    quote.estimated_completion_date = estimated_completion_date or None
    quote.status = SubcontractorQuoteRequestStatus.RESPONDED
    quote.responded_at = timezone.now()
    quote.responded_by = user
    quote.save(
        update_fields=[
            "quoted_amount",
            "subcontractor_message",
            "estimated_start_date",
            "estimated_completion_date",
            "status",
            "responded_at",
            "responded_by",
            "updated_at",
        ]
    )
    return quote


@transaction.atomic
def request_quote_revision(
    *,
    quote: SubcontractorQuoteRequest,
    user,
    revision_note: str = "",
) -> SubcontractorQuoteRequest:
    contractor = resolve_contractor_for_user(user)
    if contractor is None or contractor.id != quote.contractor_id:
        raise PermissionError("Only the contractor can request a revision.")
    if quote.status in {SubcontractorQuoteRequestStatus.CANCELLED, SubcontractorQuoteRequestStatus.DECLINED, SubcontractorQuoteRequestStatus.ACCEPTED}:
        raise ValueError("This quote request can no longer be revised.")

    quote.status = SubcontractorQuoteRequestStatus.REVISION_REQUESTED
    quote.revision_note = (revision_note or "").strip()
    quote.revision_requested_at = timezone.now()
    quote.save(
        update_fields=[
            "status",
            "revision_note",
            "revision_requested_at",
            "updated_at",
        ]
    )
    return quote


@transaction.atomic
def decline_quote_request(*, quote: SubcontractorQuoteRequest, user) -> SubcontractorQuoteRequest:
    contractor = resolve_contractor_for_user(user)
    if contractor is None or contractor.id != quote.contractor_id:
        raise PermissionError("Only the contractor can decline a quote.")
    if quote.status == SubcontractorQuoteRequestStatus.ACCEPTED:
        raise ValueError("Accepted quotes cannot be declined.")
    quote.status = SubcontractorQuoteRequestStatus.DECLINED
    quote.declined_at = timezone.now()
    quote.save(
        update_fields=[
            "status",
            "declined_at",
            "updated_at",
        ]
    )
    return quote


@transaction.atomic
def cancel_quote_request(*, quote: SubcontractorQuoteRequest, user) -> SubcontractorQuoteRequest:
    contractor = resolve_contractor_for_user(user)
    if contractor is None or contractor.id != quote.contractor_id:
        raise PermissionError("Only the contractor can cancel a quote.")
    if quote.status == SubcontractorQuoteRequestStatus.ACCEPTED:
        raise ValueError("Accepted quotes cannot be cancelled.")
    quote.status = SubcontractorQuoteRequestStatus.CANCELLED
    quote.cancelled_at = timezone.now()
    quote.save(
        update_fields=[
            "status",
            "cancelled_at",
            "updated_at",
        ]
    )
    return quote


@transaction.atomic
def accept_quote_request(
    *,
    quote: SubcontractorQuoteRequest,
    user,
    payment_release_mode: str = SubcontractorPaymentReleaseMode.MANUAL_RELEASE,
    override_reason: str = "",
) -> SubcontractorQuoteRequest:
    contractor = resolve_contractor_for_user(user)
    if contractor is None or contractor.id != quote.contractor_id:
        raise PermissionError("Only the contractor can accept a quote.")
    if quote.quoted_amount is None or _normalize_money(quote.quoted_amount) <= Decimal("0.00"):
        raise ValueError("quoted_amount must be set before accepting a quote.")
    if quote.status not in {
        SubcontractorQuoteRequestStatus.RESPONDED,
        SubcontractorQuoteRequestStatus.SENT,
        SubcontractorQuoteRequestStatus.REVISION_REQUESTED,
    }:
        raise ValueError("This quote request cannot be accepted in its current state.")

    payment_release_mode = (
        SubcontractorPaymentReleaseMode.AUTO_AFTER_CUSTOMER_APPROVAL
        if str(payment_release_mode).strip().lower() == SubcontractorPaymentReleaseMode.AUTO_AFTER_CUSTOMER_APPROVAL
        else SubcontractorPaymentReleaseMode.MANUAL_RELEASE
    )
    override_reason = (override_reason or quote.override_reason or "").strip()
    milestone_amount = _normalize_money(getattr(quote.milestone, "amount", 0))
    if _normalize_money(quote.quoted_amount) > milestone_amount and not override_reason:
        raise ValueError("accepting this quote requires an override_reason because it exceeds the milestone amount.")

    quote.override_reason = override_reason
    agreement_obj = upsert_subcontractor_milestone_agreement(
        contractor=contractor,
        agreement=quote.agreement,
        milestone=quote.milestone,
        invitation=quote.subcontractor_invitation,
        agreed_pay=quote.quoted_amount,
        payment_release_mode=payment_release_mode,
        override_reason=override_reason,
        send_agreement=True,
        mark_pending=True,
    )
    quote.status = SubcontractorQuoteRequestStatus.ACCEPTED
    quote.accepted_at = timezone.now()
    quote.accepted_by = user
    quote.linked_subcontractor_milestone_agreement = agreement_obj
    quote.save(
        update_fields=[
            "status",
            "accepted_at",
            "accepted_by",
            "linked_subcontractor_milestone_agreement",
            "override_reason",
            "updated_at",
        ]
    )
    return quote


def get_pricing_readiness_for_agreement(agreement: Agreement) -> dict[str, Any]:
    milestones = list(
        Milestone.objects.filter(agreement=agreement)
        .select_related("assigned_subcontractor_invitation", "assigned_subcontractor_invitation__accepted_by_user")
        .order_by("order", "id")
    )
    quote_rows = list(
        SubcontractorQuoteRequest.objects.select_related(
            "subcontractor_invitation",
            "subcontractor_invitation__accepted_by_user",
        )
        .filter(agreement=agreement)
        .order_by("milestone_id", "-created_at", "-id")
    )
    latest_by_milestone: dict[int, SubcontractorQuoteRequest] = {}
    for quote in quote_rows:
        if quote.milestone_id not in latest_by_milestone:
            latest_by_milestone[quote.milestone_id] = quote

    pricing_strategy = str(getattr(agreement, "pricing_strategy", "fixed") or "fixed").strip().lower() or "fixed"
    fixed_count = 0
    estimated_count = 0
    pending_quote_count = 0
    blockers = []

    for milestone in milestones:
        latest_quote = latest_by_milestone.get(milestone.id)
        latest_status = latest_quote.status if latest_quote is not None else ""
        if pricing_strategy == "estimate":
            estimated_count += 1

        if latest_status in ACTIVE_QUOTE_STATUSES:
            pending_quote_count += 1
            blockers.append(
                {
                    "milestone_id": milestone.id,
                    "milestone_title": getattr(milestone, "title", "") or "",
                    "quote_id": latest_quote.id if latest_quote else None,
                    "quote_status": latest_status,
                    "quote_status_label": latest_quote.get_status_display() if latest_quote else "",
                    "quote_amount": _money_text(latest_quote.quoted_amount) if latest_quote and latest_quote.quoted_amount is not None else "",
                    "subcontractor_name": _safe_display_name(
                        getattr(latest_quote.subcontractor_invitation, "accepted_by_user", None)
                    ) if latest_quote else "",
                    "reason": "pending_quote",
                }
            )
            continue

        if pricing_strategy == "fixed":
            fixed_count += 1

    blocked = pricing_strategy == "requires_sub_quote" and pending_quote_count > 0
    if pricing_strategy == "requires_sub_quote" and not pending_quote_count:
        safe_summary = "All requested subcontractor quotes are ready."
    elif pricing_strategy == "requires_sub_quote":
        safe_summary = "Subcontractor pricing is still pending."
    elif pricing_strategy == "estimate":
        safe_summary = "Some pricing is estimated and may require adjustment later."
    else:
        safe_summary = "All pricing is set."

    return {
        "agreement_id": agreement.id,
        "pricing_strategy": pricing_strategy,
        "fixed_count": fixed_count,
        "estimated_count": estimated_count,
        "pending_quote_count": pending_quote_count,
        "blocked": blocked,
        "next_status": "blocked" if blocked else "ready",
        "blockers": blockers,
        "safe_summary": safe_summary,
    }
