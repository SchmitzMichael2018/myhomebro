from decimal import Decimal

import django.db.models.deletion
from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("projects", "0179_contractor_edit_event"),
    ]

    operations = [
        migrations.CreateModel(
            name="MilestonePerformanceSnapshot",
            fields=[
                ("id", models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name="ID")),
                ("project_title", models.CharField(blank=True, default="", max_length=255)),
                ("project_type", models.CharField(blank=True, db_index=True, default="", max_length=120)),
                ("project_subtype", models.CharField(blank=True, default="", max_length=160)),
                ("draft_source", models.CharField(blank=True, db_index=True, default="", max_length=32)),
                ("template_name_snapshot", models.CharField(blank=True, default="", max_length=255)),
                ("milestone_order", models.PositiveIntegerField(default=0)),
                ("milestone_title", models.CharField(blank=True, default="", max_length=255)),
                ("normalized_milestone_type", models.CharField(blank=True, db_index=True, default="", max_length=128)),
                ("milestone_amount", models.DecimalField(decimal_places=2, default=Decimal("0.00"), max_digits=12)),
                ("planned_start_date", models.DateField(blank=True, null=True)),
                ("planned_completion_date", models.DateField(blank=True, null=True)),
                ("contractor_completed_at", models.DateTimeField(blank=True, db_index=True, null=True)),
                ("homeowner_approved_at", models.DateTimeField(blank=True, null=True)),
                ("invoice_created_at", models.DateTimeField(blank=True, null=True)),
                ("invoice_paid_at", models.DateTimeField(blank=True, null=True)),
                ("escrow_released_at", models.DateTimeField(blank=True, null=True)),
                ("dispute_opened_at", models.DateTimeField(blank=True, null=True)),
                ("dispute_resolved_at", models.DateTimeField(blank=True, null=True)),
                ("planned_vs_actual_completion_days", models.IntegerField(blank=True, null=True)),
                ("completion_to_approval_seconds", models.PositiveIntegerField(blank=True, null=True)),
                ("approval_to_payment_release_seconds", models.PositiveIntegerField(blank=True, null=True)),
                ("invoice_to_payment_release_seconds", models.PositiveIntegerField(blank=True, null=True)),
                ("total_lifecycle_seconds", models.PositiveIntegerField(blank=True, null=True)),
                ("is_delayed", models.BooleanField(db_index=True, default=False)),
                ("source_event", models.CharField(blank=True, db_index=True, default="", max_length=64)),
                ("state_signature", models.CharField(db_index=True, max_length=64)),
                ("metadata", models.JSONField(blank=True, default=dict)),
                ("created_at", models.DateTimeField(auto_now_add=True, db_index=True)),
                ("agreement", models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name="milestone_performance_snapshots", to="projects.agreement")),
                ("contractor", models.ForeignKey(blank=True, null=True, on_delete=django.db.models.deletion.SET_NULL, related_name="milestone_performance_snapshots", to="projects.contractor")),
                ("invoice", models.ForeignKey(blank=True, null=True, on_delete=django.db.models.deletion.SET_NULL, related_name="milestone_performance_snapshots", to="projects.invoice")),
                ("milestone", models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name="performance_snapshots", to="projects.milestone")),
                ("selected_template", models.ForeignKey(blank=True, null=True, on_delete=django.db.models.deletion.SET_NULL, related_name="milestone_performance_snapshots", to="projects.projecttemplate")),
            ],
            options={
                "ordering": ["-created_at", "-id"],
                "indexes": [
                    models.Index(fields=["agreement", "milestone"], name="projects_mi_agreeme_516d01_idx"),
                    models.Index(fields=["contractor", "project_type"], name="projects_mi_contrac_3112df_idx"),
                    models.Index(fields=["normalized_milestone_type"], name="projects_mi_normali_1f8046_idx"),
                    models.Index(fields=["source_event"], name="projects_mi_source__fbf6e5_idx"),
                    models.Index(fields=["created_at"], name="projects_mi_created_92c059_idx"),
                ],
            },
        ),
    ]
