from django.conf import settings
from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("projects", "0089_notification"),
        migrations.swappable_dependency(settings.AUTH_USER_MODEL),
    ]

    operations = [
        migrations.AddField(
            model_name="milestone",
            name="subcontractor_completion_note",
            field=models.TextField(
                blank=True,
                default="",
                help_text="Optional note from the subcontractor when submitting completion.",
            ),
        ),
        migrations.AddField(
            model_name="milestone",
            name="subcontractor_completion_status",
            field=models.CharField(
                choices=[
                    ("not_submitted", "Not Submitted"),
                    ("submitted_for_review", "Submitted for Review"),
                    ("approved", "Approved"),
                    ("needs_changes", "Needs Changes"),
                ],
                db_index=True,
                default="not_submitted",
                help_text="Parallel subcontractor completion-review workflow state.",
                max_length=32,
            ),
        ),
        migrations.AddField(
            model_name="milestone",
            name="subcontractor_marked_complete_at",
            field=models.DateTimeField(
                blank=True,
                help_text="When the assigned subcontractor submitted completion for review.",
                null=True,
            ),
        ),
        migrations.AddField(
            model_name="milestone",
            name="subcontractor_marked_complete_by",
            field=models.ForeignKey(
                blank=True,
                help_text="Assigned subcontractor user who submitted completion for review.",
                null=True,
                on_delete=models.deletion.SET_NULL,
                related_name="subcontractor_completion_submissions",
                to=settings.AUTH_USER_MODEL,
            ),
        ),
        migrations.AddField(
            model_name="milestone",
            name="subcontractor_review_response_note",
            field=models.TextField(
                blank=True,
                default="",
                help_text="Optional contractor response note for approval or change requests.",
            ),
        ),
        migrations.AddField(
            model_name="milestone",
            name="subcontractor_reviewed_at",
            field=models.DateTimeField(
                blank=True,
                help_text="When the contractor reviewed the subcontractor completion submission.",
                null=True,
            ),
        ),
        migrations.AddField(
            model_name="milestone",
            name="subcontractor_reviewed_by",
            field=models.ForeignKey(
                blank=True,
                help_text="Owning contractor user who reviewed the subcontractor completion submission.",
                null=True,
                on_delete=models.deletion.SET_NULL,
                related_name="subcontractor_completion_reviews",
                to=settings.AUTH_USER_MODEL,
            ),
        ),
    ]
