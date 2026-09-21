from django.contrib.auth import get_user_model
from django.test import RequestFactory, TestCase, override_settings
from django.urls import reverse
from django.contrib.sessions.middleware import SessionMiddleware
from django.utils import timezone

from projects.models import Agreement, Contractor, Homeowner, Invoice, Project
from projects.models_attribution import AccountAcquisition, AttributionEvent, MarketingCampaign, ProjectAttributionSnapshot
from projects.models_referrals import ContractorReferral, ReferralEarning, ReferralVisit
from projects.services.attribution import (
    associate_account,
    capture_visit,
    classify_touch,
    record_event,
    snapshot_project,
    snapshot_revenue,
)
from projects.services.referrals import attribute_customer_registration, participant_for_user
from receipts.models import Receipt


User = get_user_model()


def request_with_session(path="/", *, query="", referrer="", user_agent="Mozilla/5.0"):
    request = RequestFactory().get(f"{path}{query}", HTTP_REFERER=referrer, HTTP_USER_AGENT=user_agent)
    SessionMiddleware(lambda req: None).process_request(request)
    request.session.save()
    return request


@override_settings(DEBUG=False, ALLOWED_HOSTS=["testserver", "myhomebro.com"])
class AttributionFoundationTests(TestCase):
    def make_user(self, email):
        return User.objects.create_user(email=email, password="test-pass")

    def make_project(self):
        contractor_user = self.make_user("contractor-attribution@example.com")
        contractor = Contractor.objects.create(user=contractor_user, business_name="Builder")
        customer_user = self.make_user("customer-attribution@example.com")
        homeowner = Homeowner.objects.create(full_name="Customer", email=customer_user.email)
        project = Project.objects.create(contractor=contractor, homeowner=homeowner, title="Attributed project")
        return project, customer_user, contractor_user

    def test_first_touch_is_immutable_and_meaningful_last_touch_updates(self):
        request = request_with_session("/", query="?utm_source=google&utm_medium=organic&utm_campaign=seo")
        visit = capture_visit(request)
        first_at = visit.first_touch_at
        request.GET = {"utm_source": "facebook", "utm_medium": "paid", "utm_campaign": "fall"}
        visit = capture_visit(request)
        self.assertEqual(visit.first_source, "google")
        self.assertEqual(visit.first_medium, "organic")
        self.assertEqual(visit.first_touch_at, first_at)
        self.assertEqual(visit.last_source, "facebook")
        self.assertEqual(visit.last_medium, "paid-social")

    def test_direct_revisit_does_not_erase_last_attributable_touch(self):
        request = request_with_session("/", query="?utm_source=instagram&utm_medium=social")
        visit = capture_visit(request)
        request.GET = {}
        visit = capture_visit(request)
        self.assertEqual((visit.last_source, visit.last_medium), ("instagram", "organic-social"))

    def test_malformed_utm_is_bounded_and_safe(self):
        touch = classify_touch(params={"utm_source": "Google<>" + ("x" * 200), "utm_medium": "CPC"})
        self.assertLessEqual(len(touch["source"]), 64)
        self.assertNotIn("<", touch["source"])
        self.assertEqual(touch["medium"], "cpc")
        self.assertEqual(classify_touch(params={"utm_source": "Google", "utm_medium": "CPC"})["medium"], "paid-search")

    def test_search_social_and_external_referrer_classification(self):
        self.assertEqual(classify_touch(referrer="https://www.google.com/search?q=roof")["medium"], "organic")
        self.assertEqual(classify_touch(referrer="https://l.facebook.com/path")["source"], "facebook")
        external = classify_touch(referrer="https://partner.example/path")
        self.assertEqual((external["source"], external["medium"]), ("partner.example", "referral"))

    def test_campaign_short_link_records_visit_and_uses_configurable_destination(self):
        campaign = MarketingCampaign.objects.create(name="Card", public_code="test-card", source="business-card", medium="qr", campaign_name="business-card-general", destination="/register?role=customer")
        response = self.client.get("/go/test-card")
        self.assertRedirects(response, "/register?role=customer", fetch_redirect_response=False)
        visit = ReferralVisit.objects.get(campaign=campaign)
        self.assertEqual((visit.first_source, visit.first_medium), ("business-card", "qr"))
        self.assertTrue(AttributionEvent.objects.filter(event_type="landing_view", campaign=campaign).exists())

    def test_disabled_invalid_and_unsafe_campaigns(self):
        MarketingCampaign.objects.create(name="Off", public_code="off", source="hoodie", medium="qr", campaign_name="hoodie", is_active=False)
        self.assertEqual(self.client.get("/go/off").status_code, 404)
        self.assertEqual(self.client.get("/go/missing").status_code, 404)
        MarketingCampaign.objects.create(name="Unsafe", public_code="unsafe", source="realtor", medium="qr", campaign_name="realtor", destination="https://evil.example/phish")
        self.assertRedirects(self.client.get("/go/unsafe"), "/", fetch_redirect_response=False)

    def test_seeded_physical_campaign_identities_exist(self):
        expected = {"card", "car", "hoodie", "realtor", "contractor"}
        self.assertTrue(expected.issubset(set(MarketingCampaign.objects.values_list("public_code", flat=True))))

    def test_anonymous_visit_associates_to_account_and_role(self):
        request = request_with_session("/register", query="?utm_source=bing&utm_medium=organic")
        visit = capture_visit(request)
        user = self.make_user("new-account@example.com")
        acquisition = associate_account(request, user, role="property_manager")
        visit.refresh_from_db()
        self.assertEqual(acquisition.first_touch["source"], "bing")
        self.assertEqual(acquisition.roles, ["property_manager"])
        self.assertEqual(visit.registered_user, user)
        self.assertEqual(AttributionEvent.objects.filter(event_type="account_created", user=user).count(), 1)
        associate_account(request, user, role="contractor")
        acquisition.refresh_from_db()
        self.assertEqual(acquisition.first_touch["source"], "bing")
        self.assertEqual(set(acquisition.roles), {"property_manager", "contractor"})

    def test_referral_ownership_coexists_with_marketing_touch(self):
        referrer = self.make_user("referrer-attribution@example.com")
        participant = participant_for_user(referrer, role="homeowner")
        request = request_with_session("/register", query="?utm_source=google&utm_medium=organic")
        capture_visit(request)
        referred = self.make_user("referred-attribution@example.com")
        homeowner = Homeowner.objects.create(full_name="Referred", email=referred.email)
        referral = attribute_customer_registration(user=referred, homeowner=homeowner, referral_code=participant.code)
        acquisition = associate_account(request, referred, role="homeowner")
        self.assertEqual(acquisition.first_touch["source"], "google")
        self.assertEqual(acquisition.referral, referral)

    def test_event_idempotency(self):
        first = record_event("project_funded", object_type="agreement", object_id="42", idempotency_key="project_funded:42")
        second = record_event("project_funded", object_type="agreement", object_id="42", idempotency_key="project_funded:42")
        self.assertEqual(first.pk, second.pk)
        self.assertEqual(AttributionEvent.objects.filter(event_type="project_funded").count(), 1)

    def test_project_snapshot_preserves_separate_customer_and_contractor_sources(self):
        project, customer_user, contractor_user = self.make_project()
        AccountAcquisition.objects.create(user=customer_user, roles=["homeowner"], first_touch={"source": "google", "medium": "organic"}, last_touch={"source": "facebook", "medium": "paid-social"})
        AccountAcquisition.objects.create(user=contractor_user, roles=["contractor"], first_touch={"source": "referral", "medium": "link"}, last_touch={"source": "referral", "medium": "link"})
        snapshot = snapshot_project(project, creator=customer_user)
        self.assertEqual(snapshot.customer_attribution["first_touch"]["source"], "google")
        self.assertEqual(snapshot.contractor_attribution["first_touch"]["source"], "referral")
        customer_user.acquisition.first_touch = {"source": "changed"}
        customer_user.acquisition.save()
        snapshot.refresh_from_db()
        self.assertEqual(snapshot.customer_attribution["first_touch"]["source"], "google")

    def test_receipt_snapshot_uses_authoritative_fee_and_is_idempotent(self):
        project, _customer_user, contractor_user = self.make_project()
        agreement = Agreement.objects.create(project=project, contractor=project.contractor, homeowner=project.homeowner)
        invoice = Invoice.objects.create(agreement=agreement, amount="100.00")
        receipt = Receipt.objects.create(invoice=invoice, agreement=agreement, receipt_number="ATTR-1", stripe_payment_intent_id="pi_attr_1", amount_paid_cents=10000, platform_fee_cents=650)
        referrer = self.make_user("revenue-referrer@example.com")
        participant = participant_for_user(referrer, role="homeowner")
        referral = ContractorReferral.objects.create(
            referrer=referrer, participant=participant, referred_user=contractor_user,
            referred_contractor=project.contractor, referred_role="contractor", referrer_role="homeowner",
            attributed_code=participant.code, reward_rate_bps=2500, earning_months=3,
            activation_deadline=timezone.now() + timezone.timedelta(days=180),
        )
        earning = ReferralEarning.objects.create(
            referral=referral, receipt=receipt, allocation_side="contractor",
            qualifying_platform_fee_cents=650, maximum_reward_pool_cents=325,
            reward_rate_bps=2500, reward_cents=162,
            available_at=timezone.now() + timezone.timedelta(days=30),
        )
        snapshot = snapshot_revenue(receipt)
        repeated = snapshot_revenue(receipt)
        self.assertEqual(snapshot.pk, repeated.pk)
        self.assertEqual(snapshot.eligible_platform_fee_cents, 650)
        self.assertEqual(snapshot.contractor_reward_cents, 162)
        self.assertEqual(snapshot.retained_platform_fee_cents, 488)
        self.assertEqual(AttributionEvent.objects.filter(event_type="platform_fee_generated", object_id=str(receipt.pk)).count(), 1)
        self.assertEqual(AttributionEvent.objects.filter(event_type="referral_reward_generated", object_id=str(earning.pk)).count(), 1)
        self.assertEqual(AttributionEvent.objects.filter(event_type="project_funded", project=project).count(), 1)

    def test_bot_and_declared_test_traffic_are_excluded(self):
        bot = request_with_session(user_agent="Googlebot/2.1")
        visit = capture_visit(bot)
        self.assertTrue(visit.excluded_from_reporting)
        self.assertEqual(visit.exclusion_reason, "obvious_bot")

    def test_public_tracking_rejects_arbitrary_event_names(self):
        response = self.client.post("/api/projects/attribution/track/", {"event_type": "keystroke_logged"}, content_type="application/json")
        self.assertEqual(response.status_code, 400)

    def test_campaign_partner_fields_support_public_safe_partner_codes(self):
        campaign = MarketingCampaign.objects.create(name="Realtor A", public_code="realtor-a7k", source="realtor", medium="referral", campaign_name="realtor-pilot", partner_type="realtor", partner_code="partner-a7k")
        self.assertEqual(campaign.partner_type, "realtor")
        self.assertNotIn("@", campaign.public_code)
