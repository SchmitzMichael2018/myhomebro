from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("projects", "0121_notification_draw_request"),
    ]

    operations = [
        migrations.AddField(
            model_name="drawrequest",
            name="released_at",
            field=models.DateTimeField(blank=True, null=True),
        ),
    ]
