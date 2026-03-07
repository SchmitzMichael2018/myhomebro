# backend/projects/models_expense_request.py
from __future__ import annotations

from decimal import Decimal
from django.conf import settings
from django.db import models
from django.utils import timezone


class ExpenseRequest(models.Model):
    """
    Unified expenses workflow model (replaces Expense).

    Used by:
      /api/projects/expense-requests/
      ExpenseRequestViewSet actions:
        contractor_sign, send_to_homeowner, homeowner_accept, homeowner_reject, mark_paid
    """

    class Status(models.TextChoices):
        DRAFT = "draft", "Draft"
        CONTRACTOR_SIGNED = "contractor_signed", "Contractor Signed"
        SENT_TO_HOMEOWNER = "sent_to_homeowner", "Sent to Customer"
        HOMEOWNER_ACCEPTED = "homeowner_accepted", "Customer Accepted"
        HOMEOWNER_REJECTED = "homeowner_rejected", "Customer Rejected"
        PAID = "paid", "Paid"

    agreement = models.ForeignKey(
        "projects.Agreement",
        on_delete=models.CASCADE,
        related_name="expense_requests",
        null=True,
        blank=True,
        db_index=True,
    )

    description = models.CharField(max_length=255)
    amount = models.DecimalField(max_digits=10, decimal_places=2, default=Decimal("0.00"))
    incurred_date = models.DateField(default=timezone.now)

    # Legacy single receipt (keep for compatibility; multi-files are in ExpenseRequestAttachment)
    receipt = models.FileField(upload_to="expense_requests/receipt/", null=True, blank=True)

    notes_to_homeowner = models.TextField(blank=True, default="")

    status = models.CharField(
        max_length=32,
        choices=Status.choices,
        default=Status.DRAFT,
        db_index=True,
    )

    created_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="created_expense_requests",
    )

    contractor_signed_at = models.DateTimeField(null=True, blank=True)
    homeowner_acted_at = models.DateTimeField(null=True, blank=True)
    paid_at = models.DateTimeField(null=True, blank=True)

    # ✅ NEW: archive support (follows Agreement archive)
    is_archived = models.BooleanField(default=False, db_index=True)
    archived_at = models.DateTimeField(null=True, blank=True)
    archived_reason = models.CharField(max_length=255, blank=True, default="")

    created_at = models.DateTimeField(auto_now_add=True, db_index=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["-created_at", "-id"]

    def __str__(self) -> str:
        return f"ExpenseRequest #{self.id} — {self.description} (${self.amount})"