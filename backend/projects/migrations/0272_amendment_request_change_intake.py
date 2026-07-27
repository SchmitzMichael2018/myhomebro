from django.db import migrations, models
import django.db.models.deletion


class Migration(migrations.Migration):
    dependencies = [("projects", "0271_capture_field_findings_d4_1")]

    operations = [
        migrations.AddField(
            model_name="amendmentrequest",
            name="change_intake_category",
            field=models.CharField(
                blank=True,
                choices=[
                    ("add_scope", "Add Work"),
                    ("remove_scope", "Remove Work"),
                    ("material_substitution", "Substitute Material"),
                    ("design_change", "Change Design"),
                    ("quantity_change", "Change Quantity"),
                    ("changed_condition", "Changed Site Condition"),
                    ("schedule_impact", "Schedule-impacting Request"),
                    ("access_or_sequence", "Access or Sequencing Change"),
                    ("customer_revision", "Customer-requested Revision"),
                    ("contractor_scope_concern", "Contractor-discovered Scope Concern"),
                    ("other", "Other"),
                ],
                db_index=True,
                default="",
                max_length=40,
            ),
        ),
        migrations.AddField(
            model_name="amendmentrequest",
            name="source_actor_type",
            field=models.CharField(
                blank=True,
                choices=[("contractor", "Contractor"), ("customer", "Customer")],
                default="",
                max_length=20,
            ),
        ),
        migrations.AddField(
            model_name="amendmentrequest",
            name="source_capture",
            field=models.OneToOneField(
                blank=True,
                help_text="Immutable Capture provenance when this request originated in Change Intake.",
                null=True,
                on_delete=django.db.models.deletion.PROTECT,
                related_name="amendment_request_destination",
                to="projects.capture",
            ),
        ),
        migrations.AddField(
            model_name="amendmentrequest",
            name="source_artifacts",
            field=models.ManyToManyField(
                blank=True,
                related_name="amendment_requests",
                to="projects.captureartifact",
            ),
        ),
    ]
