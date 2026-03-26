from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("projects", "0098_public_lead_ai_and_agreement_linking"),
    ]

    operations = [
        migrations.AddField(
            model_name="publiccontractorlead",
            name="accepted_email_sent_at",
            field=models.DateTimeField(blank=True, null=True),
        ),
        migrations.AddField(
            model_name="publiccontractorlead",
            name="rejected_at",
            field=models.DateTimeField(blank=True, null=True),
        ),
        migrations.AddField(
            model_name="publiccontractorlead",
            name="rejected_email_sent_at",
            field=models.DateTimeField(blank=True, null=True),
        ),
        migrations.AlterField(
            model_name="publiccontractorlead",
            name="status",
            field=models.CharField(
                choices=[
                    ("new", "New"),
                    ("accepted", "Accepted"),
                    ("rejected", "Rejected"),
                    ("contacted", "Contacted"),
                    ("qualified", "Qualified"),
                    ("closed", "Closed"),
                    ("archived", "Archived"),
                ],
                default="new",
                max_length=20,
            ),
        ),
    ]
