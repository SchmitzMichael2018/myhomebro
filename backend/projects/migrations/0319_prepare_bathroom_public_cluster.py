from django.db import migrations


def prepare_existing_bathroom_template(apps, schema_editor):
    ProjectTemplate = apps.get_model("projects", "ProjectTemplate")
    template = ProjectTemplate.objects.filter(
        name__iexact="Bathroom Remodel",
        is_system=True,
    ).first()
    if template is None:
        return
    template.public_category_slug = template.public_category_slug or "bathroom"
    template.public_slug = template.public_slug or "bathroom-remodel-planning"
    template.public_summary = template.public_summary or template.description[:320]
    template.public_intro = template.public_intro or template.description
    template.seo_title = template.seo_title or "Bathroom Remodel Planning Guide | MyHomeBro"
    template.seo_description = template.seo_description or (
        "Plan a bathroom remodel using the existing MyHomeBro project scope, milestones, material considerations, and project workflow."
    )
    template.public_publication_status = "ready_for_review"
    template.save(update_fields=[
        "public_category_slug",
        "public_slug",
        "public_summary",
        "public_intro",
        "seo_title",
        "seo_description",
        "public_publication_status",
    ])


def unprepare(apps, schema_editor):
    ProjectTemplate = apps.get_model("projects", "ProjectTemplate")
    ProjectTemplate.objects.filter(
        name__iexact="Bathroom Remodel",
        public_slug="bathroom-remodel-planning",
        public_publication_status="ready_for_review",
    ).update(public_publication_status="draft")


class Migration(migrations.Migration):
    dependencies = [("projects", "0318_improvement_conversion_lineage")]
    operations = [migrations.RunPython(prepare_existing_bathroom_template, unprepare)]
