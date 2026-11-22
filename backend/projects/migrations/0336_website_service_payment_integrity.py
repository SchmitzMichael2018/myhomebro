from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [("projects", "0335_website_service_checkout")]

    operations = [
        migrations.AddField(
            model_name="websiteserviceproject",
            name="checkout_proposal_fingerprint",
            field=models.CharField(blank=True, max_length=64),
        ),
    ]
