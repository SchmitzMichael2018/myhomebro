from django.db import models


class PublicImprovementPlanSlot(models.Model):
    """A reusable anonymous admission slot, never project answers or plan content."""

    key = models.CharField(max_length=64, primary_key=True)
    available_at = models.DateTimeField(db_index=True)
