from __future__ import annotations

from django.conf import settings
from django.db import models
from django.utils import timezone


class MaintenanceWorkOrder(models.Model):
    STATUS_SCHEDULED = "scheduled"
    STATUS_IN_PROGRESS = "in_progress"
    STATUS_COMPLETED = "completed"
    STATUS_CANCELLED = "cancelled"
    STATUS_CHOICES = [
        (STATUS_SCHEDULED, "Scheduled"),
        (STATUS_IN_PROGRESS, "In Progress"),
        (STATUS_COMPLETED, "Completed"),
        (STATUS_CANCELLED, "Cancelled"),
    ]

    maintenance_agreement = models.ForeignKey(
        "projects.Agreement",
        on_delete=models.CASCADE,
        related_name="maintenance_work_orders",
        db_index=True,
    )
    source_milestone = models.OneToOneField(
        "projects.Milestone",
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="maintenance_work_order",
        help_text="Generated recurring milestone occurrence that this work order represents.",
    )
    property_profile = models.ForeignKey(
        "projects.PropertyProfile",
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="maintenance_work_orders",
    )
    home_system = models.ForeignKey(
        "projects.PropertyHomeSystem",
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="maintenance_work_orders",
    )
    contractor = models.ForeignKey(
        "projects.Contractor",
        on_delete=models.CASCADE,
        related_name="maintenance_work_orders",
        db_index=True,
    )
    homeowner = models.ForeignKey(
        "projects.Homeowner",
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="maintenance_work_orders",
    )
    title = models.CharField(max_length=255)
    description = models.TextField(blank=True, default="")
    scheduled_date = models.DateField(null=True, blank=True, db_index=True)
    completed_at = models.DateTimeField(null=True, blank=True, db_index=True)
    status = models.CharField(max_length=32, choices=STATUS_CHOICES, default=STATUS_SCHEDULED, db_index=True)
    notes = models.TextField(blank=True, default="")
    generated_from_schedule = models.BooleanField(default=False, db_index=True)
    created_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="created_maintenance_work_orders",
    )
    completed_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="completed_maintenance_work_orders",
    )
    created_at = models.DateTimeField(auto_now_add=True, db_index=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["scheduled_date", "id"]
        indexes = [
            models.Index(fields=["contractor", "status", "scheduled_date"]),
            models.Index(fields=["property_profile", "status", "scheduled_date"]),
            models.Index(fields=["maintenance_agreement", "status"]),
        ]

    def __str__(self) -> str:
        return f"{self.title} ({self.status})"


class MaintenanceWorkOrderAttachment(models.Model):
    work_order = models.ForeignKey(
        MaintenanceWorkOrder,
        on_delete=models.CASCADE,
        related_name="attachments",
    )
    file = models.FileField(upload_to="maintenance_work_orders/")
    original_name = models.CharField(max_length=255, blank=True, default="")
    uploaded_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="uploaded_maintenance_work_order_attachments",
    )
    uploaded_at = models.DateTimeField(default=timezone.now, db_index=True)

    class Meta:
        ordering = ["-uploaded_at", "-id"]

    def __str__(self) -> str:
        return self.original_name or f"Maintenance attachment {self.pk}"
