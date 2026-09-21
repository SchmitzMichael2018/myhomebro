from django.conf import settings
from django.db import migrations
from django.utils import timezone


CAMPAIGNS = (
    ("card", "Business Card General", "business-card", "qr", "business-card-general", "business-card", "/register"),
    ("car", "Vehicle Magnet General", "vehicle-magnet", "qr", "vehicle-magnet-general", "vehicle-magnet", "/register"),
    ("hoodie", "Hoodie General", "hoodie", "qr", "hoodie-general", "hoodie", "/register"),
    ("realtor", "Realtor Pilot", "realtor", "qr", "realtor-pilot", "realtor", "/register"),
    ("contractor", "Contractor Outreach", "contractor-outreach", "qr", "contractor-outreach", "contractor", "/register"),
)


def seed_campaigns_and_legacy_acquisition(apps, schema_editor):
    Campaign = apps.get_model("projects", "MarketingCampaign")
    Visit = apps.get_model("projects", "ReferralVisit")
    Referral = apps.get_model("projects", "ContractorReferral")
    Acquisition = apps.get_model("projects", "AccountAcquisition")
    User = apps.get_model(*settings.AUTH_USER_MODEL.split("."))
    now = timezone.now()
    for code, name, source, medium, campaign_name, content, destination in CAMPAIGNS:
        Campaign.objects.get_or_create(
            public_code=code,
            defaults={"name": name, "source": source, "medium": medium, "campaign_name": campaign_name,
                      "content": content, "destination": destination, "starts_at": now},
        )
    for visit in Visit.objects.filter(referral_code__gt="").iterator():
        medium = visit.medium or "link"
        visit.first_source = "referral"
        visit.first_medium = medium
        visit.last_source = "referral"
        visit.last_medium = medium
        visit.last_landing_page = visit.landing_page
        visit.last_referrer_url = visit.referrer_url
        visit.last_referrer_domain = visit.referrer_domain
        visit.last_touch_at = visit.first_touch_at
        visit.save(update_fields=["first_source", "first_medium", "last_source", "last_medium", "last_landing_page", "last_referrer_url", "last_referrer_domain", "last_touch_at"])
    referrals = {row.referred_user_id: row for row in Referral.objects.exclude(referred_user_id=None)}
    visits = {}
    for visit in Visit.objects.exclude(registered_user_id=None).order_by("first_touch_at", "id").iterator():
        visits.setdefault(visit.registered_user_id, visit)
    for user in User.objects.all().iterator():
        visit = visits.get(user.pk)
        referral = referrals.get(user.pk)
        if visit:
            first = {"source": visit.first_source, "medium": visit.first_medium, "campaign": visit.first_campaign,
                     "content": visit.first_content, "term": visit.first_term, "landing_page": visit.landing_page,
                     "referrer_domain": visit.referrer_domain, "referral_code": visit.referral_code}
            last = dict(first)
            first_at = visit.first_touch_at
            last_at = visit.last_touch_at or visit.first_touch_at
        else:
            first = {"source": "unknown", "medium": "legacy"}
            last = {"source": "unknown", "medium": "legacy"}
            first_at = getattr(user, "date_joined", None)
            last_at = getattr(user, "date_joined", None)
        Acquisition.objects.get_or_create(
            user_id=user.pk,
            defaults={"first_visit": visit, "last_visit": visit, "referral": referral, "roles": [],
                      "first_touch": first, "last_touch": last, "first_touch_at": first_at,
                      "last_touch_at": last_at, "account_created_at": getattr(user, "date_joined", None)},
        )


def remove_seed_campaigns(apps, schema_editor):
    Campaign = apps.get_model("projects", "MarketingCampaign")
    Campaign.objects.filter(public_code__in=[row[0] for row in CAMPAIGNS]).delete()


class Migration(migrations.Migration):
    dependencies = [("projects", "0315_marketingcampaign_and_more")]
    operations = [migrations.RunPython(seed_campaigns_and_legacy_acquisition, remove_seed_campaigns)]
