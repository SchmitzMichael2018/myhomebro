from __future__ import annotations

from typing import Any

from django.conf import settings
from django.core.mail import send_mail
from django.utils import timezone

from projects.models import (
    Agreement,
    Contractor,
    Milestone,
    SubcontractorComplianceStatus,
)
from projects.models_compliance import ContractorComplianceRecord
from projects.models_subcontractor import SubcontractorInvitation
from projects.services.compliance import (
    TRADE_ALIASES,
    contractor_has_insurance_on_file,
    contractor_has_required_license,
    derive_trade_key_from_agreement,
    get_trade_license_requirement,
    normalize_trade_key,
)
from projects.services.activity_feed import create_activity_event


def get_subcontractor_contractor(invitation: SubcontractorInvitation | None) -> Contractor | None:
    user = getattr(invitation, "accepted_by_user", None) if invitation is not None else None
    if user is None:
        return None
    return Contractor.objects.filter(user=user).first()


def derive_assignment_trade_key(*, agreement: Agreement | None, milestone: Milestone | None = None) -> str:
    known_trade_keys = set(TRADE_ALIASES.keys())
    if milestone is not None:
        normalized_type = normalize_trade_key(getattr(milestone, "normalized_milestone_type", ""))
        if normalized_type and normalized_type in known_trade_keys:
            return normalized_type
        title_key = normalize_trade_key(getattr(milestone, "title", ""))
        if title_key and title_key in known_trade_keys:
            return title_key
    return derive_trade_key_from_agreement(agreement)


def derive_assignment_state_code(*, agreement: Agreement | None, milestone: Milestone | None = None) -> str:
    agreement = agreement or getattr(milestone, "agreement", None)
    return str(getattr(agreement, "project_address_state", "") or "").strip().upper()


def _warning_message(*, requirement, trade_label: str, state_label: str, compliance_status: str, has_license: bool, has_insurance: bool) -> tuple[str, str]:
    if requirement is None:
        return (
            "MyHomeBro does not have a seeded licensing rule for this trade and state yet.",
            "info",
        )
    if not requirement.license_required and not requirement.insurance_required:
        return ("No seeded license or insurance requirement is tracked for this assignment.", "none")
    if compliance_status == SubcontractorComplianceStatus.COMPLIANT:
        return (
            f"{trade_label} work in {state_label} typically requires compliance documents, and matching records are on file.",
            "info",
        )
    if compliance_status == SubcontractorComplianceStatus.PENDING_LICENSE:
        return (
            f"{trade_label} work in {state_label} typically requires a license. Documentation has been requested before acceptance.",
            "warning",
        )
    if compliance_status == SubcontractorComplianceStatus.MISSING_LICENSE:
        return (
            f"{trade_label} work in {state_label} typically requires a license. This subcontractor does not have a matching license on file.",
            "critical",
        )
    if compliance_status == SubcontractorComplianceStatus.MISSING_INSURANCE:
        return (
            "Insurance is typically expected for this assignment, and no active insurance certificate is on file.",
            "warning",
        )
    if compliance_status == SubcontractorComplianceStatus.OVERRIDDEN:
        return (
            "This assignment was overridden without all expected compliance documents on file.",
            "warning",
        )
    if requirement.license_required and not has_license:
        return (
            f"{trade_label} work in {state_label} typically requires a license.",
            "warning",
        )
    if requirement.insurance_required and not has_insurance:
        return ("Insurance is typically expected for this assignment.", "warning")
    return ("Compliance information is available for this assignment.", "info")


def evaluate_subcontractor_assignment_compliance(
    *,
    contractor: Contractor | None,
    invitation: SubcontractorInvitation | None,
    agreement: Agreement | None = None,
    milestone: Milestone | None = None,
) -> dict[str, Any]:
    agreement = agreement or getattr(milestone, "agreement", None)
    trade_key = derive_assignment_trade_key(agreement=agreement, milestone=milestone)
    state_code = derive_assignment_state_code(agreement=agreement, milestone=milestone)
    requirement = get_trade_license_requirement(state_code, trade_key)
    subcontractor = get_subcontractor_contractor(invitation)

    license_info = contractor_has_required_license(subcontractor, state_code, trade_key)
    insurance_info = contractor_has_insurance_on_file(subcontractor)
    has_license = bool(license_info["has_license"])
    has_insurance = bool(insurance_info["has_insurance"])

    if requirement is None:
        compliance_status = SubcontractorComplianceStatus.UNKNOWN
    elif not requirement.license_required and not requirement.insurance_required:
        compliance_status = SubcontractorComplianceStatus.NOT_REQUIRED
    elif requirement.license_required and not has_license:
        compliance_status = (
            SubcontractorComplianceStatus.PENDING_LICENSE
            if license_info["status"] == ContractorComplianceRecord.Status.PENDING_REVIEW
            else SubcontractorComplianceStatus.MISSING_LICENSE
        )
    elif requirement.insurance_required and not has_insurance:
        compliance_status = SubcontractorComplianceStatus.MISSING_INSURANCE
    else:
        compliance_status = SubcontractorComplianceStatus.COMPLIANT

    trade_label = (
        getattr(requirement, "trade_label", "")
        or trade_key.replace("_", " ").title()
        or "This trade"
    )
    state_label = getattr(requirement, "state_name", "") or state_code or "this state"
    warning_message, warning_level = _warning_message(
        requirement=requirement,
        trade_label=trade_label,
        state_label=state_label,
        compliance_status=compliance_status,
        has_license=has_license,
        has_insurance=has_insurance,
    )

    available_actions = ["assign_anyway"]
    if compliance_status in {
        SubcontractorComplianceStatus.MISSING_LICENSE,
        SubcontractorComplianceStatus.MISSING_INSURANCE,
        SubcontractorComplianceStatus.PENDING_LICENSE,
    }:
        available_actions = ["assign_anyway", "request_license", "choose_another"]

    return {
        "license_required": bool(getattr(requirement, "license_required", False)),
        "insurance_required": bool(getattr(requirement, "insurance_required", False)),
        "trade_key": trade_key,
        "trade_label": trade_label,
        "state_code": state_code,
        "issuing_authority_name": getattr(requirement, "issuing_authority_name", "") or "",
        "official_lookup_url": getattr(requirement, "official_lookup_url", "") or "",
        "subcontractor_has_required_license_on_file": has_license,
        "subcontractor_license_status": license_info["status"],
        "subcontractor_has_insurance_on_file": has_insurance,
        "subcontractor_insurance_status": insurance_info["status"],
        "compliance_status": compliance_status,
        "warning_level": warning_level,
        "warning_message": warning_message,
        "available_actions": available_actions,
        "source_metadata": {
            "source_type": getattr(requirement, "source_type", "unknown") if requirement else "unknown",
            "requirement_id": getattr(requirement, "id", None),
            "agreement_id": getattr(agreement, "id", None),
            "milestone_id": getattr(milestone, "id", None),
            "contractor_id": getattr(contractor, "id", None),
            "subcontractor_contractor_id": getattr(subcontractor, "id", None),
        },
    }


def apply_assignment_compliance_decision(
    *,
    milestone: Milestone,
    evaluation: dict[str, Any],
    action: str,
    acting_user,
    override_reason: str = "",
) -> None:
    normalized_action = str(action or "").strip().lower() or "assign_anyway"
    milestone.subcontractor_license_required = bool(evaluation.get("license_required"))
    milestone.subcontractor_insurance_required = bool(evaluation.get("insurance_required"))
    milestone.subcontractor_required_trade_key = str(evaluation.get("trade_key") or "")
    milestone.subcontractor_required_state_code = str(evaluation.get("state_code") or "")
    milestone.subcontractor_compliance_warning_snapshot = {
        "warning_level": evaluation.get("warning_level"),
        "warning_message": evaluation.get("warning_message"),
        "issuing_authority_name": evaluation.get("issuing_authority_name"),
        "official_lookup_url": evaluation.get("official_lookup_url"),
        "trade_key": evaluation.get("trade_key"),
        "state_code": evaluation.get("state_code"),
        "available_actions": evaluation.get("available_actions") or [],
        "source_metadata": evaluation.get("source_metadata") or {},
        "subcontractor_license_status": evaluation.get("subcontractor_license_status"),
        "subcontractor_insurance_status": evaluation.get("subcontractor_insurance_status"),
    }
    milestone.subcontractor_compliance_override = False
    milestone.subcontractor_compliance_override_reason = ""
    milestone.subcontractor_license_requested_at = None
    milestone.subcontractor_license_requested_by = None

    status_value = str(evaluation.get("compliance_status") or SubcontractorComplianceStatus.UNKNOWN)
    if normalized_action == "request_license":
        status_value = SubcontractorComplianceStatus.PENDING_LICENSE
        milestone.subcontractor_license_requested_at = timezone.now()
        milestone.subcontractor_license_requested_by = acting_user
    elif normalized_action == "assign_anyway" and status_value in {
        SubcontractorComplianceStatus.MISSING_LICENSE,
        SubcontractorComplianceStatus.MISSING_INSURANCE,
        SubcontractorComplianceStatus.PENDING_LICENSE,
        SubcontractorComplianceStatus.UNKNOWN,
    }:
        status_value = SubcontractorComplianceStatus.OVERRIDDEN
        milestone.subcontractor_compliance_override = True
        milestone.subcontractor_compliance_override_reason = (
            override_reason.strip()
            or "Assigned anyway without all expected compliance documents on file."
        )

    milestone.subcontractor_compliance_status = status_value
    if normalized_action == "request_license":
        create_activity_event(
            contractor=getattr(getattr(milestone, "agreement", None), "contractor", None),
            actor_user=acting_user,
            agreement=getattr(milestone, "agreement", None),
            milestone=milestone,
            event_type="subcontractor_license_requested",
            title="Subcontractor license requested",
            summary=evaluation.get("warning_message") or "Compliance documents were requested before assignment acceptance.",
            severity="warning",
            related_label=getattr(milestone, "title", "") or "Milestone",
            icon_hint="compliance",
            navigation_target=f"/app/agreements/{milestone.agreement_id}",
            metadata={
                "milestone_id": milestone.id,
                "agreement_id": milestone.agreement_id,
                "trade_key": evaluation.get("trade_key"),
                "state_code": evaluation.get("state_code"),
            },
            dedupe_key=f"subcontractor_license_requested:{milestone.id}:{milestone.subcontractor_license_requested_at.isoformat() if milestone.subcontractor_license_requested_at else milestone.id}",
        )
    elif milestone.subcontractor_compliance_override:
        create_activity_event(
            contractor=getattr(getattr(milestone, "agreement", None), "contractor", None),
            actor_user=acting_user,
            agreement=getattr(milestone, "agreement", None),
            milestone=milestone,
            event_type="subcontractor_assignment_overridden",
            title="Subcontractor assignment overridden",
            summary=evaluation.get("warning_message") or "The assignment was allowed to proceed without full compliance documents on file.",
            severity="warning",
            related_label=getattr(milestone, "title", "") or "Milestone",
            icon_hint="warning",
            navigation_target=f"/app/agreements/{milestone.agreement_id}",
            metadata={
                "milestone_id": milestone.id,
                "agreement_id": milestone.agreement_id,
                "trade_key": evaluation.get("trade_key"),
                "state_code": evaluation.get("state_code"),
            },
            dedupe_key=f"subcontractor_assignment_overridden:{milestone.id}:{timezone.now().isoformat()}",
        )


def clear_assignment_compliance(milestone: Milestone) -> None:
    milestone.subcontractor_compliance_status = SubcontractorComplianceStatus.UNKNOWN
    milestone.subcontractor_license_required = False
    milestone.subcontractor_insurance_required = False
    milestone.subcontractor_compliance_override = False
    milestone.subcontractor_compliance_override_reason = ""
    milestone.subcontractor_license_requested_at = None
    milestone.subcontractor_license_requested_by = None
    milestone.subcontractor_compliance_warning_snapshot = {}
    milestone.subcontractor_required_trade_key = ""
    milestone.subcontractor_required_state_code = ""


def send_subcontractor_license_request_email(
    *,
    request,
    invitation: SubcontractorInvitation,
    evaluation: dict[str, Any],
    milestones: list[Milestone],
) -> dict[str, Any]:
    if invitation is None or not invitation.invite_email:
        return {"attempted": False, "ok": False, "message": "Missing subcontractor email."}

    trade_label = evaluation.get("trade_label") or "This trade"
    state_code = evaluation.get("state_code") or "this state"
    authority = evaluation.get("issuing_authority_name") or "the issuing authority"
    milestone_titles = ", ".join(m.title for m in milestones[:3])
    if len(milestones) > 3:
        milestone_titles += ", and more"
    subject = f"MyHomeBro compliance request for {trade_label} work"
    message = (
        f"A contractor requested compliance documents before proceeding with your assignment in MyHomeBro.\n\n"
        f"Trade: {trade_label}\n"
        f"State: {state_code}\n"
        f"Authority: {authority}\n"
        f"Milestones: {milestone_titles or 'Assigned work'}\n\n"
        "Please upload your license or compliance document in your contractor profile before continuing."
    )
    if evaluation.get("official_lookup_url"):
        message += f"\n\nOfficial source:\n{evaluation['official_lookup_url']}"

    from_email = (
        getattr(settings, "DEFAULT_FROM_EMAIL", "")
        or getattr(settings, "POSTMARK_FROM_EMAIL", "")
        or None
    )
    try:
        send_mail(
            subject=subject,
            message=message,
            from_email=from_email,
            recipient_list=[invitation.invite_email],
            fail_silently=False,
        )
        return {"attempted": True, "ok": True, "message": "Compliance request email sent."}
    except Exception as exc:
        return {"attempted": True, "ok": False, "message": str(exc)}
