from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("projects", "0079_marketpricingbaseline_pricingobservation_and_more"),
    ]

    operations = [
        migrations.AddField(
            model_name="milestone",
            name="normalized_milestone_type",
            field=models.CharField(
                blank=True,
                db_index=True,
                default="",
                help_text="Stable milestone category copied from template/AI guidance.",
                max_length=128,
            ),
        ),
        migrations.AddField(
            model_name="milestone",
            name="template_suggested_amount",
            field=models.DecimalField(
                blank=True,
                decimal_places=2,
                help_text="Original template-suggested amount snapshot.",
                max_digits=10,
                null=True,
            ),
        ),
        migrations.AddField(
            model_name="milestone",
            name="ai_suggested_amount",
            field=models.DecimalField(
                blank=True,
                decimal_places=2,
                help_text="AI or applied suggestion snapshot at milestone creation time.",
                max_digits=10,
                null=True,
            ),
        ),
        migrations.AddField(
            model_name="milestone",
            name="suggested_amount_low",
            field=models.DecimalField(
                blank=True,
                decimal_places=2,
                help_text="Low-end suggested price range snapshot.",
                max_digits=10,
                null=True,
            ),
        ),
        migrations.AddField(
            model_name="milestone",
            name="suggested_amount_high",
            field=models.DecimalField(
                blank=True,
                decimal_places=2,
                help_text="High-end suggested price range snapshot.",
                max_digits=10,
                null=True,
            ),
        ),
        migrations.AddField(
            model_name="milestone",
            name="pricing_confidence",
            field=models.CharField(
                blank=True,
                default="",
                help_text="Confidence level for pricing guidance.",
                max_length=16,
            ),
        ),
        migrations.AddField(
            model_name="milestone",
            name="pricing_source_note",
            field=models.CharField(
                blank=True,
                default="",
                help_text="Short note describing pricing guidance source.",
                max_length=255,
            ),
        ),
        migrations.AddField(
            model_name="milestone",
            name="recommended_days_from_start",
            field=models.PositiveIntegerField(
                blank=True,
                help_text="Suggested relative day offset from agreement start.",
                null=True,
            ),
        ),
        migrations.AddField(
            model_name="milestone",
            name="recommended_duration_days",
            field=models.PositiveIntegerField(
                blank=True,
                help_text="Suggested duration in days copied from template/AI guidance.",
                null=True,
            ),
        ),
        migrations.AddField(
            model_name="milestone",
            name="materials_hint",
            field=models.TextField(
                blank=True,
                default="",
                help_text="Suggested materials or takeoff hint copied from template/AI guidance.",
            ),
        ),
    ]