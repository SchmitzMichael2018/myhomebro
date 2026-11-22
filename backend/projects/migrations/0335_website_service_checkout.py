from django.db import migrations, models
import django.db.models.deletion
import django.utils.timezone


class Migration(migrations.Migration):
    dependencies = [("projects", "0334_restaurant_menu")]

    operations = [
        migrations.AddField(model_name="websiteserviceproject", name="proposal_deliverables", field=models.TextField(blank=True, max_length=8000)),
        migrations.AddField(model_name="websiteserviceproject", name="service_terms", field=models.TextField(blank=True, max_length=8000)),
        migrations.AddField(model_name="websiteserviceproject", name="refund_terms", field=models.TextField(blank=True, max_length=4000)),
        migrations.AddField(model_name="websiteserviceproject", name="quoted_price_cents", field=models.PositiveIntegerField(blank=True, null=True)),
        migrations.AddField(model_name="websiteserviceproject", name="proposal_sent_at", field=models.DateTimeField(blank=True, null=True)),
        migrations.AddField(model_name="websiteserviceproject", name="terms_accepted_at", field=models.DateTimeField(blank=True, null=True)),
        migrations.AddField(model_name="websiteserviceproject", name="payment_status", field=models.CharField(choices=[("not_ready", "Not ready"), ("checkout", "Checkout available"), ("paid", "Paid"), ("failed", "Payment failed"), ("refunded", "Refunded")], db_index=True, default="not_ready", max_length=20)),
        migrations.AddField(model_name="websiteserviceproject", name="stripe_checkout_session_id", field=models.CharField(blank=True, max_length=255, null=True, unique=True)),
        migrations.AddField(model_name="websiteserviceproject", name="stripe_payment_intent_id", field=models.CharField(blank=True, max_length=255)),
        migrations.AddField(model_name="websiteserviceproject", name="paid_at", field=models.DateTimeField(blank=True, null=True)),
        migrations.AddField(model_name="websiteserviceproject", name="final_approved_at", field=models.DateTimeField(blank=True, null=True)),
        migrations.CreateModel(
            name="WebsiteServiceEvent",
            fields=[
                ("id", models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name="ID")),
                ("event_type", models.CharField(db_index=True, max_length=40)),
                ("recipient", models.EmailField(max_length=254)),
                ("delivered", models.BooleanField(default=False)),
                ("detail", models.CharField(blank=True, max_length=500)),
                ("created_at", models.DateTimeField(default=django.utils.timezone.now)),
                ("project", models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name="events", to="projects.websiteserviceproject")),
            ],
            options={"ordering": ["-created_at", "-pk"]},
        ),
    ]
