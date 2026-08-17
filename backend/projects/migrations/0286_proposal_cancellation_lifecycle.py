from django.conf import settings
from django.db import migrations, models
import django.db.models.deletion


class Migration(migrations.Migration):
    dependencies = [
        ("projects", "0285_accepted_estimate_pricing_lineage"),
        migrations.swappable_dependency(settings.AUTH_USER_MODEL),
    ]

    operations = [
        migrations.AddField(
            model_name="proposal",
            name="cancellation_kind",
            field=models.CharField(blank=True, choices=[("withdrawn", "Withdrawn"), ("voided_after_acceptance", "Voided after acceptance")], default="", max_length=32),
        ),
        migrations.AddField(
            model_name="proposal",
            name="cancellation_reason",
            field=models.CharField(blank=True, default="", max_length=255),
        ),
        migrations.AddField(
            model_name="proposal",
            name="cancelled_at",
            field=models.DateTimeField(blank=True, null=True),
        ),
        migrations.AddField(
            model_name="proposal",
            name="cancelled_by",
            field=models.ForeignKey(blank=True, null=True, on_delete=django.db.models.deletion.SET_NULL, related_name="cancelled_proposals", to=settings.AUTH_USER_MODEL),
        ),
        migrations.AlterField(
            model_name="proposal",
            name="status",
            field=models.CharField(choices=[("draft", "Draft"), ("site_visit", "Site Visit"), ("in_progress", "Proposal In Progress"), ("ready", "Proposal Ready"), ("sent", "Proposal Sent"), ("viewed", "Viewed"), ("accepted", "Accepted"), ("declined", "Declined"), ("revision_requested", "Revision Requested"), ("expired", "Expired"), ("converted", "Converted"), ("cancelled", "Cancelled")], db_index=True, default="draft", max_length=32),
        ),
        migrations.AlterField(
            model_name="proposalactivity",
            name="event_type",
            field=models.CharField(choices=[("created", "Proposal Created"), ("appointment_linked", "Appointment Linked"), ("status_updated", "Status Updated"), ("site_visit_updated", "Site Visit Updated"), ("measurement_added", "Measurement Added"), ("measurement_updated", "Measurement Updated"), ("measurement_removed", "Measurement Removed"), ("attachment_uploaded", "Attachment Uploaded"), ("attachment_updated", "Attachment Updated"), ("attachment_removed", "Attachment Removed"), ("scope_edited", "Scope Edited"), ("notes_edited", "Notes Edited"), ("line_item_added", "Line Item Added"), ("line_item_updated", "Line Item Updated"), ("line_item_removed", "Line Item Removed"), ("estimate_sent", "Estimate Sent"), ("estimate_viewed", "Estimate Viewed"), ("estimate_accepted", "Estimate Accepted"), ("estimate_declined", "Estimate Declined"), ("estimate_revision_requested", "Estimate Revision Requested"), ("agreement_override", "Agreement Review Override"), ("agreement_created", "Agreement Created"), ("estimate_withdrawn", "Estimate Withdrawn"), ("estimate_voided", "Accepted Estimate Voided")], db_index=True, max_length=40),
        ),
    ]
