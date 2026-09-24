import hashlib
import re

from django.core.exceptions import ValidationError
from django.core.validators import validate_email
from django.db import migrations, models
from django.db.models import Q


_PHONE_RAW_PATTERN = re.compile(r"\+?[0-9 ()\-.]+\Z", re.ASCII)
_PHONE_E164_PATTERN = re.compile(r"\+[1-9][0-9]{7,14}\Z", re.ASCII)


def _has_valid_phone_parentheses(raw):
    in_group = False
    group_has_digit = False
    for character in raw:
        if character == "(":
            if in_group:
                return False
            in_group = True
            group_has_digit = False
        elif character == ")":
            if not in_group or not group_has_digit:
                return False
            in_group = False
        elif in_group and "0" <= character <= "9":
            group_has_digit = True
    return not in_group


def _normalize_phone(value):
    raw = str(value or "").strip()
    if (
        not raw
        or not raw.isascii()
        or not _PHONE_RAW_PATTERN.fullmatch(raw)
        or not _has_valid_phone_parentheses(raw)
    ):
        return ""
    digits = "".join(character for character in raw if "0" <= character <= "9")
    if not digits or set(digits) == {"0"}:
        return ""
    if raw.startswith("+"):
        phone = f"+{digits}"
    elif len(digits) == 10:
        phone = f"+1{digits}"
    elif len(digits) == 11 and digits.startswith("1"):
        phone = f"+{digits}"
    else:
        return ""
    return phone if _PHONE_E164_PATTERN.fullmatch(phone) else ""


def _identity(invite):
    email = str(invite.contractor_email or "").strip().lower()
    raw_phone = str(invite.contractor_phone or "").strip()
    phone = _normalize_phone(raw_phone)
    if raw_phone and not phone:
        return ""
    if email:
        try:
            validate_email(email)
        except ValidationError:
            return ""
        identity = f"email:{email}"
        if len(identity) > 255:
            return f"email:sha256:{hashlib.sha256(identity.encode('utf-8')).hexdigest()}"
        return identity
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
