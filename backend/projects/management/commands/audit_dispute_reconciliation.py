from django.core.management.base import BaseCommand, CommandError

from projects.models_dispute import Dispute, DisputePaymentHold
from projects.services.dispute_status import is_terminal_dispute_status


class Command(BaseCommand):
    help = "Audit dispute, payment-hold, invoice, and allocation state without moving money."

    def add_arguments(self, parser):
        parser.add_argument("--fail-on-warning", action="store_true")

    def handle(self, *args, **options):
        warnings = []
        disputes = Dispute.objects.select_related("payment_hold", "payment_request", "milestone").prefetch_related("escrow_allocations")
        for dispute in disputes.iterator(chunk_size=200):
            try:
                hold = dispute.payment_hold
            except DisputePaymentHold.DoesNotExist:
                hold = None
            hold_active = bool(hold and hold.is_active)
            if bool(dispute.escrow_frozen) != hold_active:
                warnings.append(f"dispute={dispute.id} escrow_frozen={dispute.escrow_frozen} hold_active={hold_active}")
            if is_terminal_dispute_status(dispute.status) and hold_active:
                warnings.append(f"dispute={dispute.id} terminal_status={dispute.status} still_has_active_hold")
            invoice = dispute.payment_request
            if invoice is None and dispute.milestone_id:
                try:
                    invoice = dispute.milestone.invoice
                except Exception:
                    invoice = None
            if invoice is not None and hold_active and (getattr(invoice, "escrow_released", False) or str(getattr(invoice, "status", "")).lower() == "paid"):
                warnings.append(f"dispute={dispute.id} active_hold_conflicts_with_released_invoice={invoice.id}")
            for allocation in dispute.escrow_allocations.all():
                if allocation.contractor_amount_cents + allocation.homeowner_amount_cents != allocation.source_amount_cents:
                    warnings.append(f"dispute={dispute.id} allocation={allocation.id} is_not_balanced")
                if hold and allocation.source_amount_cents != hold.amount_cents:
                    warnings.append(f"dispute={dispute.id} allocation={allocation.id} differs_from_hold_amount")

        if warnings:
            for warning in warnings:
                self.stdout.write(self.style.WARNING(warning))
            if options["fail_on_warning"]:
                raise CommandError(f"Dispute reconciliation found {len(warnings)} warning(s).")
        self.stdout.write(self.style.SUCCESS(f"audit_dispute_reconciliation: checked={disputes.count()} warnings={len(warnings)} money_moved=0"))
