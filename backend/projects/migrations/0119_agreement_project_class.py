from django.db import migrations, models


def set_project_class_defaults(apps, schema_editor):
    Agreement = apps.get_model("projects", "Agreement")
    Agreement.objects.filter(payment_structure="progress").update(project_class="commercial")
    Agreement.objects.filter(project_class__isnull=True).update(project_class="residential")
    Agreement.objects.filter(project_class="").update(project_class="residential")


class Migration(migrations.Migration):

    dependencies = [
        ("projects", "0118_learning_estimate_phase_one"),
    ]

    operations = [
        migrations.AddField(
            model_name="agreement",
            name="project_class",
            field=models.CharField(
                choices=[("residential", "Residential"), ("commercial", "Commercial")],
                db_index=True,
                default="residential",
                help_text=(
                    "Top-level workflow path. Residential keeps the experience simpler; "
                    "Commercial unlocks structured billing workflows."
                ),
                max_length=24,
            ),
        ),
        migrations.RunPython(set_project_class_defaults, migrations.RunPython.noop),
    ]
