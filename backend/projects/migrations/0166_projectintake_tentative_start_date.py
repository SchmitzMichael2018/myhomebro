from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("projects", "0165_projecttemplate_workflow_profile"),
    ]

    operations = [
        migrations.AddField(
            model_name="projectintake",
            name="tentative_start_date",
            field=models.DateField(blank=True, null=True),
        ),
    ]
