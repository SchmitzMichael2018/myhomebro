from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("projects", "0196_contractor_marketplace_join_invite"),
    ]

    operations = [
        migrations.AddField(
            model_name="customerrequest",
            name="payment_preference",
            field=models.CharField(
                blank=True,
                choices=[
                    ("escrow_milestones", "Escrow Milestone Holds"),
                    ("direct_pay", "Direct Payment"),
                    ("discuss", "Discuss With Contractor"),
                    ("unsure", "Not Sure Yet"),
                ],
                default="",
                max_length=32,
            ),
        ),
        migrations.AddField(
            model_name="customerrequest",
            name="project_category",
            field=models.CharField(blank=True, default="", max_length=80),
        ),
        migrations.AddField(
            model_name="customerrequest",
            name="project_mode",
            field=models.CharField(
                blank=True,
                choices=[
                    ("full_service", "Full Service"),
                    ("diy_assist", "DIY Assist"),
                    ("inspection_only", "Inspection Only"),
                    ("not_sure", "Not Sure Yet"),
                ],
                default="",
                max_length=32,
            ),
        ),
    ]
