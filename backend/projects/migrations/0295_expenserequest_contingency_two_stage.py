from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [("projects", "0294_zero_dispute_rework_milestone_amounts")]

    operations = [
        migrations.AddField(
            model_name="expenserequest",
            name="contingency_stage",
            field=models.CharField(
                blank=True,
                choices=[
                    ("", "Not applicable"),
                    ("approval_requested", "Approval requested"),
                    ("approved_pending_receipt", "Approved — final receipt needed"),
                    ("final_receipt_submitted", "Final receipt submitted"),
                    ("finalized", "Finalized"),
                ],
                db_index=True,
                default="",
                max_length=32,
            ),
        ),
        migrations.AddField(
            model_name="expenserequest",
            name="approved_amount",
            field=models.DecimalField(blank=True, decimal_places=2, max_digits=10, null=True),
        ),
        migrations.AddField(
            model_name="expenserequest",
            name="final_receipt",
            field=models.FileField(blank=True, null=True, upload_to="expense_requests/final_receipt/"),
        ),
        migrations.AddField(
            model_name="expenserequest",
            name="final_receipt_submitted_at",
            field=models.DateTimeField(blank=True, null=True),
        ),
    ]
