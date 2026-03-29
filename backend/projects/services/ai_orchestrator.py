from __future__ import annotations

from dataclasses import dataclass
from typing import Any

from django.utils import timezone

from projects.models import Agreement, AgreementAIScope, Contractor, Milestone, PublicContractorLead
from projects.models_subcontractor import SubcontractorInvitation
from projects.models_templates import ProjectTemplate
from projects.services.compliance import (
    get_agreement_compliance_warning,
    get_compliance_warning_for_trade,
    normalize_trade_key,
)
from projects.services.contractor_onboarding import build_onboarding_snapshot
from projects.services.activity_feed import get_next_best_action
from projects.services.estimation_engine import build_project_estimate
from projects.services.recurring_maintenance import build_recurring_preview
from projects.services.regions import build_normalized_region_key
from projects.services.subcontractor_compliance import evaluate_subcontractor_assignment_compliance
from projects.services.template_discovery import discover_templates


ORCHESTRATION_VERSION = "2026-03-27-orchestrator-v1"
LOW_CONFIDENCE_THRESHOLD = "low"


@dataclass
class OrchestratorRuntimeContext:
    contractor: Contractor | None
    request_context: dict[str, Any]
    agreement: Agreement | None = None
    lead: PublicContractorLead | None = None
    template: ProjectTemplate | None = None
    milestone: Milestone | None = None
    subcontractor_invitation: SubcontractorInvitation | None = None


def _safe_text(value: Any) -> str:
    return str(value or "").strip()


def _safe_int(value: Any, default: int = 0) -> int:
    try:
        if value in (None, ""):
            return default
        return int(value)
    except Exception:
        return default


def _safe_dict(value: Any) -> dict[str, Any]:
    return dict(value) if isinstance(value, dict) else {}


def _safe_list(value: Any) -> list[Any]:
    return list(value) if isinstance(value, (list, tuple)) else []


def _normalize_user_request(payload: dict[str, Any]) -> dict[str, Any]:
    return {
        "input": _safe_text(payload.get("input")),
        "preferred_intent": _safe_text(payload.get("preferredIntent") or payload.get("preferred_intent")),
        "context": _safe_dict(payload.get("context")),
        "previous_plan": _safe_dict(payload.get("previousPlan") or payload.get("previous_plan")),
    }


def _extract_context_text(context: dict[str, Any], *keys: str) -> str:
    for key in keys:
        value = context.get(key)
        if isinstance(value, dict):
            continue
        text = _safe_text(value)
        if text:
            return text
    return ""


def _normalize_orchestrator_context(context: dict[str, Any]) -> dict[str, Any]:
    agreement_summary = _safe_dict(context.get("agreement_summary"))
    lead_summary = _safe_dict(context.get("lead_summary"))
    template_summary = _safe_dict(context.get("template_summary"))
    milestone_summary = _safe_dict(context.get("milestone_summary"))
    return {
        "current_route": _safe_text(context.get("current_route")),
        "agreement_id": _safe_int(context.get("agreement_id")) or None,
        "lead_id": _safe_int(context.get("lead_id")) or None,
        "template_id": _safe_int(context.get("template_id")) or None,
        "milestone_id": _safe_int(context.get("milestone_id") or milestone_summary.get("id")) or None,
        "subcontractor_invitation_id": _safe_int(
            context.get("subcontractor_invitation_id")
            or context.get("invitation_id")
            or milestone_summary.get("subcontractor_invitation_id")
        )
        or None,
        "agreement_summary": agreement_summary,
        "lead_summary": lead_summary,
        "template_summary": template_summary,
        "milestone_summary": milestone_summary,
        "project_type": _extract_context_text(context, "project_type", "projectType")
        or _safe_text(agreement_summary.get("project_type"))
        or _safe_text(lead_summary.get("project_type"))
        or _safe_text(template_summary.get("project_type")),
        "project_subtype": _extract_context_text(context, "project_subtype", "projectSubtype")
        or _safe_text(agreement_summary.get("project_subtype"))
        or _safe_text(lead_summary.get("project_subtype"))
        or _safe_text(template_summary.get("project_subtype")),
        "region_city": _extract_context_text(context, "region_city", "city")
        or _safe_text(agreement_summary.get("project_address_city"))
        or _safe_text(lead_summary.get("city")),
        "region_state": _extract_context_text(context, "region_state", "state")
        or _safe_text(agreement_summary.get("project_address_state"))
        or _safe_text(lead_summary.get("state")),
        "normalized_region_key": _extract_context_text(context, "normalized_region_key"),
        "trade_key": _safe_text(context.get("trade_key") or milestone_summary.get("trade_key")),
        "template_query": _safe_text(context.get("template_query")),
        "language": _safe_text(context.get("language") or context.get("locale")),
    }


def _serialize_missing_field(key: str, prompt: str, *, blocking: bool = True) -> dict[str, Any]:
    return {
        "key": key,
        "label": key.replace("_", " ").strip(),
        "prompt": prompt,
        "blocking": blocking,
    }


def _build_context_summary(context: dict[str, Any], runtime: OrchestratorRuntimeContext) -> str:
    if runtime.agreement is not None:
        return f"Agreement #{runtime.agreement.id}"
    if runtime.lead is not None:
        return f"Lead #{runtime.lead.id}"
    if runtime.template is not None:
        return f"Template #{runtime.template.id}"
    if runtime.milestone is not None:
        return f"Milestone #{runtime.milestone.id}"
    return _safe_text(context.get("current_route"))


def _estimate_route_for_agreement(agreement: Agreement | None, step: int | None = None) -> str:
    if agreement is None:
        return f"/app/agreements/new/wizard?step={step or 1}"
    return f"/app/agreements/{agreement.id}/wizard?step={step or 1}"


def _template_region_label(template: ProjectTemplate) -> str:
    region_key = _safe_text(getattr(template, "normalized_region_key", ""))
    if not region_key:
        return "National"
    return region_key.replace("-", " ")


def _serialize_template_card(template: ProjectTemplate) -> dict[str, Any]:
    return {
        "id": template.id,
        "name": template.name,
        "project_type": _safe_text(template.project_type),
        "project_subtype": _safe_text(template.project_subtype),
        "visibility": _safe_text(template.visibility or ("system" if template.is_system else "")),
        "source_label": "system" if template.is_system else _safe_text(template.visibility),
        "normalized_region_key": _safe_text(template.normalized_region_key),
        "region_label": _template_region_label(template),
        "benchmark_match_key": _safe_text(template.benchmark_match_key),
        "rank_score": getattr(template, "rank_score", 0),
        "rank_reasons": _safe_list(getattr(template, "rank_reasons", [])),
        "region_match_scope": _safe_text(getattr(template, "region_match_scope", "")),
        "usage_count": int(getattr(template, "usage_count", 0) or 0),
        "completed_project_count": int(getattr(template, "_completed_project_count", 0) or 0),
        "has_seeded_benchmark": bool(getattr(template, "benchmark_profile_id", None)),
        "has_learned_benchmark": int(getattr(template, "_completed_project_count", 0) or 0) > 0,
        "milestone_count": int(getattr(template, "template_milestone_count", 0) or template.milestones.count()),
        "has_clarifications": bool(getattr(template, "default_clarifications", None)),
    }


def _serialize_template_preview(template: ProjectTemplate | None) -> dict[str, Any]:
    if template is None:
        return {}
    return {
        "id": template.id,
        "name": template.name,
        "default_scope": _safe_text(getattr(template, "default_scope", "")),
        "clarifications": _safe_list(getattr(template, "default_clarifications", []))[:5],
        "milestones": [
            {
                "title": _safe_text(row.title),
                "description": _safe_text(row.description),
                "suggested_amount_fixed": str(row.suggested_amount_fixed) if getattr(row, "suggested_amount_fixed", None) is not None else "",
                "recommended_duration_days": getattr(row, "recommended_duration_days", None),
                "sort_order": getattr(row, "sort_order", None),
            }
            for row in template.milestones.all()[:5]
        ],
    }


def _extract_agreement_answers(agreement: Agreement | None) -> dict[str, Any]:
    scope = getattr(agreement, "ai_scope", None)
    answers = getattr(scope, "answers", None) if isinstance(scope, AgreementAIScope) else None
    return dict(answers or {}) if isinstance(answers, dict) else {}


def _intent_from_request(normalized_request: dict[str, Any], context: dict[str, Any]) -> str:
    preferred = _safe_text(normalized_request.get("preferred_intent"))
    if preferred:
        return preferred

    text = _safe_text(normalized_request.get("input")).lower()
    if any(token in text for token in ("maintenance", "recurring", "monthly", "quarterly", "service plan")):
        return "maintenance_contract"
    if any(token in text for token in ("onboarding", "finish setup", "first project", "first agreement", "why do i need stripe", "connect stripe", "help me finish setup")):
        return "contractor_onboarding"
    if any(token in text for token in ("subcontractor", "assign anyway", "request license", "choose another")):
        return "subcontractor_assignment"
    if any(token in text for token in ("license", "compliance", "insurance", "warning", "permit")):
        return "check_compliance"
    if any(token in text for token in ("estimate", "pricing", "timeline", "price this", "why did the estimate")):
        return "estimate_project"
    if any(token in text for token in ("template", "starter", "recommend a template", "best template")):
        return "apply_template"
    if any(token in text for token in ("lead", "intake", "start an agreement for this lead")):
        return "create_lead" if context.get("lead_id") else "start_agreement"
    if any(token in text for token in ("missing", "continue", "finish", "resume", "what should i do next", "why can't i send")):
        return "resume_agreement"
    if any(token in text for token in ("milestone", "build phases", "scope breakdown")):
        return "suggest_milestones"
    if any(token in text for token in ("agreement", "contract")):
        return "start_agreement"
    if any(token in text for token in ("go to", "open ", "take me")):
        return "navigate_app"
    return "navigate_app"


def _load_runtime_context(contractor: Contractor | None, context: dict[str, Any]) -> OrchestratorRuntimeContext:
    runtime = OrchestratorRuntimeContext(contractor=contractor, request_context=context)
    if contractor is None:
        return runtime

    if context.get("agreement_id"):
        runtime.agreement = (
            Agreement.objects.select_related("selected_template", "source_lead", "contractor")
            .filter(id=context["agreement_id"], contractor=contractor)
            .first()
        )
    if context.get("lead_id"):
        runtime.lead = (
            PublicContractorLead.objects.select_related("converted_agreement", "converted_homeowner")
            .filter(id=context["lead_id"], contractor=contractor)
            .first()
        )
    if context.get("template_id"):
        runtime.template = (
            ProjectTemplate.objects.filter(id=context["template_id"], is_active=True, contractor=contractor).first()
            or ProjectTemplate.objects.filter(id=context["template_id"], is_system=True, is_active=True).first()
        )
    if context.get("milestone_id"):
        runtime.milestone = (
            Milestone.objects.select_related("agreement", "assigned_subcontractor_invitation")
            .filter(id=context["milestone_id"], agreement__contractor=contractor)
            .first()
        )
    if context.get("subcontractor_invitation_id"):
        runtime.subcontractor_invitation = (
            SubcontractorInvitation.objects.filter(id=context["subcontractor_invitation_id"], contractor=contractor).first()
        )
    if runtime.milestone is not None and runtime.agreement is None:
        runtime.agreement = runtime.milestone.agreement
    if runtime.agreement is not None and runtime.template is None and runtime.agreement.selected_template_id:
        runtime.template = runtime.agreement.selected_template
    if runtime.agreement is not None and runtime.lead is None and runtime.agreement.source_lead_id:
        runtime.lead = runtime.agreement.source_lead
    return runtime


def _build_available_actions(items: list[dict[str, Any]]) -> list[dict[str, Any]]:
    return [
        {
            "key": _safe_text(item.get("key")),
            "label": _safe_text(item.get("label")),
            "confirmation_required": bool(item.get("confirmation_required")),
            "navigation_target": _safe_text(item.get("navigation_target")),
            "action_type": _safe_text(item.get("action_type") or item.get("key")),
        }
        for item in items
        if _safe_text(item.get("key")) and _safe_text(item.get("label"))
    ]


def _lead_intake_specialist(runtime: OrchestratorRuntimeContext) -> dict[str, Any]:
    lead = runtime.lead
    if lead is None:
        return {
            "routine_name": "lead_intake",
            "intent": "create_lead",
            "recommended_action": {
                "type": "navigate",
                "label": "Open Lead Inbox",
                "action_key": "open_lead_inbox",
                "navigation_target": "/app/public-presence",
            },
            "available_actions": _build_available_actions(
                [{"key": "open_lead_inbox", "label": "Open Lead Inbox", "navigation_target": "/app/public-presence"}]
            ),
            "required_missing_fields": [
                _serialize_missing_field("lead_reference", "Select a lead before using lead-intake actions."),
            ],
            "warnings": [],
            "suggestions": ["Open the lead inbox to capture or review a lead before starting an agreement."],
            "handoff_payload": {},
            "preview_data": {},
            "confidence": "low",
            "confidence_reasoning": "Lead-specific actions need a lead context.",
            "source_metadata": {},
        }

    if lead.converted_agreement_id:
        return {
            "routine_name": "lead_intake",
            "intent": "create_lead",
            "recommended_action": {
                "type": "navigate",
                "label": "Open Existing Draft Agreement",
                "action_key": "open_existing_agreement",
                "navigation_target": f"/app/agreements/{lead.converted_agreement_id}/wizard?step=1",
            },
            "available_actions": _build_available_actions(
                [
                    {
                        "key": "open_existing_agreement",
                        "label": "Open Existing Draft Agreement",
                        "navigation_target": f"/app/agreements/{lead.converted_agreement_id}/wizard?step=1",
                    },
                    {"key": "open_lead_inbox", "label": "Open Lead Inbox", "navigation_target": "/app/public-presence"},
                ]
            ),
            "required_missing_fields": [],
            "warnings": [],
            "suggestions": ["This lead already has a draft agreement, so resuming that draft is the cleanest next step."],
            "handoff_payload": {"draft_payload": {"lead_id": lead.id}},
            "preview_data": {
                "lead_status": lead.status,
                "lead_id": lead.id,
                "converted_agreement_id": lead.converted_agreement_id,
            },
            "confidence": "high",
            "confidence_reasoning": "The lead already points to a specific agreement.",
            "source_metadata": {"lead_status": lead.status},
        }

    ai_analysis = _safe_dict(getattr(lead, "ai_analysis", {}))
    if lead.source == PublicContractorLead.SOURCE_MANUAL and not _safe_text(lead.project_description) and not ai_analysis:
        return {
            "routine_name": "lead_intake",
            "intent": "create_lead",
            "recommended_action": {
                "type": "invoke_workflow",
                "label": "Request Intake Details",
                "action_key": "send_intake_form",
                "navigation_target": "/app/public-presence",
            },
            "available_actions": _build_available_actions(
                [
                    {"key": "send_intake_form", "label": "Request Intake Details", "navigation_target": "/app/public-presence"},
                    {"key": "open_lead_inbox", "label": "Review Lead", "navigation_target": "/app/public-presence"},
                ]
            ),
            "required_missing_fields": [
                _serialize_missing_field("project_summary", "Project scope details are still missing for this lead."),
            ],
            "warnings": ["The lead still needs scope details before template and estimate suggestions will be strong."],
            "suggestions": ["Send intake first so the agreement draft has real project details to work from."],
            "handoff_payload": {"draft_payload": {"lead_id": lead.id}},
            "preview_data": {"lead_id": lead.id, "lead_status": lead.status},
            "confidence": "high",
            "confidence_reasoning": "The lead is manual and still missing scope details.",
            "source_metadata": {"lead_status": lead.status, "lead_source": lead.source},
        }

    return {
        "routine_name": "lead_intake",
        "intent": "create_lead",
        "recommended_action": {
            "type": "invoke_workflow",
            "label": "Create Draft Agreement From Lead",
            "action_key": "create_agreement_from_lead",
            "navigation_target": "/app/public-presence",
        },
        "available_actions": _build_available_actions(
            [
                {"key": "create_agreement_from_lead", "label": "Create Draft Agreement From Lead", "navigation_target": "/app/public-presence"},
                {"key": "open_lead_inbox", "label": "Open Lead Inbox", "navigation_target": "/app/public-presence"},
            ]
        ),
        "required_missing_fields": [],
        "warnings": [],
        "suggestions": ["This lead has enough context to move into the agreement workflow."],
        "handoff_payload": {
            "draft_payload": {
                "lead_id": lead.id,
                "customer_name": _safe_text(lead.full_name),
                "project_summary": _safe_text(lead.project_description),
                "project_type": _safe_text(lead.project_type),
            }
        },
        "preview_data": {"lead_id": lead.id, "ai_analysis": ai_analysis},
        "confidence": "high",
        "confidence_reasoning": "Lead context is present and can be handed off directly into the agreement flow.",
        "source_metadata": {"lead_status": lead.status, "lead_source": lead.source},
    }


def _agreement_builder_specialist(runtime: OrchestratorRuntimeContext) -> dict[str, Any]:
    agreement = runtime.agreement
    lead = runtime.lead
    if agreement is None and lead is None:
        return {
            "routine_name": "agreement_builder",
            "intent": "start_agreement",
            "recommended_action": {
                "type": "navigate",
                "label": "Open Agreement Wizard",
                "action_key": "open_wizard_step",
                "navigation_target": "/app/agreements/new/wizard?step=1",
            },
            "available_actions": _build_available_actions(
                [{"key": "open_wizard_step", "label": "Open Agreement Wizard", "navigation_target": "/app/agreements/new/wizard?step=1"}]
            ),
            "required_missing_fields": [
                _serialize_missing_field("project_summary", "Add a project summary or select a lead before starting an agreement."),
            ],
            "warnings": [],
            "suggestions": ["Use a lead or template to start with a stronger draft."],
            "handoff_payload": {"wizard_step_target": 1},
            "preview_data": {},
            "confidence": "medium",
            "confidence_reasoning": "The agreement builder can open the wizard, but there is no active lead or agreement context yet.",
            "source_metadata": {},
        }

    if agreement is None and lead is not None:
        project_summary = _safe_text(lead.project_description)
        return {
            "routine_name": "agreement_builder",
            "intent": "start_agreement",
            "recommended_action": {
                "type": "navigate",
                "label": "Open Agreement Wizard",
                "action_key": "open_wizard_step",
                "navigation_target": "/app/agreements/new/wizard?step=1",
            },
            "available_actions": _build_available_actions(
                [{"key": "open_wizard_step", "label": "Open Agreement Wizard", "navigation_target": "/app/agreements/new/wizard?step=1"}]
            ),
            "required_missing_fields": (
                [_serialize_missing_field("project_summary", "Add scope details before finalizing the draft.")] if not project_summary else []
            ),
            "warnings": [],
            "suggestions": ["Lead details can prefill Step 1 so you do not need to retype the customer and project info."],
            "handoff_payload": {
                "wizard_step_target": 1,
                "prefill_fields": {
                    "customer_name": _safe_text(lead.full_name),
                    "project_summary": project_summary,
                    "project_title": _safe_text(lead.project_type),
                    "project_type": _safe_text(lead.project_type),
                    "project_subtype": _safe_text(_safe_dict(getattr(lead, "ai_analysis", {})).get("project_subtype")),
                },
                "draft_payload": {"lead_id": lead.id},
            },
            "preview_data": {"lead_id": lead.id},
            "confidence": "high",
            "confidence_reasoning": "Lead context can prefill the agreement draft directly.",
            "source_metadata": {"lead_id": lead.id},
        }

    customer_name = _safe_text(getattr(agreement.homeowner, "full_name", ""))
    project_summary = _safe_text(agreement.description or agreement.project_subtype or agreement.project_type)
    milestone_count = int(getattr(agreement, "milestone_count", 0) or agreement.milestones.count())
    missing_fields = []
    warnings = []
    wizard_step_target = 4
    action_label = "Open Finalize Step"
    if not customer_name:
        missing_fields.append(_serialize_missing_field("customer_name", "Customer is still missing from this agreement."))
        warnings.append("The agreement still needs a customer before it can move forward.")
        wizard_step_target = 1
        action_label = "Finish Agreement Details"
    elif not project_summary:
        missing_fields.append(_serialize_missing_field("project_summary", "Project scope summary is still missing."))
        warnings.append("The agreement still needs a project summary.")
        wizard_step_target = 1
        action_label = "Finish Agreement Details"
    elif milestone_count <= 0:
        warnings.append("No milestones are saved yet.")
        wizard_step_target = 2
        action_label = "Open Milestone Builder"
    elif _extract_agreement_answers(agreement) == {}:
        wizard_step_target = 2
        action_label = "Review Clarifications"
        warnings.append("Clarifications are still light, so pricing confidence may stay broad.")

    return {
        "routine_name": "agreement_builder",
        "intent": "resume_agreement" if runtime.agreement is not None else "start_agreement",
        "recommended_action": {
            "type": "open_wizard_step",
            "label": action_label,
            "action_key": "open_wizard_step",
            "navigation_target": _estimate_route_for_agreement(agreement, wizard_step_target),
        },
        "available_actions": _build_available_actions(
            [
                {
                    "key": "open_wizard_step",
                    "label": action_label,
                    "navigation_target": _estimate_route_for_agreement(agreement, wizard_step_target),
                },
                {"key": "open_templates", "label": "Review Templates", "navigation_target": "/app/templates"},
            ]
        ),
        "required_missing_fields": missing_fields,
        "warnings": warnings,
        "suggestions": ["Use the next step the wizard is missing instead of scanning the whole agreement manually."],
        "handoff_payload": {
            "wizard_step_target": wizard_step_target,
            "prefill_fields": {"customer_name": customer_name, "project_summary": project_summary},
            "draft_payload": {
                "agreement_id": agreement.id,
                "selected_template_id": agreement.selected_template_id,
                "milestone_count": milestone_count,
            },
        },
        "preview_data": {
            "agreement_id": agreement.id,
            "project_type": _safe_text(agreement.project_type),
            "project_subtype": _safe_text(agreement.project_subtype),
            "milestone_count": milestone_count,
        },
        "confidence": "high" if runtime.agreement is not None else "medium",
        "confidence_reasoning": "Agreement context is loaded and the next missing workflow step is deterministic.",
        "source_metadata": {"agreement_id": agreement.id, "selected_template_id": agreement.selected_template_id},
    }


def _template_recommender_specialist(runtime: OrchestratorRuntimeContext) -> dict[str, Any]:
    context = runtime.request_context
    project_type = _safe_text(context.get("project_type") or getattr(runtime.agreement, "project_type", ""))
    project_subtype = _safe_text(context.get("project_subtype") or getattr(runtime.agreement, "project_subtype", ""))
    region_state = _safe_text(context.get("region_state") or getattr(runtime.agreement, "project_address_state", ""))
    region_city = _safe_text(context.get("region_city") or getattr(runtime.agreement, "project_address_city", ""))
    query = _safe_text(context.get("template_query"))

    result = discover_templates(
        contractor=runtime.contractor,
        source="all",
        project_type=project_type,
        project_subtype=project_subtype,
        query=query,
        sort="relevant",
        region_state=region_state,
        region_city=region_city,
        normalized_region_key=_safe_text(context.get("normalized_region_key")),
    )
    recommendations = [_serialize_template_card(template) for template in result["results"][:3]]
    top = recommendations[0] if recommendations else None
    top_template = result["results"][0] if result["results"] else None
    missing_fields = []
    if not project_type:
        missing_fields.append(_serialize_missing_field("project_type", "Project type will improve template recommendations."))

    return {
        "routine_name": "template_recommender",
        "intent": "apply_template",
        "recommended_action": {
            "type": "navigate",
            "label": "Open Template Marketplace",
            "action_key": "open_templates",
            "navigation_target": "/app/templates",
        },
        "available_actions": _build_available_actions(
            [
                {"key": "open_templates", "label": "Open Template Marketplace", "navigation_target": "/app/templates"},
                {"key": "preview_top_template", "label": "Preview Top Template", "navigation_target": "/app/templates"},
            ]
        ),
        "required_missing_fields": missing_fields,
        "warnings": [],
        "suggestions": [
            (
                f"Recommended because it matches {_safe_text(top.get('project_subtype') or top.get('project_type'))}"
                f"{' and ' + _safe_text(top.get('region_label')) if top and _safe_text(top.get('region_label')) else ''}."
            )
            if top
            else "No close template match was found, so the broader template library is the best next step."
        ],
        "handoff_payload": {
            "prefill_fields": {"template_query": query or project_subtype or project_type},
            "draft_payload": {"selected_template_id": top['id'] if top else None},
        },
        "preview_data": {
            "templates": recommendations,
            "normalized_region_key": result["meta"].get("normalized_region_key"),
            "rank_explanation": list(top.get("rank_reasons") or []) if top else [],
            "top_template_preview": _serialize_template_preview(top_template),
        },
        "confidence": "high" if top else "medium",
        "confidence_reasoning": (
            "Template ranking used deterministic project-type, subtype, region, and usage signals."
            if top
            else "The marketplace is available, but no strong exact match was found."
        ),
        "source_metadata": result["meta"],
    }


def _estimation_specialist(runtime: OrchestratorRuntimeContext) -> dict[str, Any]:
    agreement = runtime.agreement
    if agreement is None:
        return {
            "routine_name": "estimation",
            "intent": "estimate_project",
            "recommended_action": {
                "type": "navigate",
                "label": "Open Agreement Pricing Step",
                "action_key": "open_wizard_step",
                "navigation_target": "/app/agreements/new/wizard?step=2",
            },
            "available_actions": _build_available_actions(
                [{"key": "open_wizard_step", "label": "Open Agreement Pricing Step", "navigation_target": "/app/agreements/new/wizard?step=2"}]
            ),
            "required_missing_fields": [
                _serialize_missing_field("agreement_reference", "Save or select an agreement before requesting a project estimate."),
            ],
            "warnings": [],
            "suggestions": ["The estimation engine works best from a saved agreement with scope and location context."],
            "handoff_payload": {"wizard_step_target": 2},
            "preview_data": {},
            "confidence": "low",
            "confidence_reasoning": "Estimate previews need agreement context so seeded and learned data can resolve correctly.",
            "source_metadata": {},
        }

    estimate = build_project_estimate(agreement=agreement)
    return {
        "routine_name": "estimation",
        "intent": "estimate_project",
        "recommended_action": {
            "type": "open_wizard_step",
            "label": "Review Estimate In Step 2",
            "action_key": "open_wizard_step",
            "navigation_target": _estimate_route_for_agreement(agreement, 2),
        },
        "available_actions": _build_available_actions(
            [
                {"key": "review_estimate", "label": "Review Estimate In Step 2", "navigation_target": _estimate_route_for_agreement(agreement, 2)},
                {
                    "key": "apply_estimate_in_workflow",
                    "label": "Apply Suggestions In Workflow",
                    "navigation_target": _estimate_route_for_agreement(agreement, 2),
                    "confirmation_required": True,
                },
            ]
        ),
        "required_missing_fields": [],
        "warnings": [],
        "suggestions": list(estimate.get("explanation_lines") or [])[:3],
        "handoff_payload": {
            "wizard_step_target": 2,
            "suggested_milestones": estimate.get("milestone_suggestions") or [],
            "draft_payload": {"agreement_id": agreement.id},
        },
        "preview_data": estimate,
        "confidence": _safe_text(estimate.get("confidence_level") or "medium"),
        "confidence_reasoning": _safe_text(estimate.get("confidence_reasoning")),
        "source_metadata": _safe_dict(estimate.get("source_metadata")),
    }


def _compliance_specialist(runtime: OrchestratorRuntimeContext) -> dict[str, Any]:
    agreement = runtime.agreement
    context = runtime.request_context
    trade_key = _safe_text(context.get("trade_key"))
    state_code = _safe_text(context.get("region_state"))
    subcontractor_invitation = runtime.subcontractor_invitation
    if runtime.milestone is not None and subcontractor_invitation is not None:
        evaluation = evaluate_subcontractor_assignment_compliance(
            contractor=runtime.contractor,
            invitation=subcontractor_invitation,
            agreement=agreement,
            milestone=runtime.milestone,
        )
        return {
            "routine_name": "compliance",
            "intent": "check_compliance",
            "recommended_action": {
                "type": "navigate",
                "label": "Review Assignment Compliance",
                "action_key": "review_assignment_compliance",
                "navigation_target": f"/app/agreements/{agreement.id}",
            },
            "available_actions": _build_available_actions(
                [
                    {
                        "key": action,
                        "label": action.replace("_", " ").title(),
                        "navigation_target": f"/app/agreements/{agreement.id}",
                        "confirmation_required": action in {"assign_anyway", "request_license"},
                    }
                    for action in _safe_list(evaluation.get("available_actions"))
                ]
            ),
            "required_missing_fields": [],
            "warnings": [evaluation.get("warning_message")] if evaluation.get("warning_message") else [],
            "suggestions": (
                [f"Compliance warning triggered because {evaluation.get('trade_label')} work in {evaluation.get('state_code')} typically requires a license."]
                if evaluation.get("license_required")
                else []
            ),
            "handoff_payload": {"draft_payload": {"milestone_id": runtime.milestone.id, "subcontractor_invitation_id": subcontractor_invitation.id}},
            "preview_data": evaluation,
            "confidence": "high",
            "confidence_reasoning": "Compliance status used the seeded state-trade rules and the subcontractor's records on file.",
            "source_metadata": _safe_dict(evaluation.get("source_metadata")),
        }

    warning = {}
    if agreement is not None:
        warning = get_agreement_compliance_warning(agreement)
        trade_key = trade_key or _safe_text(warning.get("trade_key"))
        state_code = state_code or _safe_text(warning.get("state_code"))
    elif state_code and trade_key:
        warning = get_compliance_warning_for_trade(state_code, trade_key, runtime.contractor)
    else:
        trade_key = trade_key or normalize_trade_key(_safe_text(context.get("project_subtype") or context.get("project_type")))
        state_code = state_code or _safe_text(context.get("region_state"))
        if state_code and trade_key:
            warning = get_compliance_warning_for_trade(state_code, trade_key, runtime.contractor)

    available_actions = [{"key": "open_profile", "label": "Upload Compliance Documents", "navigation_target": "/app/profile"}]
    if agreement is not None:
        available_actions.insert(0, {"key": "open_agreement", "label": "Open Agreement", "navigation_target": f"/app/agreements/{agreement.id}"})

    return {
        "routine_name": "compliance",
        "intent": "check_compliance",
        "recommended_action": {
            "type": "navigate",
            "label": "Review Compliance Context",
            "action_key": "review_compliance",
            "navigation_target": f"/app/agreements/{agreement.id}" if agreement is not None else "/app/profile",
        },
        "available_actions": _build_available_actions(available_actions),
        "required_missing_fields": ([] if warning else [_serialize_missing_field("trade_or_state", "Add a trade and state to check licensing requirements.")]),
        "warnings": [warning.get("message")] if _safe_text(warning.get("message")) else [],
        "suggestions": (
            [f"Compliance warning triggered because {trade_key.replace('_', ' ').title()} work in {state_code} typically requires a license."]
            if warning.get("required")
            else []
        ),
        "handoff_payload": {"draft_payload": {"trade_key": trade_key, "state_code": state_code}},
        "preview_data": warning,
        "confidence": "high" if warning else "low",
        "confidence_reasoning": (
            "Compliance guidance used the seeded licensing rules and on-file contractor records."
            if warning
            else "Compliance checks need a state and trade to resolve."
        ),
        "source_metadata": {"trade_key": trade_key, "state_code": state_code},
    }


def _subcontractor_assignment_specialist(runtime: OrchestratorRuntimeContext) -> dict[str, Any]:
    if runtime.milestone is None or runtime.subcontractor_invitation is None:
        return {
            "routine_name": "subcontractor_assignment",
            "intent": "subcontractor_assignment",
            "recommended_action": {
                "type": "navigate",
                "label": "Open Subcontractor Assignment",
                "action_key": "open_assignment_flow",
                "navigation_target": "/app/subcontractors",
            },
            "available_actions": _build_available_actions(
                [{"key": "open_assignment_flow", "label": "Open Subcontractor Assignment", "navigation_target": "/app/subcontractors"}]
            ),
            "required_missing_fields": [
                _serialize_missing_field("assignment_context", "Select both a milestone and a subcontractor before reviewing assignment compliance."),
            ],
            "warnings": [],
            "suggestions": ["Assignment decisions stay deterministic when the milestone and subcontractor are already selected."],
            "handoff_payload": {},
            "preview_data": {},
            "confidence": "low",
            "confidence_reasoning": "Assignment evaluation needs a milestone and subcontractor context.",
            "source_metadata": {},
        }

    evaluation = evaluate_subcontractor_assignment_compliance(
        contractor=runtime.contractor,
        invitation=runtime.subcontractor_invitation,
        agreement=runtime.agreement,
        milestone=runtime.milestone,
    )
    confirmation_required = evaluation.get("compliance_status") in {
        "missing_license",
        "missing_insurance",
        "pending_license",
        "overridden",
    }
    return {
        "routine_name": "subcontractor_assignment",
        "intent": "subcontractor_assignment",
        "recommended_action": {
            "type": "navigate",
            "label": "Review Assignment Options",
            "action_key": "review_assignment_options",
            "navigation_target": f"/app/agreements/{runtime.agreement.id}",
            "confirmation_required": confirmation_required,
        },
        "available_actions": _build_available_actions(
            [
                {
                    "key": action,
                    "label": action.replace("_", " ").title(),
                    "navigation_target": f"/app/agreements/{runtime.agreement.id}",
                    "confirmation_required": action in {"assign_anyway", "request_license"},
                }
                for action in _safe_list(evaluation.get("available_actions"))
            ]
        ),
        "required_missing_fields": [],
        "warnings": [evaluation.get("warning_message")] if evaluation.get("warning_message") else [],
        "suggestions": ["Use request license when you want a traceable middle path instead of overriding immediately."],
        "handoff_payload": {
            "draft_payload": {
                "milestone_id": runtime.milestone.id,
                "subcontractor_invitation_id": runtime.subcontractor_invitation.id,
            }
        },
        "preview_data": evaluation,
        "confidence": "high",
        "confidence_reasoning": "Assignment options are based on the actual milestone, subcontractor, and state-trade compliance rule.",
        "source_metadata": _safe_dict(evaluation.get("source_metadata")),
    }


def _maintenance_contract_specialist(runtime: OrchestratorRuntimeContext) -> dict[str, Any]:
    context = runtime.request_context
    project_type = _safe_text(context.get("project_type") or getattr(runtime.agreement, "project_type", "")) or "Maintenance"
    project_subtype = _safe_text(context.get("project_subtype") or getattr(runtime.agreement, "project_subtype", ""))
    cadence = "monthly"
    if "quarter" in _safe_text(context.get("current_route")).lower():
        cadence = "quarterly"
    elif "hvac" in f"{project_type} {project_subtype}".lower():
        cadence = "quarterly"

    agreement = runtime.agreement
    recurring_preview = build_recurring_preview(agreement, horizon=3) if agreement is not None else {}
    recurrence_start_date = _safe_text(
        context.get("recurrence_start_date")
        or getattr(agreement, "recurrence_start_date", "")
        or timezone.now().date().isoformat()
    )
    recurrence_interval = _safe_int(
        context.get("recurrence_interval") or getattr(agreement, "recurrence_interval", 1),
        1,
    )
    recurrence_pattern = (
        _safe_text(context.get("recurrence_pattern") or getattr(agreement, "recurrence_pattern", ""))
        or cadence
    )
    recurring_summary_label = (
        _safe_text(context.get("recurring_summary_label") or getattr(agreement, "recurring_summary_label", ""))
        or f"{cadence.title()} {project_subtype or project_type}"
    )

    return {
        "routine_name": "maintenance_contract",
        "intent": "maintenance_contract",
        "recommended_action": {
            "type": "navigate",
            "label": "Prepare Agreement Draft",
            "action_key": "open_wizard_step",
            "navigation_target": _estimate_route_for_agreement(runtime.agreement, 1),
        },
        "available_actions": _build_available_actions(
            [{"key": "open_wizard_step", "label": "Prepare Agreement Draft", "navigation_target": _estimate_route_for_agreement(runtime.agreement, 1)}]
        ),
        "required_missing_fields": [],
        "warnings": ["Recurring-service orchestration is still a preparation preview in this phase."],
        "suggestions": [f"Suggested cadence: every {recurrence_interval} {recurrence_pattern}."],
        "handoff_payload": {
            "wizard_step_target": 1,
            "prefill_fields": {
                "project_type": project_type,
                "project_subtype": project_subtype or "Maintenance",
                "project_summary": f"{cadence.title()} maintenance agreement",
                "agreement_mode": "maintenance",
                "recurring_service_enabled": True,
                "recurrence_pattern": recurrence_pattern,
                "recurrence_interval": recurrence_interval,
                "recurrence_start_date": recurrence_start_date,
                "maintenance_status": "active",
                "recurring_summary_label": recurring_summary_label,
            },
        },
        "preview_data": {
            "mode": "maintenance_preview",
            "recommended_frequency": recurrence_pattern,
            "recurrence_interval": recurrence_interval,
            "recurrence_start_date": recurrence_start_date,
            "recurring_summary_label": recurring_summary_label,
            "suggested_milestones": recurring_preview.get("preview_occurrences")
            or [
                {"title": "Visit 1", "description": "Scheduled recurring service visit."},
                {"title": "Visit 2", "description": "Follow-up recurring service visit."},
                {"title": "Visit 3", "description": "Ongoing maintenance cycle."},
            ],
        },
        "confidence": "high" if recurring_preview.get("preview_occurrences") else "medium",
        "confidence_reasoning": "Recurring previews use the structured maintenance cadence fields and deterministic next-occurrence generation rules.",
        "source_metadata": {"preview_only": True, "uses_recurring_preview": bool(recurring_preview)},
    }


def _contractor_onboarding_specialist(runtime: OrchestratorRuntimeContext) -> dict[str, Any]:
    onboarding = build_onboarding_snapshot(runtime.contractor)
    next_step = onboarding.get("step") or "welcome"
    step_labels = {
        "welcome": "Add your trades",
        "region": "Set your service region",
        "first_job": "Start your first agreement",
        "stripe": "Connect Stripe",
        "complete": "Open Dashboard",
    }
    navigation_target = "/app/onboarding"
    if next_step == "first_job":
        navigation_target = "/app/agreements/new/wizard?step=1"
    elif next_step == "complete":
        navigation_target = "/app/dashboard"

    warnings = []
    suggestions = []
    if onboarding.get("show_soft_stripe_prompt"):
        suggestions.append("You're ready to get paid. Connect Stripe now or keep exploring until you need a payment workflow.")
    if not onboarding.get("profile_basics_complete"):
        warnings.append("Your trade and service-area basics are still incomplete.")
    elif not onboarding.get("first_value_reached"):
        suggestions.append("Let's finish your first project so you can reach a real agreement draft quickly.")
    elif not onboarding.get("stripe_ready"):
        suggestions.append("You're one step away from sending payment-ready agreements.")

    return {
        "routine_name": "contractor_onboarding",
        "intent": "contractor_onboarding",
        "recommended_action": {
            "type": "navigate",
            "label": step_labels.get(next_step, "Resume Onboarding"),
            "action_key": "resume_onboarding",
            "navigation_target": navigation_target,
        },
        "available_actions": _build_available_actions(
            [
                {"key": "resume_onboarding", "label": "Resume Onboarding", "navigation_target": "/app/onboarding"},
                {"key": "open_first_job", "label": "Start First Agreement", "navigation_target": "/app/agreements/new/wizard?step=1"},
                {"key": "open_assistant", "label": "Start with AI", "navigation_target": "/app/assistant"},
            ]
        ),
        "required_missing_fields": (
            [_serialize_missing_field("trades", "Add at least one trade to personalize your first-job setup.")]
            if not runtime.contractor or not runtime.contractor.skills.exists()
            else []
        ),
        "warnings": warnings,
        "suggestions": suggestions or ["Use onboarding to reach your first draft quickly, then connect payments only when needed."],
        "handoff_payload": {
            "prefill_fields": {
                "project_type": _safe_text(runtime.request_context.get("project_type")),
                "project_subtype": _safe_text(runtime.request_context.get("project_subtype")),
            }
        },
        "preview_data": {"onboarding": onboarding},
        "confidence": "high",
        "confidence_reasoning": "Onboarding guidance uses the contractor's saved activation state and Stripe readiness flags.",
        "source_metadata": {"onboarding_step": next_step},
    }


def _navigation_specialist(runtime: OrchestratorRuntimeContext) -> dict[str, Any]:
    current_route = _safe_text(runtime.request_context.get("current_route"))
    next_best_action = get_next_best_action(runtime.contractor)
    if next_best_action:
        return {
            "routine_name": "navigation_resume",
            "intent": "navigate_app",
            "recommended_action": {
                "type": "navigate",
                "label": _safe_text(next_best_action.get("title")) or "Open Dashboard",
                "action_key": _safe_text(next_best_action.get("action_type")) or "open_navigation_target",
                "navigation_target": _safe_text(next_best_action.get("navigation_target")) or "/app/dashboard",
            },
            "available_actions": _build_available_actions(
                [
                    {
                        "key": _safe_text(next_best_action.get("action_type")) or "open_navigation_target",
                        "label": _safe_text(next_best_action.get("cta_label")) or "Open workflow",
                        "navigation_target": _safe_text(next_best_action.get("navigation_target")) or "/app/dashboard",
                    }
                ]
            ),
            "required_missing_fields": [],
            "warnings": [],
            "suggestions": [_safe_text(next_best_action.get("message"))] if _safe_text(next_best_action.get("message")) else [],
            "handoff_payload": {},
            "preview_data": {"next_best_action": next_best_action},
            "confidence": "high",
            "confidence_reasoning": "Navigation guidance reused the dashboard next-best-action decision engine.",
            "source_metadata": {"current_route": current_route, "source_system": _safe_text(next_best_action.get("source_system"))},
        }

    navigation_target = "/app/dashboard"
    label = "Open Dashboard"
    if "/templates" in current_route:
        navigation_target = "/app/templates"
        label = "Open Templates"
    elif "/public-presence" in current_route:
        navigation_target = "/app/public-presence"
        label = "Open Lead Inbox"
    elif runtime.agreement is not None:
        navigation_target = _estimate_route_for_agreement(runtime.agreement, 1)
        label = "Open Agreement"

    return {
        "routine_name": "navigation_resume",
        "intent": "navigate_app",
        "recommended_action": {
            "type": "navigate",
            "label": label,
            "action_key": "open_navigation_target",
            "navigation_target": navigation_target,
        },
        "available_actions": _build_available_actions(
            [{"key": "open_navigation_target", "label": label, "navigation_target": navigation_target}]
        ),
        "required_missing_fields": [],
        "warnings": [],
        "suggestions": ["Open the current workflow directly when the request is mainly navigational."],
        "handoff_payload": {},
        "preview_data": {},
        "confidence": "medium",
        "confidence_reasoning": "Navigation routing used the current route and loaded workflow context.",
        "source_metadata": {"current_route": current_route},
    }


SPECIALIST_BUILDERS = {
    "lead_intake": _lead_intake_specialist,
    "agreement_builder": _agreement_builder_specialist,
    "template_recommender": _template_recommender_specialist,
    "estimation": _estimation_specialist,
    "compliance": _compliance_specialist,
    "subcontractor_assignment": _subcontractor_assignment_specialist,
    "maintenance_contract": _maintenance_contract_specialist,
    "contractor_onboarding": _contractor_onboarding_specialist,
    "navigation_resume": _navigation_specialist,
}


INTENT_ROUTINES = {
    "create_lead": ["lead_intake", "agreement_builder"],
    "start_agreement": ["agreement_builder", "template_recommender"],
    "apply_template": ["template_recommender"],
    "suggest_milestones": ["agreement_builder", "estimation"],
    "collect_clarifications": ["agreement_builder", "estimation"],
    "resume_agreement": ["agreement_builder", "template_recommender", "estimation"],
    "estimate_project": ["estimation"],
    "check_compliance": ["compliance"],
    "subcontractor_assignment": ["subcontractor_assignment", "compliance"],
    "maintenance_contract": ["maintenance_contract"],
    "contractor_onboarding": ["contractor_onboarding"],
    "navigate_app": ["navigation_resume"],
}


def _choose_primary_routine(intent: str, routine_results: list[dict[str, Any]]) -> dict[str, Any]:
    if not routine_results:
        return {}
    if intent == "subcontractor_assignment":
        for item in routine_results:
            if item.get("routine_name") == "subcontractor_assignment":
                return item
    if intent == "check_compliance":
        for item in routine_results:
            if item.get("routine_name") == "compliance":
                return item
    return routine_results[0]


def _merge_handoff_payloads(routine_results: list[dict[str, Any]]) -> dict[str, Any]:
    handoff = {
        "prefill_fields": {},
        "draft_payload": {},
        "wizard_step_target": None,
        "suggested_milestones": [],
        "clarification_questions": [],
    }
    for item in routine_results:
        payload = _safe_dict(item.get("handoff_payload"))
        handoff["prefill_fields"].update(_safe_dict(payload.get("prefill_fields")))
        handoff["draft_payload"].update(_safe_dict(payload.get("draft_payload")))
        if handoff["wizard_step_target"] is None and payload.get("wizard_step_target") is not None:
            handoff["wizard_step_target"] = payload.get("wizard_step_target")
        if payload.get("suggested_milestones"):
            handoff["suggested_milestones"] = _safe_list(payload.get("suggested_milestones"))
        if payload.get("clarification_questions"):
            handoff["clarification_questions"] = _safe_list(payload.get("clarification_questions"))
    return handoff


def _build_ui_sections(routine_results: list[dict[str, Any]], preview_payload: dict[str, Any]) -> list[dict[str, Any]]:
    sections = [{"key": "recommended_next_step", "visible": True}]
    if any(item.get("warnings") for item in routine_results):
        sections.append({"key": "warnings", "visible": True})
    if preview_payload.get("templates"):
        sections.append({"key": "template_recommendations", "visible": True})
    if preview_payload.get("top_template_preview"):
        sections.append({"key": "template_preview", "visible": True})
    if preview_payload.get("estimate_preview"):
        sections.append({"key": "estimate_preview", "visible": True})
    if preview_payload.get("compliance"):
        sections.append({"key": "compliance_notes", "visible": True})
    if preview_payload.get("assignment_compliance"):
        sections.append({"key": "assignment_options", "visible": True})
    if preview_payload.get("maintenance_preview"):
        sections.append({"key": "maintenance_preview", "visible": True})
    if preview_payload.get("onboarding"):
        sections.append({"key": "onboarding", "visible": True})
    return sections


def _build_preview_payload(routine_results: list[dict[str, Any]]) -> dict[str, Any]:
    payload: dict[str, Any] = {}
    for item in routine_results:
        routine = item.get("routine_name")
        preview = _safe_dict(item.get("preview_data"))
        if routine == "template_recommender" and preview:
            payload["templates"] = _safe_list(preview.get("templates"))
            if preview.get("top_template_preview"):
                payload["top_template_preview"] = _safe_dict(preview.get("top_template_preview"))
        elif routine == "estimation" and preview:
            payload["estimate_preview"] = preview
        elif routine == "compliance" and preview:
            payload["compliance"] = preview
        elif routine == "subcontractor_assignment" and preview:
            payload["assignment_compliance"] = preview
        elif routine == "maintenance_contract" and preview:
            payload["maintenance_preview"] = preview
        elif routine == "contractor_onboarding" and preview:
            payload["onboarding"] = preview.get("onboarding") or preview
        elif routine == "lead_intake" and preview:
            payload["lead_preview"] = preview
    return payload


def _build_alternative_actions(routine_results: list[dict[str, Any]], primary: dict[str, Any]) -> list[dict[str, Any]]:
    primary_key = _safe_text(_safe_dict(primary.get("recommended_action")).get("action_key"))
    actions = []
    seen = set()
    for item in routine_results:
        for action in _safe_list(item.get("available_actions")):
            key = _safe_text(action.get("key"))
            if not key or key == primary_key or key in seen:
                continue
            seen.add(key)
            actions.append(action)
    return actions[:6]


def _build_collected_data(normalized_request: dict[str, Any], runtime: OrchestratorRuntimeContext) -> dict[str, Any]:
    data = {}
    if runtime.agreement is not None:
        data["agreement_id"] = runtime.agreement.id
        data["project_type"] = _safe_text(runtime.agreement.project_type)
        data["project_subtype"] = _safe_text(runtime.agreement.project_subtype)
    if runtime.lead is not None:
        data["lead_id"] = runtime.lead.id
        data["customer_name"] = _safe_text(runtime.lead.full_name)
        data["project_summary"] = _safe_text(runtime.lead.project_description)
    if runtime.template is not None:
        data["template_id"] = runtime.template.id
        data["template_name"] = _safe_text(runtime.template.name)
    if runtime.milestone is not None:
        data["milestone_id"] = runtime.milestone.id
        data["milestone_title"] = _safe_text(runtime.milestone.title)
    if normalized_request.get("input"):
        data["request_text"] = _safe_text(normalized_request.get("input"))
    return data


def _guided_step_meta(
    *,
    intent: str,
    runtime: OrchestratorRuntimeContext,
    missing_fields: list[dict[str, Any]],
    recommended_action: dict[str, Any],
    preview_payload: dict[str, Any],
) -> dict[str, Any]:
    ordered = sorted(
        missing_fields,
        key=lambda item: {
            "customer_name": 1,
            "project_type": 2,
            "project_subtype": 3,
            "project_summary": 4,
            "address_state": 5,
            "region_state": 5,
            "address_city": 6,
            "region_city": 6,
            "payment_mode": 7,
            "agreement_reference": 8,
            "trade_or_state": 9,
            "assignment_context": 10,
        }.get(item.get("key"), 50),
    )
    top_field = ordered[0] if ordered else None
    if top_field:
        step_map = {
            "customer_name": "customer",
            "project_type": "project_type",
            "project_subtype": "project_subtype",
            "project_summary": "project_scope",
            "address_state": "project_location",
            "region_state": "project_location",
            "address_city": "project_location",
            "region_city": "project_location",
            "payment_mode": "agreement_mode",
            "agreement_reference": "agreement_context",
            "trade_or_state": "compliance",
            "assignment_context": "subcontractor_assignment",
        }
        key = top_field.get("key")
        return {
            "guided_step": step_map.get(key, "workflow_review"),
            "guided_question": top_field.get("prompt"),
            "field_key": key,
            "current_value": "",
            "suggested_value": "",
            "why_this_matters": {
                "customer_name": "Customer details anchor the agreement and later signature flow.",
                "project_type": "Project type drives template, pricing, and benchmark matching.",
                "project_subtype": "Subtype improves template fit and estimate specificity.",
                "project_summary": "Scope detail improves milestone and pricing quality.",
                "address_state": "Location drives regional benchmark and compliance checks.",
                "region_state": "Location drives regional benchmark and compliance checks.",
                "address_city": "City-level data can improve template and benchmark relevance.",
                "region_city": "City-level data can improve template and benchmark relevance.",
                "payment_mode": "Payment mode affects downstream agreement structure and funding steps.",
            }.get(key, "This is the next missing piece before the workflow can move forward."),
        }

    if intent in {"start_agreement", "resume_agreement"} and preview_payload.get("templates"):
        top = preview_payload["templates"][0]
        return {
            "guided_step": "template_selection",
            "guided_question": "Do you want to start from the top recommended template?",
            "field_key": "selected_template_id",
            "current_value": getattr(runtime.agreement, "selected_template_id", None),
            "suggested_value": top.get("id"),
            "why_this_matters": "Using the best-fit template reduces manual scope and milestone setup.",
        }

    if intent in {"start_agreement", "resume_agreement", "suggest_milestones"} and preview_payload.get("estimate_preview"):
        return {
            "guided_step": "estimate_review",
            "guided_question": "Review the estimate preview before applying milestone pricing.",
            "field_key": "estimate_preview",
            "current_value": "",
            "suggested_value": preview_payload["estimate_preview"].get("suggested_total_price"),
            "why_this_matters": "Estimate review helps catch underpricing and weak clarification coverage before save.",
        }

    return {
        "guided_step": "workflow_review",
        "guided_question": _safe_text(recommended_action.get("label")) or "Continue in the current workflow.",
        "field_key": "",
        "current_value": "",
        "suggested_value": "",
        "why_this_matters": "This is the next deterministic step for the current workflow context.",
    }


def _build_proactive_recommendations(
    *,
    runtime: OrchestratorRuntimeContext,
    missing_fields: list[dict[str, Any]],
    preview_payload: dict[str, Any],
    recommended_action: dict[str, Any],
) -> list[dict[str, Any]]:
    recommendations = []
    agreement = runtime.agreement
    onboarding_preview = _safe_dict(preview_payload.get("onboarding"))
    if onboarding_preview:
        step = _safe_text(onboarding_preview.get("step"))
        if step in {"welcome", "region", "first_job", "stripe"}:
            recommendations.append(
                {
                    "recommendation_type": "resume_onboarding",
                    "title": "Finish setup in stages",
                    "message": (
                        "Keep the first-run flow lightweight: finish your basics, start a draft, then connect Stripe when you need payments."
                    ),
                    "severity": "medium",
                    "source": "contractor_onboarding",
                    "recommended_action": "Resume onboarding",
                    "navigation_target": "/app/onboarding",
                    "applyable_preview": onboarding_preview,
                    "dismissible": True,
                    "evidence_points": [step],
                }
            )
    if agreement is not None:
        if not _safe_text(getattr(agreement, "project_address_state", "")) or not _safe_text(
            getattr(agreement, "project_address_city", "")
        ):
            recommendations.append(
                {
                    "recommendation_type": "missing_project_location",
                    "title": "Add project location",
                    "message": "Project city and state will improve benchmark, template, and compliance relevance.",
                    "severity": "medium",
                    "source": "agreement_builder",
                    "recommended_action": "Complete Step 1 address fields",
                    "navigation_target": _estimate_route_for_agreement(agreement, 1),
                    "applyable_preview": {},
                    "dismissible": True,
                    "evidence_points": ["Location fields are still incomplete."],
                }
            )
        if int(getattr(agreement, "milestone_count", 0) or agreement.milestones.count()) <= 0:
            recommendations.append(
                {
                    "recommendation_type": "missing_milestones",
                    "title": "Build milestones next",
                    "message": "This agreement still needs milestone structure before pricing and final review are reliable.",
                    "severity": "high",
                    "source": "agreement_builder",
                    "recommended_action": "Open Milestone Builder",
                    "navigation_target": _estimate_route_for_agreement(agreement, 2),
                    "applyable_preview": {"milestone_preview": _safe_list(preview_payload.get("milestone_preview"))},
                    "dismissible": True,
                    "evidence_points": ["No saved milestones are on this agreement."],
                }
            )

    if preview_payload.get("templates"):
        top = preview_payload["templates"][0]
        if agreement is None or top.get("id") != getattr(agreement, "selected_template_id", None):
            recommendations.append(
                {
                    "recommendation_type": "better_template_match",
                    "title": "A stronger template match is available",
                    "message": f"{top.get('name')} appears to be a stronger fit for this project and region.",
                    "severity": "medium",
                    "source": "template_recommender",
                    "recommended_action": "Review template recommendation",
                    "navigation_target": "/app/templates",
                    "applyable_preview": {"template_id": top.get("id")},
                    "dismissible": True,
                    "evidence_points": list(top.get("rank_reasons") or []),
                }
            )

    estimate_preview = _safe_dict(preview_payload.get("estimate_preview"))
    if _safe_text(estimate_preview.get("confidence_level")) == "low":
        recommendations.append(
            {
                "recommendation_type": "low_estimate_confidence",
                "title": "Estimate confidence is low",
                "message": "Clarifications or stronger benchmark context would improve pricing confidence.",
                "severity": "medium",
                "source": "estimation",
                "recommended_action": "Review clarifications",
                "navigation_target": _estimate_route_for_agreement(agreement, 2) if agreement is not None else _safe_text(recommended_action.get("navigation_target")),
                "applyable_preview": {},
                "dismissible": True,
                "evidence_points": [_safe_text(estimate_preview.get("confidence_reasoning"))],
            }
        )

    compliance_preview = _safe_dict(preview_payload.get("compliance") or preview_payload.get("assignment_compliance"))
    if compliance_preview.get("required") or compliance_preview.get("license_required"):
        recommendations.append(
            {
                "recommendation_type": "compliance_warning",
                "title": "Compliance review is recommended",
                "message": _safe_text(compliance_preview.get("message") or compliance_preview.get("warning_message")),
                "severity": "high" if compliance_preview.get("warning_level") in {"critical", "warning"} else "medium",
                "source": "compliance",
                "recommended_action": "Review compliance guidance",
                "navigation_target": _safe_text(recommended_action.get("navigation_target")) or "/app/profile",
                "applyable_preview": {},
                "dismissible": True,
                "evidence_points": [
                    _safe_text(compliance_preview.get("trade_key") or compliance_preview.get("trade_label")),
                    _safe_text(compliance_preview.get("state_code")),
                ],
            }
        )

    project_text = " ".join(
        [
            _safe_text(getattr(agreement, "project_type", "")),
            _safe_text(getattr(agreement, "project_subtype", "")),
        ]
    ).lower()
    if any(token in project_text for token in ("maintenance", "service", "lawn", "hvac maintenance")):
        recommendations.append(
            {
                "recommendation_type": "maintenance_candidate",
                "title": "This may fit a recurring agreement",
                "message": "The project looks similar to recurring maintenance work.",
                "severity": "low",
                "source": "maintenance_contract",
                "recommended_action": "Review recurring preview",
                "navigation_target": _safe_text(recommended_action.get("navigation_target")) or _estimate_route_for_agreement(agreement, 1),
                "applyable_preview": _safe_dict(preview_payload.get("maintenance_preview")),
                "dismissible": True,
                "evidence_points": ["Project type or subtype resembles maintenance work."],
            }
        )

    if missing_fields:
        recommendations.append(
            {
                "recommendation_type": "guided_missing_info",
                "title": "Answer the next missing item",
                "message": missing_fields[0].get("prompt"),
                "severity": "medium",
                "source": "guided_creation",
                "recommended_action": "Answer the next guided question",
                "navigation_target": _safe_text(recommended_action.get("navigation_target")),
                "applyable_preview": {},
                "dismissible": True,
                "evidence_points": [missing_fields[0].get("key")],
            }
        )

    return recommendations[:6]


def _build_predictive_insights(
    *,
    runtime: OrchestratorRuntimeContext,
    preview_payload: dict[str, Any],
) -> list[dict[str, Any]]:
    insights = []
    estimate_preview = _safe_dict(preview_payload.get("estimate_preview"))
    source_metadata = _safe_dict(estimate_preview.get("source_metadata"))
    if estimate_preview:
        if _safe_text(estimate_preview.get("confidence_level")) == "low":
            insights.append(
                {
                    "insight_type": "likely_low_estimate_confidence",
                    "title": "Estimate may still be broad",
                    "summary": "This estimate is leaning on broader benchmark support or limited clarification detail.",
                    "confidence": "medium",
                    "confidence_reasoning": _safe_text(estimate_preview.get("confidence_reasoning")),
                    "evidence_points": [
                        _safe_text(source_metadata.get("fallback_reason")),
                        f"Learned sample count: {source_metadata.get('learned_completed_project_count', 0)}",
                    ],
                    "recommended_follow_up": "Add clarifications or review a stronger template match.",
                    "source_metadata": source_metadata,
                }
            )
        if int(source_metadata.get("learned_completed_project_count", 0) or 0) <= 0:
            insights.append(
                {
                    "insight_type": "sparse_learned_benchmark_data",
                    "title": "Learned benchmark data is still sparse",
                    "summary": "The estimate is relying mostly on seeded or broader benchmark defaults.",
                    "confidence": "medium",
                    "confidence_reasoning": "No strong completed-job aggregate is influencing this estimate yet.",
                    "evidence_points": [f"Learned completed projects: {source_metadata.get('learned_completed_project_count', 0)}"],
                    "recommended_follow_up": "Review clarifications and regional template fit before applying pricing.",
                    "source_metadata": source_metadata,
                }
            )

    compliance_preview = _safe_dict(preview_payload.get("compliance") or preview_payload.get("assignment_compliance"))
    if compliance_preview.get("required") or compliance_preview.get("license_required"):
        insights.append(
            {
                "insight_type": "likely_compliance_issue",
                "title": "Licensed-work compliance is likely relevant",
                "summary": "This workflow includes work that typically requires licensing or insurance review.",
                "confidence": "high",
                "confidence_reasoning": "The insight is coming from seeded state-trade compliance rules.",
                "evidence_points": [
                    _safe_text(compliance_preview.get("trade_key") or compliance_preview.get("trade_label")),
                    _safe_text(compliance_preview.get("state_code")),
                ],
                "recommended_follow_up": "Review compliance guidance before finalizing assignment or agreement details.",
                "source_metadata": compliance_preview,
            }
        )

    if preview_payload.get("templates"):
        top = preview_payload["templates"][0]
        if _safe_text(top.get("region_match_scope")) in {"city", "state"}:
            insights.append(
                {
                    "insight_type": "better_regional_template_fit",
                    "title": "A stronger regional template fit is available",
                    "summary": "A higher-relevance regional template may reduce manual setup work.",
                    "confidence": "medium",
                    "confidence_reasoning": "Template ranking found a stronger match using project type, subtype, and region.",
                    "evidence_points": list(top.get("rank_reasons") or []),
                    "recommended_follow_up": "Review the top template recommendation before building milestones manually.",
                    "source_metadata": top,
                }
            )

    agreement = runtime.agreement
    if agreement is not None and int(getattr(agreement, "milestone_count", 0) or agreement.milestones.count()) <= 0:
        insights.append(
            {
                "insight_type": "likely_milestone_gap",
                "title": "Milestone structure is still missing",
                "summary": "Agreement completion and reliable pricing are likely blocked until milestones are drafted.",
                "confidence": "high",
                "confidence_reasoning": "This is based on current agreement completeness, not speculative AI text.",
                "evidence_points": ["Saved milestone count is zero."],
                "recommended_follow_up": "Open Step 2 and review milestone suggestions.",
                "source_metadata": {"agreement_id": agreement.id},
            }
        )

    return insights[:6]


def _build_proposed_actions(
    *,
    intent: str,
    runtime: OrchestratorRuntimeContext,
    handoff_payload: dict[str, Any],
    preview_payload: dict[str, Any],
    recommended_action: dict[str, Any],
    available_actions: list[dict[str, Any]],
    alternative_actions: list[dict[str, Any]],
) -> list[dict[str, Any]]:
    def make_action(action_type, label, description, *, confirmation_required=False, risk_level="low", navigation_target="", proposed_changes=None, applies_to_fields=None, source_routine="orchestrator", can_apply_partially=True, overwrite_scope="preview_only"):
        return {
            "action_type": action_type,
            "action_label": label,
            "action_description": description,
            "target_entity_type": "agreement" if runtime.agreement is not None else "workflow",
            "target_entity_id": getattr(runtime.agreement, "id", None),
            "preview_payload": preview_payload,
            "proposed_changes": proposed_changes or {},
            "risk_level": risk_level,
            "confirmation_required": confirmation_required,
            "can_apply_partially": can_apply_partially,
            "source_routine": source_routine,
            "source_metadata": {"navigation_target": navigation_target},
            "overwrite_scope": overwrite_scope,
            "applies_to_fields": applies_to_fields or [],
            "navigation_target": navigation_target,
        }

    actions = []
    if handoff_payload.get("prefill_fields"):
        actions.append(
            make_action(
                "prefill_agreement_fields",
                "Prefill agreement fields",
                "Stage agreement field suggestions in the wizard for review before save.",
                navigation_target=_safe_text(recommended_action.get("navigation_target")),
                proposed_changes=_safe_dict(handoff_payload.get("prefill_fields")),
                applies_to_fields=list(_safe_dict(handoff_payload.get("prefill_fields")).keys()),
                source_routine="agreement_builder",
            )
        )
    if preview_payload.get("templates"):
        top = preview_payload["templates"][0]
        actions.append(
            make_action(
                "apply_template_to_draft",
                "Use recommended template",
                "Carry the top template recommendation into the draft workflow for review.",
                navigation_target="/app/templates",
                proposed_changes={"selected_template_id": top.get("id")},
                applies_to_fields=["selected_template_id"],
                source_routine="template_recommender",
            )
        )
    if handoff_payload.get("suggested_milestones"):
        actions.append(
            make_action(
                "generate_milestones_preview",
                "Review milestone preview",
                "Open Step 2 with suggested milestones staged locally for review.",
                navigation_target=_estimate_route_for_agreement(runtime.agreement, 2),
                proposed_changes={"suggested_milestones": _safe_list(handoff_payload.get("suggested_milestones"))},
                applies_to_fields=["milestones"],
                source_routine="estimation",
            )
        )
    if preview_payload.get("estimate_preview"):
        actions.append(
            make_action(
                "apply_estimate_preview",
                "Review estimate preview",
                "Open Step 2 with estimate guidance and staged pricing/timeline suggestions.",
                confirmation_required=True,
                risk_level="medium",
                navigation_target=_estimate_route_for_agreement(runtime.agreement, 2),
                proposed_changes={"estimate_preview": _safe_dict(preview_payload.get("estimate_preview"))},
                applies_to_fields=["milestone_amounts", "milestone_timeline"],
                source_routine="estimation",
                overwrite_scope="staged_local_preview",
            )
        )
    if intent in {"start_agreement", "create_lead"} and runtime.agreement is None:
        actions.append(
            make_action(
                "create_agreement_draft",
                "Prepare agreement draft",
                "Move into the draft agreement flow with AI-prepared context, but do not finalize anything automatically.",
                confirmation_required=True,
                risk_level="medium",
                navigation_target=_safe_text(recommended_action.get("navigation_target")) or "/app/agreements/new/wizard?step=1",
                proposed_changes=_safe_dict(handoff_payload.get("draft_payload")),
                applies_to_fields=list(_safe_dict(handoff_payload.get("draft_payload")).keys()),
                source_routine="agreement_builder",
            )
        )
    for action in available_actions + alternative_actions:
        action_type = {
            "assign_anyway": "recommend_subcontractor_assignment",
            "request_license": "request_subcontractor_license",
            "choose_another": "recommend_subcontractor_assignment",
            "open_wizard_step": "continue_to_wizard_step",
            "review_estimate": "continue_to_wizard_step",
        }.get(action.get("key"), _safe_text(action.get("key") or "continue_to_wizard_step"))
        actions.append(
            make_action(
                action_type,
                _safe_text(action.get("label")),
                "Continue into the existing workflow to review or confirm this action.",
                confirmation_required=bool(action.get("confirmation_required")),
                risk_level="high" if action.get("confirmation_required") else "low",
                navigation_target=_safe_text(action.get("navigation_target")),
                source_routine="orchestrator",
            )
        )
    unique = []
    seen = set()
    for action in actions:
        key = (action["action_type"], action["action_label"], action.get("navigation_target"))
        if key in seen:
            continue
        seen.add(key)
        unique.append(action)
    return unique[:8]


def _compose_orchestration_response(
    *,
    normalized_request: dict[str, Any],
    context: dict[str, Any],
    runtime: OrchestratorRuntimeContext,
    intent: str,
    routine_results: list[dict[str, Any]],
    confidence: str,
    confidence_reasoning: str,
    reasoning_source: str,
    fallback_to_planner: bool = False,
) -> dict[str, Any]:
    primary = _choose_primary_routine(intent, routine_results)
    handoff_payload = _merge_handoff_payloads(routine_results)
    preview_payload = _build_preview_payload(routine_results)
    missing_fields = []
    warnings = []
    suggestions = []
    blocking_issues = []
    for item in routine_results:
        missing_fields.extend(_safe_list(item.get("required_missing_fields")))
        warnings.extend([warning for warning in _safe_list(item.get("warnings")) if _safe_text(warning)])
        suggestions.extend([suggestion for suggestion in _safe_list(item.get("suggestions")) if _safe_text(suggestion)])
    for field in missing_fields:
        if field.get("blocking") is not False and field.get("prompt"):
            blocking_issues.append(field["prompt"])

    recommended_action = _safe_dict(primary.get("recommended_action"))
    alternative_actions = _build_alternative_actions(routine_results, primary)
    ui_sections = _build_ui_sections(routine_results, preview_payload)
    context_summary = _build_context_summary(context, runtime)
    summary = _safe_text(recommended_action.get("label")) or "Review the suggested next step."
    follow_up_prompt = blocking_issues[0] if blocking_issues else "Continue in the existing workflow to review details."
    guided_flow = _guided_step_meta(
        intent=intent,
        runtime=runtime,
        missing_fields=missing_fields,
        recommended_action=recommended_action,
        preview_payload=preview_payload,
    )
    proactive_recommendations = _build_proactive_recommendations(
        runtime=runtime,
        missing_fields=missing_fields,
        preview_payload=preview_payload,
        recommended_action=recommended_action,
    )
    predictive_insights = _build_predictive_insights(
        runtime=runtime,
        preview_payload=preview_payload,
    )
    proposed_actions = _build_proposed_actions(
        intent=intent,
        runtime=runtime,
        handoff_payload=handoff_payload,
        preview_payload=preview_payload,
        recommended_action=recommended_action,
        available_actions=_safe_list(primary.get("available_actions")),
        alternative_actions=alternative_actions,
    )
    confirmation_required_actions = [
        action for action in proposed_actions if bool(action.get("confirmation_required"))
    ]
    applyable_preview = {
        "prefill_fields": _safe_dict(handoff_payload.get("prefill_fields")),
        "draft_payload": _safe_dict(handoff_payload.get("draft_payload")),
        "wizard_step_target": handoff_payload.get("wizard_step_target"),
        "suggested_milestones": _safe_list(handoff_payload.get("suggested_milestones")),
        "clarification_questions": _safe_list(handoff_payload.get("clarification_questions")),
        "template_recommendations": _safe_list(preview_payload.get("templates")),
        "top_template_preview": _safe_dict(preview_payload.get("top_template_preview")),
        "estimate_preview": _safe_dict(preview_payload.get("estimate_preview")),
        "compliance": _safe_dict(preview_payload.get("compliance")),
        "assignment_compliance": _safe_dict(preview_payload.get("assignment_compliance")),
        "maintenance_preview": _safe_dict(preview_payload.get("maintenance_preview")),
    }
    automation_plan = {
        "mode": "preview_only",
        "preview_only": True,
        "guided_flow": guided_flow,
        "proposed_actions": proposed_actions,
        "confirmation_required_actions": confirmation_required_actions,
        "applyable_preview": applyable_preview,
    }

    return {
        "orchestration_version": ORCHESTRATION_VERSION,
        "request_type": intent,
        "primary_intent": intent,
        "selected_routines": [item.get("routine_name") for item in routine_results],
        "recommended_action": recommended_action,
        "recommended_action_label": _safe_text(recommended_action.get("label")),
        "action_priority": "high" if confidence == "high" else "medium",
        "available_actions": _safe_list(primary.get("available_actions")),
        "alternative_actions": alternative_actions,
        "missing_fields": missing_fields,
        "blocking_issues": blocking_issues,
        "warnings": warnings,
        "suggestions": suggestions[:8],
        "handoff_payload": handoff_payload,
        "preview_payload": preview_payload,
        "navigation_target": _safe_text(recommended_action.get("navigation_target")),
        "confirmation_required": bool(recommended_action.get("confirmation_required"))
        or any(action.get("confirmation_required") for action in alternative_actions),
        "confidence": confidence,
        "confidence_reasoning": confidence_reasoning,
        "reasoning_source": reasoning_source,
        "source_metadata": {
            "language": _safe_text(context.get("language") or "en"),
            "normalized_region_key": _safe_text(context.get("normalized_region_key"))
            or build_normalized_region_key(country="US", state=context.get("region_state"), city=context.get("region_city")),
            "fallback_to_planner": fallback_to_planner,
        },
        "ui_sections": ui_sections,
        "automation_plan": automation_plan,
        "proposed_actions": proposed_actions,
        "confirmation_required_actions": confirmation_required_actions,
        "applyable_preview": applyable_preview,
        "proactive_recommendations": proactive_recommendations,
        "predictive_insights": predictive_insights,
        "guided_step": guided_flow.get("guided_step"),
        "guided_question": guided_flow.get("guided_question"),
        "field_key": guided_flow.get("field_key"),
        "current_value": guided_flow.get("current_value"),
        "suggested_value": guided_flow.get("suggested_value"),
        "why_this_matters": guided_flow.get("why_this_matters"),
        "next_best_action": _safe_text(recommended_action.get("label")),
        "fallback_to_planner": fallback_to_planner,
        "intent": intent,
        "intent_label": intent.replace("_", " ").title(),
        "collected_data": _build_collected_data(normalized_request, runtime),
        "next_action": {
            "type": _safe_text(recommended_action.get("type") or "navigate"),
            "label": _safe_text(recommended_action.get("label") or "Open workflow"),
            "action_key": _safe_text(recommended_action.get("action_key") or recommended_action.get("type")),
        },
        "prefill_fields": _safe_dict(handoff_payload.get("prefill_fields")),
        "draft_payload": _safe_dict(handoff_payload.get("draft_payload")),
        "wizard_step_target": handoff_payload.get("wizard_step_target"),
        "suggested_milestones": _safe_list(handoff_payload.get("suggested_milestones")),
        "clarification_questions": _safe_list(handoff_payload.get("clarification_questions")),
        "blocked_workflow_states": blocking_issues,
        "context_summary": context_summary,
        "summary": summary,
        "follow_up_prompt": follow_up_prompt,
        "planning_confidence": confidence,
        "structured_result_version": ORCHESTRATION_VERSION,
    }


def orchestrate_user_request(*, contractor: Contractor | None, payload: dict[str, Any]) -> dict[str, Any]:
    normalized_request = _normalize_user_request(payload)
    context = _normalize_orchestrator_context(normalized_request["context"])
    runtime = _load_runtime_context(contractor, context)
    intent = _intent_from_request(normalized_request, context)
    routines = list(INTENT_ROUTINES.get(intent, ["navigation_resume"]))

    if intent == "navigate_app" and not normalized_request.get("input") and runtime.agreement is None and runtime.lead is None:
        return _compose_orchestration_response(
            normalized_request=normalized_request,
            context=context,
            runtime=runtime,
            intent=intent,
            routine_results=[_navigation_specialist(runtime)],
            confidence=LOW_CONFIDENCE_THRESHOLD,
            confidence_reasoning="The request is too broad, so the assistant should fall back to the existing local planner.",
            reasoning_source="orchestrator_low_confidence",
            fallback_to_planner=True,
        )

    routine_results = [SPECIALIST_BUILDERS[name](runtime) for name in routines if name in SPECIALIST_BUILDERS]
    confidence_values = [item.get("confidence") for item in routine_results if item.get("confidence")]
    if "high" in confidence_values:
        confidence = "high"
    elif "medium" in confidence_values:
        confidence = "medium"
    else:
        confidence = LOW_CONFIDENCE_THRESHOLD

    if confidence == LOW_CONFIDENCE_THRESHOLD and intent == "navigate_app":
        return _compose_orchestration_response(
            normalized_request=normalized_request,
            context=context,
            runtime=runtime,
            intent=intent,
            routine_results=routine_results,
            confidence=LOW_CONFIDENCE_THRESHOLD,
            confidence_reasoning="The orchestration request is mostly navigational and does not have enough specific context to outperform the local planner.",
            reasoning_source="orchestrator_low_confidence",
            fallback_to_planner=True,
        )

    confidence_reasoning = " ".join(
        dict.fromkeys(
            [
                _safe_text(item.get("confidence_reasoning"))
                for item in routine_results
                if _safe_text(item.get("confidence_reasoning"))
            ]
        )
    ).strip()
    return _compose_orchestration_response(
        normalized_request=normalized_request,
        context=context,
        runtime=runtime,
        intent=intent,
        routine_results=routine_results,
        confidence=confidence,
        confidence_reasoning=confidence_reasoning or "The orchestrator used deterministic workflow rules and current app context.",
        reasoning_source="orchestrator",
        fallback_to_planner=False,
    )
