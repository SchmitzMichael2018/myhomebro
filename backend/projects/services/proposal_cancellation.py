from __future__ import annotations

from django.db import transaction
from django.utils import timezone

from projects.models_proposals import Proposal, ProposalActivity, ProposalReviewVersion


class ProposalLifecycleError(Exception):
    def __init__(self, detail: str, *, status_code: int = 409):
        super().__init__(detail)
        self.detail = detail
        self.status_code = status_code


PRE_CUSTOMER_STATUSES = {
    Proposal.STATUS_DRAFT,
    Proposal.STATUS_SITE_VISIT,
    Proposal.STATUS_IN_PROGRESS,
    Proposal.STATUS_READY,
}


def _linked_agreement(proposal):
    return proposal.converted_agreement or getattr(proposal.contractor_opportunity, "converted_agreement", None)


def _protected_draft_relations(proposal):
    labels = []
    for related_name, label in (
        ("measurement_sessions", "measurement sessions"),
        ("takeoff_sessions", "takeoff sessions"),
        ("plan_measurement_documents", "plan measurement documents"),
        ("photo_measurement_documents", "photo measurement documents"),
    ):
        if getattr(proposal, related_name).exists():
            labels.append(label)
    try:
        conversation = proposal.customer_conversation
    except Exception:
        conversation = None
    if conversation is not None:
        labels.append("customer conversation")
    return labels


@transaction.atomic
def delete_draft_estimate(*, contractor, proposal_id: int):
    proposal = Proposal.objects.select_for_update().select_related(
        "converted_agreement", "contractor_opportunity", "contractor_opportunity__converted_agreement"
    ).filter(contractor=contractor, pk=proposal_id).first()
    if proposal is None:
        raise ProposalLifecycleError("Estimate not found.", status_code=404)
    if _linked_agreement(proposal):
        raise ProposalLifecycleError("This estimate was converted to an Agreement and cannot be deleted.")
    if proposal.status not in PRE_CUSTOMER_STATUSES or proposal.review_versions.exists():
        raise ProposalLifecycleError("Only an unsent draft estimate with no customer review history can be deleted.")
    protected = _protected_draft_relations(proposal)
    if protected:
        raise ProposalLifecycleError(f"This estimate cannot be deleted because it has protected {', '.join(protected)}.")
    stored_files = [
        (attachment.file.storage, attachment.file.name)
        for attachment in proposal.attachments.all()
        if attachment.file and attachment.file.name
    ]
    proposal.delete()
    for storage, name in stored_files:
        transaction.on_commit(lambda storage=storage, name=name: storage.delete(name))


@transaction.atomic
def cancel_estimate(*, contractor, proposal_id: int, actor, reason: str = "", confirm_accepted: bool = False):
    proposal = Proposal.objects.select_for_update().select_related(
        "converted_agreement", "contractor_opportunity", "contractor_opportunity__converted_agreement"
    ).filter(contractor=contractor, pk=proposal_id).first()
    if proposal is None:
        raise ProposalLifecycleError("Estimate not found.", status_code=404)
    agreement = _linked_agreement(proposal)
    if agreement:
        raise ProposalLifecycleError("This estimate was converted to an Agreement. Manage cancellation from the Agreement.")
    if proposal.status == Proposal.STATUS_CANCELLED:
        return proposal

    latest = proposal.review_versions.select_for_update().order_by("-version").first()
    accepted = bool(latest and latest.decision == ProposalReviewVersion.DECISION_ACCEPTED)
    if accepted:
        if not confirm_accepted:
            raise ProposalLifecycleError("Confirm that you understand the accepted estimate will be voided.", status_code=400)
        reason = str(reason or "").strip()
        if not reason:
            raise ProposalLifecycleError("A reason is required to void an accepted estimate.", status_code=400)
        kind = Proposal.CANCELLATION_VOIDED
        event = ProposalActivity.EVENT_ESTIMATE_VOIDED
        message = "Accepted estimate voided by contractor"
    else:
        if latest is None or not latest.sent_at:
            raise ProposalLifecycleError("This estimate has not been sent. Delete the draft instead.")
        if latest.decision != ProposalReviewVersion.DECISION_PENDING:
            raise ProposalLifecycleError("Only a sent estimate awaiting customer acceptance can be withdrawn.")
        kind = Proposal.CANCELLATION_WITHDRAWN
        event = ProposalActivity.EVENT_ESTIMATE_WITHDRAWN
        message = "Estimate withdrawn by contractor"

    now = timezone.now()
    proposal.status = Proposal.STATUS_CANCELLED
    proposal.cancellation_kind = kind
    proposal.cancellation_reason = str(reason or "").strip()[:255]
    proposal.cancelled_at = now
    proposal.cancelled_by = actor
    proposal.save(update_fields=["status", "cancellation_kind", "cancellation_reason", "cancelled_at", "cancelled_by", "updated_at"])
    ProposalActivity.objects.create(
        proposal=proposal,
        event_type=event,
        message=message,
        actor=actor,
        metadata={"reason": proposal.cancellation_reason, "review_version": getattr(latest, "version", None)},
    )
    return proposal
