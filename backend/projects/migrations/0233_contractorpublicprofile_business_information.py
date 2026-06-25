from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("projects", "0232_website_lead_source_choices"),
    ]

    operations = [
        migrations.AddField(
            model_name="contractorpublicprofile",
            name="owner_contact_name",
            field=models.CharField(blank=True, default="", max_length=120),
        ),
        migrations.AddField(
            model_name="contractorpublicprofile",
            name="primary_trade",
            field=models.CharField(blank=True, default="", max_length=120),
        ),
        migrations.AddField(
            model_name="contractorpublicprofile",
            name="service_area_mode",
            field=models.CharField(blank=True, default="radius", max_length=24),
        ),
        migrations.AddField(
            model_name="contractorpublicprofile",
            name="service_cities",
            field=models.JSONField(blank=True, default=list),
        ),
        migrations.AddField(
            model_name="contractorpublicprofile",
            name="service_counties",
            field=models.JSONField(blank=True, default=list),
        ),
        migrations.AddField(
            model_name="contractorpublicprofile",
            name="credentials",
            field=models.JSONField(blank=True, default=dict),
        ),
        migrations.AddField(
            model_name="contractorpublicprofile",
            name="customer_trust_badges",
            field=models.JSONField(blank=True, default=list),
        ),
        migrations.AddField(
            model_name="contractorpublicprofile",
            name="has_existing_website",
            field=models.BooleanField(default=False),
        ),
        migrations.AddField(
            model_name="contractorpublicprofile",
            name="existing_website_url",
            field=models.URLField(blank=True, default=""),
        ),
        migrations.AddField(
            model_name="contractorpublicprofile",
            name="website_analysis_status",
            field=models.CharField(blank=True, default="not_started", max_length=32),
        ),
    ]
