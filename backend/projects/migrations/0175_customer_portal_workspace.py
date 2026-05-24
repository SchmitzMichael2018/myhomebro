from django.db import migrations, models
import django.db.models.deletion
import django.utils.timezone
import projects.models_customer_portal


class Migration(migrations.Migration):

    dependencies = [
        ("projects", "0174_contractor_directory_contactability"),
    ]

    operations = [
        migrations.CreateModel(
            name="PropertyProfile",
            fields=[
                ("id", models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name="ID")),
                ("customer_email", models.EmailField(db_index=True, max_length=254)),
                ("display_name", models.CharField(blank=True, default="", max_length=200)),
                (
                    "property_type",
                    models.CharField(
                        choices=[
                            ("single_family", "Single Family"),
                            ("townhome", "Townhome"),
                            ("condo", "Condo"),
                            ("multi_family", "Multi-Family"),
                            ("commercial", "Commercial"),
                            ("other", "Other"),
                        ],
                        default="single_family",
                        max_length=32,
                    ),
                ),
                ("address_line1", models.CharField(blank=True, default="", max_length=255)),
                ("address_line2", models.CharField(blank=True, default="", max_length=255)),
                ("city", models.CharField(blank=True, default="", max_length=120)),
                ("state", models.CharField(blank=True, default="", max_length=60)),
                ("postal_code", models.CharField(blank=True, default="", max_length=24)),
                ("year_built", models.PositiveIntegerField(blank=True, null=True)),
                ("square_feet", models.PositiveIntegerField(blank=True, null=True)),
                ("notes", models.TextField(blank=True, default="")),
                ("created_at", models.DateTimeField(auto_now_add=True)),
                ("updated_at", models.DateTimeField(auto_now=True)),
                (
                    "homeowner",
                    models.ForeignKey(
                        blank=True,
                        null=True,
                        on_delete=django.db.models.deletion.SET_NULL,
                        related_name="property_profiles",
                        to="projects.homeowner",
                    ),
                ),
            ],
            options={
                "ordering": ["customer_email", "display_name", "id"],
            },
        ),
        migrations.CreateModel(
            name="CustomerRequest",
            fields=[
                ("id", models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name="ID")),
                ("customer_email", models.EmailField(db_index=True, max_length=254)),
                (
                    "request_type",
                    models.CharField(
                        choices=[
                            ("repair", "Repair"),
                            ("maintenance", "Maintenance"),
                            ("new_project", "New Project"),
                            ("diy_assistance", "DIY Assistance"),
                            ("inspection", "Inspection"),
                            ("emergency", "Emergency"),
                        ],
                        max_length=32,
                    ),
                ),
                (
                    "status",
                    models.CharField(
                        choices=[
                            ("draft", "Draft"),
                            ("submitted", "Submitted"),
                            ("routed", "Routed"),
                            ("marketplace_ready", "Marketplace Ready"),
                            ("matched", "Matched"),
                            ("converted_to_project", "Converted to Project"),
                            ("closed", "Closed"),
                        ],
                        db_index=True,
                        default="submitted",
                        max_length=32,
                    ),
                ),
                ("title", models.CharField(max_length=200)),
                ("description", models.TextField()),
                ("urgency", models.CharField(blank=True, default="", max_length=32)),
                ("preferred_timeline", models.CharField(blank=True, default="", max_length=120)),
                ("address_line1", models.CharField(blank=True, default="", max_length=255)),
                ("address_line2", models.CharField(blank=True, default="", max_length=255)),
                ("city", models.CharField(blank=True, default="", max_length=120)),
                ("state", models.CharField(blank=True, default="", max_length=60)),
                ("postal_code", models.CharField(blank=True, default="", max_length=24)),
                ("internal_notes", models.TextField(blank=True, default="")),
                ("created_at", models.DateTimeField(auto_now_add=True, db_index=True)),
                ("updated_at", models.DateTimeField(auto_now=True)),
                (
                    "converted_project",
                    models.ForeignKey(
                        blank=True,
                        null=True,
                        on_delete=django.db.models.deletion.SET_NULL,
                        related_name="source_customer_requests",
                        to="projects.project",
                    ),
                ),
                (
                    "homeowner",
                    models.ForeignKey(
                        blank=True,
                        null=True,
                        on_delete=django.db.models.deletion.SET_NULL,
                        related_name="customer_requests",
                        to="projects.homeowner",
                    ),
                ),
                (
                    "property_profile",
                    models.ForeignKey(
                        blank=True,
                        null=True,
                        on_delete=django.db.models.deletion.SET_NULL,
                        related_name="customer_requests",
                        to="projects.propertyprofile",
                    ),
                ),
            ],
            options={
                "ordering": ["-created_at", "-id"],
            },
        ),
        migrations.CreateModel(
            name="PropertyDocument",
            fields=[
                ("id", models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name="ID")),
                ("title", models.CharField(max_length=200)),
                ("document_type", models.CharField(blank=True, default="", max_length=64)),
                ("file", models.FileField(upload_to=projects.models_customer_portal.property_document_upload_path)),
                ("uploaded_at", models.DateTimeField(db_index=True, default=django.utils.timezone.now)),
                (
                    "property_profile",
                    models.ForeignKey(
                        on_delete=django.db.models.deletion.CASCADE,
                        related_name="documents",
                        to="projects.propertyprofile",
                    ),
                ),
            ],
            options={
                "ordering": ["-uploaded_at", "-id"],
            },
        ),
        migrations.CreateModel(
            name="PropertyPhoto",
            fields=[
                ("id", models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name="ID")),
                ("title", models.CharField(blank=True, default="", max_length=200)),
                ("photo", models.FileField(upload_to=projects.models_customer_portal.property_photo_upload_path)),
                ("uploaded_at", models.DateTimeField(db_index=True, default=django.utils.timezone.now)),
                (
                    "property_profile",
                    models.ForeignKey(
                        on_delete=django.db.models.deletion.CASCADE,
                        related_name="photos",
                        to="projects.propertyprofile",
                    ),
                ),
            ],
            options={
                "ordering": ["-uploaded_at", "-id"],
            },
        ),
        migrations.AddIndex(
            model_name="propertyprofile",
            index=models.Index(fields=["customer_email", "updated_at"], name="projects_pr_custome_a213b1_idx"),
        ),
        migrations.AddIndex(
            model_name="customerrequest",
            index=models.Index(fields=["customer_email", "status"], name="projects_cu_custome_809ec6_idx"),
        ),
        migrations.AddIndex(
            model_name="customerrequest",
            index=models.Index(fields=["request_type", "status"], name="projects_cu_request_325eca_idx"),
        ),
    ]
