from __future__ import annotations

from datetime import date, datetime
from decimal import Decimal, InvalidOperation
from typing import Optional, Any, Dict

from django.db.models import Q
from rest_framework import serializers

from projects.models import (
    Milestone,
    Agreement,
    SubcontractorCompletionStatus,
    ContractorSubAccount,
)
from projects.models_subcontractor import (
    SubcontractorInvitation,
    SubcontractorInvitationStatus,
)
from projects.utils.accounts import get_contractor_for_user

# ✅ Centralized agreement locking rules
from projects.services.agreement_locking import (
    is_completed_agreement,
    is_signed_or_locked_agreement,
)
from projects.services.milestone_workflow import (
    can_user_review_submitted_work,
    can_user_submit_work,
    get_assigned_worker,
    get_effective_reviewer,
    is_valid_delegated_reviewer_subaccount,
)
from projects.services.milestone_payouts import payout_amount_cents_for_milestone, serialize_payout_for_milestone


def _normalize_pricing_mode(materials_responsibility) -> str:
    raw = str(materials_responsibility or "").strip().lower()
    if not raw:
        return "full_service"
    if "split" in raw or "hybrid" in raw or "shared" in raw or "depend" in raw:
        return "hybrid"
    if "homeowner" in raw or "customer" in raw or "owner" in raw or "client" in raw:
        return "labor_only"
    return "full_service"


def _today() -> date:
    try:
        from django.utils.timezone import now
        return now().date()
    except Exception:
        return date.today()


def _normalize_money(value):
    """
    Best-effort normalization for incoming amount values.
    Cleans "$1,234.50" -> Decimal("1234.50")
    Returns:
      - Decimal(...) when parseable
      - None when missing/blank/unparseable
    """
    if value is None or value == "":
        return None

    if isinstance(value, Decimal):
        return value

    if isinstance(value, (int, float)):
        try:
            return Decimal(str(value))
        except Exception:
            return None

    if isinstance(value, str):
        s = value.strip().replace(",", "")
        if s.startswith("$"):
            s = s[1:].strip()
        if s == "":
            return None
        try:
            return Decimal(s)
        except (InvalidOperation, ValueError):
            return None

    return None


class MilestoneSerializer(serializers.ModelSerializer):
    """
    Enriched milestone serializer + safe overlap validation.

    Adds (read helpers):
      - agreement_id, project_title
      - homeowner_name, homeowner_email  (legacy; UI may still depend)
      - customer_name, customer_email    (alias)
      - due_date   (read-only convenience, unified fallback)
      - is_overdue (bool)

    Locking helpers:
      - agreement_status (string)
      - agreement_is_locked (bool)
      - agreement_is_completed (bool)

    Completion gating helpers:
      - agreement_payment_mode ("escrow"|"direct")
      - agreement_escrow_funded (bool)
      - agreement_signature_is_satisfied (bool)

    Rework / Dispute UX support:
      - is_rework
      - origin_milestone

    Validates:
      - Blocks date overlaps unless allow_overlap=true.
      - Accepts incoming 'end_date' from clients and maps to 'completion_date'.

    FINANCIAL RULE:
      - Allows $0 milestones.
      - Blocks negative or invalid amounts.
    """

    agreement_id = serializers.SerializerMethodField()
    project_title = serializers.SerializerMethodField()

    homeowner_name = serializers.SerializerMethodField()
    homeowner_email = serializers.SerializerMethodField()

    customer_name = serializers.SerializerMethodField()
    customer_email = serializers.SerializerMethodField()

    due_date = serializers.SerializerMethodField()
    is_overdue = serializers.SerializerMethodField()

    agreement_status = serializers.SerializerMethodField()
    agreement_is_locked = serializers.SerializerMethodField()
    agreement_is_completed = serializers.SerializerMethodField()

    agreement_payment_mode = serializers.SerializerMethodField()
    agreement_escrow_funded = serializers.SerializerMethodField()
    agreement_signature_is_satisfied = serializers.SerializerMethodField()
    pricing_mode = serializers.SerializerMethodField()

    is_rework = serializers.SerializerMethodField()
    origin_milestone = serializers.SerializerMethodField()
    assigned_subcontractor = serializers.SerializerMethodField()
    assigned_subcontractor_display = serializers.SerializerMethodField()
    assigned_worker = serializers.SerializerMethodField()
    assigned_worker_display = serializers.SerializerMethodField()
    reviewer = serializers.SerializerMethodField()
    reviewer_display = serializers.SerializerMethodField()
    subcontractor_review_requested = serializers.SerializerMethodField()
    subcontractor_review_requested_by_display = serializers.SerializerMethodField()
    subcontractor_completion_submitted_by_display = serializers.SerializerMethodField()
    subcontractor_completion_reviewed_by_display = serializers.SerializerMethodField()
    can_current_user_submit_work = serializers.SerializerMethodField()
    can_current_user_review_work = serializers.SerializerMethodField()
    work_submission_status = serializers.SerializerMethodField()
    work_submitted_at = serializers.SerializerMethodField()
    work_submitted_by_display = serializers.SerializerMethodField()
    work_submission_note = serializers.SerializerMethodField()
    work_reviewed_at = serializers.SerializerMethodField()
    work_reviewed_by_display = serializers.SerializerMethodField()
    work_review_response_note = serializers.SerializerMethodField()
    payout_amount = serializers.SerializerMethodField()
    payout_status = serializers.SerializerMethodField()
    payout_eligible = serializers.SerializerMethodField()
    payout_ready = serializers.SerializerMethodField()
    payout_eligible_at = serializers.SerializerMethodField()
    payout_ready_for_payout_at = serializers.SerializerMethodField()
    payout_paid_at = serializers.SerializerMethodField()
    payout_failed_at = serializers.SerializerMethodField()
    payout_stripe_transfer_id = serializers.SerializerMethodField()
    payout_failure_reason = serializers.SerializerMethodField()

    allow_overlap = serializers.BooleanField(write_only=True, required=False, default=False)
    assigned_subcontractor_invitation = serializers.PrimaryKeyRelatedField(
        queryset=SubcontractorInvitation.objects.select_related("accepted_by_user"),
        required=False,
        allow_null=True,
    )
    delegated_reviewer_subaccount = serializers.PrimaryKeyRelatedField(
        queryset=ContractorSubAccount.objects.select_related("user", "parent_contractor"),
        required=False,
        allow_null=True,
    )

    class Meta:
        model = Milestone
        fields = "__all__"
        read_only_fields = (
            "agreement_id",
            "project_title",
            "homeowner_name",
            "homeowner_email",
            "customer_name",
            "customer_email",
            "is_overdue",
            "is_rework",
            "origin_milestone",
            "agreement_status",
            "agreement_is_locked",
            "agreement_is_completed",
            "agreement_payment_mode",
            "agreement_escrow_funded",
            "agreement_signature_is_satisfied",
            "pricing_mode",
            "assigned_subcontractor",
            "assigned_subcontractor_display",
            "assigned_worker",
            "assigned_worker_display",
            "reviewer",
            "reviewer_display",
            "subcontractor_review_requested",
            "subcontractor_review_requested_by_display",
            "subcontractor_review_requested_at",
            "subcontractor_review_requested_by",
            "subcontractor_review_note",
            "subcontractor_completion_submitted_by_display",
            "subcontractor_completion_reviewed_by_display",
            "subcontractor_completion_status",
            "subcontractor_marked_complete_at",
            "subcontractor_marked_complete_by",
            "subcontractor_completion_note",
            "subcontractor_reviewed_at",
            "subcontractor_reviewed_by",
            "subcontractor_review_response_note",
            "can_current_user_submit_work",
            "can_current_user_review_work",
            "work_submission_status",
            "work_submitted_at",
            "work_submitted_by_display",
            "work_submission_note",
            "work_reviewed_at",
            "work_reviewed_by_display",
            "work_review_response_note",
            "subcontractor_payout_amount_cents",
            "payout_amount",
            "payout_status",
            "payout_eligible",
            "payout_ready",
            "payout_eligible_at",
            "payout_ready_for_payout_at",
            "payout_paid_at",
            "payout_failed_at",
            "payout_stripe_transfer_id",
            "payout_failure_reason",
        )

    # ------------------------ helpers (read) ------------------------ #
    def _get_agreement(self, obj: Milestone) -> Agreement | None:
        try:
            return getattr(obj, "agreement", None)
        except Exception:
            return None

    def _get_project(self, obj: Milestone):
        ag = self._get_agreement(obj)
        try:
            return getattr(ag, "project", None)
        except Exception:
            return None

    def get_agreement_id(self, obj: Milestone):
        ag = self._get_agreement(obj)
        return getattr(ag, "id", None)

    def get_project_title(self, obj: Milestone) -> str:
        p = self._get_project(obj)
        if p:
            for attr in ("title", "name"):
                val = (getattr(p, attr, "") or "").strip()
                if val:
                    return val
            pid = getattr(p, "id", None)
            if pid:
                return f"Project #{pid}"
        ag = self._get_agreement(obj)
        snap = (getattr(ag, "project_title_snapshot", "") or "").strip() if ag else ""
        if snap:
            return snap
        return ""

    def _resolve_homeowner(self, obj: Milestone):
        ag = self._get_agreement(obj)
        h = getattr(ag, "homeowner", None) if ag else None
        if h:
            return h
        p = self._get_project(obj)
        if p:
            return getattr(p, "homeowner", None)
        return None

    def get_homeowner_name(self, obj: Milestone) -> str:
        h = self._resolve_homeowner(obj)
        if h:
            for attr in ("full_name", "name"):
                v = (getattr(h, attr, "") or "").strip()
                if v:
                    return v
        ag = self._get_agreement(obj)
        for attr in ("homeowner_name_snapshot", "homeowner_full_name", "homeowner_name"):
            v = (getattr(ag, attr, "") or "").strip() if ag else ""
            if v:
                return v
        return ""

    def get_homeowner_email(self, obj: Milestone) -> str:
        h = self._resolve_homeowner(obj)
        if h:
            v = (getattr(h, "email", "") or "").strip()
            if v:
                return v
        ag = self._get_agreement(obj)
        v = (getattr(ag, "homeowner_email_snapshot", "") or "").strip() if ag else ""
        if v:
            return v
        return ""

    def get_customer_name(self, obj: Milestone) -> str:
        return self.get_homeowner_name(obj)

    def get_customer_email(self, obj: Milestone) -> str:
        return self.get_homeowner_email(obj)

    def get_due_date(self, obj: Milestone):
        for attr in (
            "completion_date",
            "due_date",
            "end_date",
            "end",
            "target_date",
            "finish_date",
            "scheduled_date",
            "start_date",
        ):
            val = getattr(obj, attr, None)
            if val:
                return val
        return None

    def get_is_overdue(self, obj: Milestone) -> bool:
        try:
            due = self.get_due_date(obj)
            if not due:
                return False

            from django.utils.timezone import now
            today = now().date()
            completed = bool(getattr(obj, "completed", False))

            if isinstance(due, datetime):
                due_date = due.date()
            elif isinstance(due, date):
                due_date = due
            else:
                return False

            return (not completed) and (due_date < today)
        except Exception:
            return False

    def get_agreement_status(self, obj: Milestone) -> str:
        ag = self._get_agreement(obj)
        return (getattr(ag, "status", "") or "").strip() if ag else ""

    def get_agreement_is_completed(self, obj: Milestone) -> bool:
        ag = self._get_agreement(obj)
        if not ag:
            return False
        try:
            return bool(is_completed_agreement(ag))
        except Exception:
            return False

    def get_agreement_is_locked(self, obj: Milestone) -> bool:
        ag = self._get_agreement(obj)
        if not ag:
            return False
        try:
            return bool(is_signed_or_locked_agreement(ag))
        except Exception:
            return False

    def get_agreement_payment_mode(self, obj: Milestone) -> str:
        ag = self._get_agreement(obj)
        mode = (getattr(ag, "payment_mode", "") or "escrow").strip().lower() if ag else "escrow"
        return "direct" if mode == "direct" else "escrow"

    def get_agreement_escrow_funded(self, obj: Milestone) -> bool:
        ag = self._get_agreement(obj)
        if not ag:
            return False
        mode = (getattr(ag, "payment_mode", "") or "escrow").strip().lower()
        if mode == "direct":
            return False
        return bool(getattr(ag, "escrow_funded", False))

    def get_agreement_signature_is_satisfied(self, obj: Milestone) -> bool:
        ag = self._get_agreement(obj)
        if not ag:
            return False
        try:
            return bool(getattr(ag, "signature_is_satisfied"))
        except Exception:
            return bool(getattr(ag, "signed_by_contractor", False) and getattr(ag, "signed_by_homeowner", False))

    def get_pricing_mode(self, obj: Milestone) -> str:
        ag = self._get_agreement(obj)
        scope = getattr(ag, "ai_scope", None) if ag else None
        answers = getattr(scope, "answers", None) if scope else None
        if isinstance(answers, dict):
            return _normalize_pricing_mode(answers.get("materials_responsibility"))
        return "full_service"

    # ------------------------ rework/origin helpers (read) ------------------------ #
    def get_is_rework(self, obj: Milestone) -> bool:
        try:
            return bool(getattr(obj, "rework_origin_milestone_id", None))
        except Exception:
            return False

    def _origin_queryset(self):
        return Milestone.objects.all().only(
            "id",
            "order",
            "title",
            "completed",
            "is_invoiced",
            "start_date",
            "completion_date",
            "amount",
            "invoice_id",
        )

    def get_origin_milestone(self, obj: Milestone) -> Optional[Dict[str, Any]]:
        try:
            origin_id = getattr(obj, "rework_origin_milestone_id", None)
            if not origin_id:
                return None

            origin = self._origin_queryset().filter(id=origin_id).first()
            if not origin:
                return None

            return {
                "id": origin.id,
                "order": getattr(origin, "order", None),
                "title": (getattr(origin, "title", "") or "").strip(),
                "completed": bool(getattr(origin, "completed", False)),
                "is_invoiced": bool(getattr(origin, "is_invoiced", False)),
                "invoice_id": getattr(origin, "invoice_id", None),
                "start_date": getattr(origin, "start_date", None),
                "completion_date": getattr(origin, "completion_date", None),
                "amount": getattr(origin, "amount", None),
                "due_date": self.get_due_date(origin),
                "is_overdue": self.get_is_overdue(origin),
            }
        except Exception:
            return None

    def _get_assigned_subcontractor_invitation(self, obj: Milestone):
        try:
            invitation = getattr(obj, "assigned_subcontractor_invitation", None)
            if invitation is not None:
                invitation.refresh_expired_status(save=False)
            return invitation
        except Exception:
            return None

    def get_assigned_subcontractor(self, obj: Milestone) -> Optional[Dict[str, Any]]:
        invitation = self._get_assigned_subcontractor_invitation(obj)
        if invitation is None:
            return None

        user = getattr(invitation, "accepted_by_user", None)
        display_name = ""
        if user is not None:
            display_name = getattr(user, "get_full_name", lambda: "")() or ""

        return {
            "invitation_id": invitation.id,
            "user_id": getattr(user, "id", None),
            "display_name": display_name or invitation.invite_name or invitation.invite_email,
            "email": invitation.invite_email,
            "accepted_at": invitation.accepted_at,
        }

    def get_assigned_subcontractor_display(self, obj: Milestone) -> str:
        assigned = self.get_assigned_subcontractor(obj)
        if not assigned:
            return ""
        return assigned.get("display_name") or assigned.get("email") or ""

    def get_assigned_worker(self, obj: Milestone) -> Optional[Dict[str, Any]]:
        worker = get_assigned_worker(obj)
        if worker is None:
            return None
        return {
            "kind": worker.kind,
            "user_id": getattr(worker.user, "id", None),
            "display_name": worker.display_name,
            "email": worker.email,
            "subaccount_id": getattr(worker.subaccount, "id", None),
            "invitation_id": getattr(worker.invitation, "id", None),
        }

    def get_assigned_worker_display(self, obj: Milestone) -> str:
        worker = self.get_assigned_worker(obj)
        if not worker:
            return ""
        return worker.get("display_name") or worker.get("email") or ""

    def get_reviewer(self, obj: Milestone) -> Optional[Dict[str, Any]]:
        reviewer = get_effective_reviewer(obj)
        if reviewer is None:
            return None
        return {
            "kind": reviewer.kind,
            "user_id": getattr(reviewer.user, "id", None),
            "display_name": reviewer.display_name,
            "email": reviewer.email,
            "subaccount_id": getattr(reviewer.subaccount, "id", None),
            "is_delegated": reviewer.kind == "internal_team_member",
        }

    def get_reviewer_display(self, obj: Milestone) -> str:
        reviewer = self.get_reviewer(obj)
        if not reviewer:
            return ""
        return reviewer.get("display_name") or reviewer.get("email") or ""

    def get_subcontractor_review_requested(self, obj: Milestone) -> bool:
        return bool(getattr(obj, "subcontractor_review_requested_at", None))

    def get_subcontractor_review_requested_by_display(self, obj: Milestone) -> str:
        user = getattr(obj, "subcontractor_review_requested_by", None)
        if user is not None:
            display = getattr(user, "get_full_name", lambda: "")() or ""
            if display:
                return display
            email = (getattr(user, "email", "") or "").strip()
            if email:
                return email

        assigned = self.get_assigned_subcontractor(obj)
        if assigned:
            return assigned.get("display_name") or assigned.get("email") or ""
        return ""

    def get_subcontractor_completion_submitted_by_display(self, obj: Milestone) -> str:
        user = getattr(obj, "subcontractor_marked_complete_by", None)
        if user is not None:
            display = getattr(user, "get_full_name", lambda: "")() or ""
            if display:
                return display
            email = (getattr(user, "email", "") or "").strip()
            if email:
                return email
        return self.get_assigned_subcontractor_display(obj)

    def get_subcontractor_completion_reviewed_by_display(self, obj: Milestone) -> str:
        user = getattr(obj, "subcontractor_reviewed_by", None)
        if user is not None:
            display = getattr(user, "get_full_name", lambda: "")() or ""
            if display:
                return display
            email = (getattr(user, "email", "") or "").strip()
            if email:
                return email
        return ""

    def get_can_current_user_submit_work(self, obj: Milestone) -> bool:
        request = self.context.get("request")
        user = getattr(request, "user", None) if request is not None else None
        return can_user_submit_work(obj, user)

    def get_can_current_user_review_work(self, obj: Milestone) -> bool:
        request = self.context.get("request")
        user = getattr(request, "user", None) if request is not None else None
        return can_user_review_submitted_work(obj, user)

    def get_work_submission_status(self, obj: Milestone) -> str:
        return getattr(obj, "subcontractor_completion_status", SubcontractorCompletionStatus.NOT_SUBMITTED)

    def get_work_submitted_at(self, obj: Milestone):
        return getattr(obj, "subcontractor_marked_complete_at", None)

    def get_work_submitted_by_display(self, obj: Milestone) -> str:
        return self.get_subcontractor_completion_submitted_by_display(obj)

    def get_work_submission_note(self, obj: Milestone) -> str:
        return getattr(obj, "subcontractor_completion_note", "") or ""

    def get_work_reviewed_at(self, obj: Milestone):
        return getattr(obj, "subcontractor_reviewed_at", None)

    def get_work_reviewed_by_display(self, obj: Milestone) -> str:
        return self.get_subcontractor_completion_reviewed_by_display(obj)

    def get_work_review_response_note(self, obj: Milestone) -> str:
        return getattr(obj, "subcontractor_review_response_note", "") or ""

    def _can_view_payout(self, obj: Milestone) -> bool:
        request = self.context.get("request")
        user = getattr(request, "user", None) if request is not None else None
        contractor = get_contractor_for_user(user) if user is not None else None
        owner = getattr(getattr(getattr(obj, "agreement", None), "project", None), "contractor", None)
        return contractor is not None and owner is not None and contractor.id == owner.id

    def _get_payout_payload(self, obj: Milestone) -> dict | None:
        if not self._can_view_payout(obj):
            return None
        payload = serialize_payout_for_milestone(obj)
        if payload is not None:
            return payload
        assigned_worker = self.get_assigned_worker(obj)
        if not assigned_worker or assigned_worker.get("kind") != "subcontractor":
            return None
        cents = payout_amount_cents_for_milestone(obj)
        return {
            "payout_amount_cents": cents,
            "payout_amount": f"{Decimal(cents) / Decimal('100'):.2f}",
            "payout_status": "not_eligible",
            "payout_eligible": False,
            "payout_ready": False,
            "payout_eligible_at": None,
            "payout_ready_for_payout_at": None,
            "payout_paid_at": None,
            "payout_failed_at": None,
            "payout_stripe_transfer_id": "",
            "payout_failure_reason": "",
        }

    def get_payout_amount(self, obj: Milestone):
        payload = self._get_payout_payload(obj)
        return None if payload is None else payload.get("payout_amount")

    def get_payout_status(self, obj: Milestone):
        payload = self._get_payout_payload(obj)
        return None if payload is None else payload.get("payout_status")

    def get_payout_eligible(self, obj: Milestone) -> bool:
        payload = self._get_payout_payload(obj)
        return bool(payload and payload.get("payout_eligible"))

    def get_payout_ready(self, obj: Milestone) -> bool:
        payload = self._get_payout_payload(obj)
        return bool(payload and payload.get("payout_ready"))

    def get_payout_paid_at(self, obj: Milestone):
        payload = self._get_payout_payload(obj)
        return None if payload is None else payload.get("payout_paid_at")

    def get_payout_eligible_at(self, obj: Milestone):
        payload = self._get_payout_payload(obj)
        return None if payload is None else payload.get("payout_eligible_at")

    def get_payout_ready_for_payout_at(self, obj: Milestone):
        payload = self._get_payout_payload(obj)
        return None if payload is None else payload.get("payout_ready_for_payout_at")

    def get_payout_failed_at(self, obj: Milestone):
        payload = self._get_payout_payload(obj)
        return None if payload is None else payload.get("payout_failed_at")

    def get_payout_stripe_transfer_id(self, obj: Milestone) -> str:
        payload = self._get_payout_payload(obj)
        return "" if payload is None else payload.get("payout_stripe_transfer_id") or ""

    def get_payout_failure_reason(self, obj: Milestone) -> str:
        payload = self._get_payout_payload(obj)
        return "" if payload is None else payload.get("payout_failure_reason") or ""

    # ------------------------ validation ------------------------ #
    @staticmethod
    def _as_date(value) -> Optional[date]:
        if value is None or value == "":
            return None
        if isinstance(value, date) and not isinstance(value, datetime):
            return value
        if isinstance(value, datetime):
            return value.date()
        try:
            return datetime.fromisoformat(str(value)).date()
        except Exception:
            return None

    def validate(self, attrs):
        request = self.context.get("request")
        allow_overlap = attrs.get("allow_overlap", False)

        if "end_date" in getattr(self, "initial_data", {}):
            incoming_end = self.initial_data.get("end_date") or None
            if "completion_date" not in attrs:
                attrs["completion_date"] = incoming_end

        if "amount" in getattr(self, "initial_data", {}):
            raw_amt = self.initial_data.get("amount")
            incoming_amount = _normalize_money(raw_amt)

            if raw_amt not in (None, "") and incoming_amount is None:
                raise serializers.ValidationError(
                    {"amount": "Amount must be a valid number (e.g., 0, 25, 1250.00)."}
                )

            if incoming_amount is not None:
                if incoming_amount < Decimal("0"):
                    raise serializers.ValidationError({"amount": "Amount cannot be negative."})
                attrs["amount"] = incoming_amount

        if "amount" in attrs:
            amt = attrs.get("amount")
            if amt is None or amt == "":
                pass
            else:
                try:
                    amt_dec = amt if isinstance(amt, Decimal) else Decimal(str(amt))
                except Exception:
                    raise serializers.ValidationError(
                        {"amount": "Amount must be a valid number (e.g., 0, 25, 1250.00)."}
                    )
                if amt_dec < Decimal("0"):
                    raise serializers.ValidationError({"amount": "Amount cannot be negative."})
                attrs["amount"] = amt_dec

        agreement = attrs.get("agreement") or getattr(self.instance, "agreement", None)
        assigned_subcontractor_invitation = attrs.get(
            "assigned_subcontractor_invitation",
            getattr(self.instance, "assigned_subcontractor_invitation", None),
        )
        delegated_reviewer_subaccount = attrs.get(
            "delegated_reviewer_subaccount",
            getattr(self.instance, "delegated_reviewer_subaccount", None),
        )

        if "assigned_subcontractor_invitation" in attrs:
            contractor = get_contractor_for_user(getattr(request, "user", None)) if request is not None else None
            owner = getattr(getattr(agreement, "project", None), "contractor", None)
            if contractor is None or owner is None or contractor.id != owner.id:
                raise serializers.ValidationError(
                    {"assigned_subcontractor_invitation": "Only the owning contractor can assign subcontractors."}
                )

            if assigned_subcontractor_invitation is not None:
                assigned_subcontractor_invitation.refresh_expired_status()
                if assigned_subcontractor_invitation.agreement_id != getattr(agreement, "id", None):
                    raise serializers.ValidationError(
                        {"assigned_subcontractor_invitation": "Assigned subcontractor must belong to the same agreement."}
                    )
                if assigned_subcontractor_invitation.status != SubcontractorInvitationStatus.ACCEPTED:
                    raise serializers.ValidationError(
                        {"assigned_subcontractor_invitation": "Only accepted subcontractors can be assigned."}
                    )

        if "delegated_reviewer_subaccount" in attrs:
            contractor = get_contractor_for_user(getattr(request, "user", None)) if request is not None else None
            owner = getattr(getattr(agreement, "project", None), "contractor", None)
            if contractor is None or owner is None or contractor.id != owner.id:
                raise serializers.ValidationError(
                    {"delegated_reviewer_subaccount": "Only the owning contractor can assign delegated reviewers."}
                )
            if not is_valid_delegated_reviewer_subaccount(
                self.instance or Milestone(agreement=agreement, assigned_subcontractor_invitation=assigned_subcontractor_invitation),
                delegated_reviewer_subaccount,
            ):
                raise serializers.ValidationError(
                    {"delegated_reviewer_subaccount": "Delegated reviewer must be an eligible internal team member and cannot review their own assigned work."}
                )

        start_raw = attrs.get("start_date", getattr(self.instance, "start_date", None))
        end_raw = attrs.get("completion_date", getattr(self.instance, "completion_date", None))

        start = self._as_date(start_raw)
        end = self._as_date(end_raw)

        if agreement:
            ag_start = self._as_date(getattr(agreement, "start", None))
            ag_end = self._as_date(getattr(agreement, "end", None))
        else:
            ag_start = None
            ag_end = None

        if start is None:
            start = ag_start or _today()
            attrs["start_date"] = start

        if end is None:
            end = ag_end or ag_start or start or _today()
            attrs["completion_date"] = end

        if start and end and start > end:
            raise serializers.ValidationError(
                {"completion_date": "Completion date must be on or after the start date."}
            )

        if not (agreement and start and end) or allow_overlap:
            attrs.pop("allow_overlap", None)
            return attrs

        qs = Milestone.objects.filter(agreement=agreement)
        if self.instance:
            qs = qs.exclude(pk=self.instance.pk)

        conflict = qs.filter(Q(start_date__lte=end) & Q(completion_date__gte=start)).exists()

        if conflict:
            raise serializers.ValidationError(
                {
                    "non_field_errors": (
                        "This milestone overlaps an existing milestone in the same agreement. "
                        "Resubmit with allow_overlap=true to override."
                    )
                }
            )

        attrs.pop("allow_overlap", None)
        return attrs

    def update(self, instance, validated_data):
        if "assigned_subcontractor_invitation" in validated_data:
            new_assignment = validated_data.get("assigned_subcontractor_invitation")
            if getattr(instance, "assigned_subcontractor_invitation_id", None) != getattr(new_assignment, "id", None):
                validated_data["subcontractor_review_requested_at"] = None
                validated_data["subcontractor_review_requested_by"] = None
                validated_data["subcontractor_review_note"] = ""
                validated_data["subcontractor_completion_status"] = SubcontractorCompletionStatus.NOT_SUBMITTED
                validated_data["subcontractor_marked_complete_at"] = None
                validated_data["subcontractor_marked_complete_by"] = None
                validated_data["subcontractor_completion_note"] = ""
                validated_data["subcontractor_reviewed_at"] = None
                validated_data["subcontractor_reviewed_by"] = None
                validated_data["subcontractor_review_response_note"] = ""
        instance = super().update(instance, validated_data)
        try:
            from projects.services.milestone_payouts import sync_milestone_payout

            sync_milestone_payout(instance.id)
        except Exception:
            pass
        return instance

    def to_representation(self, instance):
        data = super().to_representation(instance)

        data["agreement_id"] = self.get_agreement_id(instance)
        data["project_title"] = self.get_project_title(instance)

        data["homeowner_name"] = self.get_homeowner_name(instance)
        data["homeowner_email"] = self.get_homeowner_email(instance)

        data["customer_name"] = self.get_customer_name(instance)
        data["customer_email"] = self.get_customer_email(instance)

        data["due_date"] = self.get_due_date(instance)
        data["is_overdue"] = self.get_is_overdue(instance)

        data["is_rework"] = self.get_is_rework(instance)
        data["origin_milestone"] = self.get_origin_milestone(instance)

        data["end_date"] = data.get("completion_date")

        data["agreement_status"] = self.get_agreement_status(instance)
        data["agreement_is_locked"] = self.get_agreement_is_locked(instance)
        data["agreement_is_completed"] = self.get_agreement_is_completed(instance)

        data["agreement_payment_mode"] = self.get_agreement_payment_mode(instance)
        data["agreement_escrow_funded"] = self.get_agreement_escrow_funded(instance)
        data["agreement_signature_is_satisfied"] = self.get_agreement_signature_is_satisfied(instance)
        data["pricing_mode"] = self.get_pricing_mode(instance)
        data["assigned_subcontractor"] = self.get_assigned_subcontractor(instance)
        data["assigned_subcontractor_display"] = self.get_assigned_subcontractor_display(instance)
        data["assigned_worker"] = self.get_assigned_worker(instance)
        data["assigned_worker_display"] = self.get_assigned_worker_display(instance)
        data["reviewer"] = self.get_reviewer(instance)
        data["reviewer_display"] = self.get_reviewer_display(instance)
        data["subcontractor_review_requested"] = self.get_subcontractor_review_requested(instance)
        data["subcontractor_review_requested_by_display"] = self.get_subcontractor_review_requested_by_display(instance)
        data["subcontractor_completion_submitted_by_display"] = self.get_subcontractor_completion_submitted_by_display(instance)
        data["subcontractor_completion_reviewed_by_display"] = self.get_subcontractor_completion_reviewed_by_display(instance)
        data["can_current_user_submit_work"] = self.get_can_current_user_submit_work(instance)
        data["can_current_user_review_work"] = self.get_can_current_user_review_work(instance)
        data["work_submission_status"] = self.get_work_submission_status(instance)
        data["work_submitted_at"] = self.get_work_submitted_at(instance)
        data["work_submitted_by_display"] = self.get_work_submitted_by_display(instance)
        data["work_submission_note"] = self.get_work_submission_note(instance)
        data["work_reviewed_at"] = self.get_work_reviewed_at(instance)
        data["work_reviewed_by_display"] = self.get_work_reviewed_by_display(instance)
        data["work_review_response_note"] = self.get_work_review_response_note(instance)
        data["payout_amount"] = self.get_payout_amount(instance)
        data["payout_status"] = self.get_payout_status(instance)
        data["payout_eligible"] = self.get_payout_eligible(instance)
        data["payout_ready"] = self.get_payout_ready(instance)
        data["payout_eligible_at"] = self.get_payout_eligible_at(instance)
        data["payout_ready_for_payout_at"] = self.get_payout_ready_for_payout_at(instance)
        data["payout_paid_at"] = self.get_payout_paid_at(instance)
        data["payout_failed_at"] = self.get_payout_failed_at(instance)
        data["payout_stripe_transfer_id"] = self.get_payout_stripe_transfer_id(instance)
        data["payout_failure_reason"] = self.get_payout_failure_reason(instance)

        return data
