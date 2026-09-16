from datetime import datetime
from zoneinfo import ZoneInfo

from django.db import migrations


PROMOTION_LAUNCH_AT = datetime(2026, 9, 16, 0, 0, tzinfo=ZoneInfo("America/Chicago"))
REASON = "Contractor account predates the referral promotion launch."


def exclude_prelaunch_contractors(apps, schema_editor):
    Contractor = apps.get_model("projects", "Contractor")
    Participant = apps.get_model("projects", "ReferralParticipant")
    Award = apps.get_model("projects", "FoundingContractorAward")

    contractor_ids = list(
        Contractor.objects.filter(created_at__lt=PROMOTION_LAUNCH_AT).values_list("id", flat=True)
    )
    if not contractor_ids:
        return
    user_ids = list(
        Contractor.objects.filter(id__in=contractor_ids).values_list("user_id", flat=True)
    )
    User = apps.get_model("accounts", "User")
    User.objects.filter(id__in=user_ids).update(is_active=False)
    Participant.objects.filter(user_id__in=user_ids).update(
        is_eligible=False,
        disqualified_at=PROMOTION_LAUNCH_AT,
        disqualification_reason=REASON,
    )
    Award.objects.filter(contractor_id__in=contractor_ids).update(
        status="disqualified",
        disqualification_reason=REASON,
    )


class Migration(migrations.Migration):
    dependencies = [("projects", "0293_contractorreferral_foundingcontractoraward_and_more")]

    operations = [migrations.RunPython(exclude_prelaunch_contractors, migrations.RunPython.noop)]
