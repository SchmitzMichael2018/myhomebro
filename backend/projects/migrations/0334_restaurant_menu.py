import uuid
from django.conf import settings
from django.db import migrations, models
import django.db.models.deletion
import projects.models_website_service


def assign_menu_ids(apps, schema_editor):
    Project = apps.get_model("projects", "WebsiteServiceProject")
    for pk in Project.objects.using(schema_editor.connection.alias).values_list("pk", flat=True).iterator():
        Project.objects.using(schema_editor.connection.alias).filter(pk=pk).update(menu_public_id=uuid.uuid4())


class Migration(migrations.Migration):
    dependencies = [("projects", "0333_website_service_workspace"), migrations.swappable_dependency(settings.AUTH_USER_MODEL)]
    operations = [
        migrations.AddField(model_name="websiteserviceproject", name="menu_public_id", field=models.UUIDField(null=True, editable=False)),
        migrations.RunPython(assign_menu_ids, migrations.RunPython.noop),
        migrations.AlterField(model_name="websiteserviceproject", name="menu_public_id", field=models.UUIDField(default=uuid.uuid4, unique=True, editable=False)),
        migrations.AddField(model_name="websiteserviceproject", name="menu_draft", field=models.JSONField(default=list, blank=True)),
        migrations.AddField(model_name="websiteserviceproject", name="menu_revision", field=models.PositiveIntegerField(default=0)),
        migrations.AddField(model_name="websiteserviceproject", name="menu_published", field=models.JSONField(null=True, blank=True)),
        migrations.AddField(model_name="websiteserviceproject", name="menu_published_revision", field=models.PositiveIntegerField(null=True, blank=True)),
        migrations.AddField(model_name="websiteserviceproject", name="menu_published_at", field=models.DateTimeField(null=True, blank=True)),
        migrations.CreateModel(name="WebsiteMenuPhoto", fields=[
            ("id", models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False, serialize=False)),
            ("file", models.FileField(storage=projects.models_website_service.website_material_storage, upload_to=projects.models_website_service.restaurant_menu_photo_path)),
            ("created_at", models.DateTimeField(auto_now_add=True)),
            ("project", models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name="menu_photos", to="projects.websiteserviceproject")),
        ]),
        migrations.CreateModel(name="WebsiteMenuEvent", fields=[
            ("id", models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name="ID")),
            ("action", models.CharField(max_length=16, choices=[("saved", "Saved draft"), ("published", "Published"), ("unpublished", "Unpublished")])),
            ("revision", models.PositiveIntegerField()),
            ("created_at", models.DateTimeField(auto_now_add=True)),
            ("actor", models.ForeignKey(on_delete=django.db.models.deletion.PROTECT, to=settings.AUTH_USER_MODEL)),
            ("project", models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name="menu_events", to="projects.websiteserviceproject")),
        ]),
    ]
