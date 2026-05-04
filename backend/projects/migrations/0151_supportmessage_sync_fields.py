from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("projects", "0150_supportmessage"),
    ]

    operations = [
        migrations.AddField(
            model_name="supportmessage",
            name="sender_email",
            field=models.EmailField(blank=True, default=""),
        ),
        migrations.AddField(
            model_name="supportmessage",
            name="gmail_message_id",
            field=models.CharField(blank=True, db_index=True, default="", max_length=255),
        ),
        migrations.AddField(
            model_name="supportmessage",
            name="gmail_thread_id",
            field=models.CharField(blank=True, db_index=True, default="", max_length=255),
        ),
        migrations.AddField(
            model_name="supportmessage",
            name="sent_at",
            field=models.DateTimeField(blank=True, db_index=True, null=True),
        ),
        migrations.AddConstraint(
            model_name="supportmessage",
            constraint=models.UniqueConstraint(
                condition=~models.Q(gmail_message_id=""),
                fields=("gmail_message_id",),
                name="uniq_support_message_gmail_message_id",
            ),
        ),
    ]
