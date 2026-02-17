from django.db import migrations
import uuid


def fill_resend_token(apps, schema_editor):
    ContractorInvite = apps.get_model("projects", "ContractorInvite")

    # If field allows null temporarily, fill missing.
    for inv in ContractorInvite.objects.all().only("id", "resend_token"):
        # If resend_token exists, keep it
        if getattr(inv, "resend_token", None):
            continue
        inv.resend_token = uuid.uuid4()
        inv.save(update_fields=["resend_token"])


class Migration(migrations.Migration):

    dependencies = [
        ("projects", "0049_contractorinvite_last_sent_at_and_more"),
    ]

    operations = [
        migrations.RunPython(fill_resend_token, migrations.RunPython.noop),
    ]
