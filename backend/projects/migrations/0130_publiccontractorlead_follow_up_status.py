from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("projects", "0129_projectintake_clarifications"),
    ]

    operations = [
        migrations.AlterField(
            model_name="publiccontractorlead",
            name="status",
            field=models.CharField(
                choices=[
                    ("new", "New"),
                    ("pending_customer_response", "Pending Customer Response"),
                    ("ready_for_review", "Ready for Review"),
                    ("follow_up", "Follow-Up"),
                    ("accepted", "Accepted"),
                    ("rejected", "Rejected"),
                    ("contacted", "Contacted"),
                    ("qualified", "Qualified"),
                    ("closed", "Closed"),
                    ("archived", "Archived"),
                ],
                default="new",
                max_length=32,
            ),
        ),
    ]
