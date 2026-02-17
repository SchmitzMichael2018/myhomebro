# backend/projects/migrations/0053_billing_profile.py
from __future__ import annotations

from django.db import migrations, models
import django.db.models.deletion


def backfill_billing_profiles(apps, schema_editor):
    Contractor = apps.get_model("projects", "Contractor")
    ContractorBillingProfile = apps.get_model("projects", "ContractorBillingProfile")

    for c in Contractor.objects.all().only("id"):
        ContractorBillingProfile.objects.get_or_create(contractor_id=c.id)


class Migration(migrations.Migration):

    dependencies = [
        ("projects", "0052_homeowner_company_name_and_more"),
    ]


    operations = [
        migrations.CreateModel(
            name="ContractorBillingProfile",
            fields=[
                ("id", models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name="ID")),
                ("ai_subscription_active", models.BooleanField(default=False)),
                ("ai_subscription_tier", models.CharField(choices=[("free", "Free"), ("ai_pro", "AI Pro")], default="free", max_length=24)),
                ("stripe_customer_id", models.CharField(blank=True, default="", max_length=255)),
                ("stripe_subscription_id", models.CharField(blank=True, default="", max_length=255)),
                ("current_period_end", models.DateTimeField(blank=True, null=True)),
                ("cancel_at_period_end", models.BooleanField(default=False)),
                ("created_at", models.DateTimeField(auto_now_add=True)),
                ("updated_at", models.DateTimeField(auto_now=True)),
                ("contractor", models.OneToOneField(on_delete=django.db.models.deletion.CASCADE, related_name="billing_profile", to="projects.contractor")),
            ],
        ),
        migrations.RunPython(backfill_billing_profiles, migrations.RunPython.noop),
    ]
