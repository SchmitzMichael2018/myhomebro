from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [("projects", "0295_expenserequest_contingency_two_stage")]

    operations = [
        migrations.AddField(
            model_name="contractorreview",
            name="liked_most",
            field=models.TextField(blank=True, default=""),
        ),
        migrations.AddField(
            model_name="contractorreview",
            name="could_improve",
            field=models.TextField(blank=True, default=""),
        ),
    ]
