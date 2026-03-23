# backend/projects/views/milestone.py
# v2026-02-23 — ✅ Signature-policy aware gating for milestone complete + invoice
#
# Fixes:
# - Milestone completion now requires:
#     - agreement.signature_is_satisfied == True (policy-aware)
#     - AND if agreement.payment_mode == "escrow": agreement.escrow_funded == True
# - Direct Pay agreements do NOT require escrow funded for invoicing
# - Ensures PATCH/PUT completion path cannot bypass completion gating
# - Adds structured error codes:
#     - SIGNATURE_REQUIRED
#     - ESCROW_REQUIRED

from __future__ import annotations

import logging
import os
from datetime import timedelta
from decimal import Decimal, InvalidOperation, ROUND_HALF_UP
from typing import List, Dict, Any, Optional

from django.conf import settings
from django.db import IntegrityError, transaction
from django.db.models import Max, Q, Sum
from django.shortcuts import get_object_or_404
from django.utils import timezone

from rest_framework import status, viewsets
from rest_framework.decorators import action
from rest_framework.permissions import IsAuthenticated, AllowAny
from rest_framework.response import Response

import stripe

from projects.models import (
    Milestone,
    MilestoneFile,
    MilestoneComment,
    Invoice,
    InvoiceStatus,
    Agreement,
    SubcontractorCompletionStatus,
)
from projects.serializers.milestone import MilestoneSerializer
from projects.serializers.milestone_file import MilestoneFileSerializer
from projects.serializers.milestone_comment import MilestoneCommentSerializer
from projects.serializers.invoices import InvoiceSerializer
from projects.permissions_subaccounts import IsContractorOrSubAccount, CanEditMilestones
from projects.utils.accounts import get_contractor_for_user

from projects.models_amendment_request import AmendmentRequest
from projects.serializers_amendment_request import AmendmentRequestSerializer
from projects.services.agreement_locking import (
    can_edit_milestones_under_agreement,
    is_completed_agreement,
)
from projects.services.milestone_workflow import can_user_review_submitted_work

logger = logging.getLogger(__name__)


# ----------------------------- helpers ----------------------------- #
def _money_to_cents(value) -> int:
    if value is None:
        return 0
    try:
        return int(round(float(value) * 100))
    except Exception:
        return 0


def _to_decimal_amount(value) -> Decimal:
    """
    Parse amount into Decimal dollars (Milestone.amount is DecimalField).
    Accepts: 0, 0.0, "0", "0.00", "$0.00", "1,234.56"
    """
    if value is None or value == "":
        return Decimal("0.00")
    if isinstance(value, Decimal):
        return value
    if isinstance(value, (int, float)):
        return Decimal(str(value))
    if isinstance(value, str):
        s = value.strip().replace(",", "")
        if s.startswith("$"):
            s = s[1:].strip()
        if s == "":
            return Decimal("0.00")
        try:
            return Decimal(s)
        except (InvalidOperation, ValueError):
            return Decimal("0.00")
    return Decimal("0.00")


def _quantize_money(d: Decimal) -> Decimal:
    return d.quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)


def _spread_total_equal(total: Decimal, n: int) -> List[Decimal]:
    """
    Split total into n amounts with exact cent rounding where final sum == total.
    """
    if n <= 0:
        return []
    total = _quantize_money(total)
    if total < 0:
        total = Decimal("0.00")

    total_cents = int((total * 100).to_integral_value(rounding=ROUND_HALF_UP))
    base = total_cents // n
    rem = total_cents % n

    cents = [base + (1 if i < rem else 0) for i in range(n)]
    return [Decimal(c) / Decimal(100) for c in cents]


def _recompute_agreement_total_cost(agreement: Optional[Agreement]) -> Decimal:
    if agreement is None:
        return Decimal("0.00")

    total = (
        Milestone.objects.filter(agreement=agreement)
        .aggregate(total=Sum("amount"))
        .get("total")
        or Decimal("0.00")
    )
    total = _quantize_money(_to_decimal_amount(total))

    if getattr(agreement, "total_cost", None) != total:
        agreement.total_cost = total
        agreement.save(update_fields=["total_cost"])

    return total


def _stripe_init_or_raise():
    key = getattr(settings, "STRIPE_SECRET_KEY", None)
    if not key:
        raise RuntimeError("STRIPE_SECRET_KEY is not configured.")
    stripe.api_key = key


def _stripe_remaining_refundable_cents(payment_intent_id: str) -> int:
    _stripe_init_or_raise()
    pi = stripe.PaymentIntent.retrieve(payment_intent_id)
    received = int(pi.get("amount_received") or 0)
    refunded = int(pi.get("amount_refunded") or 0)
    return max(0, received - refunded)


def _get_invoice_queryset_for_agreement(agreement):
    try:
        if hasattr(agreement, "invoices"):
            return agreement.invoices.all()
        if hasattr(agreement, "invoice_set"):
            return agreement.invoice_set.all()
    except Exception:
        pass
    return Invoice.objects.filter(agreement=agreement)


def _released_total_cents_for_agreement(agreement) -> int:
    qs = _get_invoice_queryset_for_agreement(agreement)

    released_ids = set()
    try:
        released_ids |= set(qs.filter(escrow_released=True).values_list("id", flat=True))
    except Exception:
        pass

    try:
        released_ids |= set(
            qs.exclude(stripe_transfer_id="").exclude(stripe_transfer_id__isnull=True).values_list("id", flat=True)
        )
    except Exception:
        pass

    total = 0
    if released_ids:
        for inv in qs.filter(id__in=list(released_ids)):
            total += _money_to_cents(getattr(inv, "amount", 0))
    return total


def _funded_total_cents_for_agreement(agreement) -> int:
    if hasattr(agreement, "escrow_funded_amount"):
        return _money_to_cents(getattr(agreement, "escrow_funded_amount", 0))
    return 0


def _unreleased_total_cents_for_agreement(agreement) -> int:
    funded = _funded_total_cents_for_agreement(agreement)
    released = _released_total_cents_for_agreement(agreement)
    return max(0, funded - released)


def _milestone_looks_started(m: Milestone) -> bool:
    if getattr(m, "completed", False):
        return True
    if getattr(m, "is_invoiced", False):
        return True
    if getattr(m, "invoice_id", None):
        return True
    return False


def _milestone_is_refunded(m: Milestone) -> bool:
    if hasattr(m, "descope_status"):
        return str(getattr(m, "descope_status", "") or "").lower() == "refunded"
    return False


def _ensure_descope_fields_exist(m: Milestone) -> bool:
    needed = ["descope_status", "descope_requested_at", "descope_reason", "descope_decision_at", "descope_decision_note"]
    missing = [f for f in needed if not hasattr(m, f)]
    if missing:
        raise RuntimeError(
            f"Milestone is missing descope fields: {missing}. "
            "Run migrations that add descope_status/descope_* fields."
        )
    return True


def _refund_single_milestone_via_agreement_engine(*, request_user, milestone: Milestone, reason: str) -> dict:
    agreement = milestone.agreement

    if not getattr(agreement, "escrow_funded", False):
        raise ValueError("Agreement escrow is not funded.")

    if _milestone_looks_started(milestone):
        raise ValueError("Milestone appears started/invoiced. Use dispute flow.")

    if _milestone_is_refunded(milestone):
        return {"ok": True, "already_refunded": True, "refund_cents": 0, "stripe_refund_id": None}

    pi_id = getattr(agreement, "escrow_payment_intent_id", "") or ""
    if not pi_id:
        raise ValueError("Agreement has no escrow_payment_intent_id.")

    refund_cents = _money_to_cents(getattr(milestone, "amount", 0))
    if refund_cents <= 0:
        raise ValueError("Milestone amount is invalid for refund.")

    unreleased = _unreleased_total_cents_for_agreement(agreement)
    if refund_cents > unreleased:
        raise ValueError(
            f"Not enough unreleased escrow remaining. Requested {refund_cents} cents; unreleased {unreleased} cents."
        )

    stripe_remaining = _stripe_remaining_refundable_cents(pi_id)
    if refund_cents > stripe_remaining:
        raise ValueError(
            f"Not enough refundable balance remaining on Stripe. Requested {refund_cents} cents; remaining {stripe_remaining} cents."
        )

    idem_key = f"mhb_agreement_refund_like_descope_ag{agreement.id}_ms{milestone.id}"

    with transaction.atomic():
        locked = Milestone.objects.select_for_update().get(pk=milestone.pk)
        _ensure_descope_fields_exist(locked)

        if str(getattr(locked, "descope_status", "") or "").lower() == "refunded":
            return {"ok": True, "already_refunded": True, "refund_cents": 0, "stripe_refund_id": None}

        stripe_refund = stripe.Refund.create(
            payment_intent=pi_id,
            amount=int(refund_cents),
            reason="requested_by_customer",
            idempotency_key=idem_key,
            metadata={
                "agreement_id": str(agreement.id),
                "milestone_id": str(locked.id),
                "type": "milestone_descope_refund_via_agreement_engine",
                "initiated_by_user_id": str(getattr(request_user, "id", "")),
                "initiated_by_email": getattr(request_user, "email", "") or "",
            },
        )

        locked.descope_status = "refunded"
        locked.descope_requested_at = locked.descope_requested_at or timezone.now()
        locked.descope_reason = locked.descope_reason or (reason or "")
        locked.descope_decision_at = timezone.now()
        locked.descope_decision_note = (reason or "").strip()
        locked.save(
            update_fields=[
                "descope_status",
                "descope_requested_at",
                "descope_reason",
                "descope_decision_at",
                "descope_decision_note",
            ]
        )

        try:
            MilestoneComment.objects.create(
                milestone=locked,
                author=request_user,
                content=(
                    "[System] Milestone refund issued (agreement-engine).\n"
                    f"Refund: {refund_cents} cents\n"
                    f"Stripe refund id: {getattr(stripe_refund, 'id', None) or stripe_refund.get('id')}\n\n"
                    f"Reason: {reason or ''}"
                ).strip(),
            )
        except Exception:
            pass

    rid = getattr(stripe_refund, "id", None)
    if rid is None and isinstance(stripe_refund, dict):
        rid = stripe_refund.get("id")

    return {"ok": True, "refund_cents": int(refund_cents), "stripe_refund_id": rid}


def _parse_bool(v) -> bool:
    if v is None:
        return False
    if isinstance(v, bool):
        return v
    s = str(v).strip().lower()
    return s in ("1", "true", "yes", "y", "on")


def _collect_uploaded_files(request) -> List[Any]:
    uploaded_files: List[Any] = []
    try:
        if hasattr(request, "FILES"):
            if "file" in request.FILES:
                uploaded_files.append(request.FILES["file"])
            if "files" in request.FILES:
                uploaded_files.extend(request.FILES.getlist("files"))
    except Exception:
            pass
    return uploaded_files


def _safe_list(value: Any) -> List[Any]:
    return value if isinstance(value, list) else []


def _normalize_milestone_text(value: Any) -> str:
    text = str(value or "").strip().lower()
    text = "".join(ch if ch.isalnum() or ch.isspace() else " " for ch in text)
    return " ".join(text.split())


def _milestone_title_description_signature(item: Any) -> tuple[str, str]:
    title = _normalize_milestone_text(getattr(item, "title", None) if not isinstance(item, dict) else item.get("title"))
    description = _normalize_milestone_text(
        getattr(item, "description", None) if not isinstance(item, dict) else item.get("description")
    )
    return title, description


def _text_token_overlap(left: str, right: str) -> float:
    left_tokens = set(left.split())
    right_tokens = set(right.split())
    if not left_tokens or not right_tokens:
        return 0.0
    common = len(left_tokens & right_tokens)
    denom = max(len(left_tokens), len(right_tokens))
    if denom <= 0:
        return 0.0
    return common / denom


def _looks_like_obvious_duplicate_milestone(incoming: Any, existing: Any) -> bool:
    incoming_title, incoming_desc = _milestone_title_description_signature(incoming)
    existing_title, existing_desc = _milestone_title_description_signature(existing)

    if not incoming_title or not existing_title:
        return False

    if incoming_title != existing_title:
        return False

    if not incoming_desc or not existing_desc:
        return True

    if incoming_desc == existing_desc:
        return True

    if incoming_desc in existing_desc or existing_desc in incoming_desc:
        return True

    return _text_token_overlap(incoming_desc, existing_desc) >= 0.7


def _find_append_duplicate_pairs(existing_rows: List[Milestone], incoming_rows: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    duplicates: List[Dict[str, Any]] = []
    for incoming in incoming_rows:
        for existing in existing_rows:
            if not _looks_like_obvious_duplicate_milestone(incoming, existing):
                continue
            duplicates.append(
                {
                    "existing_id": getattr(existing, "id", None),
                    "title": getattr(existing, "title", "") or incoming.get("title") or "",
                }
            )
            break
    return duplicates


def _incoming_set_closely_matches_existing(existing_rows: List[Milestone], incoming_rows: List[Dict[str, Any]]) -> bool:
    if not existing_rows:
        return True

    if len(existing_rows) != len(incoming_rows):
        return False

    unmatched = list(incoming_rows)
    for existing in existing_rows:
        match_idx = None
        for idx, incoming in enumerate(unmatched):
            if _looks_like_obvious_duplicate_milestone(incoming, existing):
                match_idx = idx
                break
        if match_idx is None:
            return False
        unmatched.pop(match_idx)

    return not unmatched


def _agreement_has_template_derived_state(agreement: Agreement) -> bool:
    if getattr(agreement, "selected_template_id", None):
        return True

    if str(getattr(agreement, "selected_template_name_snapshot", "") or "").strip():
        return True

    scope_obj = getattr(agreement, "ai_scope", None)
    questions = _safe_list(getattr(scope_obj, "questions", None))
    for question in questions:
        if not isinstance(question, dict):
            continue
        source = str(question.get("source", "") or "").strip().lower()
        if source == "template":
            return True

    return False


# ----------------------------- NEW: business rule gating ----------------------------- #
def _agreement_payment_mode(agreement: Agreement) -> str:
    """
    Return "escrow" or "direct" (default escrow).
    """
    try:
        mode = str(getattr(agreement, "payment_mode", "") or "escrow").strip().lower()
        if mode not in ("escrow", "direct"):
            return "escrow"
        return mode
    except Exception:
        return "escrow"


def _agreement_requires_escrow(agreement: Agreement) -> bool:
    return _agreement_payment_mode(agreement) == "escrow"


def _agreement_signature_satisfied(agreement: Agreement) -> bool:
    """
    Uses Agreement.signature_is_satisfied if present, else falls back to is_fully_signed.
    """
    try:
        v = getattr(agreement, "signature_is_satisfied")
        return bool(v)
    except Exception:
        return bool(getattr(agreement, "signed_by_contractor", False) and getattr(agreement, "signed_by_homeowner", False))


def _can_complete_milestone(agreement: Agreement) -> Optional[Response]:
    """
    Completion rules:
      - ALWAYS require signature satisfaction (policy-aware)
      - If escrow-mode: require escrow_funded True
    """
    if not _agreement_signature_satisfied(agreement):
        return Response(
            {
                "detail": "Agreement must meet signature requirements before completing milestones.",
                "code": "SIGNATURE_REQUIRED",
                "agreement_id": agreement.id,
                "payment_mode": _agreement_payment_mode(agreement),
                "signature_policy": getattr(agreement, "signature_policy", None),
            },
            status=status.HTTP_409_CONFLICT,
        )

    if _agreement_requires_escrow(agreement) and not getattr(agreement, "escrow_funded", False):
        return Response(
            {
                "detail": "Escrow must be funded before completing milestones.",
                "code": "ESCROW_REQUIRED",
                "agreement_id": agreement.id,
                "payment_mode": _agreement_payment_mode(agreement),
            },
            status=status.HTTP_409_CONFLICT,
        )

    return None


def _can_invoice_milestone(agreement: Agreement) -> Optional[Response]:
    """
    Invoicing rules:
      - If escrow-mode: require escrow_funded True
      - Direct pay: no escrow requirement
    """
    if _agreement_requires_escrow(agreement) and not getattr(agreement, "escrow_funded", False):
        return Response(
            {
                "detail": "Agreement escrow must be funded before invoicing milestones.",
                "code": "ESCROW_REQUIRED",
                "agreement_id": agreement.id,
                "payment_mode": _agreement_payment_mode(agreement),
            },
            status=status.HTTP_409_CONFLICT,
        )
    return None


def _mark_milestone_complete_side_effects(*, request, milestone: Milestone, completion_notes: str = "") -> Milestone:
    """
    Shared completion side-effect handler. Used by:
      - POST /milestones/:id/complete/
      - PUT/PATCH /milestones/:id/ when completed=true is submitted
    """
    stamp = timezone.now().strftime("%Y-%m-%d %H:%M:%S %Z")

    milestone.completed = True
    update_fields = ["completed"]

    if hasattr(milestone, "completion_notes") and completion_notes:
        setattr(milestone, "completion_notes", completion_notes)
        update_fields.append("completion_notes")

    if hasattr(milestone, "completed_at"):
        milestone.completed_at = timezone.now()
        update_fields.append("completed_at")

    milestone.save(update_fields=update_fields)

    base_line = f"[System] Milestone marked complete at {stamp}."
    content = f"{base_line}\n\n{completion_notes}" if completion_notes else base_line
    try:
        MilestoneComment.objects.create(milestone=milestone, author=request.user, content=content)
    except Exception:
        pass

    for up in _collect_uploaded_files(request):
        try:
            MilestoneFile.objects.create(milestone=milestone, uploaded_by=request.user, file=up)
        except Exception:
            pass

    milestone.refresh_from_db()
    return milestone


# ----------------------------- NEW: edit locking ----------------------------- #
def _is_amendment_request(request) -> bool:
    try:
        q = str(request.query_params.get("amendment", "")).strip().lower()
    except Exception:
        q = ""
    try:
        h = str(request.headers.get("X-MHB-Amendment", "")).strip().lower()
    except Exception:
        h = ""
    return q in {"1", "true", "yes"} or h in {"1", "true", "yes"}


def _locked_response(agreement: Agreement) -> Response:
    if is_completed_agreement(agreement):
        return Response(
            {
                "detail": "Agreement is completed. No edits or amendments allowed.",
                "code": "AGREEMENT_COMPLETED_LOCKED",
                "agreement_id": agreement.id,
                "agreement_status": getattr(agreement, "status", None),
            },
            status=status.HTTP_403_FORBIDDEN,
        )

    return Response(
        {
            "detail": "Agreement is signed/locked. Milestones cannot be edited outside the amendment process.",
            "code": "AGREEMENT_SIGNED_LOCKED",
            "agreement_id": agreement.id,
            "agreement_status": getattr(agreement, "status", None),
        },
        status=status.HTTP_403_FORBIDDEN,
    )


def _enforce_no_edit_on_locked_agreement(*, request, milestone: Milestone, data: dict) -> Optional[Response]:
    agreement = milestone.agreement
    allow_amendment = _is_amendment_request(request)

    if can_edit_milestones_under_agreement(agreement, allow_amendment=allow_amendment):
        return None

    # locked (signed or completed)
    allowed_fields = {"completed", "completion_notes", "notes"}

    incoming_keys = set((data or {}).keys())
    if incoming_keys and incoming_keys.issubset(allowed_fields):
        return None

    return _locked_response(agreement)


# ----------------------------- viewsets ----------------------------- #
class MilestoneViewSet(viewsets.ModelViewSet):
    permission_classes = [IsAuthenticated, IsContractorOrSubAccount, CanEditMilestones]
    serializer_class = MilestoneSerializer
    queryset = Milestone.objects.select_related(
        "agreement",
        "assigned_subcontractor_invitation",
        "assigned_subcontractor_invitation__accepted_by_user",
        "subaccount_assignment",
        "subaccount_assignment__subaccount",
        "subaccount_assignment__subaccount__user",
        "delegated_reviewer_subaccount",
        "delegated_reviewer_subaccount__user",
        "subcontractor_review_requested_by",
        "subcontractor_marked_complete_by",
        "subcontractor_reviewed_by",
    ).all()

    def _assigned_queryset_for_user(self, user):
        assignment_filter = (
            Q(subaccount_assignment__subaccount__user=user)
            | Q(assigned_to=user)
            | Q(assigned_user=user)
            | Q(assigned_employee__user=user)
        )

        return (
            Milestone.objects.select_related(
                "agreement",
                "agreement__project",
                "subaccount_assignment",
                "subaccount_assignment__subaccount",
                "subaccount_assignment__subaccount__user",
                "assigned_subcontractor_invitation",
                "assigned_subcontractor_invitation__accepted_by_user",
                "delegated_reviewer_subaccount",
                "delegated_reviewer_subaccount__user",
            )
            .filter(assignment_filter)
            .distinct()
            .order_by("completion_date", "order", "id")
        )

    def get_queryset(self):
        user = self.request.user

        contractor = get_contractor_for_user(user)
        if contractor is not None:
            qs = (
                Milestone.objects
                .select_related(
                    "agreement",
                    "agreement__project",
                    "assigned_subcontractor_invitation",
                    "assigned_subcontractor_invitation__accepted_by_user",
                    "subaccount_assignment",
                    "subaccount_assignment__subaccount",
                    "subaccount_assignment__subaccount__user",
                    "delegated_reviewer_subaccount",
                    "delegated_reviewer_subaccount__user",
                    "subcontractor_review_requested_by",
                    "subcontractor_marked_complete_by",
                    "subcontractor_reviewed_by",
                )
                .filter(agreement__project__contractor=contractor)
                .order_by("order", "id")
            )

            agreement = (
                self.request.query_params.get("agreement")
                or self.request.query_params.get("agreement_id")
            )
            if agreement:
                try:
                    qs = qs.filter(agreement_id=int(agreement))
                except (TypeError, ValueError):
                    qs = qs.none()

            return qs

        return self._assigned_queryset_for_user(user)

    @action(detail=False, methods=["get"], url_path="my-assigned")
    def my_assigned(self, request):
        user = request.user
        qs = self._assigned_queryset_for_user(user)
        ser = MilestoneSerializer(qs, many=True, context={"request": request})
        return Response(
            {
                "user_id": getattr(user, "id", None),
                "email": getattr(user, "email", None),
                "assigned_count": qs.count(),
                "results": ser.data,
            },
            status=status.HTTP_200_OK,
        )

    @transaction.atomic
    def create(self, request, *args, **kwargs):
        data = request.data.copy()

        agreement_id = data.get("agreement") or data.get("agreement_id")
        incoming_order = data.get("order")

        if agreement_id:
            try:
                ag = Agreement.objects.select_related("project").get(pk=int(agreement_id))
                if not can_edit_milestones_under_agreement(ag, allow_amendment=_is_amendment_request(request)):
                    return _locked_response(ag)
            except Exception:
                pass

        if agreement_id and (incoming_order in (None, "", [], {})):
            try:
                ag_id = int(agreement_id)
                max_order = (
                    Milestone.objects.filter(agreement_id=ag_id)
                    .aggregate(Max("order"))["order__max"]
                    or 0
                )
                data["order"] = max_order + 1
            except Exception:
                data["order"] = 1

        serializer = self.get_serializer(data=data)
        serializer.is_valid(raise_exception=True)

        try:
            self.perform_create(serializer)
            created_instance = getattr(serializer, "instance", None)
            if created_instance is not None:
                _recompute_agreement_total_cost(getattr(created_instance, "agreement", None))
        except IntegrityError as exc:
            logger.exception("IntegrityError creating milestone: %s", exc)
            return Response(
                {"detail": "Unable to create milestone due to a database constraint. Please refresh and try again."},
                status=status.HTTP_400_BAD_REQUEST,
            )

        headers = self.get_success_headers(serializer.data)
        return Response(serializer.data, status=status.HTTP_201_CREATED, headers=headers)

    @transaction.atomic
    def destroy(self, request, *args, **kwargs):
        milestone: Milestone = self.get_object()
        agreement = getattr(milestone, "agreement", None)

        if agreement is None:
            return Response({"detail": "Milestone has no agreement."}, status=status.HTTP_400_BAD_REQUEST)

        if is_completed_agreement(agreement):
            return Response(
                {
                    "detail": "Agreement is completed. Milestones cannot be deleted.",
                    "code": "AGREEMENT_COMPLETED_LOCKED",
                    "agreement_id": agreement.id,
                    "agreement_status": getattr(agreement, "status", None),
                },
                status=status.HTTP_403_FORBIDDEN,
            )

        if not can_edit_milestones_under_agreement(agreement, allow_amendment=False):
            return Response(
                {
                    "detail": "Agreement is signed/locked. Milestones cannot be deleted.",
                    "code": "AGREEMENT_SIGNED_LOCKED",
                    "agreement_id": agreement.id,
                    "agreement_status": getattr(agreement, "status", None),
                },
                status=status.HTTP_403_FORBIDDEN,
            )

        if _milestone_looks_started(milestone):
            return Response(
                {
                    "detail": "Milestone cannot be deleted because it is completed and/or invoiced/linked to an invoice.",
                    "code": "MILESTONE_STARTED_LOCKED",
                    "milestone_id": milestone.id,
                    "agreement_id": agreement.id,
                },
                status=status.HTTP_400_BAD_REQUEST,
            )

        response = super().destroy(request, *args, **kwargs)
        _recompute_agreement_total_cost(agreement)
        return response

    # ---------------- HARDEN completion via PUT/PATCH + LOCK edits on signed ---------------- #
    def update(self, request, *args, **kwargs):
        """
        Enforces completion rules (signature + escrow if escrow mode)
        even when completed=true is submitted through PATCH/PUT.
        """
        partial = kwargs.pop("partial", False)
        instance: Milestone = self.get_object()
        data = request.data.copy()

        # Prevent bypassing amendments (but allow completion-only updates if agreement locked)
        locked_resp = _enforce_no_edit_on_locked_agreement(request=request, milestone=instance, data=data)
        if locked_resp is not None:
            return locked_resp

        wants_complete = False
        if "completed" in data:
            wants_complete = _parse_bool(data.get("completed"))

        completion_notes = ((data.get("completion_notes") or data.get("notes") or "") if isinstance(data, dict) else "")
        completion_notes = (completion_notes or "").strip()

        # If they are setting completed=true and it's currently false:
        if wants_complete and not getattr(instance, "completed", False):
            # ✅ Gate completion based on agreement rules
            gate = _can_complete_milestone(instance.agreement)
            if gate is not None:
                return gate

            # remove completed so serializer doesn't flip without side-effects
            try:
                data.pop("completed", None)
            except Exception:
                pass

            serializer = self.get_serializer(instance, data=data, partial=partial)
            serializer.is_valid(raise_exception=True)

            try:
                with transaction.atomic():
                    self.perform_update(serializer)
                    locked = Milestone.objects.select_for_update().get(pk=instance.pk)

                    if not getattr(locked, "completed", False):
                        if getattr(locked, "is_invoiced", False) or getattr(locked, "invoice_id", None):
                            return Response(
                                {"detail": "This milestone has already been invoiced and cannot be marked complete again."},
                                status=status.HTTP_400_BAD_REQUEST,
                            )

                        locked = _mark_milestone_complete_side_effects(
                            request=request,
                            milestone=locked,
                            completion_notes=completion_notes,
                        )

                out = MilestoneSerializer(locked, context={"request": request}).data
                return Response(out, status=status.HTTP_200_OK)

            except Exception as exc:
                logger.exception("Failed to update+complete milestone %s: %s", getattr(instance, "id", None), exc)
                return Response({"detail": "Unable to update/complete milestone."}, status=status.HTTP_500_INTERNAL_SERVER_ERROR)

        response = super().update(request, *args, partial=partial, **kwargs)
        _recompute_agreement_total_cost(getattr(instance, "agreement", None))
        return response

    def partial_update(self, request, *args, **kwargs):
        kwargs["partial"] = True
        return self.update(request, *args, **kwargs)

    # ---------------- Request Change -> Amendment workflow ---------------- #
    @action(detail=True, methods=["post"], url_path="request_change")
    def request_change(self, request, pk=None):
        milestone: Milestone = self.get_object()
        agreement = milestone.agreement

        if is_completed_agreement(agreement):
            return Response(
                {
                    "detail": "Agreement is completed. No amendments allowed.",
                    "code": "AGREEMENT_COMPLETED_LOCKED",
                    "agreement_id": agreement.id,
                    "agreement_status": getattr(agreement, "status", None),
                },
                status=status.HTTP_403_FORBIDDEN,
            )

        payload = request.data or {}
        change_type = (payload.get("change_type") or AmendmentRequest.ChangeType.OTHER).strip()
        requested_changes = payload.get("requested_changes") or {}
        justification = str(payload.get("justification") or "").strip()

        if not justification:
            return Response({"detail": "justification is required."}, status=status.HTTP_400_BAD_REQUEST)

        ser = AmendmentRequestSerializer(
            data={
                "agreement": agreement.id,
                "milestone": milestone.id,
                "change_type": change_type,
                "requested_changes": requested_changes,
                "justification": justification,
            }
        )
        ser.is_valid(raise_exception=True)

        obj = AmendmentRequest.objects.create(
            agreement=agreement,
            milestone=milestone,
            requested_by=request.user,
            change_type=ser.validated_data["change_type"],
            requested_changes=ser.validated_data.get("requested_changes") or {},
            justification=ser.validated_data["justification"],
            status=AmendmentRequest.Status.OPEN,
        )

        try:
            MilestoneComment.objects.create(
                milestone=milestone,
                author=request.user,
                content=(
                    "[System] Amendment request submitted.\n"
                    f"Type: {obj.change_type}\n"
                    f"Requested: {obj.requested_changes}\n\n"
                    f"Justification: {obj.justification}"
                ).strip(),
            )
        except Exception:
            pass

        return Response(
            {
                "ok": True,
                "id": obj.id,
                "status": obj.status,
                "agreement_id": agreement.id,
                "milestone_id": milestone.id,
            },
            status=status.HTTP_201_CREATED,
        )

    # ---------------- bulk AI creation ---------------- #
    @action(detail=False, methods=["post"], url_path="bulk-ai-create")
    def bulk_ai_create(self, request):
        payload = request.data or {}
        agreement_id = payload.get("agreement_id") or payload.get("agreement")
        mode = (payload.get("mode") or "append").strip().lower()
        spread_strategy = (payload.get("spread_strategy") or "equal").strip().lower()
        milestones_in = payload.get("milestones") or []
        auto_schedule = bool(payload.get("auto_schedule", False))

        if not agreement_id:
            return Response({"detail": "agreement_id is required."}, status=status.HTTP_400_BAD_REQUEST)

        if mode not in ("replace", "append"):
            return Response({"detail": "mode must be 'replace' or 'append'."}, status=status.HTTP_400_BAD_REQUEST)

        if not isinstance(milestones_in, list) or not milestones_in:
            return Response({"detail": "milestones must be a non-empty list."}, status=status.HTTP_400_BAD_REQUEST)

        try:
            ag_id = int(agreement_id)
        except Exception:
            return Response({"detail": "agreement_id must be an integer."}, status=status.HTTP_400_BAD_REQUEST)

        agreement = get_object_or_404(Agreement.objects.select_related("project"), pk=ag_id)

        if not can_edit_milestones_under_agreement(agreement, allow_amendment=_is_amendment_request(request)):
            return _locked_response(agreement)

        if _agreement_has_template_derived_state(agreement):
            return Response(
                {
                    "detail": (
                        "A template is already applied to this agreement. "
                        "AI milestone bulk apply is disabled to avoid overwriting the template structure."
                    ),
                    "code": "TEMPLATE_APPLIED",
                    "agreement_id": agreement.id,
                },
                status=status.HTTP_409_CONFLICT,
            )

        contractor = get_contractor_for_user(request.user)
        if contractor is None:
            return Response({"detail": "Not authorized."}, status=status.HTTP_403_FORBIDDEN)

        if getattr(agreement, "project", None) is None or getattr(agreement.project, "contractor_id", None) != contractor.id:
            return Response({"detail": "Not authorized for this agreement."}, status=status.HTTP_403_FORBIDDEN)

        spread_total_raw = payload.get("spread_total", None)
        spread_total: Optional[Decimal] = None
        if spread_total_raw not in (None, "", []):
            try:
                spread_total = _to_decimal_amount(spread_total_raw)
            except Exception:
                spread_total = None

        existing_max = (
            Milestone.objects.filter(agreement_id=ag_id)
            .aggregate(Max("order"))["order__max"]
            or 0
        )
        next_order = 1 if mode == "replace" else (existing_max + 1)

        with transaction.atomic():
            existing = list(Milestone.objects.select_for_update().filter(agreement_id=ag_id))

            if mode == "append":
                duplicates = _find_append_duplicate_pairs(existing, milestones_in)
                if duplicates:
                    duplicate_titles = [d.get("title") for d in duplicates if d.get("title")]
                    return Response(
                        {
                            "detail": (
                                "AI append was blocked because one or more suggested milestones "
                                "already match existing milestones on this agreement."
                            ),
                            "code": "AI_APPEND_DUPLICATE",
                            "duplicate_titles": duplicate_titles[:5],
                            "duplicate_existing_ids": [d.get("existing_id") for d in duplicates if d.get("existing_id")],
                        },
                        status=status.HTTP_409_CONFLICT,
                    )

            if mode == "replace":
                started = [m.id for m in existing if _milestone_looks_started(m)]
                if started:
                    return Response(
                        {"detail": f"Cannot replace milestones because some milestones are started/invoiced: {started}"},
                        status=status.HTTP_400_BAD_REQUEST,
                    )

                if existing and not _incoming_set_closely_matches_existing(existing, milestones_in):
                    return Response(
                        {
                            "detail": (
                                "AI replace was blocked because the current milestones appear manually edited "
                                "or otherwise unsafe to wipe. Remove or update milestones manually before replacing them with AI."
                            ),
                            "code": "AI_REPLACE_UNSAFE_EXISTING",
                            "existing_count": len(existing),
                            "incoming_count": len(milestones_in),
                        },
                        status=status.HTTP_409_CONFLICT,
                    )

                Milestone.objects.filter(agreement_id=ag_id).delete()
                next_order = 1

            n = len(milestones_in)
            if spread_total is not None and spread_strategy == "equal":
                amounts = _spread_total_equal(spread_total, n)
            else:
                amounts = [_quantize_money(_to_decimal_amount((m or {}).get("amount"))) for m in milestones_in]

            ag_start = getattr(agreement, "start", None)
            ag_end = getattr(agreement, "end", None)

            schedule_pairs: List[tuple[Optional[Any], Optional[Any]]] = [(None, None)] * n
            if (
                auto_schedule
                and ag_start
                and ag_end
                and hasattr(ag_start, "year")
                and hasattr(ag_end, "year")
                and ag_end >= ag_start
                and n > 0
            ):
                total_days = (ag_end - ag_start).days
                step = max(1, (total_days + 1) // n)
                cur = ag_start
                pairs = []
                for i in range(n):
                    start_i = cur
                    if i == n - 1:
                        end_i = ag_end
                    else:
                        end_i = min(ag_end, cur + timedelta(days=step - 1))
                    pairs.append((start_i, end_i))
                    cur = min(ag_end, end_i + timedelta(days=1))
                schedule_pairs = pairs

            created_objs = []
            for idx, m in enumerate(milestones_in):
                if not isinstance(m, dict):
                    return Response({"detail": "Each milestone must be an object."}, status=status.HTTP_400_BAD_REQUEST)

                title = str(m.get("title") or "").strip() or f"Milestone {idx + 1}"
                desc = str(m.get("description") or "").strip()

                start_date = None
                completion_date = None

                if auto_schedule:
                    start_date, completion_date = schedule_pairs[idx]
                else:
                    start_date = m.get("start_date", None)
                    completion_date = m.get("completion_date", None)
                    if start_date == "":
                        start_date = None
                    if completion_date == "":
                        completion_date = None

                data = {
                    "agreement": ag_id,
                    "order": next_order + idx,
                    "title": title,
                    "description": desc,
                    "amount": str(amounts[idx]),
                    "start_date": start_date,
                    "completion_date": completion_date,
                    "allow_overlap": True,
                }

                ser = MilestoneSerializer(data=data, context={"request": request})
                ser.is_valid(raise_exception=True)
                obj = ser.save()
                created_objs.append(obj)

            _recompute_agreement_total_cost(agreement)

        out = MilestoneSerializer(created_objs, many=True, context={"request": request}).data
        return Response({"created": out, "count": len(created_objs)}, status=status.HTTP_201_CREATED)

    # ---------------- completion actions ---------------- #
    @action(detail=True, methods=["post"], url_path="complete")
    def complete(self, request, pk=None):
        milestone: Milestone = self.get_object()
        agreement = milestone.agreement

        # ✅ Gate completion (signature + escrow if needed)
        gate = _can_complete_milestone(agreement)
        if gate is not None:
            return gate

        if getattr(milestone, "completed", False) is True:
            return Response(MilestoneSerializer(milestone, context={"request": request}).data, status=status.HTTP_200_OK)

        if getattr(milestone, "is_invoiced", False) or getattr(milestone, "invoice_id", None):
            return Response(
                {"detail": "This milestone has already been invoiced and cannot be marked complete again."},
                status=status.HTTP_400_BAD_REQUEST,
            )

        completion_notes = ((request.data or {}).get("completion_notes") or "").strip()

        try:
            with transaction.atomic():
                locked = Milestone.objects.select_for_update().get(pk=milestone.pk)

                if getattr(locked, "completed", False) is True:
                    return Response(MilestoneSerializer(locked, context={"request": request}).data, status=status.HTTP_200_OK)

                if getattr(locked, "is_invoiced", False) or getattr(locked, "invoice_id", None):
                    return Response(
                        {"detail": "This milestone has already been invoiced and cannot be marked complete again."},
                        status=status.HTTP_400_BAD_REQUEST,
                    )

                locked = _mark_milestone_complete_side_effects(
                    request=request,
                    milestone=locked,
                    completion_notes=completion_notes,
                )

        except Exception as exc:
            logger.exception("Failed to mark milestone %s complete: %s", getattr(milestone, "id", None), exc)
            return Response({"detail": "Unable to mark milestone complete."}, status=status.HTTP_500_INTERNAL_SERVER_ERROR)

        return Response(MilestoneSerializer(locked, context={"request": request}).data, status=status.HTTP_200_OK)

    @action(detail=True, methods=["post"], url_path="complete-to-review")
    def complete_to_review(self, request, pk=None):
        return self.complete(request, pk=pk)

    @action(detail=True, methods=["post"], url_path="clear-subcontractor-review")
    def clear_subcontractor_review(self, request, pk=None):
        milestone: Milestone = self.get_object()

        with transaction.atomic():
            milestone = Milestone.objects.select_for_update().get(pk=milestone.pk)
            milestone.subcontractor_review_requested_at = None
            milestone.subcontractor_review_requested_by = None
            milestone.subcontractor_review_note = ""
            milestone.save(
                update_fields=[
                    "subcontractor_review_requested_at",
                    "subcontractor_review_requested_by",
                    "subcontractor_review_note",
                ]
            )

        milestone.refresh_from_db()
        return Response(
            MilestoneSerializer(milestone, context={"request": request}).data,
            status=status.HTTP_200_OK,
        )

    @action(detail=True, methods=["post"], url_path="approve-subcontractor-completion")
    def approve_subcontractor_completion(self, request, pk=None):
        milestone: Milestone = self.get_object()
        if not can_user_review_submitted_work(milestone, request.user):
            return Response({"detail": "You are not allowed to review this work submission."}, status=status.HTTP_403_FORBIDDEN)

        if milestone.subcontractor_completion_status != SubcontractorCompletionStatus.SUBMITTED_FOR_REVIEW:
            return Response({"detail": "No subcontractor completion submission is pending review."}, status=status.HTTP_400_BAD_REQUEST)

        response_note = ((request.data or {}).get("response_note") or "").strip()

        with transaction.atomic():
            milestone = Milestone.objects.select_for_update().get(pk=milestone.pk)
            if milestone.subcontractor_completion_status != SubcontractorCompletionStatus.SUBMITTED_FOR_REVIEW:
                return Response({"detail": "No subcontractor completion submission is pending review."}, status=status.HTTP_400_BAD_REQUEST)

            milestone.subcontractor_completion_status = SubcontractorCompletionStatus.APPROVED
            milestone.subcontractor_reviewed_at = timezone.now()
            milestone.subcontractor_reviewed_by = request.user
            milestone.subcontractor_review_response_note = response_note
            milestone.save(
                update_fields=[
                    "subcontractor_completion_status",
                    "subcontractor_reviewed_at",
                    "subcontractor_reviewed_by",
                    "subcontractor_review_response_note",
                ]
            )

        milestone.refresh_from_db()
        return Response(MilestoneSerializer(milestone, context={"request": request}).data, status=status.HTTP_200_OK)

    @action(detail=True, methods=["post"], url_path="reject-subcontractor-completion")
    def reject_subcontractor_completion(self, request, pk=None):
        milestone: Milestone = self.get_object()
        if not can_user_review_submitted_work(milestone, request.user):
            return Response({"detail": "You are not allowed to review this work submission."}, status=status.HTTP_403_FORBIDDEN)

        if milestone.subcontractor_completion_status != SubcontractorCompletionStatus.SUBMITTED_FOR_REVIEW:
            return Response({"detail": "No subcontractor completion submission is pending review."}, status=status.HTTP_400_BAD_REQUEST)

        response_note = ((request.data or {}).get("response_note") or "").strip()

        with transaction.atomic():
            milestone = Milestone.objects.select_for_update().get(pk=milestone.pk)
            if milestone.subcontractor_completion_status != SubcontractorCompletionStatus.SUBMITTED_FOR_REVIEW:
                return Response({"detail": "No subcontractor completion submission is pending review."}, status=status.HTTP_400_BAD_REQUEST)

            milestone.subcontractor_completion_status = SubcontractorCompletionStatus.NEEDS_CHANGES
            milestone.subcontractor_reviewed_at = timezone.now()
            milestone.subcontractor_reviewed_by = request.user
            milestone.subcontractor_review_response_note = response_note
            milestone.save(
                update_fields=[
                    "subcontractor_completion_status",
                    "subcontractor_reviewed_at",
                    "subcontractor_reviewed_by",
                    "subcontractor_review_response_note",
                ]
            )

        milestone.refresh_from_db()
        return Response(MilestoneSerializer(milestone, context={"request": request}).data, status=status.HTTP_200_OK)

    @action(detail=False, methods=["post"], url_path="check-overlap")
    def check_overlap(self, request):
        agreement = request.data.get("agreement")
        start = request.data.get("start_date")
        end = request.data.get("completion_date") or request.data.get("due_date")
        milestone_id = request.data.get("id")

        if not (agreement and start and end):
            return Response(
                {"detail": "agreement, start_date and completion_date/due_date are required."},
                status=status.HTTP_400_BAD_REQUEST,
            )

        qs = Milestone.objects.filter(agreement_id=agreement)
        if milestone_id:
            qs = qs.exclude(pk=milestone_id)

        conflicts = list(
            qs.filter(Q(start_date__lte=end) & (Q(completion_date__gte=start) | Q(completion_date__isnull=True))).values(
                "id", "title", "start_date", "completion_date"
            )
        )
        return Response({"overlaps": bool(conflicts), "conflicts": conflicts}, status=200)

    @action(detail=True, methods=["post"], url_path="create-invoice")
    def create_invoice(self, request, pk=None):
        milestone: Milestone = self.get_object()
        agreement = milestone.agreement

        if not getattr(milestone, "completed", False):
            return Response({"detail": "Milestone must be completed before invoicing."}, status=status.HTTP_400_BAD_REQUEST)

        # ✅ Escrow mode requires funded; Direct mode does not
        gate = _can_invoice_milestone(agreement)
        if gate is not None:
            return gate

        if getattr(milestone, "invoice_id", None):
            inv = Invoice.objects.filter(pk=milestone.invoice_id).first()
            if inv:
                return Response(InvoiceSerializer(inv, context={"request": request}).data, status=status.HTTP_200_OK)

        try:
            with transaction.atomic():
                milestone = Milestone.objects.select_for_update().get(pk=milestone.pk)

                if getattr(milestone, "invoice_id", None):
                    inv = Invoice.objects.filter(pk=milestone.invoice_id).first()
                    if inv:
                        return Response(InvoiceSerializer(inv, context={"request": request}).data, status=status.HTTP_200_OK)

                completion_notes = ""
                if hasattr(milestone, "completion_notes"):
                    completion_notes = (getattr(milestone, "completion_notes") or "").strip()

                if not completion_notes:
                    try:
                        comments_qs = MilestoneComment.objects.filter(milestone=milestone).order_by("created_at")
                        lines = []
                        for c in comments_qs:
                            txt = (getattr(c, "content", "") or "").strip()
                            if txt:
                                lines.append(f"- {txt}")
                        completion_notes = "\n".join(lines).strip()
                    except Exception:
                        completion_notes = ""

                attachments = []
                try:
                    files_qs = MilestoneFile.objects.filter(milestone=milestone).order_by("-uploaded_at")
                    for f in files_qs:
                        if not getattr(f, "file", None):
                            continue
                        try:
                            url = request.build_absolute_uri(f.file.url)
                        except Exception:
                            url = f.file.url
                        attachments.append(
                            {
                                "id": f.id,
                                "name": os.path.basename(getattr(f.file, "name", "") or "") or f"file_{f.id}",
                                "url": url,
                                "uploaded_at": getattr(f, "uploaded_at", None).isoformat()
                                if getattr(f, "uploaded_at", None)
                                else None,
                            }
                        )
                except Exception:
                    attachments = []

                # Status for escrow flow stays PENDING approval.
                # For direct-pay you may later want SENT; for now leave as PENDING (your existing pipeline).
                invoice = Invoice.objects.create(
                    agreement=agreement,
                    amount=milestone.amount,
                    status=InvoiceStatus.PENDING,
                    milestone_id_snapshot=getattr(milestone, "id", None),
                    milestone_title_snapshot=getattr(milestone, "title", "") or "",
                    milestone_description_snapshot=getattr(milestone, "description", "") or "",
                    milestone_completion_notes=completion_notes or "",
                    milestone_attachments_snapshot=attachments or [],
                )

                milestone.is_invoiced = True
                milestone.invoice = invoice
                milestone.save(update_fields=["is_invoiced", "invoice"])

                return Response(InvoiceSerializer(invoice, context={"request": request}).data, status=status.HTTP_201_CREATED)

        except IntegrityError as exc:
            logger.error("IntegrityError creating invoice for milestone %s: %s", milestone.id, exc)
            return Response(
                {"detail": "Unable to create invoice due to a data integrity rule. Please refresh and try again."},
                status=status.HTTP_400_BAD_REQUEST,
            )
        except Exception as exc:
            logger.exception("Unexpected error creating invoice for milestone %s: %s", milestone.id, exc)
            return Response({"detail": "Unexpected error creating invoice."}, status=status.HTTP_500_INTERNAL_SERVER_ERROR)

    @action(detail=True, methods=["get", "post"], url_path="files")
    def files(self, request, pk=None):
        milestone: Milestone = self.get_object()

        if request.method.lower() == "get":
            qs = MilestoneFile.objects.filter(milestone=milestone).order_by("-uploaded_at")
            ser = MilestoneFileSerializer(qs, many=True, context={"request": request})
            return Response(ser.data, status=status.HTTP_200_OK)

        uploaded = request.FILES.get("file") or request.FILES.get("document")
        if not uploaded:
            return Response({"detail": "file is required."}, status=status.HTTP_400_BAD_REQUEST)

        serializer = MilestoneFileSerializer(data={"milestone": milestone.pk, "file": uploaded}, context={"request": request})
        serializer.is_valid(raise_exception=True)
        instance = serializer.save(uploaded_by=request.user)
        out = MilestoneFileSerializer(instance, context={"request": request}).data
        return Response(out, status=status.HTTP_201_CREATED)

    @action(detail=True, methods=["get", "post"], url_path="comments")
    def comments(self, request, pk=None):
        milestone: Milestone = self.get_object()

        if request.method.lower() == "get":
            qs = MilestoneComment.objects.filter(milestone=milestone).order_by("-created_at")
            ser = MilestoneCommentSerializer(qs, many=True)
            return Response(ser.data, status=status.HTTP_200_OK)

        content = ((request.data or {}).get("content") or (request.data or {}).get("text") or "").strip()
        if not content:
            return Response({"detail": "content is required."}, status=status.HTTP_400_BAD_REQUEST)

        serializer = MilestoneCommentSerializer(data={"milestone": milestone.pk, "content": content})
        serializer.is_valid(raise_exception=True)
        instance = serializer.save(author=request.user)
        out = MilestoneCommentSerializer(instance).data
        return Response(out, status=status.HTTP_201_CREATED)

    @action(detail=True, methods=["post"], url_path="public-request-descope", permission_classes=[AllowAny])
    def public_request_descope(self, request, pk=None):
        milestone = get_object_or_404(Milestone.objects.select_related("agreement"), pk=pk)
        agreement = milestone.agreement

        _ensure_descope_fields_exist(milestone)

        agreement_token = str((request.data or {}).get("agreement_token") or "").strip()
        if not agreement_token:
            return Response({"detail": "agreement_token is required."}, status=status.HTTP_400_BAD_REQUEST)

        if str(getattr(agreement, "homeowner_access_token", "")).strip() != agreement_token:
            return Response({"detail": "Invalid agreement_token."}, status=status.HTTP_403_FORBIDDEN)

        if not getattr(agreement, "escrow_funded", False):
            return Response({"detail": "Escrow is not funded for this agreement."}, status=status.HTTP_400_BAD_REQUEST)

        if _milestone_looks_started(milestone):
            return Response(
                {"detail": "This milestone appears started/invoiced. Please open a dispute for changes/refunds."},
                status=status.HTTP_400_BAD_REQUEST,
            )

        if getattr(milestone, "descope_status", "") in ("requested", "approved", "refunded"):
            return Response({"detail": f"Descope already in progress (status={milestone.descope_status})."}, status=status.HTTP_200_OK)

        reason = str((request.data or {}).get("reason") or "").strip()

        with transaction.atomic():
            milestone = Milestone.objects.select_for_update().get(pk=milestone.pk)
            milestone.descope_status = "requested"
            milestone.descope_requested_at = timezone.now()
            milestone.descope_reason = reason
            milestone.save(update_fields=["descope_status", "descope_requested_at", "descope_reason"])

        return Response(MilestoneSerializer(milestone, context={"request": request}).data, status=status.HTTP_200_OK)

    @action(detail=True, methods=["post"], url_path="approve-descope")
    def approve_descope(self, request, pk=None):
        milestone: Milestone = self.get_object()
        _ensure_descope_fields_exist(milestone)

        if milestone.descope_status != "requested":
            return Response({"detail": "No active descope request for this milestone."}, status=status.HTTP_400_BAD_REQUEST)

        decision_note = str((request.data or {}).get("decision_note") or "").strip()

        try:
            result = _refund_single_milestone_via_agreement_engine(
                request_user=request.user,
                milestone=milestone,
                reason=decision_note,
            )
        except ValueError as e:
            return Response({"detail": str(e)}, status=status.HTTP_400_BAD_REQUEST)
        except Exception as e:
            logger.exception("approve_descope failed: %s", e)
            return Response({"detail": "Unable to approve descope/refund."}, status=status.HTTP_500_INTERNAL_SERVER_ERROR)

        return Response(
            {
                "ok": True,
                "milestone": MilestoneSerializer(milestone, context={"request": request}).data,
                "refund_cents": result.get("refund_cents"),
                "stripe_refund_id": result.get("stripe_refund_id"),
            },
            status=status.HTTP_200_OK,
        )

    @action(detail=True, methods=["post"], url_path="reject-descope")
    def reject_descope(self, request, pk=None):
        milestone: Milestone = self.get_object()
        _ensure_descope_fields_exist(milestone)

        if milestone.descope_status != "requested":
            return Response({"detail": "No active descope request to reject."}, status=status.HTTP_400_BAD_REQUEST)

        note = str((request.data or {}).get("decision_note") or "").strip()

        with transaction.atomic():
            milestone = Milestone.objects.select_for_update().get(pk=milestone.pk)
            milestone.descope_status = "rejected"
            milestone.descope_decision_at = timezone.now()
            milestone.descope_decision_note = note
            milestone.save(update_fields=["descope_status", "descope_decision_at", "descope_decision_note"])

        return Response(MilestoneSerializer(milestone, context={"request": request}).data, status=status.HTTP_200_OK)

    @action(detail=True, methods=["post"], url_path="descope-refund")
    def descope_refund(self, request, pk=None):
        milestone: Milestone = self.get_object()
        _ensure_descope_fields_exist(milestone)

        reason = str((request.data or {}).get("reason") or "").strip()

        try:
            result = _refund_single_milestone_via_agreement_engine(
                request_user=request.user,
                milestone=milestone,
                reason=reason,
            )
        except ValueError as e:
            return Response({"detail": str(e)}, status=status.HTTP_400_BAD_REQUEST)
        except Exception as e:
            logger.exception("descope_refund failed: %s", e)
            return Response({"detail": "Unable to process descope refund."}, status=status.HTTP_500_INTERNAL_SERVER_ERROR)

        return Response(
            {
                "ok": True,
                "milestone": MilestoneSerializer(milestone, context={"request": request}).data,
                "refund_cents": result.get("refund_cents"),
                "stripe_refund_id": result.get("stripe_refund_id"),
                "already_refunded": bool(result.get("already_refunded")),
            },
            status=status.HTTP_200_OK,
        )


class MilestoneFileViewSet(viewsets.ModelViewSet):
    permission_classes = [IsAuthenticated, IsContractorOrSubAccount]
    serializer_class = MilestoneFileSerializer
    queryset = MilestoneFile.objects.select_related("milestone").all()

    def get_queryset(self):
        contractor = get_contractor_for_user(self.request.user)
        if contractor is None:
            return MilestoneFile.objects.none()
        return (
            MilestoneFile.objects
            .select_related("milestone", "milestone__agreement", "milestone__agreement__project")
            .filter(milestone__agreement__project__contractor=contractor)
            .order_by("-uploaded_at", "-id")
        )

    def perform_create(self, serializer):
        serializer.save(uploaded_by=self.request.user)


class MilestoneCommentViewSet(viewsets.ModelViewSet):
    permission_classes = [IsAuthenticated, IsContractorOrSubAccount]
    serializer_class = MilestoneCommentSerializer
    queryset = MilestoneComment.objects.select_related("milestone").all()

    def get_queryset(self):
        contractor = get_contractor_for_user(self.request.user)
        if contractor is None:
            return MilestoneComment.objects.none()
        return (
            MilestoneComment.objects
            .select_related("milestone", "milestone__agreement", "milestone__agreement__project")
            .filter(milestone__agreement__project__contractor=contractor)
            .order_by("-created_at", "-id")
        )

    def perform_create(self, serializer):
        serializer.save(author=self.request.user)
