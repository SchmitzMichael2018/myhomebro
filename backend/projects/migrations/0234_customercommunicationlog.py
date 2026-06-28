from django.conf import settings
from django.db import migrations, models
import django.db.models.deletion
import django.utils.timezone


class Migration(migrations.Migration):

    dependencies = [
        migrations.swappable_dependency(settings.AUTH_USER_MODEL),
        ("projects", "0233_contractorpublicprofile_business_information"),
    ]

    operations = [
        migrations.CreateModel(
            name="CustomerCommunicationLog",
            fields=[
                ("id", models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name="ID")),
                (
                    "communication_type",
                    models.CharField(
                        choices=[
                            ("internal_note", "Internal note"),
                            ("phone_call", "Phone call"),
                            ("email", "Email"),
                            ("sms", "SMS"),
                            ("in_person", "In-person meeting"),
                            ("other", "Other"),
                        ],
                        db_index=True,
                        default="internal_note",
                        max_length=32,
                    ),
                ),
                (
                    "direction",
                    models.CharField(
                        choices=[("internal", "Internal"), ("inbound", "Inbound"), ("outbound", "Outbound")],
                        db_index=True,
                        default="internal",
                        max_length=16,
                    ),
                ),
                ("subject", models.CharField(blank=True, default="", max_length=255)),
                ("body", models.TextField(blank=True, default="")),
                ("occurred_at", models.DateTimeField(db_index=True, default=django.utils.timezone.now)),
                ("follow_up_at", models.DateTimeField(blank=True, db_index=True, null=True)),
                ("created_at", models.DateTimeField(auto_now_add=True)),
                ("updated_at", models.DateTimeField(auto_now=True)),
                (
                    "visibility",
                    models.CharField(
                        choices=[("internal_only", "Internal only"), ("customer_visible_future", "Customer visible future")],
                        db_index=True,
                        default="internal_only",
                        max_length=32,
                    ),
                ),
                (
                    "contractor",
                    models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name="customer_communication_logs", to="projects.contractor"),
                ),
                (
                    "created_by",
                    models.ForeignKey(blank=True, null=True, on_delete=django.db.models.deletion.SET_NULL, related_name="customer_communication_logs", to=settings.AUTH_USER_MODEL),
                ),
                (
                    "customer",
                    models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name="communication_logs", to="projects.homeowner"),
                ),
            ],
            options={
                "ordering": ["-occurred_at", "-id"],
                "indexes": [
                    models.Index(fields=["contractor", "customer", "-occurred_at"], name="projects_cu_contrac_af4fd6_idx"),
                    models.Index(fields=["contractor", "follow_up_at"], name="projects_cu_contrac_d7d8e9_idx"),
                ],
            },
        ),
    ]
