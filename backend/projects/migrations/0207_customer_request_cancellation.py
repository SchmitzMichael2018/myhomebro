from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("projects", "0206_customer_request_source_intake"),
    ]

    operations = [
        migrations.AddField(
            model_name="customerrequest",
            name="cancellation_reason",
            field=models.TextField(blank=True, default=""),
        ),
        migrations.AddField(
            model_name="customerrequest",
            name="cancelled_at",
            field=models.DateTimeField(blank=True, null=True),
        ),
        migrations.AlterField(
            model_name="customerrequest",
            name="status",
            field=models.CharField(
                choices=[
                    ("draft", "Draft"),
                    ("submitted", "Submitted"),
                    ("routed", "Routed"),
                    ("marketplace_ready", "Marketplace Ready"),
                    ("matched", "Matched"),
                    ("converted_to_project", "Converted to Project"),
                    ("closed", "Closed"),
                    ("cancelled", "Cancelled"),
                ],
                db_index=True,
                default="submitted",
                max_length=32,
            ),
        ),
    ]
