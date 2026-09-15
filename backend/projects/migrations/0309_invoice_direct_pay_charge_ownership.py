from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [
        ("projects", "0308_customerrefundrequest_approved_amount_and_more"),
    ]

    operations = [
        migrations.AddField(
            model_name="expenserequest",
            name="direct_pay_charge_type",
            field=models.CharField(
                blank=True,
                choices=[
                    ("direct", "Connected-account direct charge"),
                    ("destination", "Legacy platform destination charge"),
                ],
                default="",
                max_length=24,
            ),
        ),
        migrations.AddField(
            model_name="expenserequest",
            name="direct_pay_connected_account_id",
            field=models.CharField(blank=True, db_index=True, default="", max_length=255),
        ),
        migrations.AddField(
            model_name="drawrequest",
            name="direct_pay_charge_type",
            field=models.CharField(
                blank=True,
                choices=[
                    ("direct", "Connected-account direct charge"),
                    ("destination", "Legacy platform destination charge"),
                ],
                default="",
                max_length=24,
            ),
        ),
        migrations.AddField(
            model_name="drawrequest",
            name="direct_pay_connected_account_id",
            field=models.CharField(blank=True, db_index=True, default="", max_length=255),
        ),
        migrations.AddField(
            model_name="invoice",
            name="direct_pay_charge_type",
            field=models.CharField(
                blank=True,
                choices=[
                    ("direct", "Connected-account direct charge"),
                    ("destination", "Legacy platform destination charge"),
                ],
                default="",
                help_text="Immutable payment-rail snapshot used for refunds and reconciliation.",
                max_length=24,
            ),
        ),
        migrations.AddField(
            model_name="invoice",
            name="direct_pay_connected_account_id",
            field=models.CharField(
                blank=True,
                db_index=True,
                default="",
                help_text="Connected Stripe account that owns the Direct Pay charge.",
                max_length=255,
            ),
        ),
    ]
