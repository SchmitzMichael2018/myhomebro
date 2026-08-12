from __future__ import annotations

from projects.models_proposals import Proposal, ProposalReviewVersion


def proposal_readiness_satisfied(proposal: Proposal) -> bool:
    """Evaluate the persisted minimum needed to put an Estimate in the send-ready lane."""
    has_contact = bool(proposal.customer_name.strip() and (proposal.customer_email.strip() or proposal.customer_phone.strip()))
    has_scope = bool(proposal.included_work.strip() or proposal.site_visit_notes.strip() or proposal.project_summary.strip())
    return bool(has_contact and proposal.service_location.strip() and has_scope and proposal.line_items.exists())


def resolve_proposal_lifecycle_status(proposal: Proposal, *, readiness_ready: bool | None = None) -> str:
    """Resolve lifecycle from authoritative relationships before lower-level readiness."""
    opportunity = getattr(proposal, "contractor_opportunity", None)
    if proposal.converted_agreement_id or getattr(opportunity, "converted_agreement_id", None):
        return Proposal.STATUS_CONVERTED

    latest = proposal.review_versions.order_by("-version").first()
    if latest is not None:
        if latest.decision == ProposalReviewVersion.DECISION_ACCEPTED:
            return Proposal.STATUS_ACCEPTED
        if latest.decision == ProposalReviewVersion.DECISION_REVISION_REQUESTED:
            return Proposal.STATUS_REVISION_REQUESTED
        if latest.decision == ProposalReviewVersion.DECISION_DECLINED:
            return Proposal.STATUS_DECLINED
        if latest.sent_at:
            return Proposal.STATUS_VIEWED if latest.viewed_at else Proposal.STATUS_SENT

    # Expiration and explicit customer outcomes are changed only by their dedicated
    # workflows. Readiness may promote/demote only the pre-customer preparation states.
    if proposal.status in {
        Proposal.STATUS_DECLINED,
        Proposal.STATUS_REVISION_REQUESTED,
        Proposal.STATUS_EXPIRED,
    }:
        return proposal.status
    if readiness_ready is True:
        return Proposal.STATUS_READY
    if readiness_ready is False or proposal.status in {Proposal.STATUS_DRAFT, Proposal.STATUS_SITE_VISIT}:
        return Proposal.STATUS_IN_PROGRESS
    return proposal.status if proposal.status in {Proposal.STATUS_IN_PROGRESS, Proposal.STATUS_READY} else Proposal.STATUS_IN_PROGRESS


def synchronize_proposal_lifecycle(
    proposal: Proposal,
    *,
    readiness_ready: bool | None = None,
    recalculate_readiness: bool = False,
) -> str:
    if recalculate_readiness:
        readiness_ready = proposal_readiness_satisfied(proposal)
    resolved = resolve_proposal_lifecycle_status(proposal, readiness_ready=readiness_ready)
    if proposal.status != resolved:
        proposal.status = resolved
        proposal.save(update_fields=["status", "updated_at"])
    return resolved
