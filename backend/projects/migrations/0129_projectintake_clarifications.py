from django.db import migrations, models
import django.db.models.deletion
import django.utils.timezone
import projects.models_project_intake


class Migration(migrations.Migration):

    dependencies = [
        ("projects", "0128_projectintake_ai_budget_timeline"),
    ]

    operations = [
        migrations.AddField(
            model_name="projectintake",
            name="ai_clarification_answers",
            field=models.JSONField(blank=True, default=dict),
        ),
        migrations.AddField(
            model_name="projectintake",
            name="measurement_handling",
            field=models.CharField(
                blank=True,
                choices=[
                    ("", "Unselected"),
                    ("provided", "Provided"),
                    ("site_visit_required", "Site Visit Required"),
                    ("not_sure", "Not Sure"),
                ],
                default="",
                max_length=32,
            ),
        ),
        migrations.CreateModel(
            name="ProjectIntakeClarificationPhoto",
            fields=[
                (
                    "id",
                    models.BigAutoField(
                        auto_created=True,
                        primary_key=True,
                        serialize=False,
                        verbose_name="ID",
                    ),
                ),
                ("image", models.ImageField(upload_to=projects.models_project_intake.project_intake_clarification_photo_upload_to)),
                ("original_name", models.CharField(blank=True, default="", max_length=255)),
                ("caption", models.CharField(blank=True, default="", max_length=255)),
                ("uploaded_at", models.DateTimeField(db_index=True, default=django.utils.timezone.now)),
                (
                    "project_intake",
                    models.ForeignKey(
                        on_delete=django.db.models.deletion.CASCADE,
                        related_name="clarification_photos",
                        to="projects.projectintake",
                    ),
                ),
            ],
            options={
                "ordering": ["-uploaded_at", "-id"],
            },
        ),
    ]
