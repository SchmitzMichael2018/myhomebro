from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("projects", "0123_rename_projects_ag_has_dis_302823_idx_projects_ag_has_dis_ca6044_idx_and_more"),
    ]

    operations = [
        migrations.AddField(
            model_name="drawrequest",
            name="escrow_source_charge_id",
            field=models.CharField(blank=True, default="", max_length=255),
        ),
        migrations.AddField(
            model_name="drawrequest",
            name="escrow_source_payment_intent_id",
            field=models.CharField(blank=True, db_index=True, default="", max_length=255),
        ),
        migrations.AddField(
            model_name="drawrequest",
            name="payout_cents",
            field=models.PositiveIntegerField(default=0),
        ),
        migrations.AddField(
            model_name="drawrequest",
            name="platform_fee_cents",
            field=models.PositiveIntegerField(default=0),
        ),
        migrations.AddField(
            model_name="drawrequest",
            name="stripe_transfer_id",
            field=models.CharField(blank=True, db_index=True, default="", max_length=255),
        ),
        migrations.AddField(
            model_name="drawrequest",
            name="transfer_created_at",
            field=models.DateTimeField(blank=True, null=True),
        ),
        migrations.AddField(
            model_name="drawrequest",
            name="transfer_failure_reason",
            field=models.TextField(blank=True, default=""),
        ),
    ]
