from decimal import Decimal

from django.conf import settings
from django.db import migrations, models
import django.db.models.deletion


class Migration(migrations.Migration):

    dependencies = [
        migrations.swappable_dependency(settings.AUTH_USER_MODEL),
        ("projects", "0094_remove_aiagreementusage_contractor_and_more"),
    ]

    operations = [
        migrations.AddField(
            model_name="agreement",
            name="external_payment_enabled",
            field=models.BooleanField(
                default=False,
                help_text="Whether the contractor can record external progress payments for this agreement.",
            ),
        ),
        migrations.AddField(
            model_name="agreement",
            name="payment_structure",
            field=models.CharField(
                choices=[("simple", "Simple Payments"), ("progress", "Progress Payments")],
                db_index=True,
                default="simple",
                help_text="SIMPLE keeps milestone-paid workflow intact. PROGRESS enables draw-based requests.",
                max_length=20,
            ),
        ),
        migrations.AddField(
            model_name="agreement",
            name="retainage_percent",
            field=models.DecimalField(
                decimal_places=2,
                default=Decimal("0.00"),
                help_text="Optional retainage withheld on progress-payment draw requests.",
                max_digits=5,
            ),
        ),
        migrations.AddField(
            model_name="projecttemplate",
            name="payment_structure",
            field=models.CharField(
                choices=[("simple", "Simple Payments"), ("progress", "Progress Payments")],
                db_index=True,
                default="simple",
                max_length=20,
            ),
        ),
        migrations.AddField(
            model_name="projecttemplate",
            name="retainage_percent",
            field=models.DecimalField(decimal_places=2, default=Decimal("0.00"), max_digits=5),
        ),
        migrations.CreateModel(
            name="DrawRequest",
            fields=[
                ("id", models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name="ID")),
                ("draw_number", models.PositiveIntegerField()),
                (
                    "status",
                    models.CharField(
                        choices=[
                            ("draft", "Draft"),
                            ("submitted", "Submitted"),
                            ("approved", "Approved"),
                            ("rejected", "Rejected"),
                            ("changes_requested", "Changes Requested"),
                            ("paid", "Paid"),
                        ],
                        db_index=True,
                        default="draft",
                        max_length=32,
                    ),
                ),
                ("title", models.CharField(max_length=255)),
                ("notes", models.TextField(blank=True, default="")),
                ("submitted_at", models.DateTimeField(blank=True, null=True)),
                ("reviewed_at", models.DateTimeField(blank=True, null=True)),
                ("gross_amount", models.DecimalField(decimal_places=2, default=Decimal("0.00"), max_digits=12)),
                ("retainage_amount", models.DecimalField(decimal_places=2, default=Decimal("0.00"), max_digits=12)),
                ("net_amount", models.DecimalField(decimal_places=2, default=Decimal("0.00"), max_digits=12)),
                ("previous_payments_amount", models.DecimalField(decimal_places=2, default=Decimal("0.00"), max_digits=12)),
                ("current_requested_amount", models.DecimalField(decimal_places=2, default=Decimal("0.00"), max_digits=12)),
                ("created_at", models.DateTimeField(auto_now_add=True, db_index=True)),
                ("updated_at", models.DateTimeField(auto_now=True)),
                (
                    "agreement",
                    models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name="draw_requests", to="projects.agreement"),
                ),
                (
                    "reviewed_by",
                    models.ForeignKey(
                        blank=True,
                        null=True,
                        on_delete=django.db.models.deletion.SET_NULL,
                        related_name="reviewed_draw_requests",
                        to=settings.AUTH_USER_MODEL,
                    ),
                ),
                (
                    "submitted_by",
                    models.ForeignKey(
                        blank=True,
                        null=True,
                        on_delete=django.db.models.deletion.SET_NULL,
                        related_name="submitted_draw_requests",
                        to=settings.AUTH_USER_MODEL,
                    ),
                ),
            ],
            options={"ordering": ["-created_at", "-id"]},
        ),
        migrations.CreateModel(
            name="ExternalPaymentRecord",
            fields=[
                ("id", models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name="ID")),
                ("payer_name", models.CharField(blank=True, default="", max_length=255)),
                ("payee_name", models.CharField(blank=True, default="", max_length=255)),
                ("gross_amount", models.DecimalField(decimal_places=2, default=Decimal("0.00"), max_digits=12)),
                (
                    "retainage_withheld_amount",
                    models.DecimalField(decimal_places=2, default=Decimal("0.00"), max_digits=12),
                ),
                ("net_amount", models.DecimalField(decimal_places=2, default=Decimal("0.00"), max_digits=12)),
                ("payment_method", models.CharField(default="other", max_length=16)),
                ("payment_date", models.DateField()),
                ("reference_number", models.CharField(blank=True, default="", max_length=255)),
                ("notes", models.TextField(blank=True, default="")),
                ("proof_file", models.FileField(blank=True, null=True, upload_to="payments/external_proof/")),
                (
                    "status",
                    models.CharField(
                        choices=[
                            ("recorded", "Recorded"),
                            ("verified", "Verified"),
                            ("disputed", "Disputed"),
                            ("voided", "Voided"),
                        ],
                        db_index=True,
                        default="recorded",
                        max_length=16,
                    ),
                ),
                ("recorded_at", models.DateTimeField(auto_now_add=True, db_index=True)),
                ("updated_at", models.DateTimeField(auto_now=True)),
                (
                    "agreement",
                    models.ForeignKey(
                        on_delete=django.db.models.deletion.CASCADE,
                        related_name="external_payment_records",
                        to="projects.agreement",
                    ),
                ),
                (
                    "draw_request",
                    models.ForeignKey(
                        blank=True,
                        null=True,
                        on_delete=django.db.models.deletion.SET_NULL,
                        related_name="external_payment_records",
                        to="projects.drawrequest",
                    ),
                ),
                (
                    "recorded_by",
                    models.ForeignKey(
                        blank=True,
                        null=True,
                        on_delete=django.db.models.deletion.SET_NULL,
                        related_name="recorded_external_payments",
                        to=settings.AUTH_USER_MODEL,
                    ),
                ),
            ],
            options={"ordering": ["-payment_date", "-id"]},
        ),
        migrations.CreateModel(
            name="DrawLineItem",
            fields=[
                ("id", models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name="ID")),
                ("description", models.CharField(max_length=255)),
                ("scheduled_value", models.DecimalField(decimal_places=2, default=Decimal("0.00"), max_digits=12)),
                ("percent_complete", models.DecimalField(decimal_places=2, default=Decimal("0.00"), max_digits=5)),
                ("earned_to_date", models.DecimalField(decimal_places=2, default=Decimal("0.00"), max_digits=12)),
                ("previous_billed", models.DecimalField(decimal_places=2, default=Decimal("0.00"), max_digits=12)),
                ("this_draw_amount", models.DecimalField(decimal_places=2, default=Decimal("0.00"), max_digits=12)),
                ("retainage_amount", models.DecimalField(decimal_places=2, default=Decimal("0.00"), max_digits=12)),
                ("remaining_balance", models.DecimalField(decimal_places=2, default=Decimal("0.00"), max_digits=12)),
                ("created_at", models.DateTimeField(auto_now_add=True)),
                (
                    "draw_request",
                    models.ForeignKey(
                        on_delete=django.db.models.deletion.CASCADE,
                        related_name="line_items",
                        to="projects.drawrequest",
                    ),
                ),
                (
                    "milestone",
                    models.ForeignKey(
                        blank=True,
                        null=True,
                        on_delete=django.db.models.deletion.SET_NULL,
                        related_name="draw_line_items",
                        to="projects.milestone",
                    ),
                ),
            ],
            options={"ordering": ["id"]},
        ),
        migrations.AddConstraint(
            model_name="drawrequest",
            constraint=models.UniqueConstraint(fields=("agreement", "draw_number"), name="unique_draw_number_per_agreement"),
        ),
    ]
