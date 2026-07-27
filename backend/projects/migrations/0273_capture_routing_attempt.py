import django.db.models.deletion
import uuid

from django.conf import settings
from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [
        ("projects", "0272_amendment_request_change_intake"),
        migrations.swappable_dependency(settings.AUTH_USER_MODEL),
    ]

    operations = [
        migrations.CreateModel(
            name="CaptureRoutingAttempt",
            fields=[
                ("id", models.UUIDField(default=uuid.uuid4, editable=False, primary_key=True, serialize=False)),
                ("status", models.CharField(choices=[("open", "Open"), ("needs_information", "Needs Information"), ("suggested", "Suggested"), ("unsupported", "Unsupported"), ("confirmed", "Confirmed"), ("handed_off", "Handed Off"), ("cancelled", "Cancelled")], db_index=True, default="open", max_length=32)),
                ("orchestration_version", models.CharField(default="capture-routing.v1", max_length=32)),
                ("raw_user_text", models.TextField(blank=True, default="")),
                ("capture_method", models.CharField(choices=[("typed", "Typed"), ("voice_transcript", "Voice Transcript"), ("camera", "Camera"), ("file_upload", "File Upload"), ("public_form", "Public Form")], default="typed", max_length=32)),
                ("context_payload", models.JSONField(blank=True, default=dict)),
                ("artifact_metadata", models.JSONField(blank=True, default=list)),
                ("routing_result", models.JSONField(blank=True, default=dict)),
                ("follow_up_answers", models.JSONField(blank=True, default=list)),
                ("audit_events", models.JSONField(blank=True, default=list)),
                ("selected_profile", models.CharField(blank=True, default="", max_length=64)),
                ("selected_context", models.JSONField(blank=True, default=dict)),
                ("classifier_source", models.CharField(blank=True, default="", max_length=32)),
                ("classifier_version", models.CharField(blank=True, default="", max_length=32)),
                ("fallback_reason", models.CharField(blank=True, default="", max_length=120)),
                ("follow_up_rounds", models.PositiveSmallIntegerField(default=0)),
                ("version", models.PositiveIntegerField(default=1)),
                ("confirmed_at", models.DateTimeField(blank=True, null=True)),
                ("created_at", models.DateTimeField(auto_now_add=True, db_index=True)),
                ("updated_at", models.DateTimeField(auto_now=True)),
                ("actor", models.ForeignKey(null=True, on_delete=django.db.models.deletion.SET_NULL, related_name="capture_routing_attempts", to=settings.AUTH_USER_MODEL)),
                ("capture", models.OneToOneField(blank=True, null=True, on_delete=django.db.models.deletion.PROTECT, related_name="routing_attempt", to="projects.capture")),
                ("contractor", models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name="capture_routing_attempts", to="projects.contractor")),
            ],
            options={
                "ordering": ["-created_at", "-id"],
                "indexes": [models.Index(fields=["contractor", "actor", "-created_at"], name="capture_route_actor_idx")],
            },
        ),
    ]
