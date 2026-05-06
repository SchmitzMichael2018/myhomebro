from django.db import migrations


def forwards(apps, schema_editor):
    ProjectType = apps.get_model("projects", "ProjectType")
    ProjectSubtype = apps.get_model("projects", "ProjectSubtype")

    junk_type = (
        ProjectType.objects.filter(normalized_name="junk_removal", contractor__isnull=True)
        .order_by("id")
        .first()
    )
    if not junk_type:
        junk_type = ProjectType(name="Junk Removal", is_system=True, sort_order=95)
        junk_type.save()
    else:
        changed = False
        if not junk_type.is_system:
            junk_type.is_system = True
            changed = True
        if junk_type.contractor_id is not None:
            junk_type.contractor = None
            changed = True
        if changed:
            junk_type.save()

    subtype_names = [
        "Junk Removal",
        "Debris Removal",
        "Appliance Removal",
        "Furniture Removal",
        "Construction Debris Removal",
    ]

    for index, name in enumerate(subtype_names, start=1):
        subtype = (
            ProjectSubtype.objects.filter(
                project_type=junk_type,
                normalized_name=name.lower().replace(" ", "_"),
                contractor__isnull=True,
            )
            .order_by("id")
            .first()
        )
        if not subtype:
            subtype = ProjectSubtype(
                project_type=junk_type,
                name=name,
                is_system=True,
                sort_order=20 + index,
            )
            subtype.save()
            continue

        changed = False
        if not subtype.is_system:
            subtype.is_system = True
            changed = True
        if subtype.contractor_id is not None:
            subtype.contractor = None
            changed = True
        if changed:
            subtype.save()


def backwards(apps, schema_editor):
    ProjectType = apps.get_model("projects", "ProjectType")
    ProjectSubtype = apps.get_model("projects", "ProjectSubtype")

    junk_type = (
        ProjectType.objects.filter(normalized_name="junk_removal", contractor__isnull=True)
        .order_by("id")
        .first()
    )
    if not junk_type:
        return

    ProjectSubtype.objects.filter(project_type=junk_type).delete()
    junk_type.delete()


class Migration(migrations.Migration):
    dependencies = [
        ("projects", "0155_dispute_is_archived"),
    ]

    operations = [
        migrations.RunPython(forwards, backwards),
    ]
