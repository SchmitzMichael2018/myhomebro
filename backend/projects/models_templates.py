from __future__ import annotations

from decimal import Decimal
from django.db import models


class ProjectTemplate(models.Model):
    """
    Reusable agreement template.

    - is_system=True  => built-in/admin-managed template
    - contractor set   => contractor-owned reusable template
    """

    contractor = models.ForeignKey(
        "projects.Contractor",
        on_delete=models.CASCADE,
        related_name="project_templates",
        null=True,
        blank=True,
    )

    name = models.CharField(max_length=255)
    project_type = models.CharField(max_length=100, db_index=True, blank=True, default="")
    project_subtype = models.CharField(max_length=100, blank=True, default="")

    description = models.TextField(blank=True, default="")
    estimated_days = models.PositiveIntegerField(default=1)

    default_scope = models.TextField(blank=True, default="")
    default_clarifications = models.JSONField(blank=True, default=list)

    is_system = models.BooleanField(default=False, db_index=True)
    is_active = models.BooleanField(default=True, db_index=True)

    created_from_agreement = models.ForeignKey(
        "projects.Agreement",
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="derived_templates",
    )

    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["-is_system", "project_type", "name"]
        indexes = [
            models.Index(fields=["project_type", "project_subtype"]),
            models.Index(fields=["is_system", "is_active"]),
        ]

    def __str__(self) -> str:
        owner = "System" if self.is_system else f"Contractor {self.contractor_id}"
        return f"{self.name} ({owner})"

    @property
    def milestone_count(self) -> int:
        return self.milestones.count()


class ProjectTemplateMilestone(models.Model):
    """
    Milestone blueprint row for a template.
    """

    template = models.ForeignKey(
        ProjectTemplate,
        on_delete=models.CASCADE,
        related_name="milestones",
    )

    title = models.CharField(max_length=255)
    description = models.TextField(blank=True, default="")
    sort_order = models.PositiveIntegerField(default=1)

    recommended_days_from_start = models.PositiveIntegerField(
        null=True,
        blank=True,
        help_text="Optional relative day offset from agreement start.",
    )
    recommended_duration_days = models.PositiveIntegerField(
        null=True,
        blank=True,
        help_text="Optional duration hint for scheduling logic.",
    )

    suggested_amount_percent = models.DecimalField(
        max_digits=6,
        decimal_places=2,
        null=True,
        blank=True,
        help_text="Optional % of agreement total for this milestone.",
    )
    suggested_amount_fixed = models.DecimalField(
        max_digits=10,
        decimal_places=2,
        null=True,
        blank=True,
        help_text="Optional fixed amount for this milestone.",
    )

    materials_hint = models.TextField(blank=True, default="")
    is_optional = models.BooleanField(default=False)

    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["sort_order", "id"]

    def __str__(self) -> str:
        return f"{self.template.name} #{self.sort_order} - {self.title}"

    def resolved_amount(self, total_amount: Decimal | None = None) -> Decimal:
        if self.suggested_amount_fixed is not None:
            return Decimal(self.suggested_amount_fixed)

        if self.suggested_amount_percent is not None and total_amount is not None:
            return (Decimal(total_amount) * Decimal(self.suggested_amount_percent) / Decimal("100")).quantize(
                Decimal("0.01")
            )

        return Decimal("0.00")