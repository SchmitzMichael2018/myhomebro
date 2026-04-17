from __future__ import annotations

from decimal import Decimal

from django.db import models


class AgreementOutcomeSnapshot(models.Model):
    """
    Normalized completed-project snapshot used as the durable learning layer.

    Future estimation, timeline, milestone-composition, and template-intelligence
    features should read from this snapshot layer and the derived aggregates
    instead of recomputing directly from raw agreements on every request.
    """

    agreement = models.OneToOneField(
        "projects.Agreement",
        on_delete=models.CASCADE,
        related_name="outcome_snapshot",
    )
    contractor = models.ForeignKey(
        "projects.Contractor",
        null=True,
        blank=True,
        on_delete=models.SET_NULL,
        related_name="outcome_snapshots",
    )
    template = models.ForeignKey(
        "projects.ProjectTemplate",
        null=True,
        blank=True,
        on_delete=models.SET_NULL,
        related_name="outcome_snapshots",
    )
    template_name_snapshot = models.CharField(max_length=255, blank=True, default="")
    template_benchmark_match_key = models.CharField(max_length=120, blank=True, default="", db_index=True)

    project_type = models.CharField(max_length=120, blank=True, default="", db_index=True)
    project_subtype = models.CharField(max_length=120, blank=True, default="")

    country = models.CharField(max_length=8, blank=True, default="US")
    state = models.CharField(max_length=64, blank=True, default="")
    city = models.CharField(max_length=128, blank=True, default="")
    postal_code = models.CharField(max_length=20, blank=True, default="")
    normalized_region_key = models.CharField(max_length=255, blank=True, default="", db_index=True)

    payment_mode = models.CharField(max_length=20, blank=True, default="")
    signature_policy = models.CharField(max_length=32, blank=True, default="")

    estimated_total_amount = models.DecimalField(max_digits=12, decimal_places=2, null=True, blank=True)
    final_agreed_total_amount = models.DecimalField(max_digits=12, decimal_places=2, default=Decimal("0.00"))
    final_paid_amount = models.DecimalField(max_digits=12, decimal_places=2, default=Decimal("0.00"))
    retainage_percent = models.DecimalField(max_digits=5, decimal_places=2, default=Decimal("0.00"))
    retainage_amount = models.DecimalField(max_digits=12, decimal_places=2, default=Decimal("0.00"))

    agreement_start_date = models.DateField(null=True, blank=True)
    agreement_target_end_date = models.DateField(null=True, blank=True)
    agreement_completed_date = models.DateField(null=True, blank=True, db_index=True)

    estimated_duration_days = models.PositiveIntegerField(null=True, blank=True)
    actual_duration_days = models.PositiveIntegerField(null=True, blank=True)

    milestone_count = models.PositiveIntegerField(default=0)
    milestone_summary = models.JSONField(default=dict, blank=True)
    clarification_summary = models.JSONField(default=dict, blank=True)
    clarification_traits = models.JSONField(default=dict, blank=True)
    clarification_signature = models.CharField(max_length=64, blank=True, default="", db_index=True)

    has_amendments = models.BooleanField(default=False)
    amendment_count = models.PositiveIntegerField(default=0)
    has_change_orders = models.BooleanField(default=False)
    change_order_count = models.PositiveIntegerField(default=0)
    has_disputes = models.BooleanField(default=False)
    dispute_count = models.PositiveIntegerField(default=0)

    excluded_from_benchmarks = models.BooleanField(default=False, db_index=True)
    exclusion_reason = models.CharField(max_length=255, blank=True, default="")

    snapshot_version = models.PositiveIntegerField(default=1)
    snapshot_created_at = models.DateTimeField(auto_now_add=True)
    snapshot_updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["-agreement_completed_date", "-snapshot_updated_at", "-id"]
        indexes = [
            models.Index(fields=["excluded_from_benchmarks", "agreement_completed_date"]),
            models.Index(fields=["project_type", "project_subtype"]),
            models.Index(fields=["template"]),
            models.Index(fields=["contractor"]),
            models.Index(fields=["normalized_region_key"]),
            models.Index(fields=["project_type", "project_subtype", "clarification_signature"]),
        ]

    def __str__(self) -> str:
        return f"OutcomeSnapshot(agreement={self.agreement_id}, excluded={self.excluded_from_benchmarks})"


class AgreementOutcomeMilestoneSnapshot(models.Model):
    snapshot = models.ForeignKey(
        AgreementOutcomeSnapshot,
        on_delete=models.CASCADE,
        related_name="milestones",
    )
    milestone = models.ForeignKey(
        "projects.Milestone",
        null=True,
        blank=True,
        on_delete=models.SET_NULL,
        related_name="outcome_snapshots",
    )

    sort_order = models.PositiveIntegerField(default=0)
    title = models.CharField(max_length=255, blank=True, default="")
    normalized_milestone_type = models.CharField(max_length=128, blank=True, default="", db_index=True)

    amount = models.DecimalField(max_digits=12, decimal_places=2, default=Decimal("0.00"))
    template_suggested_amount = models.DecimalField(max_digits=12, decimal_places=2, null=True, blank=True)
    ai_suggested_amount = models.DecimalField(max_digits=12, decimal_places=2, null=True, blank=True)
    estimated_amount = models.DecimalField(max_digits=12, decimal_places=2, null=True, blank=True)
    amount_delta_from_estimate = models.DecimalField(max_digits=12, decimal_places=2, null=True, blank=True)

    start_date = models.DateField(null=True, blank=True)
    completion_date = models.DateField(null=True, blank=True)
    estimated_offset_days = models.PositiveIntegerField(null=True, blank=True)
    estimated_duration_days = models.PositiveIntegerField(null=True, blank=True)
    actual_duration_days = models.PositiveIntegerField(null=True, blank=True)
    duration_delta_from_estimate = models.IntegerField(null=True, blank=True)
    has_invoice = models.BooleanField(default=False)
    invoice_count = models.PositiveIntegerField(default=0)
    invoiced_amount = models.DecimalField(max_digits=12, decimal_places=2, default=Decimal("0.00"))
    paid_amount = models.DecimalField(max_digits=12, decimal_places=2, default=Decimal("0.00"))
    has_dispute = models.BooleanField(default=False)
    dispute_count = models.PositiveIntegerField(default=0)
    is_rework = models.BooleanField(default=False)
    rework_origin_milestone_id = models.IntegerField(null=True, blank=True)

    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["sort_order", "id"]
        indexes = [
            models.Index(fields=["snapshot", "sort_order"]),
            models.Index(fields=["normalized_milestone_type"]),
            models.Index(fields=["has_dispute", "is_rework"]),
        ]

    def __str__(self) -> str:
        return f"OutcomeMilestoneSnapshot(snapshot={self.snapshot_id}, order={self.sort_order})"


class AgreementProposalSnapshot(models.Model):
    """
    Append-only proposal snapshot used to learn from contractor-written bids.

    Draft snapshots are captured when an agreement is created. Final snapshots
    are captured when an agreement reaches a successful final outcome. Future
    proposal drafting can read from the successful final snapshots and fall back
    to deterministic generation when there is not enough data.
    """

    class Stage(models.TextChoices):
        DRAFT_CREATED = "draft_created", "Draft Created"
        FINALIZED = "finalized", "Finalized"

    agreement = models.ForeignKey(
        "projects.Agreement",
        on_delete=models.CASCADE,
        related_name="proposal_snapshots",
    )
    contractor = models.ForeignKey(
        "projects.Contractor",
        null=True,
        blank=True,
        on_delete=models.SET_NULL,
        related_name="proposal_snapshots",
    )
    source_lead = models.ForeignKey(
        "projects.PublicContractorLead",
        null=True,
        blank=True,
        on_delete=models.SET_NULL,
        related_name="proposal_snapshots",
    )
    template = models.ForeignKey(
        "projects.ProjectTemplate",
        null=True,
        blank=True,
        on_delete=models.SET_NULL,
        related_name="proposal_snapshots",
    )

    stage = models.CharField(max_length=24, choices=Stage.choices, db_index=True)
    is_successful = models.BooleanField(default=False, db_index=True)
    success_reason = models.CharField(max_length=255, blank=True, default="")

    project_title = models.CharField(max_length=255, blank=True, default="")
    project_type = models.CharField(max_length=120, blank=True, default="", db_index=True)
    project_subtype = models.CharField(max_length=120, blank=True, default="")
    proposal_text = models.TextField(blank=True, default="")

    budget_text = models.CharField(max_length=255, blank=True, default="")
    timeline_text = models.CharField(max_length=255, blank=True, default="")
    measurement_handling = models.CharField(max_length=80, blank=True, default="")
    photo_count = models.PositiveIntegerField(default=0)
    request_path_label = models.CharField(max_length=120, blank=True, default="")

    request_signals = models.JSONField(default=list, blank=True)
    clarification_summary = models.JSONField(default=list, blank=True)
    metadata = models.JSONField(default=dict, blank=True)

    agreement_status = models.CharField(max_length=32, blank=True, default="", db_index=True)

    snapshot_created_at = models.DateTimeField(auto_now_add=True)
    snapshot_updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["-snapshot_created_at", "-id"]
        constraints = [
            models.UniqueConstraint(
                fields=["agreement", "stage"],
                name="uniq_agreement_proposal_snapshot_stage",
            )
        ]
        indexes = [
            models.Index(fields=["stage", "is_successful", "project_type", "project_subtype"]),
            models.Index(fields=["project_type", "project_subtype", "is_successful"]),
            models.Index(fields=["contractor", "stage"]),
            models.Index(fields=["source_lead"]),
        ]

    def __str__(self) -> str:
        return f"ProposalSnapshot(agreement={self.agreement_id}, stage={self.stage}, success={self.is_successful})"


class ProjectBenchmarkAggregate(models.Model):
    class Scope(models.TextChoices):
        GLOBAL = "global", "Global"
        REGIONAL = "regional", "Regional"
        TEMPLATE = "template", "Template"
        CONTRACTOR = "contractor", "Contractor"

    scope = models.CharField(max_length=24, choices=Scope.choices, db_index=True)

    contractor = models.ForeignKey(
        "projects.Contractor",
        null=True,
        blank=True,
        on_delete=models.SET_NULL,
        related_name="project_benchmark_aggregates",
    )
    template = models.ForeignKey(
        "projects.ProjectTemplate",
        null=True,
        blank=True,
        on_delete=models.SET_NULL,
        related_name="project_benchmark_aggregates",
    )

    project_type = models.CharField(max_length=120, blank=True, default="", db_index=True)
    project_subtype = models.CharField(max_length=120, blank=True, default="")
    clarification_signature = models.CharField(max_length=64, blank=True, default="", db_index=True)
    clarification_traits = models.JSONField(default=dict, blank=True)

    country = models.CharField(max_length=8, blank=True, default="US")
    state = models.CharField(max_length=64, blank=True, default="")
    city = models.CharField(max_length=128, blank=True, default="")
    normalized_region_key = models.CharField(max_length=255, blank=True, default="", db_index=True)

    completed_project_count = models.PositiveIntegerField(default=0)

    average_final_total = models.DecimalField(max_digits=12, decimal_places=2, default=Decimal("0.00"))
    average_final_paid_amount = models.DecimalField(max_digits=12, decimal_places=2, default=Decimal("0.00"))
    median_final_total = models.DecimalField(max_digits=12, decimal_places=2, default=Decimal("0.00"))
    min_final_total = models.DecimalField(max_digits=12, decimal_places=2, default=Decimal("0.00"))
    max_final_total = models.DecimalField(max_digits=12, decimal_places=2, default=Decimal("0.00"))

    average_actual_duration_days = models.DecimalField(max_digits=10, decimal_places=2, default=Decimal("0.00"))
    median_actual_duration_days = models.DecimalField(max_digits=10, decimal_places=2, default=Decimal("0.00"))
    average_milestone_count = models.DecimalField(max_digits=10, decimal_places=2, default=Decimal("0.00"))

    average_retainage_amount = models.DecimalField(max_digits=12, decimal_places=2, default=Decimal("0.00"))
    average_retainage_percent = models.DecimalField(max_digits=8, decimal_places=2, default=Decimal("0.00"))
    average_change_order_count = models.DecimalField(max_digits=10, decimal_places=2, default=Decimal("0.00"))
    average_dispute_count = models.DecimalField(max_digits=10, decimal_places=2, default=Decimal("0.00"))
    average_estimate_variance_amount = models.DecimalField(max_digits=12, decimal_places=2, default=Decimal("0.00"))
    average_estimate_variance_percent = models.DecimalField(max_digits=8, decimal_places=2, default=Decimal("0.00"))
    average_duration_variance_days = models.DecimalField(max_digits=10, decimal_places=2, default=Decimal("0.00"))
    change_order_project_count = models.PositiveIntegerField(default=0)
    dispute_project_count = models.PositiveIntegerField(default=0)

    amount_sample_size = models.PositiveIntegerField(default=0)
    duration_sample_size = models.PositiveIntegerField(default=0)
    estimate_variance_sample_size = models.PositiveIntegerField(default=0)
    duration_variance_sample_size = models.PositiveIntegerField(default=0)

    amount_stddev = models.DecimalField(max_digits=12, decimal_places=2, default=Decimal("0.00"))
    duration_stddev = models.DecimalField(max_digits=10, decimal_places=2, default=Decimal("0.00"))

    region_granularity = models.CharField(max_length=32, blank=True, default="none")
    common_milestone_patterns = models.JSONField(default=list, blank=True)
    metadata = models.JSONField(default=dict, blank=True)

    first_snapshot_completed_date = models.DateField(null=True, blank=True)
    last_snapshot_completed_date = models.DateField(null=True, blank=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["scope", "project_type", "project_subtype", "normalized_region_key", "id"]
        constraints = [
            models.UniqueConstraint(
                fields=[
                    "scope",
                    "contractor",
                    "template",
                    "project_type",
                    "project_subtype",
                    "clarification_signature",
                    "normalized_region_key",
                ],
                name="uniq_project_benchmark_scope_dimensions",
            )
        ]
        indexes = [
            models.Index(fields=["scope", "project_type", "project_subtype"]),
            models.Index(fields=["scope", "normalized_region_key"]),
            models.Index(fields=["scope", "template"]),
            models.Index(fields=["scope", "contractor"]),
            models.Index(fields=["scope", "project_type", "project_subtype", "clarification_signature"]),
        ]

    def __str__(self) -> str:
        return f"ProjectBenchmarkAggregate(scope={self.scope}, type={self.project_type}, subtype={self.project_subtype})"


class MilestoneBenchmarkAggregate(models.Model):
    class Scope(models.TextChoices):
        GLOBAL = "global", "Global"
        REGIONAL = "regional", "Regional"
        TEMPLATE = "template", "Template"
        CONTRACTOR = "contractor", "Contractor"

    scope = models.CharField(max_length=24, choices=Scope.choices, db_index=True)

    contractor = models.ForeignKey(
        "projects.Contractor",
        null=True,
        blank=True,
        on_delete=models.SET_NULL,
        related_name="milestone_benchmark_aggregates",
    )
    template = models.ForeignKey(
        "projects.ProjectTemplate",
        null=True,
        blank=True,
        on_delete=models.SET_NULL,
        related_name="milestone_benchmark_aggregates",
    )

    project_type = models.CharField(max_length=120, blank=True, default="", db_index=True)
    project_subtype = models.CharField(max_length=120, blank=True, default="")
    clarification_signature = models.CharField(max_length=64, blank=True, default="", db_index=True)
    clarification_traits = models.JSONField(default=dict, blank=True)
    normalized_milestone_type = models.CharField(max_length=128, blank=True, default="", db_index=True)

    country = models.CharField(max_length=8, blank=True, default="US")
    state = models.CharField(max_length=64, blank=True, default="")
    city = models.CharField(max_length=128, blank=True, default="")
    normalized_region_key = models.CharField(max_length=255, blank=True, default="", db_index=True)

    completed_milestone_count = models.PositiveIntegerField(default=0)
    paid_milestone_count = models.PositiveIntegerField(default=0)
    disputed_milestone_count = models.PositiveIntegerField(default=0)
    rework_milestone_count = models.PositiveIntegerField(default=0)

    average_final_amount = models.DecimalField(max_digits=12, decimal_places=2, default=Decimal("0.00"))
    median_final_amount = models.DecimalField(max_digits=12, decimal_places=2, default=Decimal("0.00"))
    min_final_amount = models.DecimalField(max_digits=12, decimal_places=2, default=Decimal("0.00"))
    max_final_amount = models.DecimalField(max_digits=12, decimal_places=2, default=Decimal("0.00"))
    average_paid_amount = models.DecimalField(max_digits=12, decimal_places=2, default=Decimal("0.00"))
    average_actual_duration_days = models.DecimalField(max_digits=10, decimal_places=2, default=Decimal("0.00"))
    median_actual_duration_days = models.DecimalField(max_digits=10, decimal_places=2, default=Decimal("0.00"))
    average_estimate_variance_amount = models.DecimalField(max_digits=12, decimal_places=2, default=Decimal("0.00"))
    average_duration_variance_days = models.DecimalField(max_digits=10, decimal_places=2, default=Decimal("0.00"))

    amount_sample_size = models.PositiveIntegerField(default=0)
    duration_sample_size = models.PositiveIntegerField(default=0)
    estimate_variance_sample_size = models.PositiveIntegerField(default=0)
    duration_variance_sample_size = models.PositiveIntegerField(default=0)

    metadata = models.JSONField(default=dict, blank=True)
    first_snapshot_completed_date = models.DateField(null=True, blank=True)
    last_snapshot_completed_date = models.DateField(null=True, blank=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["scope", "project_type", "project_subtype", "normalized_milestone_type", "id"]
        constraints = [
            models.UniqueConstraint(
                fields=[
                    "scope",
                    "contractor",
                    "template",
                    "project_type",
                    "project_subtype",
                    "clarification_signature",
                    "normalized_region_key",
                    "normalized_milestone_type",
                ],
                name="uniq_milestone_benchmark_scope_dimensions",
            )
        ]
        indexes = [
            models.Index(fields=["scope", "project_type", "project_subtype", "normalized_milestone_type"]),
            models.Index(fields=["scope", "normalized_region_key", "normalized_milestone_type"]),
            models.Index(fields=["scope", "template", "normalized_milestone_type"]),
            models.Index(fields=["scope", "contractor", "normalized_milestone_type"]),
        ]

    def __str__(self) -> str:
        return (
            f"MilestoneBenchmarkAggregate(scope={self.scope}, type={self.project_type}, "
            f"subtype={self.project_subtype}, milestone_type={self.normalized_milestone_type})"
        )
