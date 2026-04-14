from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("projects", "0124_draw_request_payout_tracking"),
    ]

    operations = [
        migrations.AddField(
            model_name="agreement",
            name="agreement_fee_allocated_cents",
            field=models.PositiveIntegerField(default=0),
        ),
        migrations.AddField(
            model_name="agreement",
            name="agreement_fee_total_cents",
            field=models.PositiveIntegerField(default=0),
        ),
        migrations.AddField(
            model_name="milestone",
            name="agreement_fee_allocation_cents",
            field=models.PositiveIntegerField(default=0),
        ),
        migrations.AddField(
            model_name="milestone",
            name="amendment_number_snapshot",
            field=models.PositiveIntegerField(default=0),
        ),
    ]
