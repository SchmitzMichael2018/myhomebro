from decimal import Decimal

from django.db import migrations


def reopen_dispute_rework_milestones(apps, schema_editor):
    Milestone = apps.get_model("projects", "Milestone")
    DisputeWorkOrder = apps.get_model("projects", "DisputeWorkOrder")
    milestone_ids = list(
        DisputeWorkOrder.objects.exclude(rework_milestone_id__isnull=True)
        .exclude(rework_milestone_id=0)
        .values_list("rework_milestone_id", flat=True)
    )
    if milestone_ids:
        Milestone.objects.filter(id__in=milestone_ids).update(
            amount=Decimal("0.00"),
            completed=False,
            completed_at=None,
            is_invoiced=False,
        )


class Migration(migrations.Migration):
    dependencies = [("projects", "0294_zero_dispute_rework_milestone_amounts")]

    operations = [migrations.RunPython(reopen_dispute_rework_milestones, migrations.RunPython.noop)]
