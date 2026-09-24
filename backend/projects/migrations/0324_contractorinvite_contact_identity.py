import hashlib

from django.db import migrations, models
from django.db.models import Q


def _normalize_phone(value):
    raw = "".join(ch for ch in str(value or "").strip() if ch.isdigit() or ch == "+")
    if raw.startswith("+"):
        return raw
    digits = "".join(ch for ch in raw if ch.isdigit())
    if len(digits) == 10:
        return f"+1{digits}"
    if len(digits) == 11 and digits.startswith("1"):
        return f"+{digits}"
    return str(value or "").strip()


def _identity(invite):
    email = str(invite.contractor_email or "").strip().lower()
    if email:
        identity = f"email:{email}"
        if len(identity) > 255:
            return f"email:sha256:{hashlib.sha256(identity.encode('utf-8')).hexdigest()}"
        return identity
    phone = _normalize_phone(invite.contractor_phone)
    if phone:
        return f"phone:{phone}"
    return ""


def backfill_contact_identity(apps, schema_editor):
    ContractorInvite = apps.get_model("projects", "ContractorInvite")
    seen = set()
    queryset = ContractorInvite.objects.filter(source_intake__isnull=False).order_by("created_at", "id")
    for invite in queryset.iterator():
        identity = _identity(invite)
        pair = (invite.source_intake_id, identity)
        if not identity or pair in seen:
            identity = f"legacy:{invite.id}:{identity}"
            if len(identity) > 255:
                digest = hashlib.sha256(identity.encode("utf-8")).hexdigest()
                identity = f"legacy:{invite.id}:sha256:{digest}"
        else:
            seen.add(pair)
        invite.contact_identity = identity
        invite.save(update_fields=["contact_identity"])


class Migration(migrations.Migration):
    dependencies = [
        ("projects", "0323_admin_request_management"),
    ]

    operations = [
        migrations.AddField(
            model_name="contractorinvite",
            name="contact_identity",
            field=models.CharField(blank=True, default="", max_length=255),
        ),
        migrations.RunPython(backfill_contact_identity, migrations.RunPython.noop),
        migrations.AddConstraint(
            model_name="contractorinvite",
            constraint=models.UniqueConstraint(
                condition=Q(source_intake__isnull=False) & ~Q(contact_identity=""),
                fields=("source_intake", "contact_identity"),
                name="uniq_intake_contractor_invite_identity",
            ),
        ),
    ]
