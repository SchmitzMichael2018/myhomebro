from __future__ import annotations

from django.db import models

from projects.models import (
    AgreementAssignment,
    Capture,
    CaptureArtifact,
    ContractorSubAccount,
    MilestoneAssignment,
)
from projects.utils.accounts import get_contractor_for_user, get_subaccount_for_user


def _active_subaccount(user):
    subaccount = get_subaccount_for_user(user)
    return subaccount if subaccount and subaccount.is_active else None


def _is_owner(user) -> bool:
    return bool(get_contractor_for_user(user) and _active_subaccount(user) is None)


def _is_supervisor(user) -> bool:
    subaccount = _active_subaccount(user)
    return bool(subaccount and subaccount.role == ContractorSubAccount.ROLE_EMPLOYEE_SUPERVISOR)


def _same_contractor(user, capture: Capture) -> bool:
    contractor = get_contractor_for_user(user)
    return bool(contractor and contractor.pk == capture.contractor_id)


def can_create_capture(user) -> bool:
    if not user or not user.is_authenticated:
        return False
    return bool(get_contractor_for_user(user) and (_is_owner(user) or _active_subaccount(user)))


def can_view_company_capture(user, capture: Capture) -> bool:
    if not _same_contractor(user, capture):
        return False
    return _is_owner(user) or _is_supervisor(user) or capture.captured_by_id == user.id


def can_review_capture(user, capture: Capture) -> bool:
    return _same_contractor(user, capture) and (
        _is_owner(user) or _is_supervisor(user) or capture.captured_by_id == user.id
    )


def can_apply_capture(user, capture: Capture) -> bool:
    return _same_contractor(user, capture) and (_is_owner(user) or _is_supervisor(user))


def can_archive_capture(user, capture: Capture) -> bool:
    if not _same_contractor(user, capture):
        return False
    if _is_owner(user) or _is_supervisor(user):
        return True
    return capture.captured_by_id == user.id and capture.status in {
        Capture.STATUS_DRAFT,
        Capture.STATUS_SAVED,
        Capture.STATUS_NEEDS_INFORMATION,
        Capture.STATUS_FAILED,
    }


def can_delete_capture_artifact(user, artifact: CaptureArtifact) -> bool:
    capture = artifact.capture
    if not _same_contractor(user, capture) or capture.status in {
        Capture.STATUS_APPLIED,
        Capture.STATUS_ARCHIVED,
    }:
        return False
    return _is_owner(user) or _is_supervisor(user) or artifact.uploaded_by_id == user.id


def can_manage_qr_assets(user) -> bool:
    return bool(user and user.is_authenticated and _is_owner(user))


def can_view_qr_analytics(user) -> bool:
    return can_manage_qr_assets(user)


def can_create_project_capture(user, project, milestone=None) -> bool:
    contractor = get_contractor_for_user(user)
    if not contractor or contractor.pk != project.contractor_id:
        return False
    if _is_owner(user) or _is_supervisor(user):
        return True
    subaccount = _active_subaccount(user)
    if not subaccount or subaccount.role != ContractorSubAccount.ROLE_EMPLOYEE_MILESTONES:
        return False
    agreement = getattr(project, "agreement", None)
    if agreement and AgreementAssignment.objects.filter(
        agreement=agreement, subaccount=subaccount
    ).exists():
        return True
    if milestone and MilestoneAssignment.objects.filter(
        milestone=milestone, subaccount=subaccount
    ).exists():
        return True
    return False


def visible_project_capture_projects(user):
    contractor = get_contractor_for_user(user)
    if not contractor:
        return None
    queryset = contractor.projects.select_related("homeowner").all()
    if _is_owner(user) or _is_supervisor(user):
        return queryset
    subaccount = _active_subaccount(user)
    if not subaccount or subaccount.role != ContractorSubAccount.ROLE_EMPLOYEE_MILESTONES:
        return queryset.none()
    return queryset.filter(
        models.Q(agreement__subaccount_assignments__subaccount=subaccount)
        | models.Q(agreement__milestones__subaccount_assignment__subaccount=subaccount)
    ).distinct()
