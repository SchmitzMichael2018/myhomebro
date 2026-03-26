from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("projects", "0097_public_lead_conversion_fields"),
    ]

    operations = [
        migrations.AddField(
            model_name="agreement",
            name="source_lead",
            field=models.ForeignKey(
                blank=True,
                null=True,
                on_delete=models.SET_NULL,
                related_name="agreements_created_from_lead",
                to="projects.publiccontractorlead",
            ),
        ),
        migrations.AddField(
            model_name="publiccontractorlead",
            name="accepted_at",
            field=models.DateTimeField(blank=True, null=True),
        ),
        migrations.AddField(
            model_name="publiccontractorlead",
            name="ai_analysis",
            field=models.JSONField(blank=True, default=dict),
        ),
        migrations.AddField(
            model_name="publiccontractorlead",
            name="converted_agreement",
            field=models.ForeignKey(
                blank=True,
                null=True,
                on_delete=models.SET_NULL,
                related_name="source_public_leads",
                to="projects.agreement",
            ),
        ),
        migrations.AlterField(
            model_name="publiccontractorlead",
            name="status",
            field=models.CharField(
                choices=[
                    ("new", "New"),
                    ("accepted", "Accepted"),
                    ("contacted", "Contacted"),
                    ("qualified", "Qualified"),
                    ("closed", "Closed"),
                    ("archived", "Archived"),
                ],
                default="new",
                max_length=20,
            ),
        ),
    ]
