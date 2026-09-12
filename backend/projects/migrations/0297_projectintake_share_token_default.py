from django.db import migrations, models

import projects.models_project_intake


class Migration(migrations.Migration):
    dependencies = [
        ("projects", "0296_contractorreview_structured_feedback"),
    ]

    operations = [
        migrations.AlterField(
            model_name="projectintake",
            name="share_token",
            field=models.CharField(
                blank=True,
                default=projects.models_project_intake.generate_project_intake_share_token,
                max_length=64,
                unique=True,
            ),
        ),
    ]
