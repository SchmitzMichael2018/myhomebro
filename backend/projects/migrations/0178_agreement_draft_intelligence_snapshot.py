from django.db import migrations, models
import django.db.models.deletion


class Migration(migrations.Migration):

    dependencies = [
        ("projects", "0177_seed_core_trade_taxonomy"),
    ]

    operations = [
        migrations.CreateModel(
            name="AgreementDraftIntelligenceSnapshot",
            fields=[
                ("id", models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name="ID")),
                ("original_project_description", models.TextField(blank=True, default="")),
                ("ai_project_title", models.CharField(blank=True, default="", max_length=255)),
                ("ai_project_type", models.CharField(blank=True, default="", max_length=120)),
                ("ai_project_subtype", models.CharField(blank=True, default="", max_length=160)),
                ("ai_scope", models.TextField(blank=True, default="")),
                ("advisory_classification", models.JSONField(blank=True, default=dict)),
                ("template_recommendation_result", models.JSONField(blank=True, default=dict)),
                ("template_recommendation_tier", models.CharField(blank=True, db_index=True, default="", max_length=64)),
                (
                    "draft_source",
                    models.CharField(
                        choices=[
                            ("template_match", "Template Match"),
                            ("no_template_ai", "No-template AI"),
                            ("manual", "Manual"),
                        ],
                        db_index=True,
                        default="manual",
                        max_length=32,
                    ),
                ),
                ("ai_model_version", models.CharField(blank=True, default="", max_length=120)),
                ("snapshot_version", models.PositiveIntegerField(default=1)),
                ("created_at", models.DateTimeField(auto_now_add=True)),
                (
                    "agreement",
                    models.OneToOneField(
                        on_delete=django.db.models.deletion.CASCADE,
                        related_name="draft_intelligence_snapshot",
                        to="projects.agreement",
                    ),
                ),
                (
                    "contractor",
                    models.ForeignKey(
                        blank=True,
                        null=True,
                        on_delete=django.db.models.deletion.SET_NULL,
                        related_name="agreement_draft_intelligence_snapshots",
                        to="projects.contractor",
                    ),
                ),
                (
                    "selected_template",
                    models.ForeignKey(
                        blank=True,
                        null=True,
                        on_delete=django.db.models.deletion.SET_NULL,
                        related_name="draft_intelligence_snapshots",
                        to="projects.projecttemplate",
                    ),
                ),
            ],
            options={
                "ordering": ["-created_at", "-id"],
                "indexes": [
                    models.Index(fields=["contractor", "draft_source"], name="projects_ag_contrac_5de7e1_idx"),
                    models.Index(fields=["template_recommendation_tier"], name="projects_ag_templat_2c1270_idx"),
                    models.Index(fields=["created_at"], name="projects_ag_created_81e52c_idx"),
                ],
            },
        ),
    ]
