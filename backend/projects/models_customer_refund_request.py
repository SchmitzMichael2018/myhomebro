from django.conf import settings
from django.db import models
from django.utils import timezone


class CustomerRefundRequest(models.Model):
    class Status(models.TextChoices):
        REFUND_REQUESTED = "refund_requested", "Refund Requested"
        CONTRACTOR_RESPONSE_NEEDED = "contractor_response_needed", "Contractor Response Needed"
        UNDER_REVIEW = "under_review", "Under Review"
        APPROVED = "approved", "Approved"
        DENIED = "denied", "Denied"
        REFUNDED = "refunded", "Refunded"

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
    reason = models.TextField()
    evidence_note = models.TextField(blank=True, default="")
    requested_amount = models.DecimalField(max_digits=12, decimal_places=2, null=True, blank=True)
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
