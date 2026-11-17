from django.conf import settings
from django.db import migrations, models
import django.db.models.deletion
import projects.models_website_service


class Migration(migrations.Migration):
    dependencies = [("projects", "0332_improvement_article_sections"), migrations.swappable_dependency(settings.AUTH_USER_MODEL)]

    operations = [
        migrations.CreateModel(
            name="WebsiteServiceProject",
            fields=[
                ("id", models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name="ID")),
                ("business_name", models.CharField(max_length=180)),
                ("business_type", models.CharField(choices=[("contractor", "Contractor"), ("restaurant", "Restaurant"), ("other", "Other business")], default="contractor", max_length=20)),
                ("template_id", models.CharField(blank=True, max_length=50)),
                ("current_website", models.URLField(blank=True)),
                ("description", models.TextField(blank=True, max_length=8000)),
                ("services", models.TextField(blank=True, max_length=8000)),
                ("contact_details", models.TextField(blank=True, max_length=3000)),
                ("design_notes", models.TextField(blank=True, max_length=8000)),
                ("status", models.CharField(choices=[("brief", "Preparing your brief"), ("review", "Brief under review"), ("building", "Website in progress"), ("preview", "Preview ready"), ("launched", "Launched"), ("maintenance", "Ongoing care")], db_index=True, default="brief", max_length=20)),
                ("next_step", models.TextField(blank=True, max_length=3000)),
                ("preview_url", models.URLField(blank=True)),
                ("live_url", models.URLField(blank=True)),
                ("created_at", models.DateTimeField(auto_now_add=True)),
                ("updated_at", models.DateTimeField(auto_now=True)),
                ("owner", models.ForeignKey(on_delete=django.db.models.deletion.PROTECT, related_name="website_service_projects", to=settings.AUTH_USER_MODEL)),
            ], options={"ordering": ["-updated_at", "-pk"]},
        ),
        migrations.CreateModel(
            name="WebsiteServiceMaterial",
            fields=[
                ("id", models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name="ID")),
                ("file", models.FileField(storage=projects.models_website_service.website_material_storage, upload_to=projects.models_website_service.website_material_path)),
                ("original_name", models.CharField(max_length=200)),
                ("size", models.PositiveIntegerField()),
                ("created_at", models.DateTimeField(auto_now_add=True)),
                ("project", models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name="materials", to="projects.websiteserviceproject")),
            ],
        ),
        migrations.CreateModel(
            name="WebsiteServiceRequest",
            fields=[
                ("id", models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name="ID")),
                ("message", models.TextField(max_length=5000)),
                ("status", models.CharField(choices=[("open", "Open"), ("in_progress", "In progress"), ("done", "Completed")], default="open", max_length=20)),
                ("response", models.TextField(blank=True, max_length=5000)),
                ("created_at", models.DateTimeField(auto_now_add=True)),
                ("project", models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name="requests", to="projects.websiteserviceproject")),
            ], options={"ordering": ["-created_at", "-pk"]},
        ),
    ]
