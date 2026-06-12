from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("projects", "0207_customer_request_cancellation"),
    ]

    operations = [
        migrations.AddField(
            model_name="propertyprofile",
            name="bathrooms",
            field=models.DecimalField(blank=True, decimal_places=1, max_digits=4, null=True),
        ),
        migrations.AddField(
            model_name="propertyprofile",
            name="bedrooms",
            field=models.PositiveSmallIntegerField(blank=True, null=True),
        ),
    ]
