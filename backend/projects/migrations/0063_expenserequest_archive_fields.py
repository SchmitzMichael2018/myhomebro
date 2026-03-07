from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("projects", "0062_alter_expenserequest_amount"),
    ]

    operations = [
        migrations.AddField(
            model_name="expenserequest",
            name="is_archived",
            field=models.BooleanField(db_index=True, default=False),
        ),
        migrations.AddField(
            model_name="expenserequest",
            name="archived_at",
            field=models.DateTimeField(blank=True, null=True),
        ),
        migrations.AddField(
            model_name="expenserequest",
            name="archived_reason",
            field=models.CharField(blank=True, default="", max_length=255),
        ),
    ]