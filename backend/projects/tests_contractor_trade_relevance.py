from unittest.mock import patch

from django.contrib.auth import get_user_model
from django.test import TestCase

from projects.models import Contractor, ContractorPublicProfile, Skill
from projects.models_contractor_discovery import ContractorDirectoryListing
from projects.services.contractor_discovery import build_contractor_recommendations
from projects.services.contractor_trade_relevance import project_trade_intent
from projects.services.project_intelligence import infer_project_intelligence


class ContractorTradeRelevanceTests(TestCase):
    def test_project_guidance_prefers_lvp_classification_over_stale_outdoor_context(self):
        result = infer_project_intelligence(
            project_title="DIY Assistance — Water-Resistant LVP Flooring",
            project_type="Flooring",
            project_subtype="LVP / Vinyl Plank",
            description="Install flooring underlayment, transitions, and water-resistant luxury vinyl plank.",
        )

        self.assertEqual(result["key"], "flooring")
        self.assertIn("flooring details", result["response_starter"])
        self.assertNotIn("structure", " ".join(result["prep_items"]).lower())

    def test_flooring_classification_owns_ambiguous_underlayment_language(self):
        intent = project_trade_intent(
            "Flooring",
            "LVP / Vinyl Plank",
            "Install bathroom-approved flooring with underlayment and transitions.",
        )

        self.assertIsNotNone(intent)
        self.assertEqual(intent.key, "flooring")
        self.assertEqual(intent.query, "flooring installation contractor")

    def test_bare_underlayment_does_not_create_roofing_intent(self):
        self.assertIsNone(project_trade_intent("", "", "Confirm the approved underlayment method."))

    def test_roof_underlayment_remains_roofing(self):
        intent = project_trade_intent(
            "Roofing",
            "Replacement",
            "Install roof underlayment, flashing, and shingles.",
        )

        self.assertIsNotNone(intent)
        self.assertEqual(intent.key, "roofing")

    @patch(
        "projects.services.contractor_discovery.search_google_places_contractors_with_diagnostics",
        return_value={"diagnostic": {"configured": True, "requested": True, "results_count": 0}, "results": []},
    )
    def test_flooring_search_excludes_known_roofers_and_keeps_flooring_contractors(self, _mock_places):
        flooring_skill, _ = Skill.objects.get_or_create(name="Flooring", defaults={"slug": "flooring-trade-test"})
        roofing_skill, _ = Skill.objects.get_or_create(name="Roofing", defaults={"slug": "roofing-trade-test"})

        floor_user = get_user_model().objects.create_user(email="floor@example.com", password="testpass123")
        floor_contractor = Contractor.objects.create(
            user=floor_user,
            business_name="QA Flooring Pro",
            city="San Antonio",
            state="TX",
            marketplace_verification_status=Contractor.MARKETPLACE_VERIFIED,
        )
        floor_contractor.skills.add(flooring_skill)
        ContractorPublicProfile.objects.create(
            contractor=floor_contractor,
            business_name_public="QA Flooring Pro",
            tagline="LVP and flooring installation",
            city="San Antonio",
            state="TX",
            is_public=True,
            specialties=["Flooring", "Luxury Vinyl Plank"],
        )

        roof_user = get_user_model().objects.create_user(email="roof@example.com", password="testpass123")
        roof_contractor = Contractor.objects.create(
            user=roof_user,
            business_name="QA Roofing Pro",
            city="San Antonio",
            state="TX",
            marketplace_verification_status=Contractor.MARKETPLACE_VERIFIED,
        )
        roof_contractor.skills.add(roofing_skill)
        ContractorPublicProfile.objects.create(
            contractor=roof_contractor,
            business_name_public="QA Roofing Pro",
            tagline="Roofing, shingles, flashing, and roof underlayment",
            city="San Antonio",
            state="TX",
            is_public=True,
            specialties=["Roofing"],
        )
        ContractorDirectoryListing.objects.create(
            business_name="Cached Roofing Company",
            source=ContractorDirectoryListing.SOURCE_CACHED_DIRECTORY,
            city="San Antonio",
            state="TX",
            latitude=29.4241,
            longitude=-98.4936,
            primary_trade="roofing_contractor",
            trade_categories=["roofing", "shingles"],
        )

        payload = build_contractor_recommendations(
            payload={
                "project_title": "Water-Resistant LVP Flooring",
                "project_type": "Flooring",
                "project_subtype": "LVP / Vinyl Plank",
                "description": "Install LVP with the approved underlayment and transitions.",
                "project_city": "San Antonio",
                "project_state": "TX",
                "project_postal_code": "78201",
            },
            query="flooring installation contractor",
            latitude=29.4241,
            longitude=-98.4936,
            limit=10,
        )

        names = [row["business_name"] for row in payload["results"]]
        self.assertIn("QA Flooring Pro", names)
        self.assertNotIn("QA Roofing Pro", names)
        self.assertNotIn("Cached Roofing Company", names)
        self.assertEqual(payload["summary"]["search_query"], "flooring installation contractor")
