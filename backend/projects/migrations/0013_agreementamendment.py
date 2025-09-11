# backend/backend/projects/migrations/0013_agreementamendment.py
from django.db import migrations, models
import django.db.models.deletion

class Migration(migrations.Migration):

    dependencies = [
        ("projects", "0012_agreement_end_agreement_homeowner_agreement_start_and_more"),
    ]

    operations = [
        migrations.CreateModel(
            name="AgreementAmendment",
            fields=[
                ("id", models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name="ID")),
                ("amendment_number", models.PositiveIntegerField(default=1)),
                ("parent", models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name="amendments", to="projects.agreement")),
                ("child", models.OneToOneField(on_delete=django.db.models.deletion.CASCADE, related_name="as_amendment", to="projects.agreement")),
            ],
            options={
                "verbose_name": "Agreement Amendment",
                "verbose_name_plural": "Agreement Amendments",
                "unique_together": {("parent", "amendment_number")},
            },
        ),
    ]
