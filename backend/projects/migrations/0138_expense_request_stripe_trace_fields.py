from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("projects", "0137_contractor_stripe_onboarding_status_and_more"),
    ]

    operations = [
        migrations.AddField(
            model_name="expenserequest",
            name="platform_fee_cents",
            field=models.PositiveIntegerField(default=0),
        ),
        migrations.AddField(
            model_name="expenserequest",
            name="payout_cents",
            field=models.PositiveIntegerField(default=0),
        ),
        migrations.AddField(
            model_name="expenserequest",
            name="stripe_checkout_session_id",
            field=models.CharField(blank=True, default="", db_index=True, max_length=255),
        ),
        migrations.AddField(
            model_name="expenserequest",
            name="stripe_checkout_url",
            field=models.URLField(blank=True, default=""),
        ),
        migrations.AddField(
            model_name="expenserequest",
            name="stripe_payment_intent_id",
            field=models.CharField(blank=True, default="", db_index=True, max_length=255),
        ),
    ]
