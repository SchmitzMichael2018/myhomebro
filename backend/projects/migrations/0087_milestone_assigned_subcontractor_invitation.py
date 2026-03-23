import django.db.models.deletion
from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("projects", "0086_smsconsentstatus"),
    ]

    operations = [
        migrations.AddField(
            model_name="milestone",
            name="assigned_subcontractor_invitation",
            field=models.ForeignKey(
                blank=True,
                help_text="Accepted subcontractor invitation assigned to this milestone.",
                null=True,
                on_delete=django.db.models.deletion.SET_NULL,
                related_name="assigned_milestones",
                to="projects.subcontractorinvitation",
            ),
        ),
    ]
