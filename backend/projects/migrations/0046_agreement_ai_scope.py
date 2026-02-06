# backend/projects/migrations/0046_agreement_ai_scope.py
from django.db import migrations, models
import django.db.models.deletion


class Migration(migrations.Migration):

    dependencies = [
        ("projects", "0045_disputeaipurchase"),
    ]

    operations = [
        migrations.CreateModel(
            name="AgreementAIScope",
            fields=[
                ("id", models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name="ID")),
                ("questions", models.JSONField(blank=True, default=list)),
                ("answers", models.JSONField(blank=True, default=dict)),
                ("updated_at", models.DateTimeField(auto_now=True)),
                (
                    "agreement",
                    models.OneToOneField(
                        on_delete=django.db.models.deletion.CASCADE,
                        related_name="ai_scope",
                        to="projects.agreement",
                    ),
                ),
            ],
        ),
    ]
