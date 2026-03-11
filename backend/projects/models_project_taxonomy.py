from __future__ import annotations

from django.db import models
from django.utils.text import slugify


def normalize_taxonomy_name(value: str) -> str:
    text = (value or "").strip()
    return " ".join(text.split())


def normalized_key(value: str) -> str:
    text = normalize_taxonomy_name(value).lower()
    return slugify(text).replace("-", "_")


class ProjectType(models.Model):
    """
    Broad project classification bucket.

    Examples:
      - Remodel
      - Repair
      - Installation
      - Painting
      - Outdoor
      - Inspection
      - DIY Help
      - Custom

    Rules:
      - contractor=None + is_system=True => global/system taxonomy
      - contractor=<id> => contractor-owned/custom taxonomy
      - is_active=False => archived
      - merged_into => historical redirect target
    """

    contractor = models.ForeignKey(
        "projects.Contractor",
        null=True,
        blank=True,
        on_delete=models.CASCADE,
        related_name="project_types",
    )

    name = models.CharField(max_length=120)
    normalized_name = models.CharField(max_length=120, db_index=True, editable=False)

    is_system = models.BooleanField(default=False, db_index=True)
    is_active = models.BooleanField(default=True, db_index=True)

    merged_into = models.ForeignKey(
        "self",
        null=True,
        blank=True,
        on_delete=models.SET_NULL,
        related_name="merged_project_types",
    )

    sort_order = models.PositiveIntegerField(default=100)

    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["sort_order", "name"]
        constraints = [
            models.UniqueConstraint(
                fields=["contractor", "normalized_name"],
                name="uniq_project_type_per_contractor_normalized_name",
            ),
        ]

    def __str__(self) -> str:
        return self.name

    @property
    def owner_type(self) -> str:
        return "system" if self.is_system or self.contractor_id is None else "contractor"

    @property
    def is_merged(self) -> bool:
        return self.merged_into_id is not None

    def clean_name(self) -> str:
        return normalize_taxonomy_name(self.name)

    def save(self, *args, **kwargs):
        self.name = self.clean_name()
        self.normalized_name = normalized_key(self.name)

        if self.is_system:
            self.contractor = None

        if self.merged_into_id == self.id:
            self.merged_into = None

        super().save(*args, **kwargs)

    def archive(self, *, save: bool = True):
        self.is_active = False
        if save:
            self.save(update_fields=["is_active", "updated_at"])

    def unarchive(self, *, save: bool = True):
        self.is_active = True
        if save:
            self.save(update_fields=["is_active", "updated_at"])


class ProjectSubtype(models.Model):
    """
    Specific subtype under a ProjectType.

    Examples:
      Type: Remodel
      Subtypes:
        - Bathroom Remodel
        - Kitchen Remodel
        - Bedroom Addition

    This is classification only.
    Detailed scope logic should live in templates.
    """

    project_type = models.ForeignKey(
        "projects.ProjectType",
        on_delete=models.CASCADE,
        related_name="subtypes",
    )

    contractor = models.ForeignKey(
        "projects.Contractor",
        null=True,
        blank=True,
        on_delete=models.CASCADE,
        related_name="project_subtypes",
    )

    name = models.CharField(max_length=120)
    normalized_name = models.CharField(max_length=120, db_index=True, editable=False)

    is_system = models.BooleanField(default=False, db_index=True)
    is_active = models.BooleanField(default=True, db_index=True)

    merged_into = models.ForeignKey(
        "self",
        null=True,
        blank=True,
        on_delete=models.SET_NULL,
        related_name="merged_project_subtypes",
    )

    sort_order = models.PositiveIntegerField(default=100)

    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["project_type__sort_order", "sort_order", "name"]
        constraints = [
            models.UniqueConstraint(
                fields=["project_type", "contractor", "normalized_name"],
                name="uniq_project_subtype_per_type_per_contractor_normalized_name",
            ),
        ]

    def __str__(self) -> str:
        return f"{self.project_type.name} → {self.name}"

    @property
    def owner_type(self) -> str:
        return "system" if self.is_system or self.contractor_id is None else "contractor"

    @property
    def is_merged(self) -> bool:
        return self.merged_into_id is not None

    def clean_name(self) -> str:
        return normalize_taxonomy_name(self.name)

    def save(self, *args, **kwargs):
        self.name = self.clean_name()
        self.normalized_name = normalized_key(self.name)

        if self.is_system:
            self.contractor = None

        if self.merged_into_id == self.id:
            self.merged_into = None

        # keep contractor ownership aligned with parent when subtype is system-owned
        if self.project_type_id and self.project_type.is_system:
            self.is_system = True
            self.contractor = None

        super().save(*args, **kwargs)

    def archive(self, *, save: bool = True):
        self.is_active = False
        if save:
            self.save(update_fields=["is_active", "updated_at"])

    def unarchive(self, *, save: bool = True):
        self.is_active = True
        if save:
            self.save(update_fields=["is_active", "updated_at"])