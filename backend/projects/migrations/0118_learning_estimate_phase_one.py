from decimal import Decimal

from django.db import migrations, models
import django.db.models.deletion


class Migration(migrations.Migration):

    dependencies = [
        ("projects", "0117_projecttemplate_exclusions_text_and_more"),
    ]

    operations = [
        migrations.AddField(
            model_name="agreementoutcomesnapshot",
            name="clarification_signature",
            field=models.CharField(blank=True, db_index=True, default="", max_length=64),
        ),
        migrations.AddField(
            model_name="agreementoutcomesnapshot",
            name="clarification_traits",
            field=models.JSONField(blank=True, default=dict),
        ),
        migrations.AddField(
            model_name="agreementoutcomesnapshot",
            name="change_order_count",
            field=models.PositiveIntegerField(default=0),
        ),
        migrations.AddField(
            model_name="agreementoutcomesnapshot",
            name="has_change_orders",
            field=models.BooleanField(default=False),
        ),
        migrations.AddField(
            model_name="agreementoutcomesnapshot",
            name="template_benchmark_match_key",
            field=models.CharField(blank=True, db_index=True, default="", max_length=120),
        ),
        migrations.AddField(
            model_name="agreementoutcomesnapshot",
            name="template_name_snapshot",
            field=models.CharField(blank=True, default="", max_length=255),
        ),
        migrations.AddIndex(
            model_name="agreementoutcomesnapshot",
            index=models.Index(fields=["project_type", "project_subtype", "clarification_signature"], name="projects_ag_projec_f272bd_idx"),
        ),
        migrations.AddField(
            model_name="agreementoutcomemilestonesnapshot",
            name="amount_delta_from_estimate",
            field=models.DecimalField(blank=True, decimal_places=2, max_digits=12, null=True),
        ),
        migrations.AddField(
            model_name="agreementoutcomemilestonesnapshot",
            name="dispute_count",
            field=models.PositiveIntegerField(default=0),
        ),
        migrations.AddField(
            model_name="agreementoutcomemilestonesnapshot",
            name="duration_delta_from_estimate",
            field=models.IntegerField(blank=True, null=True),
        ),
        migrations.AddField(
            model_name="agreementoutcomemilestonesnapshot",
            name="estimated_amount",
            field=models.DecimalField(blank=True, decimal_places=2, max_digits=12, null=True),
        ),
        migrations.AddField(
            model_name="agreementoutcomemilestonesnapshot",
            name="has_dispute",
            field=models.BooleanField(default=False),
        ),
        migrations.AddField(
            model_name="agreementoutcomemilestonesnapshot",
            name="has_invoice",
            field=models.BooleanField(default=False),
        ),
        migrations.AddField(
            model_name="agreementoutcomemilestonesnapshot",
            name="invoice_count",
            field=models.PositiveIntegerField(default=0),
        ),
        migrations.AddField(
            model_name="agreementoutcomemilestonesnapshot",
            name="invoiced_amount",
            field=models.DecimalField(decimal_places=2, default=Decimal("0.00"), max_digits=12),
        ),
        migrations.AddField(
            model_name="agreementoutcomemilestonesnapshot",
            name="is_rework",
            field=models.BooleanField(default=False),
        ),
        migrations.AddField(
            model_name="agreementoutcomemilestonesnapshot",
            name="paid_amount",
            field=models.DecimalField(decimal_places=2, default=Decimal("0.00"), max_digits=12),
        ),
        migrations.AddField(
            model_name="agreementoutcomemilestonesnapshot",
            name="rework_origin_milestone_id",
            field=models.IntegerField(blank=True, null=True),
        ),
        migrations.AddIndex(
            model_name="agreementoutcomemilestonesnapshot",
            index=models.Index(fields=["has_dispute", "is_rework"], name="projects_ag_has_dis_302823_idx"),
        ),
        migrations.AddField(
            model_name="projectbenchmarkaggregate",
            name="average_change_order_count",
            field=models.DecimalField(decimal_places=2, default=Decimal("0.00"), max_digits=10),
        ),
        migrations.AddField(
            model_name="projectbenchmarkaggregate",
            name="average_dispute_count",
            field=models.DecimalField(decimal_places=2, default=Decimal("0.00"), max_digits=10),
        ),
        migrations.AddField(
            model_name="projectbenchmarkaggregate",
            name="average_final_paid_amount",
            field=models.DecimalField(decimal_places=2, default=Decimal("0.00"), max_digits=12),
        ),
        migrations.AddField(
            model_name="projectbenchmarkaggregate",
            name="change_order_project_count",
            field=models.PositiveIntegerField(default=0),
        ),
        migrations.AddField(
            model_name="projectbenchmarkaggregate",
            name="clarification_signature",
            field=models.CharField(blank=True, db_index=True, default="", max_length=64),
        ),
        migrations.AddField(
            model_name="projectbenchmarkaggregate",
            name="clarification_traits",
            field=models.JSONField(blank=True, default=dict),
        ),
        migrations.AddField(
            model_name="projectbenchmarkaggregate",
            name="dispute_project_count",
            field=models.PositiveIntegerField(default=0),
        ),
        migrations.AddField(
            model_name="projectbenchmarkaggregate",
            name="first_snapshot_completed_date",
            field=models.DateField(blank=True, null=True),
        ),
        migrations.RemoveConstraint(
            model_name="projectbenchmarkaggregate",
            name="uniq_project_benchmark_scope_dimensions",
        ),
        migrations.AddConstraint(
            model_name="projectbenchmarkaggregate",
            constraint=models.UniqueConstraint(fields=("scope", "contractor", "template", "project_type", "project_subtype", "clarification_signature", "normalized_region_key"), name="uniq_project_benchmark_scope_dimensions"),
        ),
        migrations.AddIndex(
            model_name="projectbenchmarkaggregate",
            index=models.Index(fields=["scope", "project_type", "project_subtype", "clarification_signature"], name="projects_pr_scope_70f09c_idx"),
        ),
        migrations.CreateModel(
            name="MilestoneBenchmarkAggregate",
            fields=[
                ("id", models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name="ID")),
                ("scope", models.CharField(choices=[("global", "Global"), ("regional", "Regional"), ("template", "Template"), ("contractor", "Contractor")], db_index=True, max_length=24)),
                ("project_type", models.CharField(blank=True, db_index=True, default="", max_length=120)),
                ("project_subtype", models.CharField(blank=True, default="", max_length=120)),
                ("clarification_signature", models.CharField(blank=True, db_index=True, default="", max_length=64)),
                ("clarification_traits", models.JSONField(blank=True, default=dict)),
                ("normalized_milestone_type", models.CharField(blank=True, db_index=True, default="", max_length=128)),
                ("country", models.CharField(blank=True, default="US", max_length=8)),
                ("state", models.CharField(blank=True, default="", max_length=64)),
                ("city", models.CharField(blank=True, default="", max_length=128)),
                ("normalized_region_key", models.CharField(blank=True, db_index=True, default="", max_length=255)),
                ("completed_milestone_count", models.PositiveIntegerField(default=0)),
                ("paid_milestone_count", models.PositiveIntegerField(default=0)),
                ("disputed_milestone_count", models.PositiveIntegerField(default=0)),
                ("rework_milestone_count", models.PositiveIntegerField(default=0)),
                ("average_final_amount", models.DecimalField(decimal_places=2, default=Decimal("0.00"), max_digits=12)),
                ("median_final_amount", models.DecimalField(decimal_places=2, default=Decimal("0.00"), max_digits=12)),
                ("min_final_amount", models.DecimalField(decimal_places=2, default=Decimal("0.00"), max_digits=12)),
                ("max_final_amount", models.DecimalField(decimal_places=2, default=Decimal("0.00"), max_digits=12)),
                ("average_paid_amount", models.DecimalField(decimal_places=2, default=Decimal("0.00"), max_digits=12)),
                ("average_actual_duration_days", models.DecimalField(decimal_places=2, default=Decimal("0.00"), max_digits=10)),
                ("median_actual_duration_days", models.DecimalField(decimal_places=2, default=Decimal("0.00"), max_digits=10)),
                ("average_estimate_variance_amount", models.DecimalField(decimal_places=2, default=Decimal("0.00"), max_digits=12)),
                ("average_duration_variance_days", models.DecimalField(decimal_places=2, default=Decimal("0.00"), max_digits=10)),
                ("amount_sample_size", models.PositiveIntegerField(default=0)),
                ("duration_sample_size", models.PositiveIntegerField(default=0)),
                ("estimate_variance_sample_size", models.PositiveIntegerField(default=0)),
                ("duration_variance_sample_size", models.PositiveIntegerField(default=0)),
                ("metadata", models.JSONField(blank=True, default=dict)),
                ("first_snapshot_completed_date", models.DateField(blank=True, null=True)),
                ("last_snapshot_completed_date", models.DateField(blank=True, null=True)),
                ("updated_at", models.DateTimeField(auto_now=True)),
                ("contractor", models.ForeignKey(blank=True, null=True, on_delete=django.db.models.deletion.SET_NULL, related_name="milestone_benchmark_aggregates", to="projects.contractor")),
                ("template", models.ForeignKey(blank=True, null=True, on_delete=django.db.models.deletion.SET_NULL, related_name="milestone_benchmark_aggregates", to="projects.projecttemplate")),
            ],
            options={
                "ordering": ["scope", "project_type", "project_subtype", "normalized_milestone_type", "id"],
            },
        ),
        migrations.AddIndex(
            model_name="milestonebenchmarkaggregate",
            index=models.Index(fields=["scope", "project_type", "project_subtype", "normalized_milestone_type"], name="projects_mi_scope_4d52b3_idx"),
        ),
        migrations.AddIndex(
            model_name="milestonebenchmarkaggregate",
            index=models.Index(fields=["scope", "normalized_region_key", "normalized_milestone_type"], name="projects_mi_scope_22b626_idx"),
        ),
        migrations.AddIndex(
            model_name="milestonebenchmarkaggregate",
            index=models.Index(fields=["scope", "template", "normalized_milestone_type"], name="projects_mi_scope_e56c7d_idx"),
        ),
        migrations.AddIndex(
            model_name="milestonebenchmarkaggregate",
            index=models.Index(fields=["scope", "contractor", "normalized_milestone_type"], name="projects_mi_scope_2c5f66_idx"),
        ),
        migrations.AddConstraint(
            model_name="milestonebenchmarkaggregate",
            constraint=models.UniqueConstraint(fields=("scope", "contractor", "template", "project_type", "project_subtype", "clarification_signature", "normalized_region_key", "normalized_milestone_type"), name="uniq_milestone_benchmark_scope_dimensions"),
        ),
    ]
