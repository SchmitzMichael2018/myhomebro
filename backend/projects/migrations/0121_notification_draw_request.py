from django.db import migrations, models
import django.db.models.deletion


class Migration(migrations.Migration):

    dependencies = [
        ("projects", "0120_draw_request_owner_review_and_checkout"),
    ]

    operations = [
        migrations.AddField(
            model_name="notification",
            name="draw_request",
            field=models.ForeignKey(
                blank=True,
                null=True,
                on_delete=django.db.models.deletion.CASCADE,
                related_name="notifications",
                to="projects.drawrequest",
            ),
        ),
    ]
