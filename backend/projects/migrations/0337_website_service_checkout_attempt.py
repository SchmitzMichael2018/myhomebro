from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [("projects", "0336_website_service_payment_integrity")]

    operations = [
        migrations.AddField(
            model_name="websiteserviceproject",
            name="checkout_attempt_token",
            field=models.CharField(blank=True, max_length=32),
        ),
        migrations.AddField(
            model_name="websiteserviceproject",
            name="checkout_attempt_started_at",
            field=models.DateTimeField(blank=True, null=True),
        ),
    ]
