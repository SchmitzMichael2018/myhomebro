from decimal import Decimal

from django.db import migrations


def repair_accepted_rework_records(apps, schema_editor):
    Milestone = apps.get_model("projects", "Milestone")
    DisputeWorkOrder = apps.get_model("projects", "DisputeWorkOrder")
    Dispute = apps.get_model("projects", "Dispute")
    ResolutionProposal = apps.get_model("projects", "ResolutionProposal")
    milestone_ids = list(
        DisputeWorkOrder.objects.exclude(rework_milestone_id__isnull=True)
        .exclude(rework_milestone_id=0)
        .values_list("rework_milestone_id", flat=True)
    )
    if milestone_ids:
        Milestone.objects.filter(id__in=milestone_ids).exclude(amount=Decimal("0.00")).update(amount=Decimal("0.00"))

    for dispute in Dispute.objects.filter(status="resolved_contractor").only("id", "proposal"):
        proposal_data = dispute.proposal if isinstance(dispute.proposal, dict) else {}
        if str(proposal_data.get("proposal_type") or "").strip().lower() != "rework":
            continue
        latest = ResolutionProposal.objects.filter(dispute_id=dispute.id).order_by("-created_at", "-id").first()
        if latest and latest.status in {"draft", "proposed", "ready_for_signature"}:
            latest.status = "accepted_by_customer"
            latest.save(update_fields=["status", "updated_at"])


class Migration(migrations.Migration):
    dependencies = [("projects", "0293_warrantyworkorder_milestone")]

    operations = [migrations.RunPython(repair_accepted_rework_records, migrations.RunPython.noop)]
