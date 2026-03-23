from django.conf import settings
from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("projects", "0088_milestone_subcontractor_review_request"),
        migrations.swappable_dependency(settings.AUTH_USER_MODEL),
    ]

    operations = [
        migrations.CreateModel(
            name="Notification",
            fields=[
                ("id", models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name="ID")),
                ("event_type", models.CharField(choices=[("subcontractor_comment", "Subcontractor Comment"), ("subcontractor_file", "Subcontractor File"), ("subcontractor_review", "Subcontractor Review Request")], db_index=True, max_length=64)),
                ("actor_display_name", models.CharField(blank=True, default="", max_length=255)),
                ("actor_email", models.EmailField(blank=True, default="", max_length=254)),
                ("title", models.CharField(max_length=255)),
                ("message", models.TextField(blank=True, default="")),
                ("is_read", models.BooleanField(db_index=True, default=False)),
                ("created_at", models.DateTimeField(auto_now_add=True, db_index=True)),
                ("actor_user", models.ForeignKey(blank=True, null=True, on_delete=models.deletion.SET_NULL, related_name="sent_project_notifications", to=settings.AUTH_USER_MODEL)),
                ("agreement", models.ForeignKey(blank=True, null=True, on_delete=models.deletion.CASCADE, related_name="notifications", to="projects.agreement")),
                ("contractor", models.ForeignKey(on_delete=models.deletion.CASCADE, related_name="notifications", to="projects.contractor")),
                ("milestone", models.ForeignKey(blank=True, null=True, on_delete=models.deletion.CASCADE, related_name="notifications", to="projects.milestone")),
            ],
            options={
                "ordering": ["-created_at", "-id"],
            },
        ),
    ]
