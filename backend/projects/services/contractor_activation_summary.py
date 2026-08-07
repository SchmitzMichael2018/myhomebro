from __future__ import annotations

from typing import Any

from django.db.models import Count, Q
from django.utils import timezone

from projects.models import Agreement, Contractor, Homeowner
from projects.models_contractor_discovery import ContractorDirectoryEntry, ContractorOpportunity
from projects.models_proposals import Proposal
from projects.models_templates import ProjectTemplate


SECTION_PREFILLED_PROFILE = "prefilled_profile"
SECTION_PUBLIC_LEADS = "public_leads"
SECTION_DRAFT_AGREEMENT = "draft_agreement"
SECTION_TRADITIONAL = "traditional_onboarding"
SECTION_ALL = "all"

VALID_DISMISS_SECTIONS = {
    SECTION_PREFILLED_PROFILE,
    SECTION_PUBLIC_LEADS,
    SECTION_DRAFT_AGREEMENT,
    SECTION_TRADITIONAL,
    SECTION_ALL,
}


def _profile_is_complete(contractor: Contractor) -> bool:
    return bool(
        (contractor.business_name or "").strip()
        and (contractor.phone or "").strip()
        and (contractor.city or "").strip()
        and (contractor.state or "").strip()
    )


def _opportunity_queryset(contractor: Contractor):
    return ContractorOpportunity.objects.select_related("directory_entry", "converted_agreement").filter(
        Q(directory_entry__claimed_by_contractor=contractor)
        | Q(accepted_by_contractor=contractor)
    ).distinct()


def _latest_converted_opportunity(qs):
    return (
        qs.filter(converted_agreement__isnull=False)
        .order_by("-accepted_at", "-updated_at", "-selected_at", "-id")
        .first()
    )


def _has_prefilled_profile(contractor: Contractor) -> bool:
    if contractor.activation_type in {
        Contractor.ACTIVATION_PREFILLED_DIRECTORY,
        Contractor.ACTIVATION_HOMEOWNER_SELECTED,
    }:
        return True
    return ContractorDirectoryEntry.objects.filter(claimed_by_contractor=contractor).exists()


def _build_priority_summary(contractor: Contractor) -> dict[str, Any]:
    active_template_count = ProjectTemplate.objects.filter(
        contractor=contractor,
        lifecycle_status=ProjectTemplate.LifecycleStatus.ACTIVE,
        is_active=True,
    ).count()
    customer_count = Homeowner.objects.filter(created_by=contractor).count()
    active_proposals = (
        Proposal.objects.filter(contractor=contractor)
        .exclude(status__in=[Proposal.STATUS_CONVERTED, Proposal.STATUS_DECLINED, Proposal.STATUS_EXPIRED])
        .select_related("contractor_opportunity", "contractor_opportunity__converted_agreement")
        .annotate(line_item_count=Count("line_items"))
    )
    active_estimate_count = active_proposals.count()
    latest_estimate = active_proposals.order_by("-updated_at", "-id").first()
    agreement_count = Agreement.objects.filter(contractor=contractor).count()

    launch_action: dict[str, Any] | None = None
    if active_template_count == 0:
        launch_action = {
            "key": "launch:first-template",
            "category": "launch",
            "rank": 50,
            "title": "Create your first reusable template",
            "description": "Set up a common project once so future estimates and agreements are faster and more consistent.",
            "reason": "Reusable templates can prefill milestones, descriptions, pricing guidance, timing, and materials for future estimates and agreements.",
            "action_label": "Create template",
            "destination": "/app/templates",
            "optional": True,
            "blocking": False,
        }
    elif customer_count == 0:
        launch_action = {
            "key": "launch:first-customer",
            "category": "launch",
            "rank": 50,
            "title": "Add your first customer",
            "description": "Create a customer record so you can start an estimate and keep project details organized.",
            "reason": "A customer record connects estimates, agreements, projects, and communication.",
            "action_label": "Add customer",
            "destination": "/app/customers/new",
            "optional": False,
            "blocking": False,
        }
    elif active_estimate_count == 0 and agreement_count == 0:
        launch_action = {
            "key": "launch:first-estimate",
            "category": "sales",
            "rank": 55,
            "title": "Create your first estimate",
            "description": "Use your template and customer details to build a reusable estimate workflow.",
            "reason": "An estimate carries customer, scope, pricing, and schedule details toward an agreement.",
            "action_label": "Create estimate",
            "destination": "/app/estimates?create=estimate",
            "optional": False,
            "blocking": False,
        }
    elif latest_estimate is not None:
        project_name = (latest_estimate.project_title or "this estimate").strip()
        linked_agreement_id = getattr(latest_estimate.contractor_opportunity, "converted_agreement_id", None)
        if latest_estimate.status == Proposal.STATUS_READY and not linked_agreement_id:
            launch_action = {
                "key": f"sales:agreement-ready:{latest_estimate.id}",
                "category": "sales",
                "rank": 84,
                "title": f"Create agreement for {project_name}",
                "description": "This estimate is ready for agreement review and conversion.",
                "reason": "The estimate has reached its ready state and can move into the existing Agreement Wizard.",
                "action_label": "Create agreement",
                "destination": f"/app/proposals/{latest_estimate.id}?section=ready",
                "optional": False,
                "blocking": True,
                "entity_id": latest_estimate.id,
            }
        elif latest_estimate.line_item_count == 0:
            launch_action = {
                "key": f"sales:estimate-pricing:{latest_estimate.id}",
                "category": "sales",
                "rank": 83,
                "title": f"Add pricing to {project_name}",
                "description": "Add estimate pricing before reviewing agreement readiness.",
                "reason": "Pricing is required before this estimate can become an agreement.",
                "action_label": "Add pricing",
                "destination": f"/app/proposals/{latest_estimate.id}?section=estimate",
                "optional": False,
                "blocking": True,
                "entity_id": latest_estimate.id,
            }
        elif latest_estimate.status in {Proposal.STATUS_DRAFT, Proposal.STATUS_SITE_VISIT, Proposal.STATUS_IN_PROGRESS}:
            launch_action = {
                "key": f"sales:estimate-review:{latest_estimate.id}",
                "category": "sales",
                "rank": 80,
                "title": f"Review estimate readiness for {project_name}",
                "description": "Review the remaining estimate requirements and prepare the next agreement step.",
                "reason": "A complete estimate keeps scope, pricing, and customer expectations together before agreement conversion.",
                "action_label": "Review estimate",
                "destination": f"/app/proposals/{latest_estimate.id}?section=ready",
                "optional": False,
                "blocking": True,
                "entity_id": latest_estimate.id,
            }

    return {
        "active_contractor_template_count": active_template_count,
        "customer_count": customer_count,
        "active_estimate_count": active_estimate_count,
        "agreement_count": agreement_count,
        "stripe_ready": bool(contractor.stripe_connected),
        "launch_action": launch_action,
    }


def _infer_activation_type(
    contractor: Contractor,
    *,
    has_prefilled_profile: bool,
    has_pending_opportunities: bool,
    has_converted_opportunity: bool,
) -> str:
    if contractor.activation_type:
        return contractor.activation_type
    if has_pending_opportunities or has_converted_opportunity:
        return Contractor.ACTIVATION_HOMEOWNER_SELECTED
    if has_prefilled_profile:
        return Contractor.ACTIVATION_PREFILLED_DIRECTORY
    return Contractor.ACTIVATION_TRADITIONAL_SIGNUP


def _section(
    *,
    visible: bool,
    completed: bool,
    dismissed: bool,
    title: str,
    description: str,
    action_url: str,
    action_label: str,
    checklist: list[str] | None = None,
) -> dict[str, Any]:
    return {
        "visible": bool(visible),
        "completed": bool(completed),
        "dismissed": bool(dismissed),
        "title": title,
        "description": description,
        "action_url": action_url,
        "action_label": action_label,
        "checklist": checklist or [],
    }


def build_contractor_activation_summary(contractor: Contractor | None, *, mark_seen: bool = True) -> dict[str, Any]:
    if contractor is None:
        return {
            "activation_type": "",
            "has_prefilled_profile": False,
            "has_pending_opportunities": False,
            "pending_opportunity_count": 0,
            "has_converted_opportunity": False,
            "latest_agreement_id": None,
            "latest_agreement_url": "",
            "should_show_activation_guide": False,
            "guide_sections": {},
            "priority_summary": {},
        }

    opportunities = _opportunity_queryset(contractor)
    pending_count = opportunities.filter(status=ContractorOpportunity.STATUS_PENDING).count()
    latest_converted = _latest_converted_opportunity(opportunities)
    latest_agreement = getattr(latest_converted, "converted_agreement", None)
    latest_agreement_id = getattr(latest_agreement, "id", None)
    has_pending_opportunities = pending_count > 0
    has_converted_opportunity = latest_agreement_id is not None
    has_prefilled_profile = _has_prefilled_profile(contractor)
    activation_type = _infer_activation_type(
        contractor,
        has_prefilled_profile=has_prefilled_profile,
        has_pending_opportunities=has_pending_opportunities,
        has_converted_opportunity=has_converted_opportunity,
    )

    now = timezone.now()
    update_fields: list[str] = []
    if mark_seen and has_pending_opportunities and contractor.first_opportunity_seen_at is None:
        contractor.first_opportunity_seen_at = now
        update_fields.append("first_opportunity_seen_at")
    if mark_seen and has_converted_opportunity and contractor.first_draft_agreement_seen_at is None:
        contractor.first_draft_agreement_seen_at = now
        update_fields.append("first_draft_agreement_seen_at")
    if update_fields:
        contractor.save(update_fields=update_fields)

    profile_complete = _profile_is_complete(contractor)
    has_any_agreement = Agreement.objects.filter(contractor=contractor).exists()
    stripe_connected = contractor.stripe_connected
    traditional_completed = bool(profile_complete and stripe_connected and has_any_agreement)

    guide_sections = {
        SECTION_PREFILLED_PROFILE: _section(
            visible=has_prefilled_profile,
            completed=profile_complete,
            dismissed=contractor.has_seen_prefilled_profile_intro,
            title="We prepared your business profile",
            description=(
                "MyHomeBro used public business information to prefill a starting profile. "
                "You can edit or remove any prefilled business information."
            ),
            action_url="/app/public-presence",
            action_label="Open My Profile",
            checklist=["Confirm business profile", "Review public presence details"],
        ),
        SECTION_PUBLIC_LEADS: _section(
            visible=has_pending_opportunities,
            completed=False,
            dismissed=contractor.has_seen_public_leads_intro,
            title="A homeowner request may be waiting",
            description=(
                "Nothing has been sent to a homeowner without your confirmation. "
                "Review the request, then accept or decline when you are ready."
            ),
            action_url="/app/public-presence?tab=leads",
            action_label="Open Public Leads",
            checklist=["Review public leads", "Accept or decline homeowner request"],
        ),
        SECTION_DRAFT_AGREEMENT: _section(
            visible=has_converted_opportunity,
            completed=False,
            dismissed=contractor.has_seen_draft_agreement_intro,
            title="Draft agreements are starting points",
            description=(
                "Draft agreements are starting points, not final contracts. "
                "Nothing has been sent to a homeowner without your confirmation."
            ),
            action_url=f"/app/agreements/{latest_agreement_id}/wizard?step=1" if latest_agreement_id else "",
            action_label="Open Draft Agreement",
            checklist=["Open draft agreement", "Finish agreement setup"],
        ),
        SECTION_TRADITIONAL: _section(
            visible=activation_type == Contractor.ACTIVATION_TRADITIONAL_SIGNUP,
            completed=traditional_completed,
            dismissed=contractor.has_completed_guided_activation,
            title="Finish your MyHomeBro setup",
            description="Complete the essentials so you can create your first agreement and receive protected payments.",
            action_url="/app/profile",
            action_label="Open My Profile",
            checklist=["Complete profile", "Finish Stripe onboarding", "Create first agreement"],
        ),
    }

    should_show = any(
        section["visible"] and not section["completed"] and not section["dismissed"]
        for section in guide_sections.values()
    )

    return {
        "activation_type": activation_type,
        "has_prefilled_profile": has_prefilled_profile,
        "has_pending_opportunities": has_pending_opportunities,
        "pending_opportunity_count": pending_count,
        "has_converted_opportunity": has_converted_opportunity,
        "latest_agreement_id": latest_agreement_id,
        "latest_agreement_url": f"/app/agreements/{latest_agreement_id}/wizard?step=1" if latest_agreement_id else "",
        "should_show_activation_guide": should_show,
        "guide_sections": guide_sections,
        "priority_summary": _build_priority_summary(contractor),
    }


def dismiss_contractor_activation_section(contractor: Contractor, section: str) -> dict[str, Any]:
    if section not in VALID_DISMISS_SECTIONS:
        raise ValueError("Unknown activation guide section.")

    update_fields: list[str] = []
    if section in {SECTION_PREFILLED_PROFILE, SECTION_ALL}:
        contractor.has_seen_prefilled_profile_intro = True
        update_fields.append("has_seen_prefilled_profile_intro")
    if section in {SECTION_PUBLIC_LEADS, SECTION_ALL}:
        contractor.has_seen_public_leads_intro = True
        update_fields.append("has_seen_public_leads_intro")
    if section in {SECTION_DRAFT_AGREEMENT, SECTION_ALL}:
        contractor.has_seen_draft_agreement_intro = True
        update_fields.append("has_seen_draft_agreement_intro")
    if section in {SECTION_TRADITIONAL, SECTION_ALL}:
        contractor.has_completed_guided_activation = True
        update_fields.append("has_completed_guided_activation")

    if update_fields:
        contractor.save(update_fields=list(dict.fromkeys(update_fields)))
    return build_contractor_activation_summary(contractor, mark_seen=False)
