from __future__ import annotations

from decimal import Decimal, InvalidOperation, ROUND_HALF_UP
from typing import Any

from django.db import transaction
from django.utils import timezone

from projects.models import Agreement, Milestone
from projects.models_subcontractor import (
    SubcontractorInvitation,
    SubcontractorMilestoneAgreement,
    SubcontractorMilestoneAgreementStatus,
    SubcontractorPaymentReleaseMode,
)


def _quantize_money(value: Decimal) -> Decimal:
    return value.quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)


def _normalize_money(value: Any) -> Decimal:
    if value is None or value == "":
        return Decimal("0.00")
    if isinstance(value, Decimal):
        return _quantize_money(value)
    try:
        return _quantize_money(Decimal(str(value)))
    except (InvalidOperation, ValueError, TypeError):
        return Decimal("0.00")


def _normalize_release_mode(value: Any) -> str:
    raw = str(value or "").strip().lower()
    if raw == SubcontractorPaymentReleaseMode.AUTO_AFTER_CUSTOMER_APPROVAL:
        return SubcontractorPaymentReleaseMode.AUTO_AFTER_CUSTOMER_APPROVAL
    return SubcontractorPaymentReleaseMode.MANUAL_RELEASE


def _contractor_name(contractor) -> str:
    if contractor is None:
        return ""
    business = (getattr(contractor, "business_name", "") or "").strip()
    if business:
        return business
    user = getattr(contractor, "user", None)
    return (getattr(user, "get_full_name", lambda: "")() or getattr(user, "email", "") or "").strip()


def _subcontractor_name(invitation: SubcontractorInvitation) -> str:
    user = getattr(invitation, "accepted_by_user", None)
    if user is not None:
        display = getattr(user, "get_full_name", lambda: "")() or ""
        if display:
            return display
        email = (getattr(user, "email", "") or "").strip()
        if email:
            return email
    return (getattr(invitation, "invite_name", "") or invitation.invite_email or "").strip()


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


def build_terms_snapshot(
    *,
    contractor,
    invitation: SubcontractorInvitation,
    agreement: Agreement,
    milestone: Milestone,
    agreed_pay: Decimal,
    payment_release_mode: str,
    agreement_version: int,
    accepted_at=None,
) -> dict[str, Any]:
    contractor_name = _contractor_name(contractor)
    subcontractor_name = _subcontractor_name(invitation)
    release_mode = _normalize_release_mode(payment_release_mode)
    accepted_language = (
        "Platform acceptance timestamp will be recorded when the subcontractor accepts this milestone agreement."
        if accepted_at is None
        else f"Platform acceptance timestamp recorded at {accepted_at.isoformat()}."
    )
    return {
        "contractor_name": contractor_name,
        "contractor_business_name": getattr(contractor, "business_name", "") or contractor_name,
        "subcontractor_name": subcontractor_name,
        "subcontractor_email": invitation.invite_email,
        "agreement_title": _agreement_title(agreement),
        "milestone_title": getattr(milestone, "title", "") or "",
        "milestone_description": getattr(milestone, "description", "") or "",
        "agreed_pay": f"{_quantize_money(_normalize_money(agreed_pay)):.2f}",
        "payment_release_mode": release_mode,
        "independent_contractor_language": (
            "The subcontractor is an independent contractor and is not an employee of the contractor or the customer."
        ),
        "subcontractor_works_for_contractor_language": (
            "The subcontractor performs work for the contractor, not the customer."
        ),
        "payment_contingent_language": (
            "Payment is contingent on milestone completion, contractor review, and customer approval/payment release when applicable."
        ),
        "correction_rework_language": (
            "Reasonable correction and rework responsibilities remain with the subcontractor for their own work."
        ),
        "liability_language": (
            "The subcontractor remains responsible for the quality and liability of their own work."
        ),
        "agreement_version": agreement_version,
        "platform_acceptance_timestamp_language": accepted_language,
    }


def get_latest_subcontractor_milestone_agreement(
    milestone: Milestone,
    invitation: SubcontractorInvitation | None = None,
) -> SubcontractorMilestoneAgreement | None:
    qs = SubcontractorMilestoneAgreement.objects.filter(milestone=milestone)
    if invitation is not None:
        qs = qs.filter(subcontractor_invitation=invitation)
    return qs.order_by("-agreement_version", "-id").first()


def serialize_subcontractor_milestone_agreement(
    obj: SubcontractorMilestoneAgreement | None,
    *,
    contractor_view: bool = False,
    subcontractor_view: bool = False,
) -> dict[str, Any] | None:
    if obj is None:
        return None

    milestone = getattr(obj, "milestone", None)
    agreement = getattr(obj, "agreement", None)
    invitation = getattr(obj, "subcontractor_invitation", None)
    contractor = getattr(agreement, "contractor", None)
    payload = {
        "id": obj.id,
        "milestone_id": getattr(milestone, "id", None),
        "agreement_id": getattr(agreement, "id", None),
        "contractor_id": getattr(contractor, "id", None),
        "subcontractor_invitation_id": getattr(invitation, "id", None),
        "subcontractor_user_id": getattr(getattr(invitation, "accepted_by_user", None), "id", None),
        "subcontractor_display_name": _subcontractor_name(invitation) if invitation is not None else "",
        "subcontractor_email": getattr(invitation, "invite_email", "") or "",
        "agreement_title": _agreement_title(agreement),
        "milestone_title": getattr(milestone, "title", "") or "",
        "milestone_description": getattr(milestone, "description", "") or "",
        "agreed_pay": f"{obj.agreed_pay:.2f}",
        "payment_release_mode": obj.payment_release_mode,
        "payment_release_mode_label": obj.get_payment_release_mode_display(),
        "agreement_acceptance_status": obj.agreement_acceptance_status,
        "agreement_acceptance_status_label": obj.get_agreement_acceptance_status_display(),
        "accepted_at": obj.accepted_at,
        "accepted_by_user": obj.accepted_by_user_id,
        "agreement_version": obj.agreement_version,
        "terms_snapshot": obj.terms_snapshot or {},
        "override_reason": obj.override_reason or "",
        "sent_at": obj.sent_at,
        "declined_at": obj.declined_at,
        "created_at": obj.created_at,
        "updated_at": obj.updated_at,
        "can_accept": obj.agreement_acceptance_status in {
            SubcontractorMilestoneAgreementStatus.NOT_SENT,
            SubcontractorMilestoneAgreementStatus.PENDING,
        },
        "can_decline": obj.agreement_acceptance_status in {
            SubcontractorMilestoneAgreementStatus.NOT_SENT,
            SubcontractorMilestoneAgreementStatus.PENDING,
        },
        "is_latest": True,
    }

    if contractor_view:
        payload["customer_milestone_amount"] = f"{_normalize_money(getattr(milestone, 'amount', 0)):.2f}"
        payload["customer_agreement_total"] = f"{_normalize_money(getattr(agreement, 'total_cost', 0)):.2f}"

    if subcontractor_view:
        payload.pop("customer_milestone_amount", None)
        payload.pop("customer_agreement_total", None)

    try:
        from projects.services.subcontractor_payout_orchestration import serialize_subcontractor_payout_orchestration

        payload["payout_orchestration"] = serialize_subcontractor_payout_orchestration(
            obj,
            contractor_view=contractor_view,
            subcontractor_view=subcontractor_view,
        )
    except Exception:
        payload["payout_orchestration"] = None

    return payload


def _validate_terms(
    *,
    agreed_pay: Decimal,
    milestone: Milestone,
    override_reason: str = "",
) -> None:
    milestone_amount = _normalize_money(getattr(milestone, "amount", 0))
    if agreed_pay <= Decimal("0.00"):
        raise ValueError("agreed_pay must be greater than 0.")
    if agreed_pay > milestone_amount and not override_reason.strip():
        raise ValueError("agreed_pay cannot exceed the milestone amount without an override reason.")


@transaction.atomic
def upsert_subcontractor_milestone_agreement(
    *,
    contractor,
    agreement: Agreement,
    milestone: Milestone,
    invitation: SubcontractorInvitation,
    agreed_pay,
    payment_release_mode,
    override_reason: str = "",
    send_agreement: bool = False,
    mark_pending: bool = False,
) -> SubcontractorMilestoneAgreement:
    agreed_pay_decimal = _normalize_money(agreed_pay)
    release_mode = _normalize_release_mode(payment_release_mode)
    override_reason = (override_reason or "").strip()
    _validate_terms(agreed_pay=agreed_pay_decimal, milestone=milestone, override_reason=override_reason)

    latest = get_latest_subcontractor_milestone_agreement(milestone, invitation)
    current_version = 0
    if latest is not None:
        current_version = int(getattr(latest, "agreement_version", 1) or 1)

    existing_accepted = latest is not None and latest.agreement_acceptance_status == SubcontractorMilestoneAgreementStatus.ACCEPTED
    terms_changed = (
        latest is None
        or _normalize_money(latest.agreed_pay) != agreed_pay_decimal
        or _normalize_release_mode(latest.payment_release_mode) != release_mode
        or (latest.override_reason or "").strip() != override_reason
    )

    if latest is not None and not existing_accepted and not terms_changed:
        obj = latest
    elif latest is not None and existing_accepted and not terms_changed:
        obj = latest
    else:
        obj = SubcontractorMilestoneAgreement(
            contractor=contractor,
            agreement=agreement,
            milestone=milestone,
            subcontractor_invitation=invitation,
            agreed_pay=agreed_pay_decimal,
            payment_release_mode=release_mode,
            agreement_version=current_version + 1 if latest is not None else 1,
            override_reason=override_reason,
        )

    obj.contractor = contractor
    obj.agreement = agreement
    obj.milestone = milestone
    obj.subcontractor_invitation = invitation
    obj.agreed_pay = agreed_pay_decimal
    obj.payment_release_mode = release_mode
    obj.override_reason = override_reason
    obj.terms_snapshot = build_terms_snapshot(
        contractor=contractor,
        invitation=invitation,
        agreement=agreement,
        milestone=milestone,
        agreed_pay=agreed_pay_decimal,
        payment_release_mode=release_mode,
        agreement_version=obj.agreement_version or 1,
        accepted_at=obj.accepted_at,
    )
    if send_agreement or mark_pending:
        obj.agreement_acceptance_status = SubcontractorMilestoneAgreementStatus.PENDING
        obj.sent_at = obj.sent_at or timezone.now()
    elif not obj.pk:
        obj.agreement_acceptance_status = SubcontractorMilestoneAgreementStatus.NOT_SENT

    if existing_accepted and terms_changed:
        obj.agreement_acceptance_status = SubcontractorMilestoneAgreementStatus.PENDING
        obj.accepted_at = None
        obj.accepted_by_user = None
        obj.declined_at = None
        obj.sent_at = timezone.now()
    elif existing_accepted and not terms_changed:
        obj.agreement_acceptance_status = SubcontractorMilestoneAgreementStatus.ACCEPTED

    obj.save()
    if getattr(milestone, "subcontractor_payout_amount_cents", None) != int(obj.agreed_pay * Decimal("100")):
        milestone.subcontractor_payout_amount_cents = int(obj.agreed_pay * Decimal("100"))
        milestone.save(update_fields=["subcontractor_payout_amount_cents"])
    return obj


def accept_subcontractor_milestone_agreement(
    *,
    agreement_obj: SubcontractorMilestoneAgreement,
    user,
) -> SubcontractorMilestoneAgreement:
    agreement_obj.mark_accepted(user=user, save=False)
    agreement_obj.terms_snapshot = build_terms_snapshot(
        contractor=agreement_obj.contractor,
        invitation=agreement_obj.subcontractor_invitation,
        agreement=agreement_obj.agreement,
        milestone=agreement_obj.milestone,
        agreed_pay=agreement_obj.agreed_pay,
        payment_release_mode=agreement_obj.payment_release_mode,
        agreement_version=agreement_obj.agreement_version,
        accepted_at=agreement_obj.accepted_at,
    )
    agreement_obj.save(
        update_fields=[
            "agreement_acceptance_status",
            "accepted_at",
            "accepted_by_user",
            "declined_at",
            "terms_snapshot",
            "updated_at",
        ]
    )
    return agreement_obj


def decline_subcontractor_milestone_agreement(
    *,
    agreement_obj: SubcontractorMilestoneAgreement,
    user=None,
) -> SubcontractorMilestoneAgreement:
    agreement_obj.mark_declined(user=user, save=False)
    agreement_obj.save(
        update_fields=[
            "agreement_acceptance_status",
            "declined_at",
            "accepted_by_user",
            "updated_at",
        ]
    )
    return agreement_obj
