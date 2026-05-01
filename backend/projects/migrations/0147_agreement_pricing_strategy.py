from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("projects", "0146_subcontractormilestoneagreement"),
    ]

    operations = [
        migrations.AddField(
            model_name="agreement",
            name="pricing_strategy",
            field=models.CharField(
                choices=[
                    ("fixed", "I know my pricing"),
                    ("estimate", "I will estimate and adjust later"),
                    ("requires_sub_quote", "I need subcontractor pricing first"),
                ],
                default="fixed",
                help_text="High-level pricing approach for agreement creation and send validation.",
                max_length=32,
                db_index=True,
            ),
        ),
    ]
