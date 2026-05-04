from django.conf import settings
from django.db import migrations, models
import django.db.models.deletion


class Migration(migrations.Migration):

    dependencies = [
        ("projects", "0149_projecttemplatemilestone_structure_fields"),
    ]

    operations = [
        migrations.CreateModel(
            name="SupportMessage",
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
                ("sender_role", models.CharField(choices=[("user", "User"), ("support", "Support")], db_index=True, default="user", max_length=16)),
                ("message_text", models.TextField()),
                ("is_internal", models.BooleanField(default=False)),
                ("created_at", models.DateTimeField(auto_now_add=True, db_index=True)),
                (
                    "sender",
                    models.ForeignKey(
                        blank=True,
                        null=True,
                        on_delete=django.db.models.deletion.SET_NULL,
                        related_name="support_messages_sent",
                        to=settings.AUTH_USER_MODEL,
                    ),
                ),
                (
                    "ticket",
                    models.ForeignKey(
                        on_delete=django.db.models.deletion.CASCADE,
                        related_name="messages",
                        to="projects.supportticket",
                    ),
                ),
            ],
            options={
                "ordering": ["created_at", "id"],
            },
        ),
    ]
