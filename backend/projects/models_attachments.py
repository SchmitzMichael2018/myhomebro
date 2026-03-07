# backend/projects/models_attachments.py
from django.conf import settings
from django.db import models
from django.utils import timezone
from django.utils.text import slugify


def agreement_attachment_upload_path(instance, filename):
    base, dot, ext = filename.rpartition(".")
    ext = (ext or "").lower()
    safe = slugify(base or "file")
    ts = timezone.now().strftime("%Y%m%d%H%M%S")
    return (
        f"agreements/{instance.agreement_id}/attachments/{ts}_{safe}.{ext}"
        if ext
        else f"agreements/{instance.agreement_id}/attachments/{ts}_{safe}"
    )


class AgreementAttachment(models.Model):
    CATEGORY_WARRANTY = "WARRANTY"
    CATEGORY_ADDENDUM = "ADDENDUM"
    CATEGORY_EXHIBIT = "EXHIBIT"
    CATEGORY_OTHER = "OTHER"
    CATEGORY_CHOICES = [
        (CATEGORY_WARRANTY, "Warranty"),
        (CATEGORY_ADDENDUM, "Addendum"),
        (CATEGORY_EXHIBIT, "Exhibit"),
        (CATEGORY_OTHER, "Other"),
    ]

    agreement = models.ForeignKey(
        "projects.Agreement",
        on_delete=models.CASCADE,
        related_name="attachments",
    )
    title = models.CharField(max_length=200)
    category = models.CharField(max_length=20, choices=CATEGORY_CHOICES, default=CATEGORY_OTHER)
    file = models.FileField(upload_to=agreement_attachment_upload_path)
    visible_to_homeowner = models.BooleanField(default=True)
    ack_required = models.BooleanField(default=True)

    uploaded_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="uploaded_agreement_attachments",
    )
    uploaded_at = models.DateTimeField(default=timezone.now, db_index=True)

    class Meta:
        ordering = ["-uploaded_at", "-id"]

    def __str__(self):
        return f"{self.agreement_id} • {self.category}: {self.title}"


# -------------------------------------------------------------------
# ✅ NEW: ExpenseRequest attachments (unify expenses on ExpenseRequest)
# -------------------------------------------------------------------

def expense_request_attachment_upload_path(instance, filename):
    base, dot, ext = filename.rpartition(".")
    ext = (ext or "").lower()
    safe = slugify(base or "file")
    ts = timezone.now().strftime("%Y%m%d%H%M%S")
    return (
        f"expense_requests/{instance.expense_request_id}/attachments/{ts}_{safe}.{ext}"
        if ext
        else f"expense_requests/{instance.expense_request_id}/attachments/{ts}_{safe}"
    )


class ExpenseRequestAttachment(models.Model):
    """
    Multiple receipts/photos per ExpenseRequest.

    Uploaded via:
      POST /api/projects/expense-requests/<id>/attachments/
    Listed via:
      GET  /api/projects/expense-requests/<id>/attachments/
    Deleted via:
      DELETE /api/projects/expense-requests/<id>/attachments/<att_id>/
    """

    expense_request = models.ForeignKey(
        "projects.ExpenseRequest",
        on_delete=models.CASCADE,
        related_name="attachments",
    )
    file = models.FileField(upload_to=expense_request_attachment_upload_path)
    original_name = models.CharField(max_length=255, blank=True, default="")
    uploaded_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="uploaded_expense_request_attachments",
    )
    uploaded_at = models.DateTimeField(default=timezone.now, db_index=True)

    class Meta:
        ordering = ["-uploaded_at", "-id"]

    def __str__(self):
        return f"{self.expense_request_id} • Attachment: {self.original_name or 'file'}"