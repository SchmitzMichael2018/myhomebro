# backend/projects/services/agreement_completion.py
# v2026-02-23 — Canonical Agreement completion logic (policy-aware)
#
# v2026-03-05 — FIX: exclude escrow funding/deposit invoices from completion checks
#
# Agreement is COMPLETED only when:
#  - All milestones are invoiced (invoice link exists / is_invoiced)
#  - All MILESTONE invoices are paid (escrow released/transfer OR status paid; direct paid_at/status paid)

from __future__ import annotations

from dataclasses import dataclass
from typing import Tuple

from django.db import transaction
from django.utils import timezone

from projects.models import Agreement, Milestone, Invoice, ProjectStatus


def _s(v) -> str:
    return (v or "").strip().lower()


def _agreement_mode(agreement: Agreement) -> str:
    # "escrow" | "direct"
    mode = _s(getattr(agreement, "payment_mode", "") or "escrow")
    return mode if mode in ("escrow", "direct") else "escrow"


def _invoice_is_system_funding_invoice(inv: Invoice) -> bool:
    """
    Return True for invoices that represent escrow funding/deposit payments,
    NOT actual milestone work invoices.

    We exclude these from agreement completion calculations.
    """
    # If invoice is tied to a milestone snapshot, it's a milestone invoice.
    ms_id = getattr(inv, "milestone_id_snapshot", None)
    if ms_id is not None:
        try:
            if int(ms_id) > 0:
                return False
        except Exception:
            # if it's not int-like but exists, assume milestone-linked
            return False

    title = _s(getattr(inv, "milestone_title_snapshot", "") or "")
    if not title:
        # No milestone snapshot and no title — treat as system/non-milestone.
        return True

    # Explicit funding/deposit markers
    if title in ("escrow funding deposit", "escrow funding payment", "escrow deposit", "escrow funding"):
        return True

    # Conservative: anything that starts with "escrow funding" is system funding
    if title.startswith("escrow funding"):
        return True

    return False


def _invoice_is_paid(inv: Invoice, *, mode: str) -> bool:
    """
    Paid rules:
      - Escrow:
          Prefer escrow_released / escrow_released_at / stripe_transfer_id.
          We also accept status == paid for milestone invoices if you mark them paid
          only when release happens.
      - Direct: status == paid OR direct_pay_paid_at exists
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

    # Conservative: do NOT treat payment_intent_id as paid by itself.
    return False


def _milestone_is_invoiced(m: Milestone) -> bool:
    if getattr(m, "is_invoiced", False):
        return True
    if getattr(m, "invoice_id", None):
        return True
    return False


@dataclass
class CompletionCheck:
    ok: bool
    reason: str
    milestones_total: int
    milestones_invoiced: int
    invoices_total: int
    invoices_paid: int
    mode: str


def check_agreement_completion(agreement: Agreement) -> CompletionCheck:
    mode = _agreement_mode(agreement)

    milestones = list(Milestone.objects.filter(agreement=agreement).only("id", "is_invoiced", "invoice_id"))

    # Only milestone invoices should participate in completion logic
    all_invoices = list(
        Invoice.objects.filter(agreement=agreement).only(
            "id",
            "status",
            "escrow_released",
            "escrow_released_at",
            "stripe_transfer_id",
            "direct_pay_paid_at",
            "milestone_id_snapshot",
            "milestone_title_snapshot",
        )
    )
    invoices = [inv for inv in all_invoices if not _invoice_is_system_funding_invoice(inv)]

    ms_total = len(milestones)
    inv_total = len(invoices)

    ms_invoiced = sum(1 for m in milestones if _milestone_is_invoiced(m))
    inv_paid = sum(1 for inv in invoices if _invoice_is_paid(inv, mode=mode))

    if ms_total == 0:
        return CompletionCheck(
            ok=False,
            reason="Agreement has no milestones.",
            milestones_total=0,
            milestones_invoiced=0,
            invoices_total=inv_total,
            invoices_paid=inv_paid,
            mode=mode,
        )

    if ms_invoiced < ms_total:
        return CompletionCheck(
            ok=False,
            reason="Not all milestones are invoiced yet.",
            milestones_total=ms_total,
            milestones_invoiced=ms_invoiced,
            invoices_total=inv_total,
            invoices_paid=inv_paid,
            mode=mode,
        )

    # If milestones are invoiced, milestone invoices should exist too, but handle defensively.
    if inv_total == 0:
        return CompletionCheck(
            ok=False,
            reason="No milestone invoices exist yet for this agreement.",
            milestones_total=ms_total,
            milestones_invoiced=ms_invoiced,
            invoices_total=0,
            invoices_paid=0,
            mode=mode,
        )

    if inv_paid < inv_total:
        return CompletionCheck(
            ok=False,
            reason="Not all milestone invoices are paid/released yet.",
            milestones_total=ms_total,
            milestones_invoiced=ms_invoiced,
            invoices_total=inv_total,
            invoices_paid=inv_paid,
            mode=mode,
        )

    return CompletionCheck(
        ok=True,
        reason="Agreement is eligible to be completed.",
        milestones_total=ms_total,
        milestones_invoiced=ms_invoiced,
        invoices_total=inv_total,
        invoices_paid=inv_paid,
        mode=mode,
    )


def recompute_and_apply_agreement_completion(agreement_id: int) -> Tuple[bool, CompletionCheck]:
    """
    Idempotent:
      - If eligible and not already completed: marks agreement COMPLETED
      - If not eligible: does nothing
    Returns (changed_to_completed, check)
    """
    with transaction.atomic():
        ag = Agreement.objects.select_for_update().get(pk=agreement_id)

        check = check_agreement_completion(ag)
        if not check.ok:
            return (False, check)

        if ag.status == ProjectStatus.COMPLETED:
            transaction.on_commit(lambda: _refresh_learning_snapshot(int(ag.id)))
            return (False, check)

        # Only advance forward; do not override CANCELLED
        if ag.status == ProjectStatus.CANCELLED:
            return (
                False,
                CompletionCheck(
                    ok=False,
                    reason="Agreement is cancelled; cannot mark completed.",
                    milestones_total=check.milestones_total,
                    milestones_invoiced=check.milestones_invoiced,
                    invoices_total=check.invoices_total,
                    invoices_paid=check.invoices_paid,
                    mode=check.mode,
                ),
            )

        ag.status = ProjectStatus.COMPLETED
        if hasattr(ag, "completed_at"):
            ag.completed_at = timezone.now()

        fields = ["status"]
        if hasattr(ag, "completed_at"):
            fields.append("completed_at")
        ag.save(update_fields=fields)
        transaction.on_commit(lambda: _refresh_learning_snapshot(int(ag.id)))

        return (True, check)


def _refresh_learning_snapshot(agreement_id: int) -> None:
    from projects.services.project_learning import on_agreement_completed

    on_agreement_completed(int(agreement_id))
