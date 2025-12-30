from django.db import models
from django.utils.timezone import now


class Receipt(models.Model):
    invoice = models.OneToOneField(
        "projects.Invoice",
        on_delete=models.CASCADE,
        related_name="receipt",
    )

    receipt_number = models.CharField(max_length=64, unique=True)

    stripe_payment_intent_id = models.CharField(max_length=255)
    stripe_charge_id = models.CharField(max_length=255, blank=True, null=True)

    amount_paid_cents = models.PositiveIntegerField()
    platform_fee_cents = models.PositiveIntegerField(default=0)

    card_brand = models.CharField(max_length=32, blank=True, null=True)
    card_last4 = models.CharField(max_length=4, blank=True, null=True)

    pdf_file = models.FileField(upload_to="receipts/", blank=True, null=True)
    created_at = models.DateTimeField(default=now)

    # Email tracking (already migrated in your DB)
    emailed_at = models.DateTimeField(blank=True, null=True)
    email_last_error = models.TextField(blank=True, null=True)

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

        from .emails import send_receipt_email  # <-- your existing helper :contentReference[oaicite:1]{index=1}

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
