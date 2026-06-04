from decimal import Decimal

import django.db.models.deletion
from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("projects", "0180_milestone_performance_snapshot"),
    ]

    operations = [
        migrations.CreateModel(
            name="SignedAgreementSnapshot",
            fields=[
                ("id", models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name="ID")),
                ("project_title", models.CharField(blank=True, default="", max_length=255)),
                ("project_type", models.CharField(blank=True, db_index=True, default="", max_length=120)),
                ("project_subtype", models.CharField(blank=True, default="", max_length=160)),
                ("signed_scope", models.TextField(blank=True, default="")),
                ("exclusions", models.TextField(blank=True, default="")),
                ("customer_responsibilities", models.TextField(blank=True, default="")),
                ("milestone_count", models.PositiveIntegerField(default=0)),
                ("milestone_details", models.JSONField(blank=True, default=list)),
                ("contract_amount", models.DecimalField(decimal_places=2, default=Decimal("0.00"), max_digits=12)),
                ("pricing_structure", models.CharField(blank=True, default="", max_length=64)),
                ("payment_structure", models.CharField(blank=True, db_index=True, default="", max_length=32)),
                ("payment_mode", models.CharField(blank=True, default="", max_length=32)),
                ("retainage_percent", models.DecimalField(decimal_places=2, default=Decimal("0.00"), max_digits=5)),
                ("draft_source", models.CharField(blank=True, db_index=True, default="", max_length=32)),
                ("template_name_snapshot", models.CharField(blank=True, default="", max_length=255)),
                ("template_recommendation_result", models.JSONField(blank=True, default=dict)),
                ("template_recommendation_tier", models.CharField(blank=True, db_index=True, default="", max_length=64)),
                ("amendment_number", models.PositiveIntegerField(default=0)),
                ("pdf_version", models.PositiveIntegerField(default=0)),
                ("pdf_version_id", models.PositiveIntegerField(blank=True, null=True)),
                ("warranty_type", models.CharField(blank=True, default="", max_length=32)),
                ("warranty_text", models.TextField(blank=True, default="")),
                ("contractor_signed_at", models.DateTimeField(blank=True, null=True)),
                ("homeowner_signed_at", models.DateTimeField(blank=True, null=True)),
                ("fully_signed_at", models.DateTimeField(blank=True, db_index=True, null=True)),
                ("snapshot_version", models.PositiveIntegerField(default=1)),
                ("created_at", models.DateTimeField(auto_now_add=True, db_index=True)),
                (
                    "agreement",
                    models.ForeignKey(
                        on_delete=django.db.models.deletion.CASCADE,
                        related_name="signed_agreement_snapshots",
                        to="projects.agreement",
                    ),
                ),
                (
                    "contractor",
                    models.ForeignKey(
                        blank=True,
                        null=True,
                        on_delete=django.db.models.deletion.SET_NULL,
                        related_name="signed_agreement_snapshots",
                        to="projects.contractor",
                    ),
                ),
                (
                    "draft_intelligence_snapshot",
                    models.ForeignKey(
                        blank=True,
                        null=True,
                        on_delete=django.db.models.deletion.SET_NULL,
                        related_name="signed_agreement_snapshots",
                        to="projects.agreementdraftintelligencesnapshot",
                    ),
                ),
                (
                    "homeowner",
                    models.ForeignKey(
                        blank=True,
                        null=True,
                        on_delete=django.db.models.deletion.SET_NULL,
                        related_name="signed_agreement_snapshots",
                        to="projects.homeowner",
                    ),
                ),
                (
                    "selected_template",
                    models.ForeignKey(
                        blank=True,
                        null=True,
                        on_delete=django.db.models.deletion.SET_NULL,
                        related_name="signed_agreement_snapshots",
                        to="projects.projecttemplate",
                    ),
                ),
            ],
            options={
                "ordering": ["-created_at", "-id"],
                "indexes": [
                    models.Index(fields=["contractor", "project_type"], name="projects_si_contrac_c0d2d2_idx"),
                    models.Index(fields=["selected_template"], name="projects_si_selecte_4cf537_idx"),
                    models.Index(fields=["draft_source"], name="projects_si_draft__d07eb2_idx"),
                    models.Index(fields=["fully_signed_at"], name="projects_si_fully__7dce91_idx"),
                    models.Index(fields=["created_at"], name="projects_si_created_9625b9_idx"),
                ],
                "constraints": [
                    models.UniqueConstraint(
                        fields=("agreement", "amendment_number", "pdf_version"),
                        name="uniq_signed_agreement_snapshot_version",
                    )
                ],
            },
        ),
    ]
