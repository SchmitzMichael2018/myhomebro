from __future__ import annotations

from typing import Any

from django.db.models import Q
from django.utils import timezone

from projects.models import (
    Agreement,
    Contractor,
    ContractorActivityEvent,
    Invoice,
    InvoiceStatus,
    MaintenanceStatus,
    Milestone,
    ProjectStatus,
    SubcontractorComplianceStatus,
    SubcontractorCompletionStatus,
)
from projects.services.contractor_onboarding import build_onboarding_snapshot


def _safe_text(value: Any) -> str:
    return str(value or "").strip()


def _serialize_event(event: ContractorActivityEvent) -> dict[str, Any]:
    return {
        "id": event.id,
        "event_type": event.event_type,
        "title": event.title,
        "summary": event.summary,
        "severity": event.severity,
        "created_at": event.created_at.isoformat() if event.created_at else None,
        "navigation_target": event.navigation_target,
        "related_label": event.related_label,
        "icon_hint": event.icon_hint,
        "related_entity_type": event.related_entity_type,
        "related_entity_id": event.related_entity_id,
        "metadata": event.metadata or {},
    }


def create_activity_event(
    *,
    contractor: Contractor | None,
    event_type: str,
    title: str,
    summary: str = "",
    severity: str = ContractorActivityEvent.Severity.INFO,
    actor_user=None,
    agreement: Agreement | None = None,
    milestone: Milestone | None = None,
    related_entity_type: str = "",
    related_entity_id: Any = "",
    related_label: str = "",
    icon_hint: str = "",
    navigation_target: str = "",
    metadata: dict[str, Any] | None = None,
    dedupe_key: str = "",
    surfaced_in_dashboard: bool = True,
) -> ContractorActivityEvent | None:
    if contractor is None:
        return None
    if dedupe_key and ContractorActivityEvent.objects.filter(
        contractor=contractor,
        dedupe_key=dedupe_key,
    ).exists():
        return None
    try:
        event = ContractorActivityEvent.objects.create(
            contractor=contractor,
            actor_user=actor_user,
            agreement=agreement,
            milestone=milestone,
            related_entity_type=related_entity_type or ("milestone" if milestone else "agreement" if agreement else ""),
            related_entity_id=str(related_entity_id or getattr(milestone, "id", "") or getattr(agreement, "id", "") or ""),
            event_type=event_type,
            title=title,
            summary=summary,
            severity=severity,
            related_label=related_label,
            icon_hint=icon_hint,
            navigation_target=navigation_target,
            metadata=metadata or {},
            dedupe_key=dedupe_key,
            surfaced_in_dashboard=surfaced_in_dashboard,
        )
        try:
            from projects.services.sms_automation import RULES, evaluate_sms_automation

            if event.event_type in RULES:
                evaluate_sms_automation(
                    event.event_type,
                    contractor=contractor,
                    agreement=agreement,
                    milestone=milestone,
                    metadata={"activity_event_id": event.id},
                )
        except Exception:
            pass
        return event
    except Exception:
        return None


def list_activity_feed(contractor: Contractor, *, limit: int = 12) -> list[dict[str, Any]]:
    events = (
        ContractorActivityEvent.objects.filter(contractor=contractor, dismissed_at__isnull=True)
        .order_by("-created_at", "-id")[: max(1, min(int(limit or 12), 50))]
    )
    return [_serialize_event(event) for event in events]


def _latest_draft_agreement(contractor: Contractor) -> Agreement | None:
    return (
        Agreement.objects.filter(contractor=contractor, is_archived=False, status=ProjectStatus.DRAFT)
        .order_by("-updated_at", "-id")
        .first()
    )


def _latest_pending_invoice(contractor: Contractor) -> Invoice | None:
    return (
        Invoice.objects.select_related("agreement")
        .filter(agreement__contractor=contractor, status=InvoiceStatus.PENDING)
        .order_by("-created_at", "-id")
        .first()
    )


def _latest_approved_invoice(contractor: Contractor) -> Invoice | None:
    return (
        Invoice.objects.select_related("agreement")
        .filter(
            agreement__contractor=contractor,
            status=InvoiceStatus.APPROVED,
            escrow_released=False,
        )
        .order_by("-created_at", "-id")
        .first()
    )


def _latest_compliance_milestone(contractor: Contractor) -> Milestone | None:
    return (
        Milestone.objects.select_related("agreement")
        .filter(
            agreement__contractor=contractor,
            subcontractor_compliance_status__in=[
                SubcontractorComplianceStatus.MISSING_LICENSE,
                SubcontractorComplianceStatus.MISSING_INSURANCE,
                SubcontractorComplianceStatus.PENDING_LICENSE,
                SubcontractorComplianceStatus.OVERRIDDEN,
            ],
        )
        .order_by("-subcontractor_license_requested_at", "-id")
        .first()
    )


def _latest_submitted_work(contractor: Contractor) -> Milestone | None:
    return (
        Milestone.objects.select_related("agreement")
        .filter(
            agreement__contractor=contractor,
            subcontractor_completion_status=SubcontractorCompletionStatus.SUBMITTED_FOR_REVIEW,
        )
        .order_by("-subcontractor_marked_complete_at", "-id")
        .first()
    )


def _latest_recurring_attention_agreement(contractor: Contractor) -> Agreement | None:
    today = timezone.localdate()
    return (
        Agreement.objects.filter(
            contractor=contractor,
            recurring_service_enabled=True,
            maintenance_status=MaintenanceStatus.ACTIVE,
            next_occurrence_date__isnull=False,
            next_occurrence_date__lte=today,
        )
        .order_by("next_occurrence_date", "-updated_at", "-id")
        .first()
    )


def _payment_action_needed(contractor: Contractor) -> bool:
    return Invoice.objects.filter(
        agreement__contractor=contractor,
        status__in=[InvoiceStatus.SENT, InvoiceStatus.PENDING, InvoiceStatus.APPROVED],
    ).exists() or Agreement.objects.filter(
        contractor=contractor,
        status__in=[ProjectStatus.SIGNED, ProjectStatus.FUNDED],
    ).exists()


def get_next_best_action(contractor: Contractor | None) -> dict[str, Any]:
    if contractor is None:
        return {}

    onboarding = build_onboarding_snapshot(contractor)
    latest_draft = _latest_draft_agreement(contractor)
    latest_pending_invoice = _latest_pending_invoice(contractor)
    latest_approved_invoice = _latest_approved_invoice(contractor)
    compliance_milestone = _latest_compliance_milestone(contractor)
    submitted_work = _latest_submitted_work(contractor)
    recurring_agreement = _latest_recurring_attention_agreement(contractor)

    # Priority order is intentionally explicit so tuning remains audit-friendly.
    if onboarding.get("status") != "complete":
        return {
            "action_type": "finish_onboarding",
            "title": "Finish onboarding",
            "message": "Complete your setup so MyHomeBro can tailor templates, pricing, and payment guidance.",
            "cta_label": "Resume onboarding",
            "navigation_target": "/app/onboarding",
            "priority_score": 100,
            "rationale": f"Current onboarding step is {_safe_text(onboarding.get('step')) or 'welcome'}.",
            "blocking_issue": True,
            "dismissible": False,
            "source_system": "onboarding",
        }

    if latest_draft is not None:
        return {
            "action_type": "send_first_agreement",
            "title": "Send your next agreement",
            "message": "You already have a draft agreement ready for review and sending.",
            "cta_label": "Open draft",
            "navigation_target": f"/app/agreements/{latest_draft.id}/wizard?step=1",
            "priority_score": 90,
            "rationale": "Draft agreements create the fastest path to homeowner action and funding.",
            "blocking_issue": False,
            "dismissible": False,
            "source_system": "agreements",
        }

    if not bool(getattr(contractor, "stripe_connected", False)) and _payment_action_needed(contractor):
        return {
            "action_type": "connect_stripe",
            "title": "Connect Stripe to get paid",
            "message": "A payment-related workflow is active, and payouts require a connected Stripe account.",
            "cta_label": "Resume Stripe setup",
            "navigation_target": "/app/onboarding",
            "priority_score": 80,
            "rationale": "Stripe setup is deferred until payment workflows become relevant.",
            "blocking_issue": True,
            "dismissible": False,
            "source_system": "payments",
        }

    if latest_pending_invoice is not None:
        return {
            "action_type": "review_pending_milestone_release",
            "title": "Review a pending milestone release",
            "message": "A milestone invoice is waiting for homeowner approval follow-through.",
            "cta_label": "Open invoice",
            "navigation_target": f"/app/invoices/{latest_pending_invoice.id}",
            "priority_score": 70,
            "rationale": "Pending invoices block cash collection and project momentum.",
            "blocking_issue": False,
            "dismissible": False,
            "source_system": "payments",
        }

    if latest_approved_invoice is not None:
        return {
            "action_type": "release_payment",
            "title": "Release an approved payment",
            "message": "An invoice is approved and ready for payout handling.",
            "cta_label": "Open invoice",
            "navigation_target": f"/app/invoices/{latest_approved_invoice.id}",
            "priority_score": 65,
            "rationale": "Approved invoices are the closest revenue conversion point.",
            "blocking_issue": False,
            "dismissible": False,
            "source_system": "payments",
        }

    if compliance_milestone is not None:
        return {
            "action_type": "resolve_compliance_issue",
            "title": "Review assignment compliance",
            "message": "A subcontractor assignment still needs a compliance decision or follow-up.",
            "cta_label": "Open agreement",
            "navigation_target": f"/app/agreements/{compliance_milestone.agreement_id}",
            "priority_score": 60,
            "rationale": "Compliance warnings are advisory but should stay visible and traceable.",
            "blocking_issue": False,
            "dismissible": False,
            "source_system": "compliance",
        }

    if submitted_work is not None:
        return {
            "action_type": "review_submitted_work",
            "title": "Review submitted work",
            "message": "A subcontractor marked work complete and is waiting for your review.",
            "cta_label": "Open review queue",
            "navigation_target": "/app/reviewer/queue",
            "priority_score": 55,
            "rationale": "Submitted work should be reviewed promptly to keep milestones and invoices moving.",
            "blocking_issue": False,
            "dismissible": False,
            "source_system": "milestones",
        }

    if recurring_agreement is not None:
        return {
            "action_type": "review_recurring_occurrence",
            "title": "Review your next maintenance occurrence",
            "message": "A recurring service visit is due and should be reviewed before it slips.",
            "cta_label": "Open agreement",
            "navigation_target": f"/app/agreements/{recurring_agreement.id}/wizard?step=2",
            "priority_score": 50,
            "rationale": "Recurring work stays healthy when the next occurrence is kept visible.",
            "blocking_issue": False,
            "dismissible": False,
            "source_system": "maintenance",
        }

    if Agreement.objects.filter(contractor=contractor, is_archived=False).exists():
        return {
            "action_type": "resume_workflow",
            "title": "Open your dashboard workflow",
            "message": "Your core setup is complete. Review milestones, invoices, or active agreements next.",
            "cta_label": "Open dashboard",
            "navigation_target": "/app/dashboard",
            "priority_score": 10,
            "rationale": "No higher-priority blocking action was found.",
            "blocking_issue": False,
            "dismissible": True,
            "source_system": "dashboard",
        }

    return {
        "action_type": "create_agreement",
        "title": "Create your next agreement",
        "message": "You are clear to start new work. Build the next agreement or start with AI.",
        "cta_label": "Start with AI",
        "navigation_target": "/app/assistant",
        "priority_score": 5,
        "rationale": "No active blockers or pending review items were found.",
        "blocking_issue": False,
        "dismissible": True,
        "source_system": "assistant",
    }


def build_dashboard_activity_payload(contractor: Contractor, *, limit: int = 12) -> dict[str, Any]:
    return {
        "results": list_activity_feed(contractor, limit=limit),
        "next_best_action": get_next_best_action(contractor),
    }
