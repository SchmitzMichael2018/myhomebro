# backend/projects/models_dispute.py
from __future__ import annotations
from django.conf import settings
from django.db import models
from django.utils import timezone

class Dispute(models.Model):
    INITIATOR_CHOICES = (("contractor", "Contractor"), ("homeowner", "Homeowner"))
    STATUS_CHOICES = (
        ("initiated", "Initiated (fee not paid)"),
        ("open", "Open (fee paid; under review)"),
        ("under_review", "Under Review"),
        ("resolved_contractor", "Resolved — Contractor"),
        ("resolved_homeowner", "Resolved — Homeowner"),
        ("canceled", "Canceled"),
    )

    agreement = models.ForeignKey("projects.Agreement", on_delete=models.CASCADE, related_name="disputes")
    milestone = models.ForeignKey("projects.Milestone", on_delete=models.SET_NULL, null=True, blank=True, related_name="disputes")

    initiator = models.CharField(max_length=20, choices=INITIATOR_CHOICES)
    reason = models.CharField(max_length=255)
    description = models.TextField(blank=True)

    status = models.CharField(max_length=30, choices=STATUS_CHOICES, default="initiated")

    fee_amount = models.DecimalField(max_digits=10, decimal_places=2, default=25.00)
    fee_paid = models.BooleanField(default=False)
    fee_paid_at = models.DateTimeField(null=True, blank=True)

    escrow_frozen = models.BooleanField(default=False)  # snapshot flag at dispute-level

    created_by = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.SET_NULL, null=True, related_name="disputes_created")
    created_at = models.DateTimeField(default=timezone.now)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["-created_at"]

    def __str__(self) -> str:
        m = f" for milestone #{self.milestone_id}" if self.milestone_id else ""
        return f"Dispute #{self.pk} on agreement #{self.agreement_id}{m}"

class DisputeAttachment(models.Model):
    KIND_CHOICES = (
        ("agreement", "Agreement"),
        ("milestone", "Milestone"),
        ("photo", "Photo"),
        ("receipt", "Receipt"),
        ("other", "Other"),
    )
    dispute = models.ForeignKey(Dispute, on_delete=models.CASCADE, related_name="attachments")
    kind = models.CharField(max_length=20, choices=KIND_CHOICES, default="other")
    file = models.FileField(upload_to="disputes/%Y/%m/")
    uploaded_by = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.SET_NULL, null=True)
    uploaded_at = models.DateTimeField(default=timezone.now)

    def __str__(self) -> str:
        return f"Attachment #{self.pk} ({self.kind}) for dispute #{self.dispute_id}"
