from __future__ import annotations

from decimal import Decimal, ROUND_HALF_UP

from django.conf import settings
from django.core.management.base import BaseCommand
from django.db import transaction, models

import stripe

from projects.models import Invoice


def _to_cents(amount) -> int:
    return int(
        (Decimal(str(amount or "0")) * Decimal("100"))
        .quantize(Decimal("1"), rounding=ROUND_HALF_UP)
    )


class Command(BaseCommand):
    help = "Backfill platform_fee_cents and payout_cents on invoices using Stripe Transfer metadata."

    def add_arguments(self, parser):
        parser.add_argument("--dry-run", action="store_true", help="Print changes but do not write to DB.")
        parser.add_argument("--invoice-id", type=int, default=None, help="Backfill only one invoice by DB id.")
        parser.add_argument("--limit", type=int, default=500, help="Max number of invoices to process.")
        parser.add_argument(
            "--only-missing",
            action="store_true",
            help="Only update invoices where platform_fee_cents==0 OR payout_cents==0 (default behavior).",
        )

    def handle(self, *args, **opts):
        stripe.api_key = settings.STRIPE_SECRET_KEY

        dry_run = bool(opts["dry_run"])
        invoice_id = opts["invoice_id"]
        limit = int(opts["limit"])
        only_missing = bool(opts["only_missing"])

        sample = Invoice.objects.order_by("-id").first()
        if not sample:
            self.stdout.write("No invoices found.")
            return

        if not hasattr(sample, "platform_fee_cents") or not hasattr(sample, "payout_cents"):
            self.stdout.write(
                self.style.ERROR(
                    "Invoice model is missing platform_fee_cents and/or payout_cents. Apply the migration first."
                )
            )
            return

        qs = Invoice.objects.filter(escrow_released=True).exclude(stripe_transfer_id="").order_by("-id")

        if invoice_id:
            qs = qs.filter(id=invoice_id)

        if only_missing:
            qs = qs.filter(models.Q(platform_fee_cents=0) | models.Q(payout_cents=0))

        qs = qs[:limit]

        processed = 0
        updated = 0
        skipped = 0
        errors = 0

        for inv in qs:
            processed += 1

            transfer_id = (inv.stripe_transfer_id or "").strip()
            if not transfer_id:
                skipped += 1
                continue

            try:
                tr = stripe.Transfer.retrieve(transfer_id)
            except Exception as e:
                errors += 1
                self.stdout.write(self.style.ERROR(f"[ERROR] Invoice {inv.id}: could not retrieve transfer {transfer_id}: {e}"))
                continue

            md = getattr(tr, "metadata", {}) or {}
            md_fee = md.get("platform_fee_cents")
            md_payout = md.get("payout_cents")

            amount_cents = _to_cents(inv.amount)
            transfer_amount_cents = int(getattr(tr, "amount", 0) or 0)

            fee_cents = None
            payout_cents = None

            if md_payout is not None:
                try:
                    payout_cents = int(md_payout)
                except Exception:
                    payout_cents = None

            if md_fee is not None:
                try:
                    fee_cents = int(md_fee)
                except Exception:
                    fee_cents = None

            if payout_cents is None and transfer_amount_cents > 0:
                payout_cents = transfer_amount_cents

            if fee_cents is None and payout_cents is not None and amount_cents > 0:
                fee_cents = max(amount_cents - payout_cents, 0)

            if payout_cents is None or fee_cents is None:
                errors += 1
                self.stdout.write(self.style.ERROR(f"[ERROR] Invoice {inv.id}: unable to derive fee/payout."))
                continue

            will_update = (inv.platform_fee_cents != fee_cents) or (inv.payout_cents != payout_cents)
            if not will_update:
                skipped += 1
                continue

            self.stdout.write(
                self.style.SUCCESS(
                    f"[UPDATE] Invoice {inv.id} {inv.invoice_number} "
                    f"fee {inv.platform_fee_cents}→{fee_cents} "
                    f"payout {inv.payout_cents}→{payout_cents} "
                    f"(transfer {transfer_id})"
                )
            )

            if dry_run:
                updated += 1
                continue

            try:
                with transaction.atomic():
                    inv.platform_fee_cents = int(fee_cents)
                    inv.payout_cents = int(payout_cents)
                    inv.save(update_fields=["platform_fee_cents", "payout_cents"])
                updated += 1
            except Exception as e:
                errors += 1
                self.stdout.write(self.style.ERROR(f"[ERROR] Invoice {inv.id}: DB save failed: {e}"))

        self.stdout.write("")
        self.stdout.write(self.style.MIGRATE_HEADING("Backfill Summary"))
        self.stdout.write(f"Processed: {processed}")
        self.stdout.write(f"Updated:   {updated}{' (dry-run)' if dry_run else ''}")
        self.stdout.write(f"Skipped:   {skipped}")
        self.stdout.write(f"Errors:    {errors}")
