from django.db import migrations


def _ensure_type(ProjectType, name, sort_order):
    obj = (
        ProjectType.objects.filter(normalized_name=name.lower().replace(" ", "_"), contractor__isnull=True)
        .order_by("id")
        .first()
    )
    if not obj:
        obj = ProjectType(name=name, is_system=True, sort_order=sort_order)
        obj.save()
        return obj

    changed = False
    if not obj.is_system:
        obj.is_system = True
        changed = True
    if obj.contractor_id is not None:
        obj.contractor = None
        changed = True
    if changed:
        obj.save()
    return obj


def _ensure_subtype(ProjectSubtype, project_type, name, sort_order):
    obj = (
        ProjectSubtype.objects.filter(
            project_type=project_type,
            normalized_name=name.lower().replace(" ", "_"),
            contractor__isnull=True,
        )
        .order_by("id")
        .first()
    )
    if not obj:
        obj = ProjectSubtype(project_type=project_type, name=name, is_system=True, sort_order=sort_order)
        obj.save()
        return obj

    changed = False
    if not obj.is_system:
        obj.is_system = True
        changed = True
    if obj.contractor_id is not None:
        obj.contractor = None
        changed = True
    if obj.project_type_id != project_type.id:
        obj.project_type = project_type
        changed = True
    if changed:
        obj.save()
    return obj


def forwards(apps, schema_editor):
    ProjectType = apps.get_model("projects", "ProjectType")
    ProjectSubtype = apps.get_model("projects", "ProjectSubtype")

    garage_doors = _ensure_type(ProjectType, "Garage Doors", 94)
    for index, name in enumerate(
        [
            "Garage Door Replacement",
            "Garage Door Repair",
            "Garage Door Opener Installation",
        ],
        start=1,
    ):
        _ensure_subtype(ProjectSubtype, garage_doors, name, 20 + index)


def backwards(apps, schema_editor):
    return


class Migration(migrations.Migration):
    dependencies = [
        ("projects", "0157_classifier_taxonomy_seed"),
    ]

    operations = [
        migrations.RunPython(forwards, backwards),
    ]
