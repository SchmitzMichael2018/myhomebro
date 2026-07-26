from django.conf import settings
from django.core.validators import MinValueValidator
from decimal import Decimal

from django.db import models


ZERO_OR_MORE = [MinValueValidator(Decimal("0"))]
POSITIVE = [MinValueValidator(Decimal("0.0000000001"))]


class MaterialLibraryItem(models.Model):
    SELLING_UNIT_CHOICES = [
        (value, value.replace("_", " ").title()) for value in (
            "each", "box", "case", "bundle", "sheet", "panel", "roll", "bag",
            "gallon", "quart", "linear_foot", "square_foot", "cubic_foot",
            "cubic_yard", "pound", "ton", "custom",
        )
    ]
    PRICE_BASIS_CHOICES = [
        (value, value.replace("_", " ").title()) for value in (
            "per_selling_unit", "per_square_foot", "per_linear_foot",
            "per_cubic_foot", "per_cubic_yard", "per_gallon", "per_each", "custom",
        )
    ]
    contractor = models.ForeignKey("projects.Contractor", on_delete=models.CASCADE, related_name="material_library")
    name = models.CharField(max_length=200)
    category = models.CharField(max_length=80)
    brand = models.CharField(max_length=120, blank=True, default="")
    manufacturer = models.CharField(max_length=120, blank=True, default="")
    supplier = models.CharField(max_length=160, blank=True, default="")
    supplier_sku = models.CharField(max_length=120, blank=True, default="")
    product_url = models.URLField(blank=True, default="")
    unit_price = models.DecimalField(max_digits=16, decimal_places=4, validators=ZERO_OR_MORE)
    price_basis = models.CharField(max_length=32, choices=PRICE_BASIS_CHOICES)
    selling_unit = models.CharField(max_length=32, choices=SELLING_UNIT_CHOICES)
    package_quantity = models.DecimalField(max_digits=18, decimal_places=6, default=1, validators=POSITIVE)
    coverage_quantity = models.DecimalField(max_digits=18, decimal_places=6, null=True, blank=True, validators=POSITIVE)
    coverage_unit = models.CharField(max_length=32, blank=True, default="")
    package_dimensions = models.JSONField(default=dict, blank=True)
    waste_default = models.DecimalField(max_digits=6, decimal_places=3, default=0, validators=ZERO_OR_MORE)
    tax_category = models.CharField(max_length=80, blank=True, default="")
    markup_default = models.DecimalField(max_digits=7, decimal_places=3, default=0, validators=ZERO_OR_MORE)
    is_active = models.BooleanField(default=True, db_index=True)
    is_preferred = models.BooleanField(default=False)
    price_source = models.CharField(max_length=160)
    price_effective_date = models.DateField()
    price_entered_by = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.SET_NULL, null=True, related_name="material_prices_entered")
    notes = models.TextField(blank=True, default="")
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["category", "-is_preferred", "name", "id"]
        constraints = [
            models.UniqueConstraint(fields=["contractor", "name", "supplier_sku"], name="uniq_material_library_name_sku"),
        ]


class MaterialAssembly(models.Model):
    contractor = models.ForeignKey("projects.Contractor", on_delete=models.CASCADE, related_name="material_assemblies")
    name = models.CharField(max_length=160)
    trade_profile = models.CharField(max_length=32)
    notes = models.TextField(blank=True, default="")
    is_active = models.BooleanField(default=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)


class MaterialAssemblyItem(models.Model):
    assembly = models.ForeignKey(MaterialAssembly, on_delete=models.CASCADE, related_name="items")
    material = models.ForeignKey(MaterialLibraryItem, on_delete=models.PROTECT, related_name="assembly_memberships")
    component = models.CharField(max_length=80)
    waste_override = models.DecimalField(max_digits=6, decimal_places=3, null=True, blank=True, validators=ZERO_OR_MORE)
    assumptions = models.JSONField(default=dict, blank=True)
    sequence = models.PositiveIntegerField(default=0)

    class Meta:
        ordering = ["sequence", "id"]


class TakeoffSession(models.Model):
    STATUS_CHOICES = [
        (value, value.replace("_", " ").title()) for value in (
            "draft", "calculating", "needs_information", "ready_for_review",
            "confirmed", "handed_off", "archived",
        )
    ]
    TRADE_CHOICES = [
        (value, value.replace("_", " ").title()) for value in (
            "flooring", "paint", "tile", "drywall", "linear_material", "concrete",
        )
    ]
    contractor = models.ForeignKey("projects.Contractor", on_delete=models.CASCADE, related_name="takeoff_sessions")
    project = models.ForeignKey("projects.Project", on_delete=models.CASCADE, related_name="takeoff_sessions")
    proposal = models.ForeignKey("projects.Proposal", on_delete=models.SET_NULL, null=True, blank=True, related_name="takeoff_sessions")
    measurement_session = models.ForeignKey("projects.MeasurementSession", on_delete=models.PROTECT, related_name="takeoff_sessions")
    trade_profile = models.CharField(max_length=32, choices=TRADE_CHOICES)
    status = models.CharField(max_length=32, choices=STATUS_CHOICES, default="draft", db_index=True)
    provisional = models.BooleanField(default=False)
    provisional_acknowledged = models.BooleanField(default=False)
    created_by = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.SET_NULL, null=True, related_name="takeoffs_created")
    reviewed_by = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.SET_NULL, null=True, blank=True, related_name="takeoffs_reviewed")
    confirmed_at = models.DateTimeField(null=True, blank=True)
    currency = models.CharField(max_length=3, default="USD")
    price_snapshot_at = models.DateTimeField(null=True, blank=True)
    subtotal = models.DecimalField(max_digits=18, decimal_places=4, default=0)
    tax = models.DecimalField(max_digits=18, decimal_places=4, default=0)
    markup = models.DecimalField(max_digits=18, decimal_places=4, default=0)
    total = models.DecimalField(max_digits=18, decimal_places=4, default=0)
    version = models.PositiveIntegerField(default=1)
    handoff_previewed_at = models.DateTimeField(null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)


class TakeoffItem(models.Model):
    session = models.ForeignKey(TakeoffSession, on_delete=models.CASCADE, related_name="items")
    material = models.ForeignKey(MaterialLibraryItem, on_delete=models.PROTECT, related_name="takeoff_items")
    measurement_result = models.ForeignKey("projects.MeasurementCalculatedResult", on_delete=models.PROTECT, related_name="takeoff_items")
    trade_component = models.CharField(max_length=80, default="primary_material")
    product_snapshot = models.JSONField(default=dict)
    theoretical_quantity = models.DecimalField(max_digits=24, decimal_places=10)
    waste_percentage = models.DecimalField(max_digits=7, decimal_places=3)
    waste_source = models.CharField(max_length=40)
    waste_quantity = models.DecimalField(max_digits=24, decimal_places=10)
    required_quantity = models.DecimalField(max_digits=24, decimal_places=10)
    purchase_quantity = models.DecimalField(max_digits=24, decimal_places=10)
    purchased_coverage = models.DecimalField(max_digits=24, decimal_places=10)
    excess_quantity = models.DecimalField(max_digits=24, decimal_places=10)
    selling_unit = models.CharField(max_length=32)
    package_coverage = models.DecimalField(max_digits=24, decimal_places=10)
    unit_price_snapshot = models.DecimalField(max_digits=16, decimal_places=4)
    subtotal = models.DecimalField(max_digits=18, decimal_places=4)
    tax = models.DecimalField(max_digits=18, decimal_places=4)
    markup = models.DecimalField(max_digits=18, decimal_places=4)
    final_estimated_cost = models.DecimalField(max_digits=18, decimal_places=4)
    calculation_version = models.CharField(max_length=24, default="1")
    rounding_policy = models.CharField(max_length=32, default="ceil_to_package")
    assumptions = models.JSONField(default=dict)
    warnings = models.JSONField(default=list)
    lineage = models.JSONField(default=dict)
    revision = models.PositiveIntegerField(default=1)
    sequence = models.PositiveIntegerField(default=0)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)


class TakeoffEvent(models.Model):
    session = models.ForeignKey(TakeoffSession, on_delete=models.CASCADE, related_name="events")
    event_type = models.CharField(max_length=48, db_index=True)
    actor = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.SET_NULL, null=True)
    session_version = models.PositiveIntegerField()
    metadata = models.JSONField(default=dict)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["created_at", "id"]
