from __future__ import annotations

from decimal import Decimal

from django.db import transaction
from django.db.models import Sum
from django.utils import timezone
from django.utils.dateparse import parse_date

from projects.models import Agreement, Milestone
from projects.models_amendment_request import AmendmentRequest
from projects.services.agreement_fee_allocation import refresh_agreement_fee_allocations
from projects.services.amendments import mark_agreement_amended
from projects.services.project_activity import create_project_activity_event


@transaction.atomic
def prepare_accepted_change_amendment(amendment: AmendmentRequest, *, actor=None) -> dict:
    """Turn an accepted added-work request into a signed-before-funded amendment draft."""
    amendment = AmendmentRequest.objects.select_for_update().select_related(
        "agreement", "agreement__contractor", "agreement__project"
    ).get(pk=amendment.pk)
    agreement = Agreement.objects.select_for_update().get(pk=amendment.agreement_id)
    if amendment.response_state != AmendmentRequest.ResponseState.ACCEPTED:
        raise ValueError("The customer must accept this change request before it can become an amendment.")

    requested_changes = dict(amendment.requested_changes or {})
    applied_milestone_id = requested_changes.get("applied_milestone_id")
    if applied_milestone_id:
        milestone = Milestone.objects.filter(id=applied_milestone_id, agreement=agreement).first()
        return {
            "ok": True,
            "already_applied": True,
            "agreement_id": agreement.id,
            "milestone_id": getattr(milestone, "id", None),
            "milestone_order": getattr(milestone, "order", None),
            "amendment_number": int(getattr(agreement, "amendment_number", 0) or 0),
            "next_url": f"/app/agreements/{agreement.id}/wizard?step=2",
        }

    milestone_draft = requested_changes.get("milestone_draft") or {}
    title = str(milestone_draft.get("title") or "").strip()
    scope = str(milestone_draft.get("scope") or requested_changes.get("requested_change") or "").strip()
    completion_criteria = str(milestone_draft.get("completion_criteria") or "").strip()
    try:
        amount = Decimal(str(requested_changes.get("proposed_value_change") or "0")).quantize(Decimal("0.01"))
    except Exception:
        amount = Decimal("0.00")
    if not title or not scope:
        raise ValueError("Add a proposed milestone title and scope before preparing the amendment.")
    if amount <= 0:
        raise ValueError("Add a positive price adjustment before preparing this added-work milestone.")

    current_amendment_number = int(getattr(agreement, "amendment_number", 0) or 0)
    mark_agreement_amended(agreement, actor=actor, reason=f"accepted-change-request-{amendment.id}")
    agreement.amendment_number = current_amendment_number + 1
    agreement.status = "draft"
    if hasattr(agreement, "escrow_funded"):
        agreement.escrow_funded = False
    if hasattr(agreement, "amended_at"):
        agreement.amended_at = timezone.now()
    if hasattr(agreement, "last_amend_reason"):
        agreement.last_amend_reason = f"accepted-change-request-{amendment.id}"
    agreement.save()

    milestones = list(Milestone.objects.select_for_update().filter(agreement=agreement).order_by("order", "id"))
    placement_before_id = milestone_draft.get("placement_before_milestone_id")
    placement_target = next((row for row in milestones if str(row.id) == str(placement_before_id)), None)
    next_unfinished = next((row for row in milestones if not row.completed), None)
    insert_order = placement_target.order if placement_target else (next_unfinished.order if next_unfinished else ((milestones[-1].order + 1) if milestones else 1))
    for row in sorted((row for row in milestones if row.order >= insert_order), key=lambda item: item.order, reverse=True):
        row.order += 1
        row.save(update_fields=["order"])

    description = scope if not completion_criteria else f"{scope}\n\nCompletion criteria: {completion_criteria}"
    proposed_date = parse_date(str(milestone_draft.get("proposed_milestone_date") or ""))
    if proposed_date is None and placement_target is not None:
        proposed_date = placement_target.completion_date or placement_target.start_date
    milestone = Milestone.objects.create(
        agreement=agreement,
        order=insert_order,
        title=title,
        description=description,
        amount=amount,
        start_date=proposed_date,
        completion_date=proposed_date,
        amendment_number_snapshot=agreement.amendment_number,
    )
    agreement.total_cost = Milestone.objects.filter(agreement=agreement).aggregate(total=Sum("amount"))["total"] or Decimal("0.00")
    agreement.save(update_fields=["total_cost", "updated_at"])
    refresh_agreement_fee_allocations(agreement)
    # Agreement.save() derives lifecycle status from existing escrow. During an
    # amendment, the prior funded balance must not reactivate the project before
    # the replacement signatures and incremental funding are complete.
    Agreement.objects.filter(pk=agreement.pk).update(status="draft", escrow_funded=False)
    agreement.status = "draft"
    agreement.escrow_funded = False

    requested_changes.update({
        "applied_milestone_id": milestone.id,
        "applied_amendment_number": agreement.amendment_number,
        "applied_at": timezone.now().isoformat(),
        "applied_by_user_id": getattr(actor, "id", None),
        "workflow_stage": "awaiting_amendment_signatures",
        "milestone_activation": "awaiting_additional_funding",
        "confirmed_milestone_order": insert_order,
        "confirmed_milestone_date": proposed_date.isoformat() if proposed_date else None,
    })
    amendment.requested_changes = requested_changes
    amendment.save(update_fields=["requested_changes", "updated_at"])
    create_project_activity_event(
        agreement=agreement,
        event_type="amendment_resolved",
        object_type="amendment_request",
        object_id=amendment.id,
        title="Accepted change prepared for amendment signatures",
        body=f"Milestone {insert_order}: {title} was prepared for ${amount:.2f}. It remains inactive until the amendment is signed and additional funding is received.",
        actor=actor,
        actor_role="homeowner" if amendment.initiated_by_role == "contractor" else "contractor",
        recipient_role="contractor" if amendment.initiated_by_role == "contractor" else "homeowner",
        delivered=True,
        resolved=False,
        metadata={"milestone_id": milestone.id, "amendment_number": agreement.amendment_number},
    )
    return {
        "ok": True,
        "already_applied": False,
        "agreement_id": agreement.id,
        "milestone_id": milestone.id,
        "milestone_order": milestone.order,
        "amendment_number": agreement.amendment_number,
        "additional_escrow_required": f"{amount:.2f}",
        "workflow_stage": "awaiting_amendment_signatures",
        "next_url": f"/app/agreements/{agreement.id}/wizard?step=2",
    }
