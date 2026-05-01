from __future__ import annotations

from decimal import Decimal

from django.conf import settings
from django.core.validators import MinValueValidator
from django.db import migrations, models
import django.db.models.deletion


class Migration(migrations.Migration):
    dependencies = [
        migrations.swappable_dependency(settings.AUTH_USER_MODEL),
        ("projects", "0147_agreement_pricing_strategy"),
    ]

    operations = [
        migrations.CreateModel(
            name="SubcontractorQuoteRequest",
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
                ("scope_snapshot", models.JSONField(blank=True, default=dict)),
                ("contractor_message", models.TextField(blank=True, default="")),
                (
                    "quoted_amount",
                    models.DecimalField(
                        blank=True,
                        decimal_places=2,
                        max_digits=12,
                        null=True,
                        validators=[MinValueValidator(Decimal("0.01"))],
                    ),
                ),
                ("subcontractor_message", models.TextField(blank=True, default="")),
                ("estimated_start_date", models.DateField(blank=True, null=True)),
                ("estimated_completion_date", models.DateField(blank=True, null=True)),
                (
                    "status",
                    models.CharField(
                        choices=[
                            ("sent", "Sent"),
                            ("responded", "Responded"),
                            ("accepted", "Accepted"),
                            ("declined", "Declined"),
                            ("revision_requested", "Revision Requested"),
                            ("cancelled", "Cancelled"),
                        ],
                        db_index=True,
                        default="sent",
                        max_length=32,
                    ),
                ),
                ("revision_note", models.TextField(blank=True, default="")),
                ("override_reason", models.TextField(blank=True, default="")),
                ("created_at", models.DateTimeField(auto_now_add=True)),
                ("sent_at", models.DateTimeField(blank=True, null=True)),
                ("responded_at", models.DateTimeField(blank=True, null=True)),
                ("accepted_at", models.DateTimeField(blank=True, null=True)),
                ("declined_at", models.DateTimeField(blank=True, null=True)),
                ("cancelled_at", models.DateTimeField(blank=True, null=True)),
                ("revision_requested_at", models.DateTimeField(blank=True, null=True)),
                ("updated_at", models.DateTimeField(auto_now=True)),
                (
                    "accepted_by",
                    models.ForeignKey(
                        blank=True,
                        null=True,
                        on_delete=django.db.models.deletion.SET_NULL,
                        related_name="accepted_subcontractor_quote_requests",
                        to=settings.AUTH_USER_MODEL,
                    ),
                ),
                (
                    "agreement",
                    models.ForeignKey(
                        on_delete=django.db.models.deletion.CASCADE,
                        related_name="subcontractor_quote_requests",
                        to="projects.agreement",
                    ),
                ),
                (
                    "contractor",
                    models.ForeignKey(
                        on_delete=django.db.models.deletion.CASCADE,
                        related_name="subcontractor_quote_requests",
                        to="projects.contractor",
                    ),
                ),
                (
                    "created_by",
                    models.ForeignKey(
                        blank=True,
                        null=True,
                        on_delete=django.db.models.deletion.SET_NULL,
                        related_name="created_subcontractor_quote_requests",
                        to=settings.AUTH_USER_MODEL,
                    ),
                ),
                (
                    "linked_subcontractor_milestone_agreement",
                    models.ForeignKey(
                        blank=True,
                        null=True,
                        on_delete=django.db.models.deletion.SET_NULL,
                        related_name="quote_requests",
                        to="projects.subcontractormilestoneagreement",
                    ),
                ),
                (
                    "milestone",
                    models.ForeignKey(
                        on_delete=django.db.models.deletion.CASCADE,
                        related_name="subcontractor_quote_requests",
                        to="projects.milestone",
                    ),
                ),
                (
                    "responded_by",
                    models.ForeignKey(
                        blank=True,
                        null=True,
                        on_delete=django.db.models.deletion.SET_NULL,
                        related_name="responded_subcontractor_quote_requests",
                        to=settings.AUTH_USER_MODEL,
                    ),
                ),
                (
                    "subcontractor",
                    models.ForeignKey(
                        on_delete=django.db.models.deletion.CASCADE,
                        related_name="subcontractor_quote_requests",
                        to=settings.AUTH_USER_MODEL,
                    ),
                ),
                (
                    "subcontractor_invitation",
                    models.ForeignKey(
                        on_delete=django.db.models.deletion.CASCADE,
                        related_name="quote_requests",
                        to="projects.subcontractorinvitation",
                    ),
                ),
            ],
            options={
                "ordering": ["-created_at", "-id"],
            },
        ),
        migrations.AddIndex(
            model_name="subcontractorquoterequest",
            index=models.Index(fields=["agreement", "milestone", "status"], name="projects_sqr_agreem_6f6d3f_idx"),
        ),
        migrations.AddIndex(
            model_name="subcontractorquoterequest",
            index=models.Index(fields=["subcontractor", "status"], name="projects_sqr_subcon_1d00b4_idx"),
        ),
        migrations.AddIndex(
            model_name="subcontractorquoterequest",
            index=models.Index(fields=["contractor", "status"], name="projects_sqr_contra_0c2f5a_idx"),
        ),
    ]
