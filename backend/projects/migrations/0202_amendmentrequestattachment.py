import projects.models_amendment_request
from django.conf import settings
from django.db import migrations, models
import django.db.models.deletion
import django.utils.timezone


class Migration(migrations.Migration):

    dependencies = [
        migrations.swappable_dependency(settings.AUTH_USER_MODEL),
        ("projects", "0201_amendment_activity_workflow"),
    ]

    operations = [
        migrations.CreateModel(
            name="AmendmentRequestAttachment",
            fields=[
                ("id", models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name="ID")),
                (
                    "file",
                    models.FileField(upload_to=projects.models_amendment_request.amendment_request_attachment_upload_path),
                ),
                ("original_filename", models.CharField(blank=True, default="", max_length=255)),
                ("content_type", models.CharField(blank=True, default="", max_length=120)),
                ("size", models.PositiveIntegerField(default=0)),
                ("uploaded_at", models.DateTimeField(db_index=True, default=django.utils.timezone.now)),
                (
                    "response_state",
                    models.CharField(
                        choices=[
                            ("pending", "Pending Response"),
                            ("accepted", "Accepted"),
                            ("rejected", "Rejected"),
                            ("countered", "Countered"),
                        ],
                        default="countered",
                        max_length=32,
                    ),
                ),
                (
                    "agreement",
                    models.ForeignKey(
                        on_delete=django.db.models.deletion.CASCADE,
                        related_name="amendment_request_attachments",
                        to="projects.agreement",
                    ),
                ),
                (
                    "amendment_request",
                    models.ForeignKey(
                        on_delete=django.db.models.deletion.CASCADE,
                        related_name="attachments",
                        to="projects.amendmentrequest",
                    ),
                ),
                (
                    "uploaded_by",
                    models.ForeignKey(
                        blank=True,
                        null=True,
                        on_delete=django.db.models.deletion.SET_NULL,
                        related_name="uploaded_amendment_request_attachments",
                        to=settings.AUTH_USER_MODEL,
                    ),
                ),
            ],
            options={
                "ordering": ["-uploaded_at", "-id"],
                "indexes": [
                    models.Index(fields=["agreement", "uploaded_at"], name="projects_am_agreem_586219_idx"),
                    models.Index(fields=["amendment_request", "uploaded_at"], name="projects_am_amendm_5ff3c4_idx"),
                ],
            },
        ),
    ]
