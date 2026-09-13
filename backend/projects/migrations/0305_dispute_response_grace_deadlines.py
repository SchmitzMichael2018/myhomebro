from datetime import timedelta

from django.db import migrations, models


def _add_business_day(value):
    if value is None:
        return None
    current = value
    while True:
        current += timedelta(days=1)
        if current.weekday() < 5:
            return current


def backfill_grace_deadlines(apps, schema_editor):
    Dispute = apps.get_model("projects", "Dispute")
    for dispute in Dispute.objects.all().iterator():
        updates = {}
        for due_field, grace_field in (
            ("qualification_due_at", "qualification_grace_due_at"),
            ("response_due_at", "response_grace_due_at"),
            ("proposal_due_at", "proposal_grace_due_at"),
        ):
            due_at = getattr(dispute, due_field, None)
            if due_at and not getattr(dispute, grace_field, None):
                updates[grace_field] = _add_business_day(due_at)
        if updates:
            Dispute.objects.filter(pk=dispute.pk).update(**updates)


class Migration(migrations.Migration):

    dependencies = [
        ("projects", "0304_disputeescrowallocation_settlement_invoice_and_more"),
    ]

    operations = [
        migrations.AlterField(
            model_name="dispute",
            name="status",
            field=models.CharField(
                choices=[
                    ("initiated", "Initiated"),
                    ("open", "Open"),
                    ("under_review", "Under Review"),
                    ("resolved_contractor", "Resolved - Contractor"),
                    ("resolved_homeowner", "Resolved - Homeowner"),
                    ("resolved_partial", "Resolved - Partial"),
                    ("closed", "Administratively Closed"),
                    ("canceled", "Canceled"),
                ],
                default="initiated",
                max_length=30,
            ),
        ),
        migrations.AddField(
            model_name="dispute",
            name="qualification_grace_due_at",
            field=models.DateTimeField(blank=True, db_index=True, null=True),
        ),
        migrations.AddField(
            model_name="dispute",
            name="response_grace_due_at",
            field=models.DateTimeField(blank=True, null=True),
        ),
        migrations.AddField(
            model_name="dispute",
            name="proposal_grace_due_at",
            field=models.DateTimeField(blank=True, null=True),
        ),
        migrations.RunPython(backfill_grace_deadlines, migrations.RunPython.noop),
    ]
