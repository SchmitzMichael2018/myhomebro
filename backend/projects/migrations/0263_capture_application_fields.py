import re

from django.db import migrations, models
import django.db.models.deletion


def backfill_customer_identity(apps, schema_editor):
    Homeowner = apps.get_model("projects", "Homeowner")
    for customer in Homeowner.objects.all().iterator():
        email = str(customer.email or "").strip().lower()
        phone = re.sub(r"\D+", "", str(customer.phone_number or ""))
        customer.normalized_email = email
        customer.normalized_phone = phone
        customer.contact_information_needed = not bool(email or phone)
        customer.save(update_fields=[
            "normalized_email", "normalized_phone", "contact_information_needed"
        ])


class Migration(migrations.Migration):
    dependencies = [("projects", "0262_capture_review_fields")]

    operations = [
        migrations.RemoveConstraint(
            model_name="homeowner",
            name="uniq_homeowner_email_per_contractor",
        ),
        migrations.AlterField(
            model_name="homeowner",
            name="email",
            field=models.EmailField(blank=True, db_index=True, default="", max_length=254),
        ),
        migrations.AddField(
            model_name="homeowner",
            name="normalized_email",
            field=models.CharField(blank=True, db_index=True, default="", max_length=254),
        ),
        migrations.AddField(
            model_name="homeowner",
            name="normalized_phone",
            field=models.CharField(blank=True, db_index=True, default="", max_length=32),
        ),
        migrations.AddField(
            model_name="homeowner",
            name="contact_information_needed",
            field=models.BooleanField(db_index=True, default=False),
        ),
        migrations.AddField(
            model_name="homeowner",
            name="origin_capture",
            field=models.ForeignKey(
                blank=True, null=True, on_delete=django.db.models.deletion.SET_NULL,
                related_name="created_customers", to="projects.capture",
            ),
        ),
        migrations.AddField(
            model_name="contractoropportunity",
            name="customer",
            field=models.ForeignKey(
                blank=True, null=True, on_delete=django.db.models.deletion.SET_NULL,
                related_name="originating_contractor_opportunities", to="projects.homeowner",
            ),
        ),
        migrations.AddField(
            model_name="contractoropportunity",
            name="origin_capture",
            field=models.ForeignKey(
                blank=True, null=True, on_delete=django.db.models.deletion.SET_NULL,
                related_name="created_opportunities", to="projects.capture",
            ),
        ),
        migrations.AddField(
            model_name="customercommunicationlog",
            name="origin_capture",
            field=models.ForeignKey(
                blank=True, null=True, on_delete=django.db.models.deletion.SET_NULL,
                related_name="created_communication_logs", to="projects.capture",
            ),
        ),
        migrations.AddField(
            model_name="customercommunicationlog",
            name="opportunity",
            field=models.ForeignKey(
                blank=True, null=True, on_delete=django.db.models.deletion.SET_NULL,
                related_name="communication_logs", to="projects.contractoropportunity",
            ),
        ),
        migrations.RunPython(backfill_customer_identity, migrations.RunPython.noop),
        migrations.AddConstraint(
            model_name="homeowner",
            constraint=models.UniqueConstraint(
                condition=~models.Q(normalized_email=""),
                fields=("created_by", "normalized_email"),
                name="uniq_homeowner_email_per_contractor",
            ),
        ),
    ]
