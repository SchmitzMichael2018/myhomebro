from django.db import migrations, models
import django.db.models.deletion


class Migration(migrations.Migration):

    dependencies = [
        ("projects", "0178_agreement_draft_intelligence_snapshot"),
    ]

    operations = [
        migrations.CreateModel(
            name="ContractorEditEvent",
            fields=[
                ("id", models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name="ID")),
                (
                    "field_changed",
                    models.CharField(
                        choices=[
                            ("project_title", "Project Title"),
                            ("project_type", "Project Type"),
                            ("project_subtype", "Project Subtype"),
                            ("scope", "Scope"),
                            ("milestones", "Milestones"),
                            ("pricing", "Pricing"),
                            ("schedule", "Schedule"),
                            ("exclusions", "Exclusions"),
                            ("clarification_questions", "Clarification Questions"),
                        ],
                        db_index=True,
                        max_length=64,
                    ),
                ),
                ("original_value", models.JSONField(blank=True, default=dict)),
                ("updated_value", models.JSONField(blank=True, default=dict)),
                (
                    "source",
                    models.CharField(
                        choices=[("contractor", "Contractor"), ("template", "Template"), ("ai", "AI")],
                        db_index=True,
                        default="contractor",
                        max_length=24,
                    ),
                ),
                ("change_reason", models.CharField(blank=True, default="", max_length=255)),
                ("metadata", models.JSONField(blank=True, default=dict)),
                ("created_at", models.DateTimeField(auto_now_add=True)),
                (
                    "agreement",
                    models.ForeignKey(
                        on_delete=django.db.models.deletion.CASCADE,
                        related_name="contractor_edit_events",
                        to="projects.agreement",
                    ),
                ),
                (
                    "contractor",
                    models.ForeignKey(
                        blank=True,
                        null=True,
                        on_delete=django.db.models.deletion.SET_NULL,
                        related_name="contractor_edit_events",
                        to="projects.contractor",
                    ),
                ),
            ],
            options={
                "ordering": ["-created_at", "-id"],
                "indexes": [
                    models.Index(fields=["agreement", "field_changed"], name="projects_co_agreeme_1d735d_idx"),
                    models.Index(fields=["contractor", "field_changed"], name="projects_co_contrac_b480de_idx"),
                    models.Index(fields=["source", "field_changed"], name="projects_co_source_09ee32_idx"),
                    models.Index(fields=["created_at"], name="projects_co_created_c1facd_idx"),
                ],
            },
        ),
    ]
