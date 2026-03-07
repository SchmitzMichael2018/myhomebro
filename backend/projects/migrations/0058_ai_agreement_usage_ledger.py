# backend/projects/migrations/0058_ai_agreement_usage_ledger.py
# v2026-02-19 — Create AIAgreementUsage ledger for 1 credit = 1 agreement
from django.db import migrations, models
import django.db.models.deletion
import django.utils.timezone


class Migration(migrations.Migration):

    # TODO: update to your latest projects migration
    dependencies = [
        ("projects", "0057_contractoraientitlement_allow_agreement_writer_and_more"),
    ]

    operations = [
        migrations.CreateModel(
            name="AIAgreementUsage",
            fields=[
                ("id", models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name="ID")),
                ("agreement_id", models.PositiveIntegerField(db_index=True)),
                ("feature_key", models.CharField(choices=[("agreement_bundle", "Agreement AI Bundle")], db_index=True, max_length=64)),
                ("created_at", models.DateTimeField(db_index=True, default=django.utils.timezone.now)),
                ("contractor", models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name="ai_agreement_usages", to="projects.contractor")),
            ],
            options={"ordering": ["-created_at"]},
        ),
        migrations.AddConstraint(
            model_name="aiagreementusage",
            constraint=models.UniqueConstraint(
                fields=("contractor", "agreement_id", "feature_key"),
                name="uniq_ai_usage_contractor_agreement_feature",
            ),
        ),
    ]
