# backend/projects/models_schedule.py
from __future__ import annotations

from django.db import models


class EmployeeWorkSchedule(models.Model):
    """
    Weekly work schedule for a ContractorSubAccount (employee).

    Full-week support: Sun-Sat toggles.
    """
    subaccount = models.OneToOneField(
        "projects.ContractorSubAccount",
        on_delete=models.CASCADE,
        related_name="work_schedule",
    )

    timezone = models.CharField(max_length=64, default="America/Chicago")

    # Full week (Sun-Sat)
    work_sun = models.BooleanField(default=False)
    work_mon = models.BooleanField(default=True)
    work_tue = models.BooleanField(default=True)
    work_wed = models.BooleanField(default=True)
    work_thu = models.BooleanField(default=True)
    work_fri = models.BooleanField(default=True)
    work_sat = models.BooleanField(default=False)

    # Optional workday window (not enforced yet; used later for hour-level warnings)
    start_time = models.TimeField(null=True, blank=True)
    end_time = models.TimeField(null=True, blank=True)

    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        verbose_name = "Employee Work Schedule"
        verbose_name_plural = "Employee Work Schedules"

    def __str__(self) -> str:
        return f"WorkSchedule(subaccount={self.subaccount_id})"


class EmployeeScheduleException(models.Model):
    """
    Date-specific override:
    - is_working=False => day off
    - is_working=True  => extra work day even if normally off
    """
    subaccount = models.ForeignKey(
        "projects.ContractorSubAccount",
        on_delete=models.CASCADE,
        related_name="schedule_exceptions",
    )

    date = models.DateField(db_index=True)
    is_working = models.BooleanField(default=False)
    note = models.CharField(max_length=255, blank=True, default="")

    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        verbose_name = "Employee Schedule Exception"
        verbose_name_plural = "Employee Schedule Exceptions"
        unique_together = (("subaccount", "date"),)
        ordering = ("-date",)

    def __str__(self) -> str:
        return f"ScheduleException(subaccount={self.subaccount_id}, date={self.date}, is_working={self.is_working})"
