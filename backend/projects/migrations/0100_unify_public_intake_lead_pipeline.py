from django.db import migrations, models


def migrate_public_profile_sources(apps, schema_editor):
    PublicContractorLead = apps.get_model("projects", "PublicContractorLead")
    PublicContractorLead.objects.filter(source="profile").update(source="public_profile")


class Migration(migrations.Migration):
    dependencies = [
        ("projects", "0099_public_lead_notifications"),
    ]

    operations = [
        migrations.AddField(
            model_name="projectintake",
            name="lead_source",
            field=models.CharField(
                choices=[
                    ("landing_page", "Landing Page"),
                    ("public_profile", "Public Profile"),
                    ("qr", "QR"),
                    ("direct", "Direct"),
                ],
                default="direct",
                max_length=20,
            ),
        ),
        migrations.AddField(
            model_name="projectintake",
            name="public_lead",
            field=models.OneToOneField(
                blank=True,
                null=True,
                on_delete=models.deletion.SET_NULL,
                related_name="source_intake",
                to="projects.publiccontractorlead",
            ),
        ),
        migrations.AddField(
            model_name="projectintake",
            name="public_profile",
            field=models.ForeignKey(
                blank=True,
                null=True,
                on_delete=models.deletion.SET_NULL,
                related_name="project_intakes",
                to="projects.contractorpublicprofile",
            ),
        ),
        migrations.RunPython(migrate_public_profile_sources, migrations.RunPython.noop),
    ]
