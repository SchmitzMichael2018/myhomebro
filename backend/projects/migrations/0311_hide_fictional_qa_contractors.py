from django.db import migrations
from django.utils import timezone


FICTIONAL_QA_BUSINESS_NAMES = (
    "Contractor2 Services",
    "MyHomeBro QA Contractor",
)


def hide_fictional_qa_contractors(apps, schema_editor):
    Contractor = apps.get_model("projects", "Contractor")
    Contractor.objects.filter(
        business_name__in=FICTIONAL_QA_BUSINESS_NAMES,
        is_active=True,
    ).update(
        is_active=False,
        deactivated_at=timezone.now(),
    )


class Migration(migrations.Migration):

    dependencies = [
        ("projects", "0310_contractor_role_lifecycle"),
    ]

    operations = [
        migrations.RunPython(hide_fictional_qa_contractors, migrations.RunPython.noop),
    ]
