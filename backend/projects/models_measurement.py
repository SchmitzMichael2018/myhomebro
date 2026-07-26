from django.conf import settings
from django.db import models
from django.utils import timezone


class MeasurementSession(models.Model):
    STATUS_DRAFT = "draft"
    STATUS_MEASURING = "measuring"
    STATUS_NEEDS_REVIEW = "needs_review"
    STATUS_VERIFIED = "verified"
    STATUS_CONFIRMED = "confirmed"
    STATUS_ARCHIVED = "archived"
    STATUS_CHOICES = [
        (STATUS_DRAFT, "Draft"), (STATUS_MEASURING, "Measuring"),
        (STATUS_NEEDS_REVIEW, "Needs Review"), (STATUS_VERIFIED, "Verified"),
        (STATUS_CONFIRMED, "Confirmed"), (STATUS_ARCHIVED, "Archived"),
    ]
    PURPOSE_CHOICES = [
        (value, value.replace("_", " ").title()) for value in (
            "flooring", "wall_finish", "painting", "ceiling", "door", "window",
            "cabinetry", "countertop", "fencing", "roofing", "general_room", "custom",
        )
    ]
    contractor = models.ForeignKey("projects.Contractor", on_delete=models.CASCADE, related_name="measurement_sessions")
    project = models.ForeignKey("projects.Project", on_delete=models.CASCADE, related_name="measurement_sessions")
    proposal = models.ForeignKey("projects.Proposal", on_delete=models.SET_NULL, null=True, blank=True, related_name="measurement_sessions")
    customer = models.ForeignKey("projects.Homeowner", on_delete=models.SET_NULL, null=True, blank=True, related_name="measurement_sessions")
    property_profile = models.ForeignKey("projects.PropertyProfile", on_delete=models.SET_NULL, null=True, blank=True, related_name="measurement_sessions")
    room_name = models.CharField(max_length=160)
    room_type = models.CharField(max_length=80, default="general_room")
    purpose = models.CharField(max_length=40, choices=PURPOSE_CHOICES, default="general_room")
    guided_profile = models.CharField(max_length=40, blank=True, default="")
    default_unit_system = models.CharField(max_length=24, default="us_customary")
    status = models.CharField(max_length=24, choices=STATUS_CHOICES, default=STATUS_NEEDS_REVIEW, db_index=True)
    notes = models.TextField(blank=True, default="")
    captured_by = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.SET_NULL, null=True, related_name="captured_measurement_sessions")
    measured_at = models.DateTimeField(default=timezone.now)
    source_capture = models.OneToOneField("projects.Capture", on_delete=models.PROTECT, related_name="measurement_session")
    version = models.PositiveIntegerField(default=1)
    confirmed_by = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.SET_NULL, null=True, blank=True, related_name="confirmed_measurement_sessions")
    confirmed_at = models.DateTimeField(null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)


class MeasurementEntry(models.Model):
    DIMENSION_CHOICES = [
        (value, value.replace("_", " ").title()) for value in (
            "length", "width", "height", "depth", "thickness", "perimeter_segment",
            "diagonal", "radius", "diameter", "slope", "angle", "area_manual",
            "volume_manual", "opening_width", "opening_height", "other",
        )
    ]
    SOURCE_CHOICES = [
        (value, value.replace("_", " ").title()) for value in (
            "tape_measure", "manual_entry", "voice_transcript", "laser_manual_entry",
            "photo_reference", "existing_plan", "other",
        )
    ]
    VERIFICATION_CHOICES = [
        (value, value.replace("_", " ").title()) for value in (
            "estimated", "needs_verification", "verified", "confirmed",
        )
    ]
    session = models.ForeignKey(MeasurementSession, on_delete=models.CASCADE, related_name="entries")
    client_key = models.CharField(max_length=80)
    reading_group = models.CharField(max_length=80, blank=True, default="")
    label = models.CharField(max_length=160)
    dimension_type = models.CharField(max_length=32, choices=DIMENSION_CHOICES)
    normalized_value = models.DecimalField(max_digits=24, decimal_places=10)
    display_unit = models.CharField(max_length=32)
    raw_value = models.CharField(max_length=160)
    source_method = models.CharField(max_length=32, choices=SOURCE_CHOICES)
    verification_status = models.CharField(max_length=24, choices=VERIFICATION_CHOICES, default="needs_verification")
    confidence = models.DecimalField(max_digits=5, decimal_places=4, null=True, blank=True)
    tool_description = models.CharField(max_length=255, blank=True, default="")
    reference_entry = models.ForeignKey("self", on_delete=models.SET_NULL, null=True, blank=True, related_name="referenced_entries")
    selected_for_calculation = models.BooleanField(default=True)
    selection_method = models.CharField(max_length=24, blank=True, default="")
    direction = models.CharField(
        max_length=8,
        blank=True,
        default="",
        choices=[(value, value.title()) for value in ("north", "east", "south", "west")],
    )
    sequence = models.PositiveIntegerField(default=0)
    notes = models.TextField(blank=True, default="")
    measured_by = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.SET_NULL, null=True, related_name="measurement_entries")
    measured_at = models.DateTimeField(default=timezone.now)
    verified_by = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.SET_NULL, null=True, blank=True, related_name="verified_measurement_entries")
    verified_at = models.DateTimeField(null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["sequence", "id"]
        constraints = [models.UniqueConstraint(fields=["session", "client_key"], name="uniq_measurement_session_client_key")]


class MeasurementAdjustment(models.Model):
    TYPE_CHOICES = [(value, value.title()) for value in ("addition", "exclusion", "unmeasured")]
    session = models.ForeignKey(MeasurementSession, on_delete=models.CASCADE, related_name="adjustments")
    client_key = models.CharField(max_length=80)
    label = models.CharField(max_length=160)
    adjustment_type = models.CharField(max_length=24, choices=TYPE_CHOICES)
    source_entry_keys = models.JSONField(default=list)
    calculated_value = models.DecimalField(max_digits=24, decimal_places=10)
    normalized_unit = models.CharField(max_length=32, default="square_inches")
    notes = models.TextField(blank=True, default="")
    created_at = models.DateTimeField(auto_now_add=True)


class MeasurementCalculatedResult(models.Model):
    RESULT_CHOICES = [(value, value.replace("_", " ").title()) for value in (
        "gross_area", "net_area", "excluded_area", "perimeter",
        "total_linear_length", "volume", "opening_area", "custom_calculated",
    )]
    session = models.ForeignKey(MeasurementSession, on_delete=models.CASCADE, related_name="calculated_results")
    result_type = models.CharField(max_length=32, choices=RESULT_CHOICES)
    label = models.CharField(max_length=160)
    normalized_value = models.DecimalField(max_digits=24, decimal_places=10)
    normalized_unit = models.CharField(max_length=32)
    display_value = models.CharField(max_length=80)
    display_unit = models.CharField(max_length=32)
    formula_key = models.CharField(max_length=80)
    calculation_version = models.CharField(max_length=24, default="1")
    source_entry_keys = models.JSONField(default=list)
    adjustment_keys = models.JSONField(default=list)
    verification_status = models.CharField(max_length=24, default="needs_verification")
    lineage = models.JSONField(default=dict)
    revision = models.PositiveIntegerField(default=1)
    created_at = models.DateTimeField(auto_now_add=True)


class MeasurementAttachment(models.Model):
    session = models.ForeignKey(MeasurementSession, on_delete=models.CASCADE, related_name="attachments")
    artifact = models.OneToOneField("projects.CaptureArtifact", on_delete=models.PROTECT, related_name="measurement_attachment")
    attachment_type = models.CharField(max_length=32, default="room_overview")
    created_by = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.SET_NULL, null=True)
    created_at = models.DateTimeField(auto_now_add=True)


class MeasurementAnnotation(models.Model):
    attachment = models.ForeignKey(MeasurementAttachment, on_delete=models.CASCADE, related_name="annotations")
    label = models.CharField(max_length=160)
    line = models.JSONField(default=dict)
    entry_client_key = models.CharField(max_length=80, blank=True, default="")
    known_reference_value = models.DecimalField(max_digits=24, decimal_places=10, null=True, blank=True)
    verification_status = models.CharField(max_length=24, default="estimated")
    warning = models.CharField(max_length=255, default="Perspective may affect accuracy. Verify before contractual use.")
    created_at = models.DateTimeField(auto_now_add=True)


class MeasurementEvent(models.Model):
    session = models.ForeignKey(MeasurementSession, on_delete=models.CASCADE, related_name="events")
    event_type = models.CharField(max_length=40, db_index=True)
    actor = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.SET_NULL, null=True)
    session_version = models.PositiveIntegerField()
    metadata = models.JSONField(default=dict)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["created_at", "id"]
