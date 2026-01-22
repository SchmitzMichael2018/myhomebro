# backend/projects/views/agreement_closeout.py
from __future__ import annotations

from django.utils import timezone
from django.shortcuts import get_object_or_404

from rest_framework.views import APIView
from rest_framework.response import Response
from rest_framework.permissions import IsAuthenticated

from projects.models import Agreement, Invoice, Milestone, Contractor, ProjectStatus


def _is_invoice_paid(inv: Invoice) -> bool:
    # Robust: treat either paid status OR escrow_released as paid-out
    return (inv.status == "paid") or bool(inv.escrow_released)


def _closure_status(agreement: Agreement) -> dict:
    """
    Agreement is eligible to close+archive if:
      - has >= 1 milestone
      - ALL milestones completed=True
      - ALL milestones is_invoiced=True AND invoice is set
      - ALL invoices for agreement are paid (status=paid OR escrow_released=True)
      - NO disputed invoices (optional, but wise)
    """
    reasons = []
    totals = {
        "milestones_total": 0,
        "milestones_completed": 0,
        "milestones_invoiced": 0,
        "invoices_total": 0,
        "invoices_paid": 0,
        "invoices_disputed": 0,
    }

    ms_qs = Milestone.objects.filter(agreement=agreement)
    inv_qs = Invoice.objects.filter(agreement=agreement)

    totals["milestones_total"] = ms_qs.count()
    totals["milestones_completed"] = ms_qs.filter(completed=True).count()
    totals["milestones_invoiced"] = ms_qs.filter(is_invoiced=True).count()
    totals["invoices_total"] = inv_qs.count()
    totals["invoices_disputed"] = inv_qs.filter(disputed=True).count()
    totals["invoices_paid"] = sum(1 for inv in inv_qs.only("status", "escrow_released") if _is_invoice_paid(inv))

    # Rule checks
    if totals["milestones_total"] <= 0:
        reasons.append("Agreement has no milestones yet.")

    if totals["milestones_total"] > 0 and totals["milestones_completed"] != totals["milestones_total"]:
        reasons.append("Not all milestones are completed.")

    # Invoicing: require milestone is_invoiced and a linked invoice id
    # (Your schema enforces invoice link consistency, but we check anyway.)
    if totals["milestones_total"] > 0:
        missing_invoice_links = ms_qs.filter(is_invoiced=True, invoice__isnull=True).count()
        not_invoiced_count = ms_qs.filter(is_invoiced=False).count()

        if not_invoiced_count > 0:
            reasons.append("Not all milestones have been invoiced.")
        if missing_invoice_links > 0:
            reasons.append("One or more invoiced milestones are missing an invoice link.")

    if totals["invoices_total"] <= 0:
        reasons.append("Agreement has no invoices yet.")
    else:
        if totals["invoices_paid"] != totals["invoices_total"]:
            reasons.append("Not all invoices are paid/released.")
        if totals["invoices_disputed"] > 0:
            reasons.append("Agreement has disputed invoices.")

    eligible = (len(reasons) == 0)

    # Helpful derived status
    derived = {
        "agreement_id": agreement.id,
        "already_completed": (agreement.status == ProjectStatus.COMPLETED),
        "already_archived": bool(agreement.is_archived),
        "eligible": eligible,
        "reasons": reasons,
        "totals": totals,
    }
    return derived


class AgreementClosureStatusView(APIView):
    """
    GET /api/projects/agreements/<agreement_id>/closure_status/
    """
    permission_classes = [IsAuthenticated]

    def get(self, request, agreement_id: int):
        # Contractor scope (owner-only)
        try:
            contractor = request.user.contractor_profile
        except Contractor.DoesNotExist:
            return Response({"detail": "Contractor profile not found."}, status=400)

        agreement = get_object_or_404(Agreement, id=agreement_id, contractor=contractor)
        data = _closure_status(agreement)
        return Response(data)


class AgreementCloseAndArchiveView(APIView):
    """
    POST /api/projects/agreements/<agreement_id>/close_and_archive/

    If eligible:
      - set Agreement.status=COMPLETED
      - set Agreement.end=today if blank
      - set Agreement.is_archived=True
      - append a simple audit line to signature_log
    """
    permission_classes = [IsAuthenticated]

    def post(self, request, agreement_id: int):
        try:
            contractor = request.user.contractor_profile
        except Contractor.DoesNotExist:
            return Response({"detail": "Contractor profile not found."}, status=400)

        agreement = get_object_or_404(Agreement, id=agreement_id, contractor=contractor)

        status_payload = _closure_status(agreement)
        if not status_payload["eligible"]:
            return Response(
                {
                    "detail": "Agreement is not eligible to close/archve yet.",
                    **status_payload,
                },
                status=400,
            )

        # Idempotent: if already archived/completed, just return success
        now = timezone.now()
        today = now.date()

        changed_fields = []

        if agreement.status != ProjectStatus.COMPLETED:
            agreement.status = ProjectStatus.COMPLETED
            changed_fields.append("status")

        if not agreement.end:
            agreement.end = today
            changed_fields.append("end")

        if not agreement.is_archived:
            agreement.is_archived = True
            changed_fields.append("is_archived")

        # Append audit note (lightweight)
        audit_line = f"[{now.isoformat()}] Closed & archived by contractor user_id={request.user.id} email={getattr(request.user, 'email', '')}\n"
        existing_log = agreement.signature_log or ""
        agreement.signature_log = (existing_log + audit_line)
        changed_fields.append("signature_log")

        # Always update updated_at; model has auto_now=True so save() will do it
        agreement.save(update_fields=list(set(changed_fields)) if changed_fields else None)

        # Return fresh status
        refreshed = _closure_status(agreement)
        return Response(
            {
                "detail": "Agreement closed and archived.",
                **refreshed,
            }
        )
