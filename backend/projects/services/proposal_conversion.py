from __future__ import annotations

from dataclasses import dataclass
from django.utils import timezone

from projects.models_proposals import Proposal, ProposalActivity, ProposalReviewVersion
from projects.services.proposal_customer_review import build_customer_snapshot


class ProposalConversionError(Exception):
    def __init__(self, detail: str, *, status_code: int = 400):
        super().__init__(detail)
        self.detail = detail
        self.status_code = status_code


@dataclass
class ProposalConversionContext:
    proposal: Proposal
    review: ProposalReviewVersion | None
    existing_agreement: object | None
    trusted_payload: dict


def _scope_from_snapshot(snapshot: dict) -> str:
    project = snapshot.get("project") or {}
    parts = []
    if project.get("description"):
        parts.append(str(project["description"]).strip())
    for label, key in (
        ("Included Work", "included_work"),
        ("Exclusions", "excluded_work"),
        ("Assumptions", "assumptions"),
        ("Allowances", "allowances"),
    ):
        value = str(project.get(key) or "").strip()
        if value:
            parts.append(f"{label}:\n{value}")
    return "\n\n".join(parts)


def _trusted_agreement_payload(review: ProposalReviewVersion) -> dict:
    snapshot = review.snapshot or {}
    project = snapshot.get("project") or {}
    pricing = snapshot.get("pricing") or {}
    schedule = project.get("schedule") or {}
    payload = {
        "title": project.get("title") or "Draft Agreement",
        "project_title": project.get("title") or "Draft Agreement",
        "description": _scope_from_snapshot(snapshot),
        "scope_of_work": _scope_from_snapshot(snapshot),
        "address_line1": project.get("property") or "",
        "total_cost": str(pricing.get("total") or "0.00"),
        "incidentals_reserve_amount": str(pricing.get("incidentals_reserve") or "0.00"),
    }
    if schedule.get("start_date"):
        payload["project_start_date"] = schedule["start_date"]
        payload["start"] = schedule["start_date"]
    return payload


def prepare_proposal_conversion(*, contractor, proposal_id: int) -> ProposalConversionContext:
    """Lock and validate the only authoritative Proposal conversion source."""
    proposal = (
        Proposal.objects.select_for_update()
        .select_related("converted_agreement", "contractor_opportunity", "contractor_opportunity__converted_agreement")
        .prefetch_related("line_items", "review_versions")
        .filter(pk=proposal_id, contractor=contractor)
        .first()
    )
    if proposal is None:
        raise ProposalConversionError("Accepted estimate not found.", status_code=404)
    if proposal.converted_agreement_id:
        return ProposalConversionContext(proposal, proposal.converted_review_version, proposal.converted_agreement, {})
    if proposal.status != Proposal.STATUS_ACCEPTED:
        raise ProposalConversionError("Customer acceptance is required before creating an agreement.", status_code=409)
    if not proposal.customer_name or not proposal.customer_email:
        raise ProposalConversionError("The estimate must have a customer name and email before conversion.")
    latest = proposal.review_versions.order_by("-version").first()
    if latest is None or latest.decision != ProposalReviewVersion.DECISION_ACCEPTED:
        raise ProposalConversionError("The current estimate version has not been accepted by the customer.", status_code=409)
    if latest.expires_at and latest.expires_at <= timezone.now():
        raise ProposalConversionError("The accepted estimate version is expired.", status_code=409)
    current_customer_terms = build_customer_snapshot(proposal)
    if current_customer_terms != latest.snapshot:
        raise ProposalConversionError("Customer-facing estimate terms changed after acceptance. Send a revised estimate for customer approval.", status_code=409)
    opportunity_agreement = getattr(proposal.contractor_opportunity, "converted_agreement", None)
    if opportunity_agreement is not None:
        raise ProposalConversionError("This opportunity already has a different agreement. Open that agreement or resolve the opportunity linkage before converting.", status_code=409)
    return ProposalConversionContext(proposal, latest, None, _trusted_agreement_payload(latest))


def finalize_proposal_conversion(*, context: ProposalConversionContext, agreement, actor) -> None:
    """Finalize both lifecycle relationships inside the caller's atomic transaction."""
    proposal = context.proposal
    if proposal.converted_agreement_id and proposal.converted_agreement_id != agreement.id:
        raise ProposalConversionError("This estimate was already converted to another agreement.", status_code=409)
    proposal.converted_agreement = agreement
    proposal.converted_review_version = context.review
    proposal.converted_at = timezone.now()
    proposal.conversion_method = "online"
    proposal.status = Proposal.STATUS_CONVERTED
    proposal.save(update_fields=["converted_agreement", "converted_review_version", "converted_at", "conversion_method", "status", "updated_at"])
    opportunity = proposal.contractor_opportunity
    if opportunity is not None:
        if opportunity.converted_agreement_id not in (None, agreement.id):
            raise ProposalConversionError("This opportunity is already linked to another agreement.", status_code=409)
        if opportunity.converted_agreement_id is None:
            opportunity.converted_agreement = agreement
            opportunity.save(update_fields=["converted_agreement", "updated_at"])
    ProposalActivity.objects.create(
        proposal=proposal,
        event_type=ProposalActivity.EVENT_AGREEMENT_CREATED,
        message="Agreement created from accepted estimate",
        actor=actor,
        metadata={"agreement_id": agreement.id, "review_version": context.review.version, "acceptance_method": "online"},
    )
