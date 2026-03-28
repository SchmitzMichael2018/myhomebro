from __future__ import annotations

from dataclasses import dataclass
from datetime import timedelta
from typing import Any

from django.conf import settings
from django.utils import timezone

from projects.models import Agreement, Contractor, ContractorActivityEvent, Homeowner, Invoice, Milestone
from projects.models_sms import DeferredSMSAutomation, SMSAutomationDecision
from projects.services.activity_feed import create_activity_event
from projects.services.sms_service import get_sms_consent, normalize_phone_to_e164, send_compliant_sms
from projects.services.sms_templates import get_sms_template


@dataclass(frozen=True)
class SMSAutomationRule:
    event_type: str
    priority: str
    template_key: str
    channel_preference: str
    cooldown_hours: int
    dedupe_scope: str
    audience: str
    allow_sms: bool = True
    quiet_hours_behavior: str = "defer"
    quiet_hours_bypass: bool = False


RULES: dict[str, SMSAutomationRule] = {
    "payment_released": SMSAutomationRule("payment_released", "high", "payment_released_contractor", "sms", 12, "agreement", "contractor", True, "send", True),
    "invoice_approved": SMSAutomationRule("invoice_approved", "medium", "invoice_approved_contractor", "sms", 12, "invoice", "contractor"),
    "escrow_funded": SMSAutomationRule("escrow_funded", "medium", "escrow_funded_homeowner", "sms", 12, "agreement", "homeowner"),
    "milestone_pending_approval": SMSAutomationRule("milestone_pending_approval", "medium", "milestone_review_needed_homeowner", "sms", 24, "milestone", "homeowner"),
    "agreement_sent": SMSAutomationRule("agreement_sent", "medium", "agreement_sent_homeowner", "sms", 24, "agreement", "homeowner"),
    "agreement_signed": SMSAutomationRule("agreement_signed", "medium", "agreement_signed_contractor", "dashboard_only", 24, "agreement", "contractor"),
    "agreement_fully_signed": SMSAutomationRule("agreement_fully_signed", "high", "agreement_fully_signed_contractor", "sms", 24, "agreement", "contractor", True, "send", True),
    "direct_pay_link_ready": SMSAutomationRule("direct_pay_link_ready", "high", "direct_pay_link_ready_homeowner", "sms", 12, "invoice", "homeowner", True, "send", True),
    "dispute_opened": SMSAutomationRule("dispute_opened", "high", "dispute_opened_contractor", "sms", 12, "agreement", "contractor", True, "send", True),
    "dispute_resolved": SMSAutomationRule("dispute_resolved", "medium", "dispute_resolved_contractor", "sms", 12, "agreement", "contractor"),
    "upcoming_due_milestone": SMSAutomationRule("upcoming_due_milestone", "low", "upcoming_due_milestone_homeowner", "dashboard_only", 24, "milestone", "homeowner"),
    "overdue_invoice": SMSAutomationRule("overdue_invoice", "medium", "overdue_invoice_homeowner", "sms", 24, "invoice", "homeowner"),
    "overdue_milestone": SMSAutomationRule("overdue_milestone", "low", "overdue_milestone_contractor", "dashboard_only", 24, "milestone", "contractor"),
    "inactive_agreement_nudge": SMSAutomationRule("inactive_agreement_nudge", "low", "inactive_agreement_nudge_contractor", "dashboard_only", 72, "agreement", "contractor"),
    "onboarding_incomplete": SMSAutomationRule("onboarding_incomplete", "low", "onboarding_completion_nudge_contractor", "dashboard_only", 72, "contractor", "contractor"),
    "stripe_onboarding_incomplete": SMSAutomationRule("stripe_onboarding_incomplete", "medium", "stripe_onboarding_reminder_contractor", "dashboard_only", 72, "contractor", "contractor"),
}

RELATED_PRIORITY_SUPPRESSIONS: dict[str, set[str]] = {
    "payment_released": {"invoice_approved"},
    "agreement_fully_signed": {"agreement_sent", "agreement_signed"},
    "agreement_signed": {"agreement_sent"},
}


def _resolve_context(
    *,
    contractor: Contractor | None = None,
    homeowner: Homeowner | None = None,
    agreement: Agreement | None = None,
    invoice: Invoice | None = None,
    milestone: Milestone | None = None,
) -> dict[str, Any]:
    if invoice is not None and agreement is None:
        agreement = invoice.agreement
    if milestone is not None and agreement is None:
        agreement = milestone.agreement
    if agreement is not None:
        contractor = contractor or agreement.contractor
        homeowner = homeowner or agreement.homeowner
    if homeowner is not None and contractor is None:
        contractor = getattr(homeowner, "created_by", None)
    return {
        "contractor": contractor,
        "homeowner": homeowner,
        "agreement": agreement,
        "invoice": invoice,
        "milestone": milestone,
    }


def _phone_for_audience(rule: SMSAutomationRule, ctx: dict[str, Any]) -> str:
    if rule.audience == "homeowner":
        return normalize_phone_to_e164(getattr(ctx.get("homeowner"), "phone_number", ""))
    return normalize_phone_to_e164(getattr(ctx.get("contractor"), "phone", ""))


def _consent_snapshot(phone_number_e164: str) -> dict[str, Any]:
    consent = get_sms_consent(phone_number_e164)
    if consent is None:
        return {
            "exists": False,
            "phone_number_e164": phone_number_e164,
            "can_send_sms": False,
            "opted_out": False,
        }
    return {
        "exists": True,
        "phone_number_e164": consent.phone_number_e164,
        "can_send_sms": bool(consent.can_send_sms),
        "opted_out": bool(consent.opted_out),
        "opted_in_at": consent.opted_in_at.isoformat() if consent.opted_in_at else None,
        "opted_out_at": consent.opted_out_at.isoformat() if consent.opted_out_at else None,
        "opted_in_source": consent.opted_in_source,
        "opted_out_source": consent.opted_out_source,
    }


def _recent_decisions(phone_number_e164: str, *, hours: int = 72):
    if not phone_number_e164:
        return SMSAutomationDecision.objects.none()
    return SMSAutomationDecision.objects.filter(
        phone_number_e164=phone_number_e164,
        created_at__gte=timezone.now() - timedelta(hours=hours),
    ).order_by("-created_at", "-id")


def has_recent_similar_sms(
    *,
    phone_number_e164: str,
    template_key: str,
    event_type: str,
    agreement: Agreement | None,
    milestone: Milestone | None,
    cooldown_hours: int,
) -> bool:
    recent = SMSAutomationDecision.objects.filter(
        phone_number_e164=phone_number_e164,
        created_at__gte=timezone.now() - timedelta(hours=cooldown_hours),
        sent=True,
    )
    if template_key:
        recent = recent.filter(template_key=template_key)
    if recent.exists():
        return True
    same_event = SMSAutomationDecision.objects.filter(
        event_type=event_type,
        created_at__gte=timezone.now() - timedelta(hours=cooldown_hours),
        sent=True,
    )
    if agreement is not None:
        same_event = same_event.filter(agreement=agreement)
    if milestone is not None:
        same_event = same_event.filter(milestone=milestone)
    return same_event.exists()


def get_recent_sms_context(phone_number_e164: str) -> dict[str, Any]:
    recent = list(_recent_decisions(phone_number_e164, hours=72)[:5])
    return {
        "recent_decisions": [
            {
                "event_type": item.event_type,
                "reason_code": item.reason_code,
                "priority": item.priority,
                "sent": item.sent,
                "created_at": item.created_at.isoformat() if item.created_at else None,
                "template_key": item.template_key,
            }
            for item in recent
        ]
    }


def should_escalate_or_suppress(
    event_type: str,
    *,
    phone_number_e164: str,
    agreement: Agreement | None,
    invoice: Invoice | None,
    milestone: Milestone | None,
) -> tuple[bool, str]:
    if event_type == "invoice_approved" and invoice is not None and bool(getattr(invoice, "escrow_released", False)):
        return True, "superseded_by_payment_release"
    suppressed_by_higher = [
        parent
        for parent, children in RELATED_PRIORITY_SUPPRESSIONS.items()
        if event_type in children
    ]
    if not suppressed_by_higher or not phone_number_e164:
        return False, ""
    recent = _recent_decisions(phone_number_e164, hours=24).filter(
        sent=True,
        event_type__in=suppressed_by_higher,
    )
    if agreement is not None:
        recent = recent.filter(agreement=agreement)
    if milestone is not None:
        recent = recent.filter(milestone=milestone)
    if recent.exists():
        return True, "higher_value_event_already_sent"
    return False, ""


def _quiet_hours() -> tuple[int, int]:
    start = int(getattr(settings, "SMS_QUIET_HOURS_START", 21) or 21)
    end = int(getattr(settings, "SMS_QUIET_HOURS_END", 8) or 8)
    return start, end


def _in_quiet_hours(now_dt=None) -> bool:
    now_dt = now_dt or timezone.localtime()
    start, end = _quiet_hours()
    hour = now_dt.hour
    if start < end:
        return start <= hour < end
    return hour >= start or hour < end


def _next_send_window(now_dt=None):
    now_dt = now_dt or timezone.localtime()
    start, end = _quiet_hours()
    if end <= now_dt.hour < start:
        return now_dt
    candidate = now_dt.replace(hour=end, minute=0, second=0, microsecond=0)
    if now_dt.hour >= start:
        candidate = candidate + timedelta(days=1)
    return candidate


def _build_decision_payload(
    *,
    should_send: bool,
    reason_code: str,
    priority: str,
    channel: str,
    template_key: str,
    message_preview: str,
    cooldown_applied: bool,
    sent: bool,
    intent_key: str = "",
    intent_summary: str = "",
    deferred: bool = False,
    duplicate_suppressed: bool = False,
    twilio_message_sid: str = "",
) -> dict[str, Any]:
    return {
        "should_send": should_send,
        "reason_code": reason_code,
        "priority": priority,
        "channel": channel,
        "template_key": template_key,
        "cooldown_applied": cooldown_applied,
        "sent": sent,
        "message_preview": message_preview,
        "intent_key": intent_key,
        "intent_summary": intent_summary,
        "deferred": deferred,
        "duplicate_suppressed": duplicate_suppressed,
        "twilio_message_sid": twilio_message_sid,
    }


def _record_activity_for_suppression(
    *,
    contractor: Contractor | None,
    agreement: Agreement | None,
    milestone: Milestone | None,
    phone_number_e164: str,
    reason_code: str,
    summary: str,
):
    create_activity_event(
        contractor=contractor,
        agreement=agreement,
        milestone=milestone,
        event_type="sms_blocked",
        title="SMS automation suppressed",
        summary=summary,
        severity=ContractorActivityEvent.Severity.WARNING,
        related_label=phone_number_e164,
        icon_hint="sms",
        metadata={"phone": phone_number_e164, "reason_code": reason_code},
        surfaced_in_dashboard=False,
    )


def _persist_decision(
    *,
    event_type: str,
    ctx: dict[str, Any],
    phone_number_e164: str,
    decision: dict[str, Any],
    consent_snapshot: dict[str, Any],
    metadata: dict[str, Any],
) -> SMSAutomationDecision:
    return SMSAutomationDecision.objects.create(
        event_type=event_type,
        phone_number_e164=phone_number_e164,
        contractor=ctx.get("contractor"),
        homeowner=ctx.get("homeowner"),
        agreement=ctx.get("agreement"),
        invoice=ctx.get("invoice"),
        milestone=ctx.get("milestone"),
        should_send=bool(decision["should_send"]),
        channel_decision=decision["channel"],
        reason_code=decision["reason_code"],
        priority=decision["priority"],
        template_key=decision["template_key"],
        intent_key=decision.get("intent_key", ""),
        intent_summary=decision.get("intent_summary", ""),
        message_preview=decision.get("message_preview", "")[:255],
        cooldown_applied=bool(decision["cooldown_applied"]),
        duplicate_suppressed=bool(decision.get("duplicate_suppressed", False)),
        sent=bool(decision["sent"]),
        deferred=bool(decision.get("deferred", False)),
        sms_consent_snapshot_json=consent_snapshot,
        decision_context_json=metadata,
        twilio_message_sid=decision.get("twilio_message_sid", ""),
    )


def _queue_deferred_sms(
    *,
    decision_obj: SMSAutomationDecision,
    ctx: dict[str, Any],
    phone_number_e164: str,
    template_key: str,
    intent_key: str,
    message_body: str,
    event_type: str,
    scheduled_for,
):
    return DeferredSMSAutomation.objects.create(
        phone_number_e164=phone_number_e164,
        template_key=template_key,
        intent_key=intent_key,
        message_body=message_body,
        scheduled_for=scheduled_for,
        event_type=event_type,
        contractor=ctx.get("contractor"),
        homeowner=ctx.get("homeowner"),
        agreement=ctx.get("agreement"),
        invoice=ctx.get("invoice"),
        milestone=ctx.get("milestone"),
        decision=decision_obj,
    )


def evaluate_sms_automation(
    event_type,
    *,
    contractor: Contractor | None = None,
    homeowner: Homeowner | None = None,
    agreement: Agreement | None = None,
    invoice: Invoice | None = None,
    milestone: Milestone | None = None,
    metadata: dict[str, Any] | None = None,
    simulate: bool = False,
) -> dict[str, Any]:
    metadata = dict(metadata or {})
    ctx = _resolve_context(
        contractor=contractor,
        homeowner=homeowner,
        agreement=agreement,
        invoice=invoice,
        milestone=milestone,
    )
    rule = RULES.get(str(event_type or "").strip())
    if rule is None:
        decision = _build_decision_payload(
            should_send=False,
            reason_code="no_rule_defined",
            priority="low",
            channel="none",
            template_key="",
            message_preview="",
            cooldown_applied=False,
            sent=False,
        )
        decision_obj = _persist_decision(
            event_type=event_type,
            ctx=ctx,
            phone_number_e164="",
            decision=decision,
            consent_snapshot={},
            metadata={"simulate": simulate, **metadata},
        )
        return {**decision, "decision_id": decision_obj.id}

    template = get_sms_template(rule.template_key)
    if template is None:
        decision = _build_decision_payload(
            should_send=False,
            reason_code="template_missing",
            priority=rule.priority,
            channel="none",
            template_key=rule.template_key,
            message_preview="",
            cooldown_applied=False,
            sent=False,
        )
        decision_obj = _persist_decision(
            event_type=event_type,
            ctx=ctx,
            phone_number_e164="",
            decision=decision,
            consent_snapshot={},
            metadata={"simulate": simulate, **metadata},
        )
        return {**decision, "decision_id": decision_obj.id}

    phone_number_e164 = _phone_for_audience(rule, ctx)
    consent_snapshot = _consent_snapshot(phone_number_e164)
    message_preview = template.body_builder({**ctx, "metadata": metadata})
    decision_context = {
        "simulate": simulate,
        "audience": rule.audience,
        "recent_sms_context": get_recent_sms_context(phone_number_e164),
        **metadata,
    }

    if not phone_number_e164:
        decision = _build_decision_payload(
            should_send=False,
            reason_code="missing_phone_number",
            priority=rule.priority,
            channel="suppressed",
            template_key=template.template_key,
            message_preview=message_preview,
            cooldown_applied=False,
            sent=False,
            intent_key=template.intent_key,
            intent_summary=template.intent_summary,
        )
        decision_obj = _persist_decision(
            event_type=event_type,
            ctx=ctx,
            phone_number_e164="",
            decision=decision,
            consent_snapshot=consent_snapshot,
            metadata=decision_context,
        )
        _record_activity_for_suppression(
            contractor=ctx.get("contractor"),
            agreement=ctx.get("agreement"),
            milestone=ctx.get("milestone"),
            phone_number_e164="",
            reason_code="missing_phone_number",
            summary="SMS automation skipped because no phone number is available.",
        )
        return {**decision, "decision_id": decision_obj.id}

    if not rule.allow_sms:
        decision = _build_decision_payload(
            should_send=False,
            reason_code="low_value_dashboard_only",
            priority=rule.priority,
            channel="dashboard_only",
            template_key=template.template_key,
            message_preview=message_preview,
            cooldown_applied=False,
            sent=False,
            intent_key=template.intent_key,
            intent_summary=template.intent_summary,
        )
        decision_obj = _persist_decision(
            event_type=event_type,
            ctx=ctx,
            phone_number_e164=phone_number_e164,
            decision=decision,
            consent_snapshot=consent_snapshot,
            metadata=decision_context,
        )
        return {**decision, "decision_id": decision_obj.id}

    if not consent_snapshot.get("exists"):
        decision = _build_decision_payload(
            should_send=False,
            reason_code="no_consent",
            priority=rule.priority,
            channel="suppressed",
            template_key=template.template_key,
            message_preview=message_preview,
            cooldown_applied=False,
            sent=False,
            intent_key=template.intent_key,
            intent_summary=template.intent_summary,
        )
        decision_obj = _persist_decision(
            event_type=event_type,
            ctx=ctx,
            phone_number_e164=phone_number_e164,
            decision=decision,
            consent_snapshot=consent_snapshot,
            metadata=decision_context,
        )
        _record_activity_for_suppression(
            contractor=ctx.get("contractor"),
            agreement=ctx.get("agreement"),
            milestone=ctx.get("milestone"),
            phone_number_e164=phone_number_e164,
            reason_code="no_consent",
            summary="SMS automation suppressed because no consent is on file.",
        )
        return {**decision, "decision_id": decision_obj.id}

    if consent_snapshot.get("opted_out") or not consent_snapshot.get("can_send_sms"):
        decision = _build_decision_payload(
            should_send=False,
            reason_code="opted_out",
            priority=rule.priority,
            channel="suppressed",
            template_key=template.template_key,
            message_preview=message_preview,
            cooldown_applied=False,
            sent=False,
            intent_key=template.intent_key,
            intent_summary=template.intent_summary,
        )
        decision_obj = _persist_decision(
            event_type=event_type,
            ctx=ctx,
            phone_number_e164=phone_number_e164,
            decision=decision,
            consent_snapshot=consent_snapshot,
            metadata=decision_context,
        )
        _record_activity_for_suppression(
            contractor=ctx.get("contractor"),
            agreement=ctx.get("agreement"),
            milestone=ctx.get("milestone"),
            phone_number_e164=phone_number_e164,
            reason_code="opted_out",
            summary="SMS automation suppressed because the contact is opted out.",
        )
        return {**decision, "decision_id": decision_obj.id}

    suppressed, suppression_reason = should_escalate_or_suppress(
        event_type,
        phone_number_e164=phone_number_e164,
        agreement=ctx.get("agreement"),
        invoice=ctx.get("invoice"),
        milestone=ctx.get("milestone"),
    )
    if suppressed:
        decision = _build_decision_payload(
            should_send=False,
            reason_code=suppression_reason,
            priority=rule.priority,
            channel="suppressed",
            template_key=template.template_key,
            message_preview=message_preview,
            cooldown_applied=False,
            sent=False,
            intent_key=template.intent_key,
            intent_summary=template.intent_summary,
            duplicate_suppressed=True,
        )
        decision_obj = _persist_decision(
            event_type=event_type,
            ctx=ctx,
            phone_number_e164=phone_number_e164,
            decision=decision,
            consent_snapshot=consent_snapshot,
            metadata=decision_context,
        )
        _record_activity_for_suppression(
            contractor=ctx.get("contractor"),
            agreement=ctx.get("agreement"),
            milestone=ctx.get("milestone"),
            phone_number_e164=phone_number_e164,
            reason_code=suppression_reason,
            summary="SMS automation suppressed because a higher-value related update already exists.",
        )
        return {**decision, "decision_id": decision_obj.id}

    if has_recent_similar_sms(
        phone_number_e164=phone_number_e164,
        template_key=template.template_key,
        event_type=event_type,
        agreement=ctx.get("agreement"),
        milestone=ctx.get("milestone"),
        cooldown_hours=rule.cooldown_hours,
    ):
        decision = _build_decision_payload(
            should_send=False,
            reason_code="duplicate_recent",
            priority=rule.priority,
            channel="suppressed",
            template_key=template.template_key,
            message_preview=message_preview,
            cooldown_applied=True,
            sent=False,
            intent_key=template.intent_key,
            intent_summary=template.intent_summary,
            duplicate_suppressed=True,
        )
        decision_obj = _persist_decision(
            event_type=event_type,
            ctx=ctx,
            phone_number_e164=phone_number_e164,
            decision=decision,
            consent_snapshot=consent_snapshot,
            metadata=decision_context,
        )
        _record_activity_for_suppression(
            contractor=ctx.get("contractor"),
            agreement=ctx.get("agreement"),
            milestone=ctx.get("milestone"),
            phone_number_e164=phone_number_e164,
            reason_code="duplicate_recent",
            summary="SMS automation suppressed because a similar message was sent recently.",
        )
        return {**decision, "decision_id": decision_obj.id}

    if rule.channel_preference == "dashboard_only":
        decision = _build_decision_payload(
            should_send=False,
            reason_code="dashboard_only_preferred" if rule.priority != "low" else "low_value_dashboard_only",
            priority=rule.priority,
            channel="dashboard_only",
            template_key=template.template_key,
            message_preview=message_preview,
            cooldown_applied=False,
            sent=False,
            intent_key=template.intent_key,
            intent_summary=template.intent_summary,
        )
        decision_obj = _persist_decision(
            event_type=event_type,
            ctx=ctx,
            phone_number_e164=phone_number_e164,
            decision=decision,
            consent_snapshot=consent_snapshot,
            metadata=decision_context,
        )
        return {**decision, "decision_id": decision_obj.id}

    if _in_quiet_hours() and not rule.quiet_hours_bypass and rule.quiet_hours_behavior == "defer":
        scheduled_for = _next_send_window()
        decision = _build_decision_payload(
            should_send=True,
            reason_code="quiet_hours_deferred",
            priority=rule.priority,
            channel="sms",
            template_key=template.template_key,
            message_preview=message_preview,
            cooldown_applied=False,
            sent=False,
            intent_key=template.intent_key,
            intent_summary=template.intent_summary,
            deferred=True,
        )
        decision_obj = _persist_decision(
            event_type=event_type,
            ctx=ctx,
            phone_number_e164=phone_number_e164,
            decision=decision,
            consent_snapshot=consent_snapshot,
            metadata={**decision_context, "scheduled_for": scheduled_for.isoformat()},
        )
        _queue_deferred_sms(
            decision_obj=decision_obj,
            ctx=ctx,
            phone_number_e164=phone_number_e164,
            template_key=template.template_key,
            intent_key=template.intent_key,
            message_body=message_preview,
            event_type=event_type,
            scheduled_for=scheduled_for,
        )
        _record_activity_for_suppression(
            contractor=ctx.get("contractor"),
            agreement=ctx.get("agreement"),
            milestone=ctx.get("milestone"),
            phone_number_e164=phone_number_e164,
            reason_code="quiet_hours_deferred",
            summary="SMS automation deferred delivery until the next allowed send window.",
        )
        return {**decision, "decision_id": decision_obj.id, "scheduled_for": scheduled_for.isoformat()}

    if simulate:
        decision = _build_decision_payload(
            should_send=True,
            reason_code="preview_ready",
            priority=rule.priority,
            channel="sms",
            template_key=template.template_key,
            message_preview=message_preview,
            cooldown_applied=False,
            sent=False,
            intent_key=template.intent_key,
            intent_summary=template.intent_summary,
        )
        decision_obj = _persist_decision(
            event_type=event_type,
            ctx=ctx,
            phone_number_e164=phone_number_e164,
            decision=decision,
            consent_snapshot=consent_snapshot,
            metadata=decision_context,
        )
        return {**decision, "decision_id": decision_obj.id}

    send_result = send_compliant_sms(
        phone_number_e164,
        message_preview,
        related_object=ctx.get("invoice") or ctx.get("milestone") or ctx.get("agreement") or ctx.get("homeowner") or ctx.get("contractor"),
        category="customer_care",
    )
    decision = _build_decision_payload(
        should_send=True,
        reason_code="sent_immediately" if send_result.get("ok") else "send_failed",
        priority=rule.priority,
        channel="sms",
        template_key=template.template_key,
        message_preview=message_preview,
        cooldown_applied=False,
        sent=bool(send_result.get("ok")),
        intent_key=template.intent_key,
        intent_summary=template.intent_summary,
        twilio_message_sid=send_result.get("twilio_sid", ""),
    )
    decision_obj = _persist_decision(
        event_type=event_type,
        ctx=ctx,
        phone_number_e164=phone_number_e164,
        decision=decision,
        consent_snapshot=consent_snapshot,
        metadata={**decision_context, "send_result": send_result},
    )
    return {**decision, "decision_id": decision_obj.id}


def build_sms_automation_summary(*, contractor: Contractor | None = None, agreement: Agreement | None = None) -> dict[str, Any]:
    qs = SMSAutomationDecision.objects.all()
    if contractor is not None:
        qs = qs.filter(contractor=contractor)
    if agreement is not None:
        qs = qs.filter(agreement=agreement)
    last_7d = timezone.now() - timedelta(days=7)
    window = qs.filter(created_at__gte=last_7d)
    recent = qs.order_by("-created_at", "-id")[:5]
    last_decision = qs.order_by("-created_at", "-id").first()
    return {
        "sms_automation_enabled": True,
        "last_sms_automation_decision": {
            "event_type": last_decision.event_type,
            "reason_code": last_decision.reason_code,
            "channel_decision": last_decision.channel_decision,
            "priority": last_decision.priority,
            "sent": last_decision.sent,
            "deferred": last_decision.deferred,
            "created_at": last_decision.created_at.isoformat() if last_decision and last_decision.created_at else None,
            "message_preview": last_decision.message_preview,
        } if last_decision else None,
        "recent_sms_automation_decisions": [
            {
                "id": item.id,
                "event_type": item.event_type,
                "reason_code": item.reason_code,
                "channel_decision": item.channel_decision,
                "priority": item.priority,
                "sent": item.sent,
                "deferred": item.deferred,
                "created_at": item.created_at.isoformat() if item.created_at else None,
                "message_preview": item.message_preview,
            }
            for item in recent
        ],
        "suppressed_sms_count_7d": window.filter(channel_decision=SMSAutomationDecision.ChannelDecision.SUPPRESSED).count(),
        "sent_sms_count_7d": window.filter(sent=True).count(),
        "deferred_sms_count_7d": window.filter(deferred=True).count(),
    }


def process_deferred_sms_automation(*, limit: int = 50) -> list[dict[str, Any]]:
    results: list[dict[str, Any]] = []
    rows = DeferredSMSAutomation.objects.filter(
        status=DeferredSMSAutomation.Status.PENDING,
        scheduled_for__lte=timezone.now(),
    ).order_by("scheduled_for", "id")[: max(1, min(int(limit or 50), 200))]
    for row in rows:
        send_result = send_compliant_sms(
            row.phone_number_e164,
            row.message_body,
            related_object=row.invoice or row.milestone or row.agreement or row.homeowner or row.contractor,
            category="customer_care",
        )
        if send_result.get("ok"):
            row.status = DeferredSMSAutomation.Status.SENT
            if row.decision_id:
                SMSAutomationDecision.objects.filter(id=row.decision_id).update(
                    sent=True,
                    twilio_message_sid=send_result.get("twilio_sid", ""),
                )
        else:
            row.status = DeferredSMSAutomation.Status.CANCELLED
        row.save(update_fields=["status", "updated_at"])
        results.append(
            {
                "id": row.id,
                "status": row.status,
                "phone_number_e164": row.phone_number_e164,
                "event_type": row.event_type,
            }
        )
    return results
