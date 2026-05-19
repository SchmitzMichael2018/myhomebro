from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("projects", "0171_contractor_directory_claim_foundation"),
    ]

    operations = [
        migrations.AddField(
            model_name="contractordirectoryentry",
            name="raw_services",
            field=models.JSONField(blank=True, default=list),
        ),
        migrations.AddField(
            model_name="contractordirectoryentry",
            name="service_normalization_status",
            field=models.CharField(
                choices=[("not_started", "Not Started"), ("auto", "Auto"), ("manual", "Manual")],
                db_index=True,
                default="not_started",
                max_length=32,
            ),
        ),
    ]
