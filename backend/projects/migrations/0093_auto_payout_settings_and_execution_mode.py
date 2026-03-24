from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("projects", "0092_milestonepayout_foundations"),
    ]

    operations = [
        migrations.AddField(
            model_name="contractor",
            name="auto_subcontractor_payouts_enabled",
            field=models.BooleanField(default=False),
        ),
        migrations.AddField(
            model_name="milestonepayout",
            name="execution_mode",
            field=models.CharField(
                blank=True,
                choices=[("manual", "Manual"), ("automatic", "Automatic")],
                default="",
                max_length=16,
            ),
        ),
    ]
