from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("projects", "0066_agreement_external_contract_attested_and_more"),
    ]

    operations = [
        migrations.AddField(
            model_name="agreement",
            name="contractor_ack_reviewed",
            field=models.BooleanField(default=False),
        ),
        migrations.AddField(
            model_name="agreement",
            name="contractor_ack_tos",
            field=models.BooleanField(default=False),
        ),
        migrations.AddField(
            model_name="agreement",
            name="contractor_ack_esign",
            field=models.BooleanField(default=False),
        ),
        migrations.AddField(
            model_name="agreement",
            name="contractor_ack_at",
            field=models.DateTimeField(blank=True, null=True),
        ),
    ]