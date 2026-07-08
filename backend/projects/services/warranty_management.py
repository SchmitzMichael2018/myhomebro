from __future__ import annotations

from datetime import timedelta

from django.contrib.auth import get_user_model
from django.db import transaction
from django.utils import timezone

from projects.models import Agreement, AgreementWarranty, WarrantyStatus
from projects.models_dispute import Dispute
from projects.models_warranty import (
    WarrantyRequest,
    WarrantyRequestStatusHistory,
    WarrantyWorkOrder,
)
from projects.services.activity_feed import create_activity_event


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
    if to_status in {WarrantyRequest.STATUS_CLOSED, WarrantyRequest.STATUS_COMPLETED, WarrantyRequest.STATUS_DENIED}:
        request.closed_at = request.closed_at or timezone.now()
    request.save(update_fields=["status", "closed_at", "updated_at"])
    return WarrantyRequestStatusHistory.objects.create(
        warranty_request=request,
        from_status=from_status,
        to_status=to_status,
        note=note or "",
        actor=actor if getattr(actor, "is_authenticated", False) else None,
        actor_email=(getattr(actor, "email", "") or "") if actor else "",
        metadata=metadata or {},
    )


def create_initial_status(request: WarrantyRequest, *, actor=None) -> None:
    if request.status_history.exists():
        return
    WarrantyRequestStatusHistory.objects.create(
        warranty_request=request,
        from_status="",
        to_status=request.status,
        note="Warranty request submitted.",
        actor=actor if getattr(actor, "is_authenticated", False) else None,
        actor_email=(getattr(actor, "email", "") or getattr(request, "submitted_by_email", "") or "") if actor else getattr(request, "submitted_by_email", ""),
        metadata={"source": "warranty_request"},
    )


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
        "confidence_level": "medium" if active else "low",
        "evidence_considered": {
            "agreement_id": request.agreement_id,
            "warranty_id": warranty.id,
            "completion_date": warranty.completion_date.isoformat() if warranty.completion_date else "",
            "expiration_date": warranty.end_date.isoformat() if warranty.end_date else "",
            "evidence_count": request.evidence.count(),
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
    return work_order


def escalate_warranty_request_to_resolution(request: WarrantyRequest, *, actor=None, note: str = "") -> Dispute:
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
            metadata={"dispute_id": dispute.id},
        )
    _activity(request, actor=actor, title="Warranty request escalated", summary="Warranty request was escalated to the Resolution Workspace.")
    return dispute


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
