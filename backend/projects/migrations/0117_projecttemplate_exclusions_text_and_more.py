from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("projects", "0116_contractor_service_radius_miles"),
    ]

    operations = [
        migrations.AddField(
            model_name="projecttemplate",
            name="assumptions_text",
            field=models.TextField(blank=True, default=""),
        ),
        migrations.AddField(
            model_name="projecttemplate",
            name="exclusions_text",
            field=models.TextField(blank=True, default=""),
        ),
    ]
