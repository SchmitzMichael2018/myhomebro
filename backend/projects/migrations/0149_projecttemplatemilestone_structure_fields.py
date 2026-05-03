from django.db import migrations, models


def forwards(apps, schema_editor):
    ProjectTemplateMilestone = apps.get_model("projects", "ProjectTemplateMilestone")

    for milestone in ProjectTemplateMilestone.objects.all().iterator():
        update_fields = []

        if getattr(milestone, "start_offset", None) is None:
            legacy_days = getattr(milestone, "recommended_days_from_start", None)
            if legacy_days is not None:
                try:
                    milestone.start_offset = max(int(legacy_days) - 1, 0)
                    update_fields.append("start_offset")
                except Exception:
                    pass

        if getattr(milestone, "duration_days", None) is None:
            legacy_duration = getattr(milestone, "recommended_duration_days", None)
            if legacy_duration is not None:
                try:
                    milestone.duration_days = max(int(legacy_duration), 1)
                    update_fields.append("duration_days")
                except Exception:
                    pass

        if not bool(getattr(milestone, "pricing_advisory", False)):
            has_pricing = any(
                getattr(milestone, field, None) is not None
                for field in (
                    "suggested_amount_percent",
                    "suggested_amount_fixed",
                    "suggested_amount_low",
                    "suggested_amount_high",
                    "pricing_confidence",
                    "pricing_source_note",
                )
            )
            if has_pricing:
                milestone.pricing_advisory = True
                update_fields.append("pricing_advisory")

        if update_fields:
            milestone.save(update_fields=update_fields)


class Migration(migrations.Migration):

    dependencies = [
        ("projects", "0148_subcontractorquoterequest"),
    ]

    operations = [
        migrations.AddField(
            model_name="projecttemplatemilestone",
            name="start_offset",
            field=models.PositiveIntegerField(blank=True, null=True, help_text="Canonical start offset in days from agreement start."),
        ),
        migrations.AddField(
            model_name="projecttemplatemilestone",
            name="duration_days",
            field=models.PositiveIntegerField(blank=True, null=True, help_text="Canonical duration hint in days for this milestone."),
        ),
        migrations.AddField(
            model_name="projecttemplatemilestone",
            name="pricing_advisory",
            field=models.BooleanField(default=False, help_text="Marks milestone pricing as advisory only instead of enforced."),
        ),
        migrations.RunPython(forwards, migrations.RunPython.noop),
    ]
