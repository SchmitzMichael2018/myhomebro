from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("projects", "0090_milestone_subcontractor_completion_review"),
    ]

    operations = [
        migrations.AddField(
            model_name="milestone",
            name="delegated_reviewer_subaccount",
            field=models.ForeignKey(
                blank=True,
                help_text="Optional delegated internal reviewer for worker submissions on this milestone.",
                null=True,
                on_delete=models.deletion.SET_NULL,
                related_name="review_milestones",
                to="projects.contractorsubaccount",
            ),
        ),
    ]
