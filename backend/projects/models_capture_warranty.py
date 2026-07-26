from django.conf import settings
from django.db import models


class EquipmentCaptureAttachment(models.Model):
    equipment = models.ForeignKey(
        "projects.ContractorAsset", on_delete=models.CASCADE,
        related_name="capture_attachments",
    )
    artifact = models.OneToOneField(
        "projects.CaptureArtifact", on_delete=models.PROTECT,
        related_name="equipment_attachment",
    )
    customer_visible = models.BooleanField(default=False)
    created_by = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.SET_NULL, null=True, blank=True,
        related_name="created_equipment_capture_attachments",
    )
    created_at = models.DateTimeField(auto_now_add=True)


class WarrantyCaptureDocument(models.Model):
    warranty = models.ForeignKey(
        "projects.AgreementWarranty", on_delete=models.CASCADE,
        related_name="capture_documents",
    )
    equipment = models.ForeignKey(
        "projects.ContractorAsset", on_delete=models.SET_NULL, null=True, blank=True,
        related_name="warranty_documents",
    )
    artifact = models.OneToOneField(
        "projects.CaptureArtifact", on_delete=models.PROTECT,
        related_name="warranty_document",
    )
    customer_visible = models.BooleanField(default=False)
    approved_metadata = models.JSONField(default=dict, blank=True)
    created_by = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.SET_NULL, null=True, blank=True,
        related_name="created_warranty_capture_documents",
    )
    created_at = models.DateTimeField(auto_now_add=True)


class WarrantyCaptureChange(models.Model):
    warranty = models.ForeignKey(
        "projects.AgreementWarranty", on_delete=models.CASCADE,
        related_name="capture_changes",
    )
    origin_capture = models.ForeignKey(
        "projects.Capture", on_delete=models.PROTECT,
        related_name="warranty_changes",
    )
    before_values = models.JSONField(default=dict)
    approved_values = models.JSONField(default=dict)
    action = models.CharField(max_length=24, default="create")
    actor = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.SET_NULL, null=True, blank=True,
        related_name="warranty_capture_changes",
    )
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["created_at", "id"]
