# backend/projects/views/milestone.py
# v2026-01-01 — Unify milestone refund behavior with agreement refund endpoints
#
# v2026-01-05 — Employee milestone visibility fix (robust)
# - If user resolves to a contractor -> contractor-scoped milestones (unchanged)
# - If not -> treat as subaccount and show ONLY milestones assigned to that user
# - Adds /my-assigned/ debug endpoint for quick verification
#
# v2026-01-25 — Bulk AI milestone creation + auto-spread amounts
# - POST /api/projects/milestones/bulk-ai-create/
# - Single request to create suggested milestones
# - Optional spread_total across milestones with rounding safety
# - Mode replace/append

from __future__ import annotations

import logging
import os
from decimal import Decimal, InvalidOperation, ROUND_HALF_UP
from typing import List, Dict, Any, Optional

from django.conf import settings
from django.db import IntegrityError, transaction
from django.db.models import Max, Q
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
)
from projects.serializers.milestone import MilestoneSerializer
from projects.serializers.milestone_file import MilestoneFileSerializer
from projects.serializers.milestone_comment import MilestoneCommentSerializer
from projects.serializers.invoices import InvoiceSerializer
from projects.permissions_subaccounts import IsContractorOrSubAccount, CanEditMilestones
from projects.utils.accounts import get_contractor_for_user

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

    # Work in cents to guarantee exactness
    total_cents = int((total * 100).to_integral_value(rounding=ROUND_HALF_UP))
    base = total_cents // n
    rem = total_cents % n

    cents = [base + (1 if i < rem else 0) for i in range(n)]
    return [Decimal(c) / Decimal(100) for c in cents]


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
    """
    Released = invoices with escrow_released True OR stripe_transfer_id present.
    Sum invoice.amount for released invoices.
    """
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
    """
    Funded total = Agreement.escrow_funded_amount (your canonical field).
    """
    if hasattr(agreement, "escrow_funded_amount"):
        return _money_to_cents(getattr(agreement, "escrow_funded_amount", 0))
    return 0


def _unreleased_total_cents_for_agreement(agreement) -> int:
    funded = _funded_total_cents_for_agreement(agreement)
    released = _released_total_cents_for_agreement(agreement)
    return max(0, funded - released)


def _milestone_looks_started(m: Milestone) -> bool:
    """
    'Started' for refund safety = completed OR invoiced OR invoice linked.
    """
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
    """
    Unified refund engine:
    - Only refunds THIS milestone
    - Caps by DB unreleased escrow remaining
    - Caps by Stripe remaining refundable
    - Uses PaymentIntent refund (platform-controlled)
    - Marks milestone descope_status='refunded' (if fields exist)
    """
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


# ----------------------------- viewsets ----------------------------- #
class MilestoneViewSet(viewsets.ModelViewSet):
    permission_classes = [IsAuthenticated, IsContractorOrSubAccount, CanEditMilestones]
    serializer_class = MilestoneSerializer
    queryset = Milestone.objects.select_related("agreement").all()

    def _assigned_queryset_for_user(self, user):
        """
        Build a safe assignment filter without assuming your exact schema.
        Supports:
          - assigned_to (User)
          - assigned_user (User)
          - assigned_employee.user (EmployeeProfile -> User)
        """
        assignment_filter = Q(assigned_to=user) | Q(assigned_user=user) | Q(assigned_employee__user=user)

        return (
            Milestone.objects.select_related("agreement", "agreement__project")
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
                .select_related("agreement", "agreement__project")
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
        except IntegrityError as exc:
            logger.exception("IntegrityError creating milestone: %s", exc)
            return Response(
                {"detail": "Unable to create milestone due to a database constraint. Please refresh and try again."},
                status=status.HTTP_400_BAD_REQUEST,
            )

        headers = self.get_success_headers(serializer.data)
        return Response(serializer.data, status=status.HTTP_201_CREATED, headers=headers)

    # ---------------- NEW: bulk AI creation ---------------- #
    @action(detail=False, methods=["post"], url_path="bulk-ai-create")
    def bulk_ai_create(self, request):
        """
        POST /api/projects/milestones/bulk-ai-create/

        Body:
        {
          "agreement_id": 3,
          "mode": "replace" | "append",
          "spread_total": "1250.00",         // optional; if set and strategy == "equal" then spread across milestones
          "spread_strategy": "equal" | "keep_existing_amounts",
          "auto_schedule": false,            // optional; if true and Agreement.start/end set, sequential dates are applied
          "milestones": [
            {"title":"...", "description":"...", "start_date": null, "completion_date": null, "amount": 0},
            ...
          ]
        }

        Recommended behavior (MyHomeBro):
        - AI bulk create should NOT be blocked by overlap validation.
        - By default, AI milestones are scope/pricing drafts (dates may be null).
        - If auto_schedule=true and agreement.start/end exist, we will assign sequential non-overlapping dates.
        """
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

        # Ensure contractor scope (owner) matches agreement.project.contractor
        contractor = get_contractor_for_user(request.user)
        if contractor is None:
            return Response({"detail": "Not authorized."}, status=status.HTTP_403_FORBIDDEN)

        if getattr(agreement, "project", None) is None or getattr(agreement.project, "contractor_id", None) != contractor.id:
            return Response({"detail": "Not authorized for this agreement."}, status=status.HTTP_403_FORBIDDEN)

        # Parse spread_total if provided
        spread_total_raw = payload.get("spread_total", None)
        spread_total: Optional[Decimal] = None
        if spread_total_raw not in (None, "", []):
            try:
                spread_total = _to_decimal_amount(spread_total_raw)
            except Exception:
                spread_total = None

        # Determine ordering start point
        existing_max = (
            Milestone.objects.filter(agreement_id=ag_id)
            .aggregate(Max("order"))["order__max"]
            or 0
        )
        next_order = 1 if mode == "replace" else (existing_max + 1)

        # If replace, delete existing milestones (ONLY if they have NOT been invoiced/started)
        with transaction.atomic():
            if mode == "replace":
                existing = list(Milestone.objects.select_for_update().filter(agreement_id=ag_id))
                started = [m.id for m in existing if _milestone_looks_started(m)]
                if started:
                    return Response(
                        {"detail": f"Cannot replace milestones because some milestones are started/invoiced: {started}"},
                        status=status.HTTP_400_BAD_REQUEST,
                    )
                Milestone.objects.filter(agreement_id=ag_id).delete()
                next_order = 1

            # Prepare amounts
            n = len(milestones_in)
            if spread_total is not None and spread_strategy == "equal":
                amounts = _spread_total_equal(spread_total, n)
            else:
                amounts = [_quantize_money(_to_decimal_amount((m or {}).get("amount"))) for m in milestones_in]

            # Auto-schedule (optional): sequential, non-overlapping date slices from Agreement.start to Agreement.end
            ag_start = getattr(agreement, "start", None)
            ag_end = getattr(agreement, "end", None)

            schedule_pairs: List[tuple[Optional[date], Optional[date]]] = [(None, None)] * n
            if auto_schedule and ag_start and ag_end and isinstance(ag_start, date) and isinstance(ag_end, date) and ag_end >= ag_start and n > 0:
                total_days = (ag_end - ag_start).days
                # Ensure at least 1 day window when possible
                step = max(1, (total_days + 1) // n)  # inclusive-ish
                cur = ag_start
                pairs = []
                for i in range(n):
                    start_i = cur
                    # last milestone ends at ag_end
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

                # Respect explicit dates from client ONLY if auto_schedule is False.
                # If auto_schedule is True, we compute sequential dates.
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
                    # IMPORTANT: Do NOT auto-fill from agreement dates (prevents overlap blocking at Step 2)

                data = {
                    "agreement": ag_id,
                    "order": next_order + idx,
                    "title": title,
                    "description": desc,
                    "amount": str(amounts[idx]),
                    "start_date": start_date,
                    "completion_date": completion_date,

                    # ✅ Critical: AI bulk create should never be blocked by overlap validation.
                    "allow_overlap": True,
                }

                ser = MilestoneSerializer(data=data, context={"request": request})
                ser.is_valid(raise_exception=True)
                obj = ser.save()
                created_objs.append(obj)

        out = MilestoneSerializer(created_objs, many=True, context={"request": request}).data
        return Response({"created": out, "count": len(created_objs)}, status=status.HTTP_201_CREATED)

    # ---------------- existing actions ---------------- #
    @action(detail=True, methods=["post"], url_path="complete")
    def complete(self, request, pk=None):
        milestone: Milestone = self.get_object()

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
                milestone = Milestone.objects.select_for_update().get(pk=milestone.pk)

                if getattr(milestone, "completed", False) is True:
                    return Response(MilestoneSerializer(milestone, context={"request": request}).data, status=status.HTTP_200_OK)

                milestone.completed = True
                update_fields = ["completed"]

                if hasattr(milestone, "completion_notes") and completion_notes:
                    setattr(milestone, "completion_notes", completion_notes)
                    update_fields.append("completion_notes")

                # Track timestamp if your model uses completed_at
                if hasattr(milestone, "completed_at"):
                    milestone.completed_at = timezone.now()
                    update_fields.append("completed_at")

                milestone.save(update_fields=update_fields)

                stamp = timezone.now().strftime("%Y-%m-%d %H:%M:%S %Z")
                base_line = f"[System] Milestone marked complete at {stamp}."
                content = f"{base_line}\n\n{completion_notes}" if completion_notes else base_line
                try:
                    MilestoneComment.objects.create(milestone=milestone, author=request.user, content=content)
                except Exception:
                    pass

                uploaded_files = []
                if hasattr(request, "FILES"):
                    if "file" in request.FILES:
                        uploaded_files.append(request.FILES["file"])
                    if "files" in request.FILES:
                        uploaded_files.extend(request.FILES.getlist("files"))

                for up in uploaded_files:
                    MilestoneFile.objects.create(milestone=milestone, uploaded_by=request.user, file=up)

                milestone.refresh_from_db()

        except Exception as exc:
            logger.exception("Failed to mark milestone %s complete: %s", getattr(milestone, "id", None), exc)
            return Response({"detail": "Unable to mark milestone complete."}, status=status.HTTP_500_INTERNAL_SERVER_ERROR)

        return Response(MilestoneSerializer(milestone, context={"request": request}).data, status=status.HTTP_200_OK)

    @action(detail=True, methods=["post"], url_path="complete-to-review")
    def complete_to_review(self, request, pk=None):
        return self.complete(request, pk=pk)

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

        if not getattr(agreement, "escrow_funded", False):
            return Response(
                {"detail": "Agreement escrow must be funded before invoicing milestones."},
                status=status.HTTP_400_BAD_REQUEST,
            )

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
