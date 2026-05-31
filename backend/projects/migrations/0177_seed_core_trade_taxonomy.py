"""
Migration 0177 — seed core trade ProjectType + ProjectSubtype records.

Background: ProjectType/ProjectSubtype tables were created in 0078 but only
seeded with a small set of types in 0156–0158 (Remodel, Outdoor Living, Pool,
Siding, Junk Removal, Garage Doors). The historical trade types that existed as
CharField choices (Roofing, Flooring, Painting, Electrical, Plumbing, HVAC, etc.)
were never migrated into the table. This causes the AI classifier to receive a
taxonomy list missing critical types, leading to wrong classifications.
"""
from django.db import migrations


def _ensure_type(ProjectType, name, sort_order):
    obj = (
        ProjectType.objects.filter(
            normalized_name=name.lower().replace(" ", "_"),
            contractor__isnull=True,
        )
        .order_by("id")
        .first()
    )
    if not obj:
        obj = ProjectType(name=name, is_system=True, sort_order=sort_order)
        obj.save()
    else:
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
        obj = ProjectSubtype(
            project_type=project_type,
            name=name,
            is_system=True,
            sort_order=sort_order,
        )
        obj.save()
    else:
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


def forwards(apps, schema_editor):
    ProjectType = apps.get_model("projects", "ProjectType")
    ProjectSubtype = apps.get_model("projects", "ProjectSubtype")

    roofing = _ensure_type(ProjectType, "Roofing", 20)
    for i, name in enumerate(
        ["Roof Replacement", "Roof Repair", "Flat Roof Installation", "Metal Roofing", "Shingle Repair"],
        start=1,
    ):
        _ensure_subtype(ProjectSubtype, roofing, name, 10 + i)

    flooring = _ensure_type(ProjectType, "Flooring", 30)
    for i, name in enumerate(
        ["Hardwood Floor Installation", "LVP / Vinyl Plank", "Tile Flooring", "Carpet Installation", "Floor Refinishing", "Subfloor Repair"],
        start=1,
    ):
        _ensure_subtype(ProjectSubtype, flooring, name, 10 + i)

    painting = _ensure_type(ProjectType, "Painting", 40)
    for i, name in enumerate(
        ["Interior Painting", "Exterior Painting", "Cabinet Painting", "Deck / Fence Staining", "Epoxy Floor Coating"],
        start=1,
    ):
        _ensure_subtype(ProjectSubtype, painting, name, 10 + i)

    electrical = _ensure_type(ProjectType, "Electrical", 50)
    for i, name in enumerate(
        ["Panel Upgrade", "Outlet / Switch Install", "Lighting Install", "EV Charger Install", "Electrical Repair"],
        start=1,
    ):
        _ensure_subtype(ProjectSubtype, electrical, name, 10 + i)

    plumbing = _ensure_type(ProjectType, "Plumbing", 60)
    for i, name in enumerate(
        ["Plumbing Repair", "Water Heater Replacement", "Fixture Installation", "Drain / Sewer Work", "Pipe Replacement"],
        start=1,
    ):
        _ensure_subtype(ProjectSubtype, plumbing, name, 10 + i)

    hvac = _ensure_type(ProjectType, "HVAC", 70)
    for i, name in enumerate(
        ["HVAC Replacement", "HVAC Repair", "Ductwork", "Mini-Split Installation", "Furnace Replacement"],
        start=1,
    ):
        _ensure_subtype(ProjectSubtype, hvac, name, 10 + i)

    fencing = _ensure_type(ProjectType, "Fencing", 75)
    for i, name in enumerate(
        ["Fence Installation", "Fence Repair", "Gate Installation"],
        start=1,
    ):
        _ensure_subtype(ProjectSubtype, fencing, name, 10 + i)

    drywall = _ensure_type(ProjectType, "Drywall", 80)
    for i, name in enumerate(
        ["Drywall Installation", "Drywall Repair", "Texture / Skim Coat", "Ceiling Repair"],
        start=1,
    ):
        _ensure_subtype(ProjectSubtype, drywall, name, 10 + i)

    landscaping = _ensure_type(ProjectType, "Landscaping", 85)
    for i, name in enumerate(
        ["Lawn & Garden", "Hardscape", "Drainage", "Tree Work", "Sod Installation"],
        start=1,
    ):
        _ensure_subtype(ProjectSubtype, landscaping, name, 10 + i)

    outdoor = _ensure_type(ProjectType, "Outdoor", 88)
    for i, name in enumerate(
        ["Shed Build", "Deck", "Patio Cover / Pergola", "Outdoor Structure"],
        start=1,
    ):
        _ensure_subtype(ProjectSubtype, outdoor, name, 10 + i)

    concrete = _ensure_type(ProjectType, "Concrete", 89)
    for i, name in enumerate(
        ["Concrete Driveway", "Concrete Patio", "Concrete Repair", "Sidewalk / Walkway", "Concrete Slab"],
        start=1,
    ):
        _ensure_subtype(ProjectSubtype, concrete, name, 10 + i)

    tile = _ensure_type(ProjectType, "Tile", 86)
    for i, name in enumerate(
        ["Tile Installation", "Backsplash", "Shower Tile", "Floor Tile"],
        start=1,
    ):
        _ensure_subtype(ProjectSubtype, tile, name, 10 + i)

    handyman = _ensure_type(ProjectType, "Handyman", 96)
    for i, name in enumerate(
        ["General Repair", "Assembly", "Miscellaneous Fixes"],
        start=1,
    ):
        _ensure_subtype(ProjectSubtype, handyman, name, 10 + i)

    addition = _ensure_type(ProjectType, "Addition", 15)
    for i, name in enumerate(
        ["Room Addition", "Garage Addition", "ADU / Guest Unit", "Sunroom"],
        start=1,
    ):
        _ensure_subtype(ProjectSubtype, addition, name, 10 + i)


def backwards(apps, schema_editor):
    # Do not reverse — removing types can break existing agreements.
    return


class Migration(migrations.Migration):

    dependencies = [
        ("projects", "0176_notificationrule_smartnotification_notificationlog_and_more"),
    ]

    operations = [
        migrations.RunPython(forwards, backwards),
    ]
