from django.db import models
from django.utils.timezone import now


class Receipt(models.Model):
    invoice = models.OneToOneField(
        "projects.Invoice",
        on_delete=models.CASCADE,
        related_name="receipt",
    )

    # Optional but strongly recommended for fast auditing + agreement cap calculations.
    # Backward compatible: null/blank allowed.
    agreement = models.ForeignKey(
        "projects.Agreement",
        on_delete=models.SET_NULL,
        related_name="receipts",
        blank=True,
        null=True,
    )

    receipt_number = models.CharField(max_length=64, unique=True)

    stripe_payment_intent_id = models.CharField(max_length=255)
    stripe_charge_id = models.CharField(max_length=255, blank=True, null=True)

    amount_paid_cents = models.PositiveIntegerField()

    # What you actually charged as platform fee (cents)
    platform_fee_cents = models.PositiveIntegerField(default=0)

    card_brand = models.CharField(max_length=32, blank=True, null=True)
    card_last4 = models.CharField(max_length=4, blank=True, null=True)

    pdf_file = models.FileField(upload_to="receipts/", blank=True, null=True)
    created_at = models.DateTimeField(default=now)

    # Email tracking (already migrated in your DB)
    emailed_at = models.DateTimeField(blank=True, null=True)
    email_last_error = models.TextField(blank=True, null=True)

    # ─────────────────────────────────────────────────────────────
    # Fee audit snapshot (NEW)
    # All fields are nullable to allow a safe migration + backfill.
    # ─────────────────────────────────────────────────────────────

    # Version tag for your fee engine logic
    fee_engine_version = models.CharField(max_length=32, blank=True, null=True)

    # Plan code: intro | tier1 | tier2 | tier3 (+risk suffix optional)
    fee_plan_code = models.CharField(max_length=32, blank=True, null=True)

    # Snapshot of the applied rate + flat fee
    fee_rate = models.DecimalField(max_digits=6, decimal_places=4, blank=True, null=True)
    flat_fee = models.DecimalField(max_digits=6, decimal_places=2, blank=True, null=True)

    # Monthly volume used to determine tier (dollars)
    monthly_volume_used = models.DecimalField(max_digits=12, decimal_places=2, blank=True, null=True)

    # Fee before agreement cap was applied (cents)
    platform_fee_uncapped_cents = models.PositiveIntegerField(blank=True, null=True)

    # Agreement cap snapshot (cents)
    cap_total_cents = models.PositiveIntegerField(blank=True, null=True)
    cap_already_collected_cents = models.PositiveIntegerField(blank=True, null=True)
    cap_remaining_cents = models.PositiveIntegerField(blank=True, null=True)

    # Flags + tier name
    is_intro = models.BooleanField(default=False)
    high_risk_applied = models.BooleanField(default=False)
    tier_name = models.CharField(max_length=16, blank=True, null=True)

    def __str__(self):
        return self.receipt_number

    def generate_pdf(self, *, force: bool = False) -> bool:
        """
        Generate and attach the receipt PDF.
        Returns True if generated, False if skipped.
        """
        if self.pdf_file and self.pdf_file.name and not force:
            return False

        from .pdf import generate_receipt_pdf
        generate_receipt_pdf(self)
        return True

    def send_email_to_homeowner(self, *, force: bool = False) -> bool:
        """
        Email the receipt PDF to the homeowner using receipts/emails.py.
        Idempotent: will not re-send if emailed_at is already set unless force=True.
        """
        if self.emailed_at and not force:
            return False

        from .emails import send_receipt_email

        try:
            ok = send_receipt_email(self)
            if ok:
                self.emailed_at = now()
                self.email_last_error = ""
                self.save(update_fields=["emailed_at", "email_last_error"])
                return True

            self.email_last_error = "No homeowner email found (invoice.homeowner_email / agreement.homeowner_email)."
            self.save(update_fields=["email_last_error"])
            return False

        except Exception as e:
            self.email_last_error = str(e)
            self.save(update_fields=["email_last_error"])
            return False
