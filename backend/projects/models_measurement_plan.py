from django.conf import settings
from django.core.validators import MinValueValidator
from django.db import models
from decimal import Decimal


class PlanMeasurementDocument(models.Model):
    STATUS_ACTIVE = "active"
    STATUS_ARCHIVED = "archived"
    STATUS_CHOICES = ((STATUS_ACTIVE, "Active"), (STATUS_ARCHIVED, "Archived"))

    contractor = models.ForeignKey("projects.Contractor", on_delete=models.CASCADE, related_name="plan_measurement_documents")
    measurement_session = models.ForeignKey("projects.MeasurementSession", on_delete=models.CASCADE, related_name="plan_documents")
    artifact = models.OneToOneField("projects.CaptureArtifact", on_delete=models.PROTECT, related_name="plan_measurement_document")
    project = models.ForeignKey("projects.Project", on_delete=models.CASCADE, related_name="plan_measurement_documents")
    proposal = models.ForeignKey("projects.Proposal", on_delete=models.SET_NULL, null=True, blank=True, related_name="plan_measurement_documents")
    original_filename = models.CharField(max_length=255)
    checksum = models.CharField(max_length=64, db_index=True)
    page_count = models.PositiveIntegerField()
    file_size = models.PositiveIntegerField()
    status = models.CharField(max_length=16, choices=STATUS_CHOICES, default=STATUS_ACTIVE, db_index=True)
    source = models.CharField(max_length=32, default="capture_artifact")
    created_by = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.SET_NULL, null=True, related_name="plan_documents_created")
    version = models.PositiveIntegerField(default=1)
    archived_at = models.DateTimeField(null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["-created_at", "id"]


class PlanMeasurementCalibration(models.Model):
    TYPE_PAGE = "page"
    TYPE_REGION = "region"
    TYPE_CHOICES = ((TYPE_PAGE, "Page"), (TYPE_REGION, "Region"))
    CONFIDENCE_CHOICES = (
        ("low", "Low"), ("medium", "Medium"),
        ("high_estimate", "High estimate"), ("verified", "Verified"),
    )

    document = models.ForeignKey(PlanMeasurementDocument, on_delete=models.CASCADE, related_name="calibrations")
    page_number = models.PositiveIntegerField()
    calibration_type = models.CharField(max_length=16, choices=TYPE_CHOICES, default=TYPE_PAGE)
    reference_geometry = models.JSONField()
    region_geometry = models.JSONField(default=dict, blank=True)
    known_length = models.DecimalField(max_digits=24, decimal_places=10, validators=[MinValueValidator(Decimal("0.0000000001"))])
    unit = models.CharField(max_length=24)
    canonical_distance = models.DecimalField(max_digits=24, decimal_places=10)
    scale_per_point = models.DecimalField(max_digits=24, decimal_places=10)
    page_rotation = models.PositiveSmallIntegerField(default=0)
    page_box = models.JSONField(default=dict)
    source_dimension_label = models.CharField(max_length=160, blank=True, default="")
    confidence = models.CharField(max_length=24, choices=CONFIDENCE_CHOICES, default="high_estimate")
    warnings = models.JSONField(default=list)
    document_checksum = models.CharField(max_length=64)
    created_by = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.SET_NULL, null=True, related_name="plan_calibrations_created")
    superseded_by = models.ForeignKey("self", on_delete=models.PROTECT, null=True, blank=True, related_name="supersedes")
    invalidated_at = models.DateTimeField(null=True, blank=True)
    version = models.PositiveIntegerField(default=1)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["page_number", "-created_at", "id"]


class PlanMeasurementAnnotation(models.Model):
    TYPE_CHOICES = (
        ("line", "Line"), ("polyline", "Polyline"),
        ("polygon", "Polygon"), ("count", "Count marker"),
    )
    CONFIDENCE_CHOICES = PlanMeasurementCalibration.CONFIDENCE_CHOICES

    document = models.ForeignKey(PlanMeasurementDocument, on_delete=models.CASCADE, related_name="annotations")
    calibration = models.ForeignKey(PlanMeasurementCalibration, on_delete=models.PROTECT, null=True, blank=True, related_name="annotations")
    previous_revision = models.ForeignKey("self", on_delete=models.PROTECT, null=True, blank=True, related_name="revisions")
    measurement_entry = models.ForeignKey("projects.MeasurementEntry", on_delete=models.PROTECT, null=True, blank=True, related_name="plan_annotations")
    measurement_result = models.ForeignKey("projects.MeasurementCalculatedResult", on_delete=models.PROTECT, null=True, blank=True, related_name="plan_annotations")
    page_number = models.PositiveIntegerField()
    annotation_type = models.CharField(max_length=16, choices=TYPE_CHOICES)
    geometry = models.JSONField()
    label = models.CharField(max_length=160)
    category = models.CharField(max_length=80, blank=True, default="")
    normalized_value = models.DecimalField(max_digits=24, decimal_places=10)
    normalized_unit = models.CharField(max_length=32)
    perimeter_value = models.DecimalField(max_digits=24, decimal_places=10, null=True, blank=True)
    confidence = models.CharField(max_length=24, choices=CONFIDENCE_CHOICES, default="high_estimate")
    confidence_reasons = models.JSONField(default=list)
    warnings = models.JSONField(default=list)
    source_version = models.CharField(max_length=24, default="pdf_plan.v1")
    calculation_version = models.CharField(max_length=24, default="pdf_geometry.v1")
    created_by = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.SET_NULL, null=True, related_name="plan_annotations_created")
    archived_at = models.DateTimeField(null=True, blank=True)
    version = models.PositiveIntegerField(default=1)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["page_number", "created_at", "id"]
