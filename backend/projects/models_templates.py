from __future__ import annotations

from decimal import Decimal
from django.db import models


class ProjectTemplate(models.Model):
    """
    Reusable agreement template.

    - is_system=True  => built-in/admin-managed template
    - contractor set  => contractor-owned reusable template
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

    # NEW: project-level materials guidance for the whole template
    project_materials_hint = models.TextField(blank=True, default="")

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

    PRICING_CONFIDENCE_CHOICES = [
        ("", "Unknown"),
        ("low", "Low"),
        ("medium", "Medium"),
        ("high", "High"),
    ]

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

    normalized_milestone_type = models.CharField(
        max_length=128,
        blank=True,
        default="",
        db_index=True,
        help_text="Stable normalized category used for pricing analytics.",
    )
    suggested_amount_low = models.DecimalField(
        max_digits=10,
        decimal_places=2,
        null=True,
        blank=True,
        help_text="Optional low-end suggested price range for this milestone.",
    )
    suggested_amount_high = models.DecimalField(
        max_digits=10,
        decimal_places=2,
        null=True,
        blank=True,
        help_text="Optional high-end suggested price range for this milestone.",
    )
    pricing_confidence = models.CharField(
        max_length=16,
        choices=PRICING_CONFIDENCE_CHOICES,
        blank=True,
        default="",
        help_text="Confidence level for current pricing guidance.",
    )
    pricing_source_note = models.CharField(
        max_length=255,
        blank=True,
        default="",
        help_text="Short note about where the suggested pricing came from.",
    )

    materials_hint = models.TextField(blank=True, default="")
    is_optional = models.BooleanField(default=False)

    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["sort_order", "id"]
        indexes = [
            models.Index(fields=["template", "sort_order"]),
            models.Index(fields=["normalized_milestone_type"]),
        ]

    def __str__(self) -> str:
        return f"{self.template.name} #{self.sort_order} - {self.title}"

    def resolved_amount(self, total_amount: Decimal | None = None) -> Decimal:
        if self.suggested_amount_fixed is not None:
            return Decimal(self.suggested_amount_fixed)

        if self.suggested_amount_percent is not None and total_amount is not None:
            return (
                Decimal(total_amount) * Decimal(self.suggested_amount_percent) / Decimal("100")
            ).quantize(Decimal("0.01"))

        return Decimal("0.00")


class MarketPricingBaseline(models.Model):
    """
    Seeded or curated market pricing priors used before platform history is strong.
    """

    region_state = models.CharField(max_length=64, blank=True, default="")
    region_city = models.CharField(max_length=128, blank=True, default="")

    project_type = models.CharField(max_length=100, db_index=True, blank=True, default="")
    project_subtype = models.CharField(max_length=100, blank=True, default="")
    normalized_milestone_type = models.CharField(max_length=128, db_index=True, blank=True, default="")

    low_amount = models.DecimalField(max_digits=10, decimal_places=2, default=0)
    median_amount = models.DecimalField(max_digits=10, decimal_places=2, default=0)
    high_amount = models.DecimalField(max_digits=10, decimal_places=2, default=0)

    typical_days_from_start = models.PositiveIntegerField(null=True, blank=True)
    typical_duration_days = models.PositiveIntegerField(null=True, blank=True)
    typical_total_project_days = models.PositiveIntegerField(null=True, blank=True)

    source_note = models.CharField(max_length=255, blank=True, default="")
    is_active = models.BooleanField(default=True, db_index=True)

    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["project_type", "project_subtype", "normalized_milestone_type", "region_state", "region_city"]
        indexes = [
            models.Index(fields=["project_type", "project_subtype"]),
            models.Index(fields=["normalized_milestone_type"]),
            models.Index(fields=["region_state", "region_city"]),
            models.Index(fields=["is_active"]),
        ]

    def __str__(self) -> str:
        parts = [
            self.project_type or "Any Type",
            self.project_subtype or "Any Subtype",
            self.normalized_milestone_type or "Any Milestone",
            self.region_city or self.region_state or "Any Region",
        ]
        return " | ".join(parts)


class PricingObservation(models.Model):
    """
    Raw pricing evidence captured from paid milestones / invoices.
    This is the passive learning layer.
    """

    contractor = models.ForeignKey(
        "projects.Contractor",
        null=True,
        blank=True,
        on_delete=models.SET_NULL,
        related_name="pricing_observations",
    )
    agreement = models.ForeignKey(
        "projects.Agreement",
        null=True,
        blank=True,
        on_delete=models.SET_NULL,
        related_name="pricing_observations",
    )
    milestone = models.ForeignKey(
        "projects.Milestone",
        null=True,
        blank=True,
        on_delete=models.SET_NULL,
        related_name="pricing_observations",
    )

    region_state = models.CharField(max_length=64, blank=True, default="")
    region_city = models.CharField(max_length=128, blank=True, default="")
    postal_code = models.CharField(max_length=20, blank=True, default="")

    project_type = models.CharField(max_length=100, db_index=True, blank=True, default="")
    project_subtype = models.CharField(max_length=100, blank=True, default="")
    normalized_milestone_type = models.CharField(max_length=128, db_index=True, blank=True, default="")

    milestone_title_snapshot = models.CharField(max_length=255, blank=True, default="")
    milestone_description_snapshot = models.TextField(blank=True, default="")

    amount = models.DecimalField(max_digits=10, decimal_places=2, default=0)
    agreement_total = models.DecimalField(max_digits=12, decimal_places=2, default=0)

    estimated_days = models.PositiveIntegerField(default=0)
    milestone_days_from_start = models.PositiveIntegerField(null=True, blank=True)
    milestone_duration_days = models.PositiveIntegerField(null=True, blank=True)

    paid_at = models.DateTimeField(null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["-paid_at", "-id"]
        indexes = [
            models.Index(fields=["project_type", "project_subtype"]),
            models.Index(fields=["normalized_milestone_type"]),
            models.Index(fields=["region_state", "region_city"]),
            models.Index(fields=["contractor"]),
            models.Index(fields=["paid_at"]),
        ]

    def __str__(self) -> str:
        label = self.normalized_milestone_type or self.milestone_title_snapshot or "Observation"
        return f"{label} - {self.amount}"


class PricingStatistic(models.Model):
    """
    Aggregated pricing stats derived from observations.
    """

    SCOPE_CHOICES = [
        ("market", "Market"),
        ("platform", "Platform"),
        ("contractor", "Contractor"),
    ]

    scope = models.CharField(max_length=32, choices=SCOPE_CHOICES, default="market", db_index=True)
    contractor = models.ForeignKey(
        "projects.Contractor",
        null=True,
        blank=True,
        on_delete=models.SET_NULL,
        related_name="pricing_statistics",
    )

    region_state = models.CharField(max_length=64, blank=True, default="")
    region_city = models.CharField(max_length=128, blank=True, default="")

    project_type = models.CharField(max_length=100, db_index=True, blank=True, default="")
    project_subtype = models.CharField(max_length=100, blank=True, default="")
    normalized_milestone_type = models.CharField(max_length=128, db_index=True, blank=True, default="")

    sample_size = models.PositiveIntegerField(default=0)

    low_amount = models.DecimalField(max_digits=10, decimal_places=2, default=0)
    median_amount = models.DecimalField(max_digits=10, decimal_places=2, default=0)
    high_amount = models.DecimalField(max_digits=10, decimal_places=2, default=0)
    avg_amount = models.DecimalField(max_digits=10, decimal_places=2, default=0)

    avg_days_from_start = models.DecimalField(max_digits=8, decimal_places=2, default=0)
    avg_duration_days = models.DecimalField(max_digits=8, decimal_places=2, default=0)
    avg_total_project_days = models.DecimalField(max_digits=8, decimal_places=2, default=0)

    source_note = models.CharField(max_length=255, blank=True, default="")
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["scope", "project_type", "project_subtype", "normalized_milestone_type"]
        indexes = [
            models.Index(fields=["scope", "project_type", "project_subtype"]),
            models.Index(fields=["scope", "normalized_milestone_type"]),
            models.Index(fields=["scope", "region_state", "region_city"]),
            models.Index(fields=["contractor"]),
        ]

    def __str__(self) -> str:
        scope_label = self.scope or "unknown"
        milestone_label = self.normalized_milestone_type or "any"
        return f"{scope_label} | {self.project_type} | {milestone_label}"