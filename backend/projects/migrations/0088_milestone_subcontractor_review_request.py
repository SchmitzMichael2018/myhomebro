from django.conf import settings
from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("projects", "0087_milestone_assigned_subcontractor_invitation"),
        migrations.swappable_dependency(settings.AUTH_USER_MODEL),
    ]

    operations = [
        migrations.AddField(
            model_name="milestone",
            name="subcontractor_review_note",
            field=models.TextField(
                blank=True,
                default="",
                help_text="Optional note from the assigned subcontractor when requesting review.",
            ),
        ),
        migrations.AddField(
            model_name="milestone",
            name="subcontractor_review_requested_at",
            field=models.DateTimeField(
                blank=True,
                help_text="When the assigned subcontractor requested contractor review.",
                null=True,
            ),
        ),
        migrations.AddField(
            model_name="milestone",
            name="subcontractor_review_requested_by",
            field=models.ForeignKey(
                blank=True,
                help_text="Assigned subcontractor user who requested contractor review.",
                null=True,
                on_delete=models.SET_NULL,
                related_name="subcontractor_review_requests",
                to=settings.AUTH_USER_MODEL,
            ),
        ),
    ]
