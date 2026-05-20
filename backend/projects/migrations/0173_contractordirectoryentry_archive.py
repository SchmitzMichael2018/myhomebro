from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("projects", "0172_contractor_directory_service_normalization"),
    ]

    operations = [
        migrations.AddField(
            model_name="contractordirectoryentry",
            name="archived_at",
            field=models.DateTimeField(blank=True, null=True),
        ),
        migrations.AddField(
            model_name="contractordirectoryentry",
            name="is_archived",
            field=models.BooleanField(db_index=True, default=False),
        ),
    ]
