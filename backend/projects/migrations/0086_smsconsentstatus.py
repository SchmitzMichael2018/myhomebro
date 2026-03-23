from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("projects", "0085_subcontractorinvitation"),
    ]

    operations = [
        migrations.CreateModel(
            name="SMSConsentStatus",
            fields=[
                (
                    "id",
                    models.BigAutoField(
                        auto_created=True,
                        primary_key=True,
                        serialize=False,
                        verbose_name="ID",
                    ),
                ),
                ("phone_number", models.CharField(db_index=True, max_length=32, unique=True)),
                ("is_subscribed", models.BooleanField(default=True)),
                ("last_inbound_message_sid", models.CharField(blank=True, default="", max_length=64)),
                ("last_inbound_body", models.TextField(blank=True, default="")),
                (
                    "last_keyword_type",
                    models.CharField(
                        choices=[
                            ("opt_out", "Opt Out"),
                            ("help", "Help"),
                            ("opt_in", "Opt In"),
                            ("default", "Default"),
                            ("error", "Error"),
                        ],
                        db_index=True,
                        default="default",
                        max_length=16,
                    ),
                ),
                ("opted_out_at", models.DateTimeField(blank=True, null=True)),
                ("opted_in_at", models.DateTimeField(blank=True, null=True)),
                ("created_at", models.DateTimeField(auto_now_add=True)),
                ("updated_at", models.DateTimeField(auto_now=True)),
            ],
            options={
                "ordering": ["-updated_at", "-id"],
            },
        ),
    ]
