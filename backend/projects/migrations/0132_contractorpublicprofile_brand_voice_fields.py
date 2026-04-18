from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [
        ("projects", "0131_proposal_learning_snapshots"),
    ]

    operations = [
        migrations.AddField(
            model_name="contractorpublicprofile",
            name="proposal_tone",
            field=models.CharField(
                blank=True,
                choices=[
                    ("professional", "Professional"),
                    ("friendly", "Friendly"),
                    ("straightforward", "Straightforward"),
                    ("premium", "Premium"),
                    ("warm_and_consultative", "Warm and Consultative"),
                ],
                default="",
                max_length=32,
            ),
        ),
        migrations.AddField(
            model_name="contractorpublicprofile",
            name="preferred_signoff",
            field=models.CharField(blank=True, default="", max_length=120),
        ),
        migrations.AddField(
            model_name="contractorpublicprofile",
            name="brand_primary_color",
            field=models.CharField(blank=True, default="", max_length=32),
        ),
    ]
