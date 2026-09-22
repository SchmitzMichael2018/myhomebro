from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("accounts", "0005_account_verification_anti_abuse"),
    ]

    operations = [
        migrations.AddField(
            model_name="user",
            name="email_verification_token_version",
            field=models.PositiveIntegerField(default=0),
        ),
    ]
