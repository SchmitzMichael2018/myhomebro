# backend/projects/views/subaccounts.py
# v2026-01-11 — add ADMIN detection to WhoAmIView (no behavior regressions)

from __future__ import annotations

from django.contrib.auth import get_user_model
from django.db import transaction
from django.utils.crypto import get_random_string

from rest_framework import status, viewsets
from rest_framework.decorators import action
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView
from rest_framework.exceptions import PermissionDenied, ValidationError

from projects.models import ContractorSubAccount, EmployeeCapability, EmployeeSkillLevel, Milestone, Skill, SubcontractorCompletionStatus
from projects.models_subcontractor import SubcontractorInvitation, SubcontractorInvitationStatus
from projects.serializers.subaccounts import (
    ContractorSubAccountSerializer,
    ContractorSubAccountCreateSerializer,
)
from projects.services.milestone_workflow import is_effective_reviewer_user
from projects.services.team_attention import build_contractor_attention_counts
from projects.utils.accounts import get_contractor_for_user, get_subaccount_for_user
from projects.permissions_subaccounts import IsContractorOrSubAccount

User = get_user_model()


def _normalize_email(value: str | None) -> str:
    return (value or "").strip().lower()


def _review_queue_count_for_user(user) -> int:
    contractor = get_contractor_for_user(user)
    subaccount = get_subaccount_for_user(user)

    rows = Milestone.objects.select_related("agreement", "agreement__project").filter(
        subcontractor_completion_status=SubcontractorCompletionStatus.SUBMITTED_FOR_REVIEW
    )
    if subaccount is not None:
        rows = rows.filter(delegated_reviewer_subaccount__user=user)
    elif contractor is not None:
        rows = rows.filter(agreement__project__contractor=contractor)
    else:
        return 0

    count = 0
    for milestone in rows.order_by("agreement_id", "order", "id"):
        if is_effective_reviewer_user(milestone, user):
            count += 1
    return count


def _empty_attention_counts() -> dict:
    return {
        "awaiting_review_count": 0,
        "submitted_for_review_count": 0,
        "unassigned_assignment_count": 0,
        "assigned_work_count": 0,
        "assigned_action_count": 0,
        "overdue_milestone_count": 0,
        "pending_invites_count": 0,
        "active_subcontractor_count": 0,
        "total_attention_count": 0,
    }


class ContractorSubAccountViewSet(viewsets.ModelViewSet):
    permission_classes = [IsAuthenticated, IsContractorOrSubAccount]
    LABOR_COST_FIELDS = {
        "cost_basis",
        "hourly_cost",
        "annual_salary",
        "standard_hours_per_week",
        "overtime_multiplier",
        "labor_cost_notes",
    }

    def get_queryset(self):
        contractor = get_contractor_for_user(self.request.user)
        if contractor is None:
            return ContractorSubAccount.objects.none()
        return (
            ContractorSubAccount.objects.filter(parent_contractor=contractor)
            .select_related("user", "parent_contractor")
            .prefetch_related("capabilities__skill")
            .order_by("-created_at")
        )

    def get_serializer_class(self):
        if self.action in ("create", "update", "partial_update"):
            return ContractorSubAccountCreateSerializer
        return ContractorSubAccountSerializer

    def get_serializer_context(self):
        context = super().get_serializer_context()
        context["can_view_labor_cost"] = self._can_manage_labor_cost()
        return context

    def _can_manage_labor_cost(self) -> bool:
        return (
            get_contractor_for_user(self.request.user) is not None
            and get_subaccount_for_user(self.request.user) is None
        )

    def _assert_labor_cost_write_allowed(self, request):
        if any(field in request.data for field in self.LABOR_COST_FIELDS) and not self._can_manage_labor_cost():
            raise PermissionDenied("Only contractor owners can manage labor cost assumptions.")

    def _require_contractor_owner(self):
        contractor = get_contractor_for_user(self.request.user)
        if contractor is None:
            raise PermissionDenied("You must be a contractor to manage team members.")
        if get_subaccount_for_user(self.request.user) is not None:
            raise PermissionDenied("Only the contractor owner can manage team members.")
        return contractor

    @transaction.atomic
    def create(self, request, *args, **kwargs):
        contractor = self._require_contractor_owner()

        serializer = self.get_serializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        vd = dict(serializer.validated_data)

        email = _normalize_email(vd.get("email"))
        if not email:
            raise ValidationError({"email": "Email is required."})

        owner_email = _normalize_email(getattr(request.user, "email", None))
        if email == owner_email:
            raise ValidationError(
                {"email": "You cannot use the contractor owner's email as a team member."}
            )

        temp_password = vd.get("password") or vd.get("temporary_password")
        if not temp_password:
            temp_password = get_random_string(16)

        existing_user = User.objects.filter(email__iexact=email).first()
        if existing_user is not None:
            raise ValidationError({"email": "A user with this email already exists."})

        user = User.objects.create_user(email=email, password=temp_password)

        subaccount = serializer.save(parent_contractor=contractor, user=user)

        out = ContractorSubAccountSerializer(subaccount, context=self.get_serializer_context())
        return Response(out.data, status=status.HTTP_201_CREATED)

    @transaction.atomic
    def update(self, request, *args, **kwargs):
        self._assert_labor_cost_write_allowed(request)
        partial = kwargs.pop("partial", False)
        subaccount = self.get_object()
        serializer = self.get_serializer(subaccount, data=request.data, partial=partial)
        serializer.is_valid(raise_exception=True)
        self.perform_update(serializer)
        refreshed = (
            ContractorSubAccount.objects.filter(pk=subaccount.pk)
            .select_related("user", "parent_contractor")
            .prefetch_related("capabilities__skill")
            .get()
        )
        return Response(ContractorSubAccountSerializer(refreshed, context=self.get_serializer_context()).data)

    def partial_update(self, request, *args, **kwargs):
        kwargs["partial"] = True
        return self.update(request, *args, **kwargs)

    def destroy(self, request, *args, **kwargs):
        contractor = self._require_contractor_owner()
        subaccount = self.get_object()

        if subaccount.parent_contractor_id != contractor.id:
            raise PermissionDenied("You do not own this team member.")

        if subaccount.user_id == request.user.id:
            raise ValidationError({"detail": "You cannot delete your own account."})

        if hasattr(subaccount, "assigned_agreements") and subaccount.assigned_agreements.exists():
            raise ValidationError(
                {"detail": "This team member has agreement assignments. Deactivate instead."}
            )
        if hasattr(subaccount, "assigned_milestones") and subaccount.assigned_milestones.exists():
            raise ValidationError(
                {"detail": "This team member has milestone assignments. Deactivate instead."}
            )

        subaccount.delete()
        return Response(status=status.HTTP_204_NO_CONTENT)

    @action(detail=True, methods=["patch"], url_path="capabilities")
    @transaction.atomic
    def capabilities(self, request, *args, **kwargs):
        contractor = self._require_contractor_owner()
        subaccount = self.get_object()
        if subaccount.parent_contractor_id != contractor.id:
            raise PermissionDenied("You do not own this team member.")

        incoming = request.data.get("capabilities", None)
        if incoming is None:
            incoming = []
        if not isinstance(incoming, list):
            raise ValidationError({"capabilities": "Capabilities must be a list."})

        skill_ids = set()
        valid_levels = {value for value, _label in EmployeeSkillLevel.choices}
        normalized = []
        for index, item in enumerate(incoming):
            if not isinstance(item, dict):
                raise ValidationError({"capabilities": f"Capability #{index + 1} must be an object."})
            raw_skill_id = item.get("skill_id") or item.get("skill")
            if not raw_skill_id:
                raise ValidationError({"capabilities": f"Capability #{index + 1} requires skill_id."})
            try:
                skill_id = int(raw_skill_id)
            except (TypeError, ValueError) as exc:
                raise ValidationError({"capabilities": f"Capability #{index + 1} has an invalid skill_id."}) from exc
            if skill_id in skill_ids:
                raise ValidationError({"capabilities": "Duplicate capabilities are not allowed."})
            skill_ids.add(skill_id)
            level = str(item.get("skill_level") or "").strip().lower()
            if level not in valid_levels:
                raise ValidationError({"capabilities": f"Capability #{index + 1} has an invalid skill level."})
            normalized.append({"skill_id": skill_id, "skill_level": level})

        existing_ids = set(Skill.objects.filter(id__in=skill_ids).values_list("id", flat=True))
        missing = sorted(skill_ids - existing_ids)
        if missing:
            raise ValidationError({"capabilities": f"Unknown skill id(s): {', '.join(map(str, missing))}."})

        wanted = {item["skill_id"]: item["skill_level"] for item in normalized}
        EmployeeCapability.objects.filter(subaccount=subaccount).exclude(skill_id__in=wanted.keys()).delete()
        for skill_id, level in wanted.items():
            EmployeeCapability.objects.update_or_create(
                subaccount=subaccount,
                skill_id=skill_id,
                defaults={"skill_level": level},
            )

        refreshed = (
            ContractorSubAccount.objects.filter(pk=subaccount.pk)
            .select_related("user", "parent_contractor")
            .prefetch_related("capabilities__skill")
            .get()
        )
        return Response(ContractorSubAccountSerializer(refreshed, context=self.get_serializer_context()).data)


class WhoAmIView(APIView):
    """
    Canonical identity resolver for frontend routing & permissions.

    Order of precedence:
      1) Admin (staff or superuser)
      2) Contractor owner
      3) Contractor subaccount (employee)
    """

    permission_classes = [IsAuthenticated]

    def get(self, request, *args, **kwargs):
        user = request.user

        # -------------------------------------------------
        # ✅ ADMIN (source of truth)
        # -------------------------------------------------
        if user.is_staff or user.is_superuser:
            return Response(
                {
                    "user_id": user.id,
                    "email": user.email,
                    "type": "admin",
                    "role": "admin",
                    "is_staff": True,
                    "is_superuser": bool(user.is_superuser),
                    "review_queue_count": 0,
                    "attention_counts": _empty_attention_counts(),
                },
                status=status.HTTP_200_OK,
            )

        # -------------------------------------------------
        # Contractor / Subaccount logic (unchanged)
        # -------------------------------------------------
        contractor = get_contractor_for_user(user)
        subaccount = get_subaccount_for_user(user)

        if contractor and not subaccount:
            attention_counts = build_contractor_attention_counts(contractor, user=user)
            return Response(
                {
                    "user_id": user.id,
                    "email": user.email,
                    "type": "contractor",
                    "role": "contractor_owner",
                    "identity_type": "contractor_owner",
                    "review_queue_count": _review_queue_count_for_user(user),
                    "attention_counts": attention_counts,
                },
                status=status.HTTP_200_OK,
            )

        if contractor and subaccount:
            return Response(
                {
                    "user_id": user.id,
                    "email": user.email,
                    "type": "subaccount",
                    "role": subaccount.role,
                    "identity_type": "internal_team_member",
                    "team_role": subaccount.role,
                    "review_queue_count": _review_queue_count_for_user(user),
                    "attention_counts": _empty_attention_counts(),
                },
                status=status.HTTP_200_OK,
            )

        accepted_subcontractor_invite = (
            SubcontractorInvitation.objects.filter(
                accepted_by_user=user,
                status=SubcontractorInvitationStatus.ACCEPTED,
            )
            .only("id")
            .first()
        )
        if accepted_subcontractor_invite is not None:
            return Response(
                {
                    "user_id": user.id,
                    "email": user.email,
                    "type": "subcontractor",
                    "role": "subcontractor",
                    "identity_type": "subcontractor",
                    "review_queue_count": 0,
                    "attention_counts": _empty_attention_counts(),
                },
                status=status.HTTP_200_OK,
            )

        # -------------------------------------------------
        # Fallback (authenticated but not classified)
        # -------------------------------------------------
        return Response(
            {
                "user_id": user.id,
                "email": user.email,
                "type": "unknown",
                "role": None,
                "review_queue_count": 0,
                "attention_counts": _empty_attention_counts(),
            },
            status=status.HTTP_200_OK,
        )
