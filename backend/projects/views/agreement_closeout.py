# backend/projects/views/agreement_closeout.py
# v2026-02-23 — Fix: Agreement COMPLETED only when all milestones invoiced + all invoices paid/released
#
# Changes vs prior:
# - Removes "all milestones completed" requirement (invoicing already implies completion in your schema)
# - Supports DIRECT pay "paid" via (status == paid) OR direct_pay_paid_at
# - Does NOT force COMPLETED unless eligible by canonical rules
# - Uses projects.services.agreement_completion as source of truth

from __future__ import annotations

from django.utils import timezone
from django.shortcuts import get_object_or_404

from rest_framework.views import APIView
from rest_framework.response import Response
from rest_framework.permissions import IsAuthenticated

from projects.models import Agreement, Invoice, Milestone, Contractor, ProjectStatus
from projects.services.agreement_completion import (
    check_agreement_completion,
    recompute_and_apply_agreement_completion,
)


def _s(v) -> str:
    return (v or "").strip().lower()


def _agreement_mode(agreement: Agreement) -> str:
    mode = _s(getattr(agreement, "payment_mode", "") or "escrow")
    return mode if mode in ("escrow", "direct") else "escrow"


def _is_invoice_paid(inv: Invoice, *, mode: str) -> bool:
    """
    Paid rules:
      - Escrow: status=paid OR escrow_released True OR escrow_released_at OR stripe_transfer_id present
      - Direct: status=paid OR direct_pay_paid_at present
    """
    st = _s(getattr(inv, "status", ""))

    if st == "paid":
        return True

    if mode == "escrow":
        if bool(getattr(inv, "escrow_released", False)):
            return True
        if getattr(inv, "escrow_released_at", None):
            return True
        if (getattr(inv, "stripe_transfer_id", "") or "").strip():
            return True
        return False

    # direct
    if getattr(inv, "direct_pay_paid_at", None):
        return True
    return False


def _closure_status(agreement: Agreement) -> dict:
    """
    Agreement is eligible to close+archive if:
      - has >= 1 milestone
      - ALL milestones are invoiced and have invoice link
      - ALL invoices are paid (escrow released/paid OR direct paid)
      - NO disputed invoices (recommended safety)
    """
    reasons = []
    totals = {
        "milestones_total": 0,
        "milestones_invoiced": 0,
        "milestones_missing_invoice_links": 0,
        "invoices_total": 0,
        "invoices_paid": 0,
        "invoices_disputed": 0,
        "mode": _agreement_mode(agreement),
    }

    ms_qs = Milestone.objects.filter(agreement=agreement)
    inv_qs = Invoice.objects.filter(agreement=agreement)

    totals["milestones_total"] = ms_qs.count()
    totals["milestones_invoiced"] = ms_qs.filter(is_invoiced=True).count()
    totals["milestones_missing_invoice_links"] = ms_qs.filter(is_invoiced=True, invoice__isnull=True).count()

    totals["invoices_total"] = inv_qs.count()
    totals["invoices_disputed"] = inv_qs.filter(disputed=True).count()
    totals["invoices_paid"] = sum(
        1 for inv in inv_qs.only("status", "escrow_released", "escrow_released_at", "stripe_transfer_id", "direct_pay_paid_at")
        if _is_invoice_paid(inv, mode=totals["mode"])
    )

    # Rule checks
    if totals["milestones_total"] <= 0:
        reasons.append("Agreement has no milestones yet.")

    if totals["milestones_total"] > 0:
        not_invoiced_count = ms_qs.filter(is_invoiced=False).count()
        if not_invoiced_count > 0:
            reasons.append("Not all milestones have been invoiced.")
        if totals["milestones_missing_invoice_links"] > 0:
            reasons.append("One or more invoiced milestones are missing an invoice link.")

    if totals["invoices_total"] <= 0:
        reasons.append("Agreement has no invoices yet.")
    else:
        if totals["invoices_paid"] != totals["invoices_total"]:
            reasons.append("Not all invoices are paid/released.")
        if totals["invoices_disputed"] > 0:
            reasons.append("Agreement has disputed invoices.")

    eligible = (len(reasons) == 0)

    return {
        "agreement_id": agreement.id,
        "already_completed": (agreement.status == ProjectStatus.COMPLETED),
        "already_archived": bool(getattr(agreement, "is_archived", False)),
        "eligible": eligible,
        "reasons": reasons,
        "totals": totals,
    }


class AgreementClosureStatusView(APIView):
    """
    GET /api/projects/agreements/<agreement_id>/closure_status/
    """
    permission_classes = [IsAuthenticated]

    def get(self, request, agreement_id: int):
        try:
            contractor = request.user.contractor_profile
        except Contractor.DoesNotExist:
            return Response({"detail": "Contractor profile not found."}, status=400)

        agreement = get_object_or_404(Agreement, id=agreement_id, contractor=contractor)

        # Also include canonical completion service result (source of truth)
        chk = check_agreement_completion(agreement)

        data = _closure_status(agreement)
        data["completion_check"] = {
            "ok": chk.ok,
            "reason": chk.reason,
            "mode": chk.mode,
            "milestones_total": chk.milestones_total,
            "milestones_invoiced": chk.milestones_invoiced,
            "invoices_total": chk.invoices_total,
            "invoices_paid": chk.invoices_paid,
        }
        return Response(data)


class AgreementCloseAndArchiveView(APIView):
    """
    POST /api/projects/agreements/<agreement_id>/close_and_archive/

    If eligible:
      - mark Agreement COMPLETED (ONLY if completion rules are met)
      - set Agreement.end=today if blank
      - set Agreement.is_archived=True
      - append audit line to signature_log
    """
    permission_classes = [IsAuthenticated]

    def post(self, request, agreement_id: int):
        try:
            contractor = request.user.contractor_profile
        except Contractor.DoesNotExist:
            return Response({"detail": "Contractor profile not found."}, status=400)

        agreement = get_object_or_404(Agreement, id=agreement_id, contractor=contractor)

        # Canonical check
        chk = check_agreement_completion(agreement)

        # Optional: keep the older totals/reasons payload for UI, but the service is the gate.
        status_payload = _closure_status(agreement)

        if not chk.ok:
            return Response(
                {
                    "detail": "Agreement is not eligible to close/archive yet.",
                    "code": "AGREEMENT_NOT_ELIGIBLE_FOR_COMPLETION",
                    "completion_check": {
                        "ok": chk.ok,
                        "reason": chk.reason,
                        "mode": chk.mode,
                        "milestones_total": chk.milestones_total,
                        "milestones_invoiced": chk.milestones_invoiced,
                        "invoices_total": chk.invoices_total,
                        "invoices_paid": chk.invoices_paid,
                    },
                    **status_payload,
                },
                status=409,
            )

        # Mark completed idempotently (service does not override CANCELLED)
        changed_to_completed, chk2 = recompute_and_apply_agreement_completion(agreement.id)

        # Refresh agreement for state updates
        agreement.refresh_from_db()

        now = timezone.now()
        today = now.date()
        changed_fields = []

        if not agreement.end:
            agreement.end = today
            changed_fields.append("end")

        if not getattr(agreement, "is_archived", False):
            agreement.is_archived = True
            changed_fields.append("is_archived")

        # Append audit note (lightweight)
        audit_line = (
            f"[{now.isoformat()}] Close & archive requested by contractor user_id={request.user.id} "
            f"email={getattr(request.user, 'email', '')} changed_to_completed={changed_to_completed}\n"
        )
        existing_log = agreement.signature_log or ""
        agreement.signature_log = (existing_log + audit_line)
        changed_fields.append("signature_log")

        agreement.save(update_fields=list(set(changed_fields)) if changed_fields else None)

        refreshed = _closure_status(agreement)
        refreshed["completion_check"] = {
            "ok": chk2.ok,
            "reason": chk2.reason,
            "mode": chk2.mode,
            "milestones_total": chk2.milestones_total,
            "milestones_invoiced": chk2.milestones_invoiced,
            "invoices_total": chk2.invoices_total,
            "invoices_paid": chk2.invoices_paid,
        }

        return Response(
            {
                "detail": "Agreement closed and archived.",
                "changed_to_completed": changed_to_completed,
                **refreshed,
            }
        )