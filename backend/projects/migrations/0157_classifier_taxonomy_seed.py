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

    remodel = _ensure_type(ProjectType, "Remodel", 10)
    outdoor_living = _ensure_type(ProjectType, "Outdoor Living", 90)
    pool = _ensure_type(ProjectType, "Pool", 91)
    siding = _ensure_type(ProjectType, "Siding", 92)
    junk = _ensure_type(ProjectType, "Junk Removal", 93)

    for index, name in enumerate(["Home Theater / Media Room"], start=1):
        _ensure_subtype(ProjectSubtype, remodel, name, 20 + index)

    for index, name in enumerate(
        [
            "Outdoor Kitchen",
            "Patio Kitchen",
            "Outdoor Bar",
            "Grill Island",
            "Patio Extension",
            "Pergola / Patio Cover",
        ],
        start=1,
    ):
        _ensure_subtype(ProjectSubtype, outdoor_living, name, 20 + index)

    for index, name in enumerate(
        ["Inground Pool and Pool House", "Pool House Construction", "Pool Installation"],
        start=1,
    ):
        _ensure_subtype(ProjectSubtype, pool, name, 20 + index)

    for index, name in enumerate(["Siding Replacement", "Siding Repair"], start=1):
        _ensure_subtype(ProjectSubtype, siding, name, 20 + index)

    for index, name in enumerate(
        [
            "Junk Removal",
            "Debris Removal",
            "Appliance Removal",
            "Furniture Removal",
            "Construction Debris Removal",
        ],
        start=1,
    ):
        _ensure_subtype(ProjectSubtype, junk, name, 20 + index)


def backwards(apps, schema_editor):
    # Keep taxonomy additions; removing them can break existing agreements and templates.
    return


class Migration(migrations.Migration):
    dependencies = [
        ("projects", "0156_junk_removal_taxonomy"),
    ]

    operations = [
        migrations.RunPython(forwards, backwards),
    ]

