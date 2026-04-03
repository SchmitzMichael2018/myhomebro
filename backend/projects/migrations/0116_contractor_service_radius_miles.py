from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("projects", "0115_smsautomationdecision_deferredsmsautomation_and_more"),
    ]

    operations = [
        migrations.AddField(
            model_name="contractor",
            name="service_radius_miles",
            field=models.PositiveIntegerField(
                choices=[(10, "10"), (25, "25"), (50, "50"), (100, "100")],
                default=25,
            ),
        ),
    ]
