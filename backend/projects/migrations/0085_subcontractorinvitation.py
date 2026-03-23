import datetime
import secrets

import django.db.models.deletion
from django.conf import settings
from django.db import migrations, models
from django.utils import timezone


def default_expiry():
    return timezone.now() + datetime.timedelta(days=14)


def default_token():
    return secrets.token_urlsafe(32)


class Migration(migrations.Migration):

    dependencies = [
        migrations.swappable_dependency(settings.AUTH_USER_MODEL),
        ("projects", "0084_agreementwarranty"),
    ]

    operations = [
        migrations.CreateModel(
            name="SubcontractorInvitation",
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
                ("invite_email", models.EmailField(db_index=True, max_length=254)),
                ("invite_name", models.CharField(blank=True, default="", max_length=255)),
                ("token", models.CharField(db_index=True, default=default_token, editable=False, max_length=96, unique=True)),
                (
                    "status",
                    models.CharField(
                        choices=[
                            ("pending", "Pending"),
                            ("accepted", "Accepted"),
                            ("revoked", "Revoked"),
                            ("expired", "Expired"),
                        ],
                        db_index=True,
                        default="pending",
                        max_length=16,
                    ),
                ),
                ("invited_message", models.TextField(blank=True, default="")),
                ("invited_at", models.DateTimeField(auto_now_add=True)),
                ("expires_at", models.DateTimeField(default=default_expiry)),
                ("accepted_at", models.DateTimeField(blank=True, null=True)),
                (
                    "accepted_by_user",
                    models.ForeignKey(
                        blank=True,
                        null=True,
                        on_delete=django.db.models.deletion.SET_NULL,
                        related_name="accepted_subcontractor_invitations",
                        to=settings.AUTH_USER_MODEL,
                    ),
                ),
                (
                    "agreement",
                    models.ForeignKey(
                        on_delete=django.db.models.deletion.CASCADE,
                        related_name="subcontractor_invitations",
                        to="projects.agreement",
                    ),
                ),
                (
                    "contractor",
                    models.ForeignKey(
                        on_delete=django.db.models.deletion.CASCADE,
                        related_name="subcontractor_invitations",
                        to="projects.contractor",
                    ),
                ),
            ],
            options={
                "ordering": ["-invited_at", "-id"],
            },
        ),
        migrations.AddIndex(
            model_name="subcontractorinvitation",
            index=models.Index(fields=["agreement", "status"], name="projects_su_agreeme_32a875_idx"),
        ),
        migrations.AddIndex(
            model_name="subcontractorinvitation",
            index=models.Index(fields=["agreement", "invite_email"], name="projects_su_agreeme_ec265b_idx"),
        ),
    ]
