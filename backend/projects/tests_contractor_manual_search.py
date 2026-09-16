from unittest.mock import patch
from types import SimpleNamespace

from django.test import TestCase

from projects.models_contractor_discovery import ContractorDirectoryListing
from projects.services.contractor_discovery import build_contractor_recommendations
from projects.services.contractor_opportunities import resolve_directory_entry_from_selection
from projects.services.contractor_marketplace_join_invites import _email_body, _sms_body


class ContractorManualBusinessSearchTests(TestCase):
    def setUp(self):
        self.listing = ContractorDirectoryListing.objects.create(
            source=ContractorDirectoryListing.SOURCE_CACHED_DIRECTORY,
            business_name="Xxthetic Floors LLC",
            city="San Antonio",
            state="TX",
            latitude=29.4241,
            longitude=-98.4936,
            primary_trade="flooring_contractor",
            trade_categories=["flooring_contractor"],
        )

    @patch("projects.services.contractor_discovery._iter_contractors_for_public_profiles", return_value=[])
    @patch(
        "projects.services.contractor_discovery.search_google_places_contractors_with_diagnostics",
        return_value={
            "results": [],
            "diagnostic": {
                "configured": True,
                "requested": True,
                "results_count": 0,
                "google_raw_count": 0,
            },
        },
    )
    def test_manual_business_name_is_not_rewritten_to_project_trade(self, places_search, _profiles):
        payload = build_contractor_recommendations(
            payload={
                "project_title": "Toy Room Vinyl Plank Flooring Replacement",
                "project_type": "Flooring",
                "project_subtype": "LVP / Vinyl Plank",
                "project_state": "TX",
            },
            query="Xxthetic Floors LLC",
            latitude=29.4241,
            longitude=-98.4936,
            radius_miles=25,
            manual_search=True,
        )

        self.assertEqual(payload["summary"]["search_query"], "Xxthetic Floors LLC")
        self.assertEqual([row["business_name"] for row in payload["results"]], ["Xxthetic Floors LLC"])
        self.assertEqual(places_search.call_args.kwargs["query"], "Xxthetic Floors LLC")
        self.assertEqual(places_search.call_count, 1)

    @patch("projects.services.contractor_discovery._iter_contractors_for_public_profiles", return_value=[])
    @patch(
        "projects.services.contractor_discovery.search_google_places_contractors_with_diagnostics",
        return_value={"results": [], "diagnostic": {"configured": True, "requested": True}},
    )
    def test_project_match_still_uses_trade_query(self, places_search, _profiles):
        payload = build_contractor_recommendations(
            payload={
                "project_title": "Toy Room Vinyl Plank Flooring Replacement",
                "project_type": "Flooring",
                "project_subtype": "LVP / Vinyl Plank",
                "project_state": "TX",
            },
            query="Xxthetic Floors LLC",
            latitude=29.4241,
            longitude=-98.4936,
            manual_search=False,
        )

        self.assertIn("flooring", payload["summary"]["search_query"].lower())
        self.assertNotEqual(places_search.call_args.kwargs["query"], "Xxthetic Floors LLC")

    def test_manual_directory_prospect_is_preserved_without_google_presence(self):
        entry = resolve_directory_entry_from_selection({
            "id": "manual:xxthetic-floors",
            "source": "manual",
            "business_name": "Xxthetic Floors LLC",
            "phone": "210-636-7707",
            "city": "San Antonio",
            "state": "TX",
            "primary_trade": "Flooring",
        })

        self.assertEqual(entry.business_name, "Xxthetic Floors LLC")
        self.assertEqual(entry.phone, "210-636-7707")
        self.assertEqual(entry.source, "manual")
        self.assertFalse(entry.claimed)
        self.assertFalse(entry.google_place_id)

    def test_manual_directory_prospect_requires_contact_method(self):
        with self.assertRaisesRegex(ValueError, "phone number or email"):
            resolve_directory_entry_from_selection({
                "source": "manual",
                "business_name": "Xxthetic Floors LLC",
            })

    def test_project_opportunity_invite_promotes_claim_and_myhomebro_workflow(self):
        invite = SimpleNamespace(invited_business_name="Xxthetic Floors LLC")
        subject, text, html = _email_body(
            invite=invite,
            claim_url="https://myhomebro.com/claim/example",
            project_title="Toy Room Flooring Replacement",
        )
        sms = _sms_body(
            invite=invite,
            claim_url="https://myhomebro.com/claim/example",
            project_title="Toy Room Flooring Replacement",
        )

        self.assertIn("homeowner selected", subject.lower())
        self.assertIn("Toy Room Flooring Replacement", text)
        self.assertIn("Claim your profile", text)
        self.assertIn("business website", text)
        self.assertIn("Toy Room Flooring Replacement", html)
        self.assertIn("Toy Room Flooring Replacement", sms)
