from __future__ import annotations

from dataclasses import dataclass
from typing import Callable


@dataclass(frozen=True)
class SMSTemplateDefinition:
    template_key: str
    audience: str
    intent_key: str
    intent_summary: str
    priority: str
    short_fallback_text: str
    body_builder: Callable[[dict], str]


def _agreement_label(ctx: dict) -> str:
    agreement = ctx.get("agreement")
    if agreement is not None and getattr(agreement, "id", None):
        return f"Agreement #{agreement.id}"
    return "your project"


def _milestone_label(ctx: dict) -> str:
    milestone = ctx.get("milestone")
    if milestone is not None and getattr(milestone, "title", None):
        return str(milestone.title)
    return "the milestone"


def _invoice_label(ctx: dict) -> str:
    invoice = ctx.get("invoice")
    if invoice is not None and getattr(invoice, "invoice_number", None):
        return f"Invoice {invoice.invoice_number}"
    return "your invoice"


TEMPLATES: dict[str, SMSTemplateDefinition] = {
    "payment_released_contractor": SMSTemplateDefinition(
        template_key="payment_released_contractor",
        audience="contractor",
        intent_key="payment_release_notice",
        intent_summary="Notify the contractor that funds were released.",
        priority="high",
        short_fallback_text="Payment released for your agreement.",
        body_builder=lambda ctx: f"Payment released for {_agreement_label(ctx)}. Review details in MyHomeBro.",
    ),
    "invoice_approved_contractor": SMSTemplateDefinition(
        template_key="invoice_approved_contractor",
        audience="contractor",
        intent_key="invoice_approval_notice",
        intent_summary="Notify the contractor that an invoice was approved.",
        priority="medium",
        short_fallback_text="Invoice approved in MyHomeBro.",
        body_builder=lambda ctx: f"{_invoice_label(ctx)} was approved for {_agreement_label(ctx)}.",
    ),
    "escrow_funded_homeowner": SMSTemplateDefinition(
        template_key="escrow_funded_homeowner",
        audience="homeowner",
        intent_key="escrow_ready_notice",
        intent_summary="Confirm escrow funding to the homeowner.",
        priority="medium",
        short_fallback_text="Escrow funding received for your agreement.",
        body_builder=lambda ctx: f"Escrow funding was received for {_agreement_label(ctx)}. You can review the agreement in MyHomeBro.",
    ),
    "milestone_review_needed_homeowner": SMSTemplateDefinition(
        template_key="milestone_review_needed_homeowner",
        audience="homeowner",
        intent_key="homeowner_action_needed",
        intent_summary="Ask the homeowner to review a submitted milestone.",
        priority="medium",
        short_fallback_text="A milestone is ready for your review.",
        body_builder=lambda ctx: f"{_milestone_label(ctx)} is ready for your review on {_agreement_label(ctx)}.",
    ),
    "agreement_sent_homeowner": SMSTemplateDefinition(
        template_key="agreement_sent_homeowner",
        audience="homeowner",
        intent_key="homeowner_action_needed",
        intent_summary="Notify the homeowner that an agreement is ready to review.",
        priority="medium",
        short_fallback_text="Your agreement is ready for review.",
        body_builder=lambda ctx: f"{_agreement_label(ctx)} is ready for your review in MyHomeBro.",
    ),
    "agreement_signed_contractor": SMSTemplateDefinition(
        template_key="agreement_signed_contractor",
        audience="contractor",
        intent_key="agreement_status_update",
        intent_summary="Notify the contractor when a homeowner signs.",
        priority="medium",
        short_fallback_text="Agreement signed in MyHomeBro.",
        body_builder=lambda ctx: f"{_agreement_label(ctx)} was signed. Review the next steps in MyHomeBro.",
    ),
    "agreement_fully_signed_contractor": SMSTemplateDefinition(
        template_key="agreement_fully_signed_contractor",
        audience="contractor",
        intent_key="agreement_status_update",
        intent_summary="Notify the contractor when an agreement is fully signed.",
        priority="high",
        short_fallback_text="Agreement fully signed.",
        body_builder=lambda ctx: f"{_agreement_label(ctx)} is fully signed and ready for the next step.",
    ),
    "direct_pay_link_ready_homeowner": SMSTemplateDefinition(
        template_key="direct_pay_link_ready_homeowner",
        audience="homeowner",
        intent_key="homeowner_action_needed",
        intent_summary="Tell the homeowner a direct-pay link is ready.",
        priority="high",
        short_fallback_text="Your payment link is ready.",
        body_builder=lambda ctx: f"A payment link is ready for {_agreement_label(ctx)}. Open MyHomeBro to pay securely.",
    ),
    "dispute_opened_contractor": SMSTemplateDefinition(
        template_key="dispute_opened_contractor",
        audience="contractor",
        intent_key="dispute_status_update",
        intent_summary="Notify the contractor that a dispute needs attention.",
        priority="high",
        short_fallback_text="A dispute needs attention.",
        body_builder=lambda ctx: f"A dispute was opened for {_agreement_label(ctx)}. Review it in MyHomeBro.",
    ),
    "dispute_resolved_contractor": SMSTemplateDefinition(
        template_key="dispute_resolved_contractor",
        audience="contractor",
        intent_key="dispute_status_update",
        intent_summary="Notify the contractor that a dispute was resolved.",
        priority="medium",
        short_fallback_text="A dispute was resolved.",
        body_builder=lambda ctx: f"A dispute was resolved for {_agreement_label(ctx)}. Review the outcome in MyHomeBro.",
    ),
    "upcoming_due_milestone_homeowner": SMSTemplateDefinition(
        template_key="upcoming_due_milestone_homeowner",
        audience="homeowner",
        intent_key="homeowner_action_needed",
        intent_summary="Remind the homeowner about an upcoming due milestone.",
        priority="low",
        short_fallback_text="Upcoming milestone reminder.",
        body_builder=lambda ctx: f"{_milestone_label(ctx)} is coming up soon on {_agreement_label(ctx)}.",
    ),
    "overdue_invoice_homeowner": SMSTemplateDefinition(
        template_key="overdue_invoice_homeowner",
        audience="homeowner",
        intent_key="homeowner_action_needed",
        intent_summary="Remind the homeowner about an overdue invoice.",
        priority="medium",
        short_fallback_text="Invoice follow-up.",
        body_builder=lambda ctx: f"{_invoice_label(ctx)} for {_agreement_label(ctx)} still needs attention in MyHomeBro.",
    ),
    "overdue_milestone_contractor": SMSTemplateDefinition(
        template_key="overdue_milestone_contractor",
        audience="contractor",
        intent_key="contractor_followup_nudge",
        intent_summary="Nudge the contractor about an overdue milestone.",
        priority="low",
        short_fallback_text="Milestone follow-up.",
        body_builder=lambda ctx: f"{_milestone_label(ctx)} is overdue on {_agreement_label(ctx)}.",
    ),
    "inactive_agreement_nudge_contractor": SMSTemplateDefinition(
        template_key="inactive_agreement_nudge_contractor",
        audience="contractor",
        intent_key="contractor_followup_nudge",
        intent_summary="Prompt the contractor to resume an inactive agreement.",
        priority="low",
        short_fallback_text="Agreement follow-up reminder.",
        body_builder=lambda ctx: f"{_agreement_label(ctx)} has been inactive. Review the next step in MyHomeBro.",
    ),
    "onboarding_completion_nudge_contractor": SMSTemplateDefinition(
        template_key="onboarding_completion_nudge_contractor",
        audience="contractor",
        intent_key="onboarding_completion_nudge",
        intent_summary="Nudge the contractor to finish onboarding.",
        priority="low",
        short_fallback_text="Finish onboarding in MyHomeBro.",
        body_builder=lambda ctx: "Finish your MyHomeBro setup to unlock tailored templates, pricing, and payment guidance.",
    ),
    "stripe_onboarding_reminder_contractor": SMSTemplateDefinition(
        template_key="stripe_onboarding_reminder_contractor",
        audience="contractor",
        intent_key="onboarding_completion_nudge",
        intent_summary="Remind the contractor to complete Stripe onboarding when payments matter.",
        priority="medium",
        short_fallback_text="Connect Stripe to get paid.",
        body_builder=lambda ctx: "You are ready to get paid. Connect Stripe in MyHomeBro to continue payment workflows.",
    ),
}


def get_sms_template(template_key: str) -> SMSTemplateDefinition | None:
    return TEMPLATES.get(str(template_key or "").strip())

