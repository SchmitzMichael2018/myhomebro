from django.db import migrations, models
import django.db.models.deletion


class Migration(migrations.Migration):

    dependencies = [
        ("projects", "0083_milestone_pricing_breakdown_snapshot_fields"),
    ]

    operations = [
        migrations.CreateModel(
            name="AgreementWarranty",
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
                ("title", models.CharField(max_length=255)),
                ("coverage_details", models.TextField(blank=True, default="")),
                ("exclusions", models.TextField(blank=True, default="")),
                ("start_date", models.DateField(blank=True, db_index=True, null=True)),
                ("end_date", models.DateField(blank=True, db_index=True, null=True)),
                (
                    "status",
                    models.CharField(
                        choices=[
                            ("active", "Active"),
                            ("expired", "Expired"),
                            ("void", "Void"),
                        ],
                        db_index=True,
                        default="active",
                        max_length=16,
                    ),
                ),
                (
                    "applies_to",
                    models.CharField(
                        blank=True,
                        choices=[
                            ("full_agreement", "Full Agreement"),
                            ("workmanship", "Workmanship"),
                            ("materials", "Materials"),
                            ("other", "Other"),
                        ],
                        default="",
                        help_text="Optional lightweight scope label for the warranty record.",
                        max_length=24,
                    ),
                ),
                ("created_at", models.DateTimeField(auto_now_add=True, db_index=True)),
                ("updated_at", models.DateTimeField(auto_now=True)),
                (
                    "agreement",
                    models.ForeignKey(
                        db_index=True,
                        on_delete=django.db.models.deletion.CASCADE,
                        related_name="warranty_records",
                        to="projects.agreement",
                    ),
                ),
                (
                    "contractor",
                    models.ForeignKey(
                        db_index=True,
                        on_delete=django.db.models.deletion.CASCADE,
                        related_name="agreement_warranties",
                        to="projects.contractor",
                    ),
                ),
            ],
            options={
                "ordering": ["-start_date", "-created_at", "-id"],
            },
        ),
    ]
