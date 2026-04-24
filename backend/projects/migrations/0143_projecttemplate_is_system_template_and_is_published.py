from django.db import migrations, models
from django.utils import timezone


def backfill_system_template_flags(apps, schema_editor):
    ProjectTemplate = apps.get_model("projects", "ProjectTemplate")

    now = timezone.now()
    system_templates = ProjectTemplate.objects.filter(models.Q(is_system=True) | models.Q(visibility="system"))

    for template in system_templates.iterator():
        updates = []

        if not template.is_system:
            template.is_system = True
            updates.append("is_system")

        if not template.is_system_template:
            template.is_system_template = True
            updates.append("is_system_template")

        if not template.is_published:
            template.is_published = True
            updates.append("is_published")

        if template.visibility != "system":
            template.visibility = "system"
            updates.append("visibility")

        if not template.allow_discovery:
            template.allow_discovery = True
            updates.append("allow_discovery")

        if template.contractor_id is not None:
            template.contractor = None
            updates.append("contractor")

        if template.published_at is None:
            template.published_at = now
            updates.append("published_at")

        if updates:
            template.save(update_fields=updates)


def reverse_backfill_system_template_flags(apps, schema_editor):
    return None


class Migration(migrations.Migration):

    dependencies = [
        ("projects", "0142_contractorpublicprofile_brand_accent_color_and_more"),
    ]

    operations = [
        migrations.AddField(
            model_name="projecttemplate",
            name="is_system_template",
            field=models.BooleanField(
                default=False,
                db_index=True,
                help_text="Marks this template as a system-owned starter template.",
            ),
        ),
        migrations.AddField(
            model_name="projecttemplate",
            name="is_published",
            field=models.BooleanField(
                default=False,
                db_index=True,
                help_text="Whether this system template is visible to contractors.",
            ),
        ),
        migrations.RunPython(backfill_system_template_flags, reverse_backfill_system_template_flags),
    ]
