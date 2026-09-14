from django.conf import settings
from django.db import models
from django.utils import timezone


class CustomerRefundRequest(models.Model):
    class InitiatorRole(models.TextChoices):
        HOMEOWNER = "homeowner", "Homeowner"
        CONTRACTOR = "contractor", "Contractor"

    class SourceType(models.TextChoices):
        ESCROW = "escrow", "Escrow balance"
        INVOICE = "invoice", "Invoice payment"
        DRAW = "draw", "Draw payment"
        EXTERNAL = "external", "External payment"

    class PaymentMode(models.TextChoices):
        ESCROW = "escrow", "Escrow"
        DIRECT = "direct", "Direct Pay"
        EXTERNAL = "external", "External / record only"

    class Status(models.TextChoices):
        REFUND_REQUESTED = "refund_requested", "Refund Requested"
        CONTRACTOR_RESPONSE_NEEDED = "contractor_response_needed", "Contractor Response Needed"
        UNDER_REVIEW = "under_review", "Under Review"
        COUNTERED = "countered", "Different Amount Proposed"
        APPROVED = "approved", "Approved"
        DENIED = "denied", "Denied"
        PROCESSING = "processing", "Processing"
        REFUNDED = "refunded", "Refunded"
        FAILED = "failed", "Failed"
        CANCELLED = "cancelled", "Cancelled"

    agreement = models.ForeignKey(
        "projects.Agreement",
        on_delete=models.CASCADE,
        related_name="customer_refund_requests",
    )
    requested_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="customer_refund_requests",
    )
    initiated_by_role = models.CharField(
        max_length=20,
        choices=InitiatorRole.choices,
        default=InitiatorRole.HOMEOWNER,
        db_index=True,
    )
    source_type = models.CharField(
        max_length=20,
        choices=SourceType.choices,
        default=SourceType.ESCROW,
        db_index=True,
    )
    payment_mode = models.CharField(
        max_length=20,
        choices=PaymentMode.choices,
        default=PaymentMode.ESCROW,
        db_index=True,
    )
    invoice = models.ForeignKey(
        "projects.Invoice",
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="refund_requests",
    )
    draw_request = models.ForeignKey(
        "projects.DrawRequest",
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="refund_requests",
    )
    milestone = models.ForeignKey(
        "projects.Milestone",
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="refund_requests",
    )
    external_payment = models.ForeignKey(
        "projects.ExternalPaymentRecord",
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="refund_requests",
    )
    reason = models.TextField()
    evidence_note = models.TextField(blank=True, default="")
    requested_amount = models.DecimalField(max_digits=12, decimal_places=2, null=True, blank=True)
    approved_amount = models.DecimalField(max_digits=12, decimal_places=2, null=True, blank=True)
    response_note = models.TextField(blank=True, default="")
    responded_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="responded_refund_requests",
    )
    responded_at = models.DateTimeField(null=True, blank=True)
    processed_at = models.DateTimeField(null=True, blank=True)
    failure_reason = models.TextField(blank=True, default="")
    notification_delivery = models.JSONField(default=dict, blank=True)
    status = models.CharField(max_length=40, choices=Status.choices, default=Status.REFUND_REQUESTED, db_index=True)
    created_at = models.DateTimeField(default=timezone.now, editable=False)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["-created_at", "-id"]
        indexes = [
            models.Index(fields=["agreement", "status"]),
            models.Index(fields=["created_at"]),
        ]

    def __str__(self):
        return f"Refund request #{self.pk} for agreement {self.agreement_id}"


class CustomerRefundRequestEvent(models.Model):
    refund_request = models.ForeignKey(
        CustomerRefundRequest,
        on_delete=models.CASCADE,
        related_name="events",
    )
    actor = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="refund_request_events",
    )
    actor_role = models.CharField(max_length=20, blank=True, default="")
    event_type = models.CharField(max_length=40, db_index=True)
    from_status = models.CharField(max_length=40, blank=True, default="")
    to_status = models.CharField(max_length=40, blank=True, default="")
    note = models.TextField(blank=True, default="")
    metadata = models.JSONField(default=dict, blank=True)
    created_at = models.DateTimeField(default=timezone.now, editable=False, db_index=True)

    class Meta:
        ordering = ["created_at", "id"]

    def __str__(self):
        return f"Refund request event #{self.pk} ({self.event_type})"


class CustomerRefundTransaction(models.Model):
    class Action(models.TextChoices):
        REFUND = "refund", "Customer refund"
        TRANSFER_REVERSAL = "transfer_reversal", "Contractor transfer reversal"
        EXTERNAL_RECORD = "external_record", "External refund record"

    class Status(models.TextChoices):
        PENDING = "pending", "Pending"
        SUCCEEDED = "succeeded", "Succeeded"
        FAILED = "failed", "Failed"

    refund_request = models.ForeignKey(
        CustomerRefundRequest,
        on_delete=models.CASCADE,
        related_name="transactions",
    )
    payment = models.ForeignKey(
        "payments.Payment",
        on_delete=models.PROTECT,
        null=True,
        blank=True,
        related_name="customer_refund_transactions",
    )
    action = models.CharField(max_length=24, choices=Action.choices, db_index=True)
    status = models.CharField(max_length=20, choices=Status.choices, default=Status.PENDING, db_index=True)
    attempt_number = models.PositiveIntegerField(default=1)
    amount_cents = models.PositiveBigIntegerField(default=0)
    currency = models.CharField(max_length=10, default="usd")
    source_payment_intent_id = models.CharField(max_length=255, blank=True, default="", db_index=True)
    source_charge_id = models.CharField(max_length=255, blank=True, default="", db_index=True)
    source_transfer_id = models.CharField(max_length=255, blank=True, default="", db_index=True)
    stripe_refund_id = models.CharField(max_length=255, blank=True, default="", db_index=True)
    stripe_transfer_reversal_id = models.CharField(max_length=255, blank=True, default="", db_index=True)
    idempotency_key = models.CharField(max_length=255, unique=True)
    error_message = models.TextField(blank=True, default="")
    metadata = models.JSONField(default=dict, blank=True)
    created_at = models.DateTimeField(default=timezone.now, editable=False, db_index=True)
    completed_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        ordering = ["created_at", "id"]

    def __str__(self):
        return f"Refund transaction #{self.pk} ({self.action}: {self.status})"
