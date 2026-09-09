from django.db import migrations, models
import django.db.models.deletion


class Migration(migrations.Migration):
    dependencies = [("projects", "0292_milestone_collaborator_assignment")]

    operations = [
        migrations.AddField(
            model_name="warrantyworkorder",
            name="milestone",
            field=models.OneToOneField(
                blank=True,
                help_text="Zero-dollar agreement milestone created for the covered repair.",
                null=True,
                on_delete=django.db.models.deletion.SET_NULL,
                related_name="warranty_work_order",
                to="projects.milestone",
            ),
        ),
    ]
