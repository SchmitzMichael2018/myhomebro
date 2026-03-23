from __future__ import annotations

from dataclasses import dataclass
from typing import Optional

from projects.models import ContractorSubAccount, Milestone


ROLE_INTERNAL_TEAM_MEMBER = "internal_team_member"
ROLE_SUBCONTRACTOR = "subcontractor"
ROLE_CONTRACTOR_OWNER = "contractor_owner"
ROLE_HOMEOWNER = "homeowner"


@dataclass
class WorkerAssignment:
    kind: str
    user: object | None
    display_name: str
    email: str
    subaccount: ContractorSubAccount | None = None
    invitation: object | None = None


def canonical_identity_type(user) -> str:
    if user is None:
        return "unknown"
    if getattr(user, "is_staff", False) or getattr(user, "is_superuser", False):
        return "admin"
    if hasattr(user, "contractor_subaccount"):
        return ROLE_INTERNAL_TEAM_MEMBER
    if hasattr(user, "contractor_profile"):
        return ROLE_CONTRACTOR_OWNER
    return ROLE_SUBCONTRACTOR


def get_owner_contractor(milestone: Milestone):
    agreement = getattr(milestone, "agreement", None)
    project = getattr(agreement, "project", None) if agreement is not None else None
    contractor = getattr(project, "contractor", None) if project is not None else None
    if contractor is not None:
        return contractor
    return getattr(agreement, "contractor", None)


def get_owner_user(milestone: Milestone):
    contractor = get_owner_contractor(milestone)
    return getattr(contractor, "user", None)


def get_assigned_worker(milestone: Milestone) -> Optional[WorkerAssignment]:
    invitation = getattr(milestone, "assigned_subcontractor_invitation", None)
    if invitation is not None:
        user = getattr(invitation, "accepted_by_user", None)
        display_name = ""
        if user is not None:
            display_name = getattr(user, "get_full_name", lambda: "")() or ""
        email = (getattr(invitation, "invite_email", "") or "").strip()
        display_name = display_name or getattr(invitation, "invite_name", "") or email or "Subcontractor"
        return WorkerAssignment(
            kind=ROLE_SUBCONTRACTOR,
            user=user,
            display_name=display_name,
            email=email,
            invitation=invitation,
        )

    assignment = getattr(milestone, "subaccount_assignment", None)
    subaccount = getattr(assignment, "subaccount", None) if assignment is not None else None
    if subaccount is not None:
        user = getattr(subaccount, "user", None)
        email = (getattr(user, "email", "") or "").strip()
        display_name = (
            getattr(subaccount, "display_name", "") or getattr(user, "get_full_name", lambda: "")() or email or "Team Member"
        )
        return WorkerAssignment(
            kind=ROLE_INTERNAL_TEAM_MEMBER,
            user=user,
            display_name=display_name,
            email=email,
            subaccount=subaccount,
        )

    return None


def subaccount_can_review_work(subaccount: ContractorSubAccount | None) -> bool:
    if subaccount is None or not getattr(subaccount, "is_active", False):
        return False
    role = str(getattr(subaccount, "role", "") or "").strip().lower()
    return role in {
        ContractorSubAccount.ROLE_EMPLOYEE_MILESTONES,
        ContractorSubAccount.ROLE_EMPLOYEE_SUPERVISOR,
    }


def is_valid_delegated_reviewer_subaccount(milestone: Milestone, subaccount: ContractorSubAccount | None) -> bool:
    if subaccount is None:
        return True

    owner = get_owner_contractor(milestone)
    if owner is None or getattr(subaccount, "parent_contractor_id", None) != getattr(owner, "id", None):
        return False

    if not subaccount_can_review_work(subaccount):
        return False

    assigned_worker = get_assigned_worker(milestone)
    if assigned_worker is not None and assigned_worker.kind == ROLE_INTERNAL_TEAM_MEMBER:
        if getattr(assigned_worker.subaccount, "id", None) == subaccount.id:
            return False

    return True


def get_delegated_reviewer_subaccount(milestone: Milestone) -> ContractorSubAccount | None:
    return getattr(milestone, "delegated_reviewer_subaccount", None)


def get_effective_reviewer(milestone: Milestone) -> WorkerAssignment:
    delegated = get_delegated_reviewer_subaccount(milestone)
    if delegated is not None and is_valid_delegated_reviewer_subaccount(milestone, delegated):
        user = getattr(delegated, "user", None)
        email = (getattr(user, "email", "") or "").strip()
        display_name = getattr(delegated, "display_name", "") or getattr(user, "get_full_name", lambda: "")() or email or "Reviewer"
        return WorkerAssignment(
            kind=ROLE_INTERNAL_TEAM_MEMBER,
            user=user,
            display_name=display_name,
            email=email,
            subaccount=delegated,
        )

    owner_user = get_owner_user(milestone)
    owner = get_owner_contractor(milestone)
    email = (getattr(owner_user, "email", "") or "").strip()
    display_name = ""
    if owner_user is not None:
        display_name = getattr(owner_user, "get_full_name", lambda: "")() or ""
    display_name = display_name or getattr(owner, "business_name", "") or email or "Contractor Owner"
    return WorkerAssignment(
        kind=ROLE_CONTRACTOR_OWNER,
        user=owner_user,
        display_name=display_name,
        email=email,
    )


def is_effective_reviewer_user(milestone: Milestone, user) -> bool:
    if user is None:
        return False
    reviewer = get_effective_reviewer(milestone)
    if reviewer.user is None:
        return False
    return getattr(reviewer.user, "id", None) == getattr(user, "id", None)


def can_user_submit_work(milestone: Milestone, user) -> bool:
    worker = get_assigned_worker(milestone)
    if worker is None or worker.user is None or user is None:
        return False
    return getattr(worker.user, "id", None) == getattr(user, "id", None)


def can_user_review_submitted_work(milestone: Milestone, user) -> bool:
    if user is None:
        return False

    owner_user = get_owner_user(milestone)
    if owner_user is not None and getattr(owner_user, "id", None) == getattr(user, "id", None):
        return True

    return is_effective_reviewer_user(milestone, user)
