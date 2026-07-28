from django.db import migrations, models


def backfill_pdf_generation_status(apps, schema_editor):
    agreement = apps.get_model("projects", "Agreement")
    agreement.objects.exclude(pdf_file="").update(pdf_generation_status="completed")
    agreement.objects.filter(pdf_file="").update(pdf_generation_status="disabled")


class Migration(migrations.Migration):
    dependencies = [
        ("projects", "0273_capture_routing_attempt"),
    ]

    operations = [
        migrations.AddField(
            model_name="agreement",
            name="pdf_generation_status",
            field=models.CharField(
                choices=[
                    ("pending", "Pending"),
                    ("disabled", "Async generation disabled"),
                    ("queued", "Queued"),
                    ("processing", "Processing"),
                    ("completed", "Completed"),
                    ("failed_retryable", "Failed — retryable"),
                    ("failed_permanent", "Failed — permanent"),
                ],
                db_index=True,
                default="pending",
                max_length=24,
            ),
        ),
        migrations.AddField(
            model_name="agreement",
            name="pdf_task_id",
            field=models.CharField(blank=True, default="", max_length=255),
        ),
        migrations.AddField(
            model_name="agreement",
            name="pdf_generation_error_code",
            field=models.CharField(blank=True, default="", max_length=80),
        ),
        migrations.AddField(
            model_name="agreement",
            name="pdf_generation_updated_at",
            field=models.DateTimeField(blank=True, null=True),
        ),
        migrations.RunPython(backfill_pdf_generation_status, migrations.RunPython.noop),
    ]
