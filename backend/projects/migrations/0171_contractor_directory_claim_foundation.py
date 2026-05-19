from django.conf import settings
from django.db import migrations, models
import django.db.models.deletion
import uuid


class Migration(migrations.Migration):

    dependencies = [
        migrations.swappable_dependency(settings.AUTH_USER_MODEL),
        ("projects", "0170_contractor_activation_state"),
    ]

    operations = [
        migrations.AddField(
            model_name="contractordirectoryentry",
            name="normalized_services",
            field=models.JSONField(blank=True, default=list),
        ),
        migrations.AddField(
            model_name="contractordirectoryentry",
            name="primary_service",
            field=models.CharField(blank=True, db_index=True, max_length=120, null=True),
        ),
        migrations.AddField(
            model_name="contractordirectoryentry",
            name="service_city",
            field=models.CharField(blank=True, db_index=True, max_length=120, null=True),
        ),
        migrations.AddField(
            model_name="contractordirectoryentry",
            name="service_radius_miles",
            field=models.PositiveIntegerField(db_index=True, default=25),
        ),
        migrations.AddField(
            model_name="contractordirectoryentry",
            name="service_state",
            field=models.CharField(blank=True, db_index=True, max_length=60, null=True),
        ),
        migrations.AddField(
            model_name="contractordirectoryentry",
            name="service_zip",
            field=models.CharField(blank=True, db_index=True, max_length=20, null=True),
        ),
        migrations.AlterField(
            model_name="contractor",
            name="service_radius_miles",
            field=models.PositiveIntegerField(choices=[(5, "5"), (10, "10"), (15, "15"), (25, "25"), (50, "50"), (100, "100")], default=25),
        ),
        migrations.CreateModel(
            name="ContractorDirectoryClaimToken",
            fields=[
                ("id", models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name="ID")),
                ("token", models.UUIDField(db_index=True, default=uuid.uuid4, unique=True)),
                ("status", models.CharField(choices=[("pending", "Pending"), ("claimed", "Claimed"), ("revoked", "Revoked")], db_index=True, default="pending", max_length=24)),
                ("created_at", models.DateTimeField(auto_now_add=True)),
                ("claimed_at", models.DateTimeField(blank=True, null=True)),
                ("updated_at", models.DateTimeField(auto_now=True)),
                ("claimed_by_contractor", models.ForeignKey(blank=True, null=True, on_delete=django.db.models.deletion.SET_NULL, related_name="directory_claim_tokens", to="projects.contractor")),
                ("directory_entry", models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name="claim_tokens", to="projects.contractordirectoryentry")),
                ("generated_by", models.ForeignKey(blank=True, null=True, on_delete=django.db.models.deletion.SET_NULL, related_name="contractor_directory_claim_tokens_generated", to=settings.AUTH_USER_MODEL)),
            ],
            options={
                "ordering": ["-created_at", "-id"],
                "indexes": [
                    models.Index(fields=["directory_entry", "status"], name="projects_co_directo_f1a1be_idx"),
                    models.Index(fields=["status", "created_at"], name="projects_co_status_f69e71_idx"),
                ],
            },
        ),
        migrations.AddIndex(
            model_name="contractordirectoryentry",
            index=models.Index(fields=["service_state", "service_zip"], name="projects_co_service_4e839f_idx"),
        ),
        migrations.AddIndex(
            model_name="contractordirectoryentry",
            index=models.Index(fields=["primary_service"], name="projects_co_primary_13341d_idx"),
        ),
    ]
