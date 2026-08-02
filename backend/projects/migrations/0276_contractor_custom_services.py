from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [("projects", "0275_diy_project_planner_phase1")]

    operations = [
        migrations.AddField(
            model_name="contractor",
            name="custom_services",
            field=models.JSONField(blank=True, default=list),
        ),
    ]
