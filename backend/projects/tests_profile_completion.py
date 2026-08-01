from django.contrib.auth import get_user_model
from django.test import TestCase

from projects.models import Contractor, Skill
from projects.services.profile_completion import build_profile_completion


class ContractorProfileCompletionTests(TestCase):
    def setUp(self):
        self.user = get_user_model().objects.create_user(
            email="profile-completion@example.test",
            password="testpass123",
            first_name="Solo",
            last_name="Contractor",
        )
        self.contractor = Contractor.objects.create(
            user=self.user,
            business_name="Solo Builds",
            phone="555-0100",
            address="1 Main Street",
            city="Austin",
            state="TX",
            zip="78701",
            service_radius_miles=25,
        )
        skill, _ = Skill.objects.get_or_create(name="Carpentry", defaults={"slug": "carpentry-profile-test"})
        self.contractor.skills.add(skill)

    def test_complete_solo_profile_does_not_require_activity_team_stripe_logo_or_license(self):
        result = build_profile_completion(self.contractor, self.user)
        self.assertEqual(result["score"], 100)
        self.assertEqual(result["required_count"], 7)
        states = {item["key"]: item["state"] for item in result["items"]}
        self.assertEqual(states["license"], "optional")
        self.assertEqual(states["logo"], "recommended")
        self.assertNotIn("team_members", states)
        self.assertNotIn("stripe_connect", states)
        self.assertNotIn("first_job_or_template", states)

    def test_required_contact_trade_and_service_fields_change_score(self):
        self.contractor.phone = ""
        self.contractor.service_radius_miles = 0
        self.contractor.save(update_fields=["phone", "service_radius_miles"])
        self.contractor.skills.clear()
        result = build_profile_completion(self.contractor, self.user)
        self.assertEqual(result["score"], 57)
        missing = {item["key"] for item in result["items"] if item["state"] == "incomplete"}
        self.assertTrue({"phone", "service_area", "trade_profile"}.issubset(missing))

    def test_license_is_required_only_when_compliance_contract_requires_it(self):
        result = build_profile_completion(
            self.contractor,
            self.user,
            trade_requirements=[{"requires_license": True}],
        )
        self.assertEqual(result["score"], 88)
        license_item = next(item for item in result["items"] if item["key"] == "license")
        self.assertTrue(license_item["required"])
        self.assertEqual(license_item["state"], "incomplete")
