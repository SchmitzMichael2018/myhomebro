from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("projects", "0309_invoice_direct_pay_charge_ownership"),
    ]

    operations = [
        migrations.AddField(
            model_name="contractor",
            name="deactivated_at",
            field=models.DateTimeField(blank=True, null=True),
        ),
        migrations.AddField(
            model_name="contractor",
            name="is_active",
            field=models.BooleanField(db_index=True, default=True),
        ),
    ]
