from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("projects", "0231_contractorwebsite_contractorwebsitepage"),
    ]

    operations = [
        migrations.AlterField(
            model_name="projectintake",
            name="lead_source",
            field=models.CharField(
                choices=[
                    ("landing_page", "Landing Page"),
                    ("public_profile", "Public Profile"),
                    ("website", "Website"),
                    ("quote_request", "Quote Request"),
                    ("manual", "Manual"),
                    ("qr", "QR"),
                    ("contractor_sent_form", "Contractor Sent Form"),
                    ("direct", "Direct"),
                ],
                default="direct",
                max_length=20,
            ),
        ),
        migrations.AlterField(
            model_name="publiccontractorlead",
            name="source",
            field=models.CharField(
                choices=[
                    ("landing_page", "Landing Page"),
                    ("public_profile", "Public Profile"),
                    ("website", "Website"),
                    ("quote_request", "Quote Request"),
                    ("manual", "Manual"),
                    ("qr", "QR"),
                    ("contractor_sent_form", "Contractor Sent Form"),
                    ("direct", "Direct"),
                ],
                default="public_profile",
                max_length=20,
            ),
        ),
    ]
