from django.conf import settings
from django.db import models
from django.utils import timezone


class AmendmentRequest(models.Model):
    """
    A lightweight 'change request' record. This does NOT change the agreement/milestone.
    It captures intent and justification, and can be used to route into the amendment flow.
    """

    class ChangeType(models.TextChoices):
        DATE_CHANGE = "date_change", "Date Change"
        AMOUNT_CHANGE = "amount_change", "Amount Change"
        SCOPE_PRODUCT_CHANGE = "scope_product_change", "Product/Scope Change"
        OTHER = "other", "Other"

    class Status(models.TextChoices):
        OPEN = "open", "Open"
        ROUTED_TO_AMENDMENT = "routed_to_amendment", "Routed to Amendment"
        CLOSED = "closed", "Closed"

    created_at = models.DateTimeField(default=timezone.now, editable=False)
    updated_at = models.DateTimeField(auto_now=True)

    agreement = models.ForeignKey(
        "projects.Agreement",
        on_delete=models.CASCADE,
        related_name="amendment_requests",
    )
    milestone = models.ForeignKey(
        "projects.Milestone",
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="amendment_requests",
        help_text="Optional. Some amendment requests may be agreement-level.",
    )

    requested_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="amendment_requests",
    )

    change_type = models.CharField(
        max_length=64,
        choices=ChangeType.choices,
        default=ChangeType.OTHER,
    )

    # flexible payload describing requested changes (new_date, new_amount, new_scope, etc.)
    requested_changes = models.JSONField(default=dict, blank=True)

    justification = models.TextField(blank=True, default="")

    status = models.CharField(
        max_length=64,
        choices=Status.choices,
        default=Status.OPEN,
    )

    def __str__(self):
        return f"AmendmentRequest #{self.pk} — Agreement {self.agreement_id} — {self.change_type}"