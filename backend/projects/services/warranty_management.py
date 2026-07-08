from __future__ import annotations

from datetime import timedelta

from django.contrib.auth import get_user_model
from django.db import transaction
from django.utils import timezone

from projects.models import Agreement, AgreementWarranty, Notification, WarrantyStatus
from projects.models_customer_portal import NotificationRule, SmartNotificationEvent
from projects.models_dispute import Dispute
from projects.models_warranty import (
    WarrantyRequest,
    WarrantyRequestStatusHistory,
    WarrantyWorkOrder,
)
from projects.services.activity_feed import create_activity_event
from projects.services.notification_center import create_notification
from projects.services.smart_notifications import create_smart_notification


def _add_months_approx(start, months: int):
    try:
        return start + timedelta(days=max(int(months or 0), 0) * 30)
    except Exception:
        return start


def agreement_completion_date(agreement: Agreement):
    if getattr(agreement, "end", None):
        return agreement.end
    latest = agreement.milestones.filter(completed_at__isnull=False).order_by("-completed_at").first()
    if latest and latest.completed_at:
        return latest.completed_at.date()
    return timezone.localdate()


def ensure_warranties_for_completed_agreement(agreement: Agreement) -> list[AgreementWarranty]:
    if str(getattr(agreement, "status", "") or "").lower() != "completed":
        return []
    contractor = getattr(agreement, "contractor", None)
    if contractor is None:
        return []

    start = agreement_completion_date(agreement)
    text = (getattr(agreement, "warranty_text_snapshot", "") or "").strip()
    if not text:
        text = (
            "Standard workmanship warranty for covered labor after substantial completion. "
            "Materials remain subject to manufacturer warranty terms."
        )
    end = _add_months_approx(start, 12)
    warranty, _created = AgreementWarranty.objects.update_or_create(
        agreement=agreement,
        applies_to="workmanship",
        generated_from_agreement_completion=True,
        defaults={
            "contractor": contractor,
            "title": "12-Month Workmanship Warranty",
            "coverage_details": text,
            "covered_work": text,
            "exclusions": getattr(agreement, "excluded_work", "") or "Normal wear, misuse, improper maintenance, third-party modifications, and acts of God.",
            "excluded_work": getattr(agreement, "excluded_work", "") or "Normal wear, misuse, improper maintenance, third-party modifications, and acts of God.",
            "customer_responsibilities": getattr(agreement, "homeowner_responsibilities", "") or "Notify contractor promptly and provide reasonable access for inspection.",
            "contractor_responsibilities": getattr(agreement, "contractor_responsibilities", "") or "Review warranty requests and complete covered repairs within a reasonable schedule.",
            "response_time_expectations": "Contractor should respond to submitted warranty requests within 2 business days when practical.",
            "manufacturer_notes": "Manufacturer warranties apply separately to covered materials.",
            "workmanship_duration_months": 12,
            "labor_duration_months": 12,
            "materials_duration_months": 0,
            "completion_date": start,
            "start_date": start,
            "end_date": end,
            "status": WarrantyStatus.ACTIVE,
        },
    )
    return [warranty]


def record_warranty_status(
    request: WarrantyRequest,
    to_status: str,
    *,
    actor=None,
    note: str = "",
    metadata: dict | None = None,
) -> WarrantyRequestStatusHistory:
    from_status = request.status or ""
    request.status = to_status
    request.next_expected_action = _next_action_for_status(to_status)
    if to_status in {WarrantyRequest.STATUS_CLOSED, WarrantyRequest.STATUS_COMPLETED, WarrantyRequest.STATUS_DENIED}:
        request.closed_at = request.closed_at or timezone.now()
    request.save(update_fields=["status", "next_expected_action", "closed_at", "updated_at"])
    event = WarrantyRequestStatusHistory.objects.create(
        warranty_request=request,
        from_status=from_status,
        to_status=to_status,
        note=note or "",
        actor=actor if getattr(actor, "is_authenticated", False) else None,
        actor_email=(getattr(actor, "email", "") or "") if actor else "",
        metadata=metadata or {},
    )
    notify_warranty_status_change(request, to_status=to_status, actor=actor, note=note, metadata=metadata or {})
    _activity(request, actor=actor, title=f"Warranty {to_status.replace('_', ' ')}", summary=note or f"Warranty request moved to {to_status.replace('_', ' ')}.")
    return event


def create_initial_status(request: WarrantyRequest, *, actor=None) -> None:
    if request.status_history.exists():
        return
    if not request.response_due_at:
        request.response_due_at = timezone.now() + timedelta(days=2)
    if not request.next_expected_action:
        request.next_expected_action = "Contractor reviews request."
    request.save(update_fields=["response_due_at", "next_expected_action", "updated_at"])
    WarrantyRequestStatusHistory.objects.create(
        warranty_request=request,
        from_status="",
        to_status=request.status,
        note="Warranty request submitted.",
        actor=actor if getattr(actor, "is_authenticated", False) else None,
        actor_email=(getattr(actor, "email", "") or getattr(request, "submitted_by_email", "") or "") if actor else getattr(request, "submitted_by_email", ""),
        metadata={"source": "warranty_request"},
    )
    notify_warranty_status_change(request, to_status=request.status, actor=actor, note="Warranty request submitted.")
    _activity(request, actor=actor, title="Warranty request submitted", summary=f"{request.title} was submitted for review.")


def build_warranty_ai_review(request: WarrantyRequest) -> dict:
    warranty = request.warranty
    today = timezone.localdate()
    active = bool(warranty.start_date and warranty.end_date and warranty.start_date <= today <= warranty.end_date)
    likely = "likely_covered" if active else "needs_review"
    missing = []
    if request.evidence.count() == 0:
        missing.append("Photos, video, or supporting documents")
    if not request.date_noticed:
        missing.append("Date issue was noticed")
    return {
        "advisory_only": True,
        "summary": f"{request.title}: {request.description[:240]}",
        "likely_coverage": likely,
        "possible_exclusions": warranty.excluded_work or warranty.exclusions or "",
        "missing_information": missing,
        "recommended_next_step": "Schedule inspection" if request.severity in {"high", "critical"} else "Review request and ask for missing information if needed",
        "recommended_team_member": _recommended_team_member(request),
        "confidence_level": "medium" if active else "low",
        "evidence_considered": {
            "agreement_id": request.agreement_id,
            "warranty_id": warranty.id,
            "completion_date": warranty.completion_date.isoformat() if warranty.completion_date else "",
            "expiration_date": warranty.end_date.isoformat() if warranty.end_date else "",
            "evidence_count": request.evidence.count(),
            "status_history_count": request.status_history.count(),
            "work_order_id": getattr(getattr(request, "work_order", None), "id", None),
        },
        "boundary": "Project Assistant does not approve, deny, assign blame, or create payment obligations.",
    }


def create_warranty_work_order(request: WarrantyRequest, *, actor=None, payload: dict | None = None) -> WarrantyWorkOrder:
    payload = payload or {}
    assigned_user = payload.get("assigned_user")
    if assigned_user and not hasattr(assigned_user, "pk"):
        try:
            assigned_user = get_user_model().objects.filter(pk=assigned_user).first()
        except Exception:
            assigned_user = None
    work_order, created = WarrantyWorkOrder.objects.get_or_create(
        warranty_request=request,
        defaults={
            "warranty": request.warranty,
            "agreement": request.agreement,
            "project": request.project,
            "contractor": request.contractor,
            "title": payload.get("title") or request.title,
            "scope": payload.get("scope") or request.description,
            "assigned_user": assigned_user,
            "assigned_team_notes": payload.get("assigned_team_notes") or "",
            "materials": payload.get("materials") or "",
            "scheduled_for": payload.get("scheduled_for"),
            "labor_estimate_hours": payload.get("labor_estimate_hours"),
            "estimated_duration_minutes": payload.get("estimated_duration_minutes"),
            "customer_notes": payload.get("customer_notes") or request.customer_notes,
            "completion_checklist": payload.get("completion_checklist") or [],
            "status": WarrantyWorkOrder.STATUS_OPEN,
        },
    )
    if created:
        record_warranty_status(
            request,
            WarrantyRequest.STATUS_REPAIR_SCHEDULED if work_order.scheduled_for else WarrantyRequest.STATUS_COVERED,
            actor=actor,
            note="Warranty work order created.",
            metadata={"work_order_id": work_order.id},
        )
        _activity(request, actor=actor, title="Warranty work order created", summary=f"Warranty work order created for {request.title}.")
        if work_order.scheduled_for:
            notify_warranty_status_change(
                request,
                to_status=WarrantyRequest.STATUS_REPAIR_SCHEDULED,
                actor=actor,
                note="Warranty repair scheduled.",
                metadata={"work_order_id": work_order.id, "scheduled_for": work_order.scheduled_for.isoformat()},
            )
    return work_order


def complete_warranty_work_order(work_order: WarrantyWorkOrder, *, actor=None, notes: str = "") -> WarrantyWorkOrder:
    work_order.status = WarrantyWorkOrder.STATUS_COMPLETED
    work_order.completed_at = work_order.completed_at or timezone.now()
    if notes:
        work_order.completion_notes = notes
    work_order.save(update_fields=["status", "completed_at", "completion_notes", "updated_at"])
    request = work_order.warranty_request
    record_warranty_status(
        request,
        WarrantyRequest.STATUS_ACKNOWLEDGMENT_REQUESTED,
        actor=actor,
        note="Warranty repair completed. Customer acknowledgment requested.",
        metadata={"work_order_id": work_order.id},
    )
    return work_order


def acknowledge_warranty_completion(request: WarrantyRequest, *, accepted: bool, actor_email: str = "", note: str = "") -> WarrantyRequest:
    request.customer_acknowledged_at = timezone.now()
    request.customer_acknowledgment_response = "accepted" if accepted else "issue_still_exists"
    if not accepted:
        request.unresolved_reason = note or request.unresolved_reason
        request.status = WarrantyRequest.STATUS_FOLLOW_UP_NEEDED
        request.next_expected_action = "Contractor reviews follow-up and schedules next action."
        update_fields = [
            "customer_acknowledged_at",
            "customer_acknowledgment_response",
            "unresolved_reason",
            "status",
            "next_expected_action",
            "updated_at",
        ]
        request.save(update_fields=update_fields)
        WarrantyRequestStatusHistory.objects.create(
            warranty_request=request,
            from_status=WarrantyRequest.STATUS_ACKNOWLEDGMENT_REQUESTED,
            to_status=WarrantyRequest.STATUS_FOLLOW_UP_NEEDED,
            note=note or "Customer reported the issue still exists.",
            actor_email=actor_email,
            metadata={"acknowledgment": "issue_still_exists"},
        )
        notify_warranty_status_change(
            request,
            to_status=WarrantyRequest.STATUS_FOLLOW_UP_NEEDED,
            note=note or "Customer reported the issue still exists.",
            metadata={"acknowledgment": "issue_still_exists"},
        )
        return request

    request.status = WarrantyRequest.STATUS_CLOSED
    request.closed_at = request.closed_at or timezone.now()
    request.next_expected_action = "Warranty request closed."
    request.save(
        update_fields=[
            "customer_acknowledged_at",
            "customer_acknowledgment_response",
            "status",
            "closed_at",
            "next_expected_action",
            "updated_at",
        ]
    )
    WarrantyRequestStatusHistory.objects.create(
        warranty_request=request,
        from_status=WarrantyRequest.STATUS_ACKNOWLEDGMENT_REQUESTED,
        to_status=WarrantyRequest.STATUS_CLOSED,
        note=note or "Customer accepted warranty repair completion.",
        actor_email=actor_email,
        metadata={"acknowledgment": "accepted"},
    )
    notify_warranty_status_change(
        request,
        to_status=WarrantyRequest.STATUS_CLOSED,
        note=note or "Customer accepted warranty repair completion.",
        metadata={"acknowledgment": "accepted"},
    )
    return request


def escalate_warranty_request_to_resolution(request: WarrantyRequest, *, actor=None, note: str = "") -> Dispute:
    work_order = getattr(request, "work_order", None)
    context_lines = [
        "Source: Warranty Request",
        f"Coverage Decision: {request.coverage_decision or request.status}",
        f"Repair Status: {getattr(work_order, 'status', '') or 'No warranty work order'}",
        f"Warranty Expiration: Active through {request.warranty.end_date}" if request.warranty.end_date else "",
        f"Evidence Count: {request.evidence.count()}",
        f"Status Events: {request.status_history.count()}",
    ]
    with transaction.atomic():
        dispute = Dispute.objects.create(
            agreement=request.agreement,
            project=request.project,
            milestone=None,
            warranty_request=request.warranty,
            warranty_service_request=request,
            source_type=Dispute.SOURCE_WARRANTY_REQUEST,
            source_object_id=request.id,
            source_locked=True,
            initiator="contractor" if actor else "system",
            reason=f"Warranty request escalated: {request.title}",
            description="\n\n".join(
                part
                for part in [
                    request.description,
                    note,
                    "\n".join(line for line in context_lines if line),
                    f"AI Review: {request.ai_review}" if request.ai_review else "",
                    f"[Warranty Request] warranty_request_id={request.id} warranty_id={request.warranty_id}",
                ]
                if str(part or "").strip()
            ),
            status="open",
            fee_paid=True,
            escrow_frozen=False,
            created_by=actor if getattr(actor, "is_authenticated", False) else None,
        )
        request.escalated_dispute_id = dispute.id
        request.status = WarrantyRequest.STATUS_ESCALATED_TO_RESOLUTION
        request.save(update_fields=["escalated_dispute_id", "status", "updated_at"])
        WarrantyRequestStatusHistory.objects.create(
            warranty_request=request,
            from_status="",
            to_status=WarrantyRequest.STATUS_ESCALATED_TO_RESOLUTION,
            note=note or "Escalated to Resolution Workspace.",
            actor=actor if getattr(actor, "is_authenticated", False) else None,
            actor_email=getattr(actor, "email", "") or "",
            metadata={
                "dispute_id": dispute.id,
                "warranty_request_id": request.id,
                "work_order_id": getattr(work_order, "id", None),
                "evidence_ids": list(request.evidence.values_list("id", flat=True)),
                "status_history_ids": list(request.status_history.values_list("id", flat=True)),
                "ai_review": request.ai_review,
                "coverage_decision": request.coverage_decision,
                "repair_status": getattr(work_order, "status", ""),
            },
        )
    _activity(request, actor=actor, title="Warranty request escalated", summary="Warranty request was escalated to the Resolution Workspace.")
    notify_warranty_status_change(request, to_status=WarrantyRequest.STATUS_ESCALATED_TO_RESOLUTION, actor=actor, note=note or "Warranty request escalated.")
    return dispute


def notify_warranty_status_change(
    request: WarrantyRequest,
    *,
    to_status: str,
    actor=None,
    note: str = "",
    metadata: dict | None = None,
) -> None:
    metadata = metadata or {}
    customer_email = (
        getattr(request, "submitted_by_email", "")
        or getattr(getattr(request, "homeowner", None), "email", "")
        or ""
    )
    context = {
        "request_title": request.title,
        "project_title": getattr(getattr(request, "project", None), "title", "") or getattr(getattr(request.agreement, "project", None), "title", ""),
        "contractor_name": getattr(request.contractor, "business_name", "") or "Your contractor",
        "coverage_decision": request.coverage_decision or to_status.replace("_", " "),
        "scheduled_for": metadata.get("scheduled_for") or _scheduled_label(getattr(getattr(request, "work_order", None), "scheduled_for", None)),
        "dedupe_key": f"warranty:{request.id}:{to_status}:{metadata.get('work_order_id', '')}",
    }
    event_type = _customer_event_for_status(to_status)
    if customer_email and event_type:
        create_smart_notification(
            event_type=event_type,
            recipient_email=customer_email,
            context=context,
            audience=NotificationRule.AUDIENCE_CUSTOMER,
            action_url=f"/app/project/{request.project_id}?token={getattr(request.agreement, 'homeowner_access_token', '')}" if request.project_id else "",
            homeowner=request.homeowner,
            contractor=request.contractor,
            project=request.project,
            agreement=request.agreement,
            property_profile=request.property_profile,
        )
    create_notification(
        contractor=request.contractor,
        category=_contractor_category_for_status(to_status),
        title=_contractor_title_for_status(to_status),
        body=note or f"{request.title} moved to {to_status.replace('_', ' ')}.",
        link=f"/app/warranties?request={request.id}",
        agreement=request.agreement,
        actor_user=actor if getattr(actor, "is_authenticated", False) else None,
    )


def _customer_event_for_status(status_value: str) -> str:
    mapping = {
        WarrantyRequest.STATUS_SUBMITTED: SmartNotificationEvent.WARRANTY_REQUEST_RECEIVED,
        WarrantyRequest.STATUS_MORE_INFORMATION_REQUESTED: SmartNotificationEvent.WARRANTY_INFORMATION_REQUESTED,
        WarrantyRequest.STATUS_INSPECTION_SCHEDULED: SmartNotificationEvent.WARRANTY_INSPECTION_SCHEDULED,
        WarrantyRequest.STATUS_COVERED: SmartNotificationEvent.WARRANTY_COVERAGE_DECISION,
        WarrantyRequest.STATUS_PARTIALLY_COVERED: SmartNotificationEvent.WARRANTY_COVERAGE_DECISION,
        WarrantyRequest.STATUS_NOT_COVERED: SmartNotificationEvent.WARRANTY_COVERAGE_DECISION,
        WarrantyRequest.STATUS_DENIED: SmartNotificationEvent.WARRANTY_COVERAGE_DECISION,
        WarrantyRequest.STATUS_REPAIR_SCHEDULED: SmartNotificationEvent.WARRANTY_REPAIR_SCHEDULED,
        WarrantyRequest.STATUS_REPAIR_IN_PROGRESS: SmartNotificationEvent.WARRANTY_REPAIR_SCHEDULED,
        WarrantyRequest.STATUS_ACKNOWLEDGMENT_REQUESTED: SmartNotificationEvent.WARRANTY_ACKNOWLEDGMENT_REQUESTED,
        WarrantyRequest.STATUS_COMPLETED: SmartNotificationEvent.WARRANTY_REPAIR_COMPLETED,
        WarrantyRequest.STATUS_CLOSED: SmartNotificationEvent.WARRANTY_CLOSED,
        WarrantyRequest.STATUS_ESCALATED_TO_RESOLUTION: SmartNotificationEvent.WARRANTY_ESCALATED,
    }
    return mapping.get(status_value, SmartNotificationEvent.WARRANTY_COVERAGE_DECISION)


def _contractor_category_for_status(status_value: str) -> str:
    if status_value in {WarrantyRequest.STATUS_SUBMITTED, WarrantyRequest.STATUS_FOLLOW_UP_NEEDED}:
        return Notification.EVENT_DISPUTE_UPDATED
    if status_value == WarrantyRequest.STATUS_REPAIR_SCHEDULED:
        return Notification.EVENT_MAINTENANCE_WORK_ORDER_SCHEDULED
    if status_value in {WarrantyRequest.STATUS_ACKNOWLEDGMENT_REQUESTED, WarrantyRequest.STATUS_CLOSED, WarrantyRequest.STATUS_COMPLETED}:
        return Notification.EVENT_MAINTENANCE_WORK_ORDER_COMPLETED
    if status_value == WarrantyRequest.STATUS_ESCALATED_TO_RESOLUTION:
        return Notification.EVENT_DISPUTE_OPENED
    return Notification.EVENT_DISPUTE_UPDATED


def _contractor_title_for_status(status_value: str) -> str:
    labels = {
        WarrantyRequest.STATUS_SUBMITTED: "New warranty request",
        WarrantyRequest.STATUS_FOLLOW_UP_NEEDED: "Warranty follow-up needed",
        WarrantyRequest.STATUS_REPAIR_SCHEDULED: "Warranty repair scheduled",
        WarrantyRequest.STATUS_ACKNOWLEDGMENT_REQUESTED: "Warranty completion awaiting customer",
        WarrantyRequest.STATUS_CLOSED: "Warranty request closed",
        WarrantyRequest.STATUS_ESCALATED_TO_RESOLUTION: "Warranty escalated to Resolution",
    }
    return labels.get(status_value, "Warranty request updated")


def _next_action_for_status(status_value: str) -> str:
    return {
        WarrantyRequest.STATUS_SUBMITTED: "Contractor reviews request.",
        WarrantyRequest.STATUS_UNDER_REVIEW: "Contractor reviews warranty language and evidence.",
        WarrantyRequest.STATUS_MORE_INFORMATION_REQUESTED: "Customer responds with details or evidence.",
        WarrantyRequest.STATUS_INSPECTION_SCHEDULED: "Customer prepares for scheduled inspection.",
        WarrantyRequest.STATUS_COVERED: "Contractor schedules repair work.",
        WarrantyRequest.STATUS_PARTIALLY_COVERED: "Customer reviews partial coverage decision.",
        WarrantyRequest.STATUS_NOT_COVERED: "Customer may respond or request Resolution review.",
        WarrantyRequest.STATUS_DENIED: "Customer may respond or request Resolution review.",
        WarrantyRequest.STATUS_REPAIR_SCHEDULED: "Contractor completes scheduled warranty repair.",
        WarrantyRequest.STATUS_REPAIR_IN_PROGRESS: "Warranty repair is in progress.",
        WarrantyRequest.STATUS_ACKNOWLEDGMENT_REQUESTED: "Customer reviews and acknowledges completion.",
        WarrantyRequest.STATUS_FOLLOW_UP_NEEDED: "Contractor reviews unresolved issue.",
        WarrantyRequest.STATUS_CLOSED: "Warranty request closed.",
    }.get(status_value, "Review warranty request status.")


def _scheduled_label(value) -> str:
    if not value:
        return "a scheduled visit"
    try:
        return timezone.localtime(value).strftime("%b %-d, %Y %-I:%M %p")
    except Exception:
        return str(value)


def _recommended_team_member(request: WarrantyRequest) -> dict:
    try:
        work_order = getattr(request, "work_order", None)
        assigned_user = getattr(work_order, "assigned_user", None)
        if assigned_user:
            return {"user_id": assigned_user.id, "email": assigned_user.email, "reason": "Already assigned to this warranty work order."}
        contractor = request.contractor
        sub = contractor.subaccounts.filter(is_active=True).select_related("user").order_by("id").first()
        if sub:
            return {
                "subaccount_id": sub.id,
                "user_id": getattr(sub.user, "id", None),
                "email": getattr(sub.user, "email", ""),
                "name": sub.display_name,
                "reason": "First active team member. Availability remains advisory and should be confirmed.",
            }
    except Exception:
        pass
    return {"reason": "No active team member recommendation available."}


def _activity(request: WarrantyRequest, *, actor=None, title: str, summary: str) -> None:
    try:
        create_activity_event(
            contractor=request.contractor,
            actor_user=actor,
            agreement=request.agreement,
            milestone=None,
            event_type="warranty_request",
            title=title,
            summary=summary,
            severity="info",
            related_label=request.title,
            icon_hint="warranty",
            navigation_target=f"/app/warranties?request={request.id}",
            metadata={"warranty_request_id": request.id, "warranty_id": request.warranty_id},
            dedupe_key=f"warranty:{request.id}:{title}",
        )
    except Exception:
        pass
