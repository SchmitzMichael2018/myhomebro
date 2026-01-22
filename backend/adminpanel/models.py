from __future__ import annotations

from django.conf import settings
from django.db import models


class AdminGoal(models.Model):
    """
    Admin-configurable goals for the platform.

    We store cents as integers for durability and to avoid float problems.
    """
    class Timeframe(models.TextChoices):
        ROLLING_12_MONTHS = "rolling_12_months", "Rolling 12 Months"
        CALENDAR_YEAR = "calendar_year", "Calendar Year"
        MONTH = "month", "Month"
        QUARTER = "quarter", "Quarter"

    key = models.CharField(max_length=64, unique=True)
    name = models.CharField(max_length=128, default="")
    description = models.TextField(blank=True, default="")

    # Example: $300,000.00 => 30000000 cents
    target_cents = models.BigIntegerField(default=0)

    timeframe = models.CharField(
        max_length=32,
        choices=Timeframe.choices,
        default=Timeframe.ROLLING_12_MONTHS,
    )

    is_enabled = models.BooleanField(default=True)

    # Audit
    updated_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        null=True,
        blank=True,
        on_delete=models.SET_NULL,
        related_name="admin_goals_updated",
    )
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["key"]

    def __str__(self) -> str:
        return f"{self.key} ({self.timeframe})"

    @classmethod
    def get_or_create_default_owner_salary_goal(cls) -> "AdminGoal":
        """
        Ensures there is a canonical 'owner_salary' goal.
        """
        obj, _created = cls.objects.get_or_create(
            key="owner_salary",
            defaults={
                "name": "Owner Salary",
                "description": "Rolling 12-month platform fees collected target (salary proxy).",
                "target_cents": 300_000_00,  # $300,000.00
                "timeframe": cls.Timeframe.ROLLING_12_MONTHS,
                "is_enabled": True,
            },
        )
        return obj
