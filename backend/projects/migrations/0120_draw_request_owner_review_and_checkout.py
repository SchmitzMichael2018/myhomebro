from django.db import migrations, models
import uuid


class Migration(migrations.Migration):

    dependencies = [
        ("projects", "0119_agreement_project_class"),
    ]

    operations = [
        migrations.AddField(
            model_name="drawrequest",
            name="homeowner_acted_at",
            field=models.DateTimeField(blank=True, null=True),
        ),
        migrations.AddField(
            model_name="drawrequest",
            name="homeowner_review_notes",
            field=models.TextField(blank=True, default=""),
        ),
        migrations.AddField(
            model_name="drawrequest",
            name="homeowner_viewed_at",
            field=models.DateTimeField(blank=True, null=True),
        ),
        migrations.AddField(
            model_name="drawrequest",
            name="last_review_email_error",
            field=models.TextField(blank=True, default=""),
        ),
        migrations.AddField(
            model_name="drawrequest",
            name="paid_at",
            field=models.DateTimeField(blank=True, null=True),
        ),
        migrations.AddField(
            model_name="drawrequest",
            name="paid_via",
            field=models.CharField(blank=True, default="", max_length=32),
        ),
        migrations.AddField(
            model_name="drawrequest",
            name="public_token",
            field=models.UUIDField(db_index=True, default=uuid.uuid4, editable=False, unique=True),
        ),
        migrations.AddField(
            model_name="drawrequest",
            name="review_email_sent_at",
            field=models.DateTimeField(blank=True, null=True),
        ),
        migrations.AddField(
            model_name="drawrequest",
            name="stripe_checkout_session_id",
            field=models.CharField(blank=True, db_index=True, default="", max_length=255),
        ),
        migrations.AddField(
            model_name="drawrequest",
            name="stripe_checkout_url",
            field=models.URLField(blank=True, default=""),
        ),
        migrations.AddField(
            model_name="drawrequest",
            name="stripe_payment_intent_id",
            field=models.CharField(blank=True, db_index=True, default="", max_length=255),
        ),
    ]
