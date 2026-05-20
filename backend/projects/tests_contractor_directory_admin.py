from django.contrib.auth import get_user_model
from django.test import TestCase
from unittest.mock import patch
from rest_framework.test import APIClient

from projects.models_contractor_discovery import ContractorDirectoryEntry
from projects.services.contractor_directory import normalize_business_name, normalize_phone, normalize_website_domain


class AdminContractorDirectoryEnrichmentTests(TestCase):
    def setUp(self):
        self.user = get_user_model().objects.create_user(
            email="directory-admin@example.com",
            password="test-pass",
            is_staff=True,
            is_superuser=True,
        )
        self.client = APIClient()
        self.client.force_authenticate(self.user)
        self.entry = ContractorDirectoryEntry.objects.create(
            business_name="Austin Concrete Co",
            normalized_name=normalize_business_name("Austin Concrete Co"),
            website="https://www.austinconcrete.example/contact",
            website_domain=normalize_website_domain("https://www.austinconcrete.example/contact"),
            phone="(512) 555-0101",
            normalized_phone=normalize_phone("(512) 555-0101"),
            city="Austin",
            state="TX",
            zip_code="78701",
            services=["concrete contractor"],
            primary_service="Concrete",
            normalized_services=["Concrete"],
            raw_services=["concrete contractor"],
        )

    def test_patch_updates_public_email_and_services_with_enrichment_metadata(self):
        response = self.client.patch(
            f"/api/projects/admin/contractor-directory/{self.entry.id}/",
            {
                "public_email": "hello@austinconcrete.example",
                "address_line1": "12703 Spectrum Dr #103",
                "city": "San Antonio",
                "state": "TX",
                "zip_code": "78249-4013",
                "services": "concrete contractor, patio contractor",
                "primary_service": "Patio",
                "normalized_services": "Concrete, Patio",
                "raw_services": "concrete contractor, patio contractor",
                "email_source_url": "https://www.austinconcrete.example/contact",
                "services_source_url": "https://www.austinconcrete.example/services",
                "enrichment_notes": "Reviewed public website.",
            },
            format="json",
        )

        self.assertEqual(response.status_code, 200)
        self.entry.refresh_from_db()
        self.assertEqual(self.entry.public_email, "hello@austinconcrete.example")
        self.assertEqual(self.entry.address_line1, "12703 Spectrum Dr #103")
        self.assertEqual(self.entry.city, "San Antonio")
        self.assertEqual(self.entry.state, "TX")
        self.assertEqual(self.entry.zip_code, "78249")
        self.assertEqual(self.entry.services, ["concrete contractor", "patio contractor"])
        self.assertEqual(self.entry.primary_service, "Patio")
        self.assertEqual(self.entry.normalized_services, ["Concrete", "Patio"])
        self.assertEqual(self.entry.raw_services, ["concrete contractor", "patio contractor"])
        self.assertEqual(self.entry.service_normalization_status, ContractorDirectoryEntry.SERVICE_NORMALIZATION_MANUAL)
        self.assertEqual(self.entry.enrichment_status, ContractorDirectoryEntry.ENRICHMENT_REVIEWED)
        self.assertIsNotNone(self.entry.enriched_at)
        self.assertEqual(self.entry.enriched_by, self.user)

    def test_patch_rejects_invalid_email_and_placeholder_email(self):
        invalid = self.client.patch(
            f"/api/projects/admin/contractor-directory/{self.entry.id}/",
            {"public_email": "not-an-email"},
            format="json",
        )
        self.assertEqual(invalid.status_code, 400)
        self.assertIn("public_email", invalid.data["errors"])

        placeholder = self.client.patch(
            f"/api/projects/admin/contractor-directory/{self.entry.id}/",
            {"public_email": "Email not listed"},
            format="json",
        )
        self.assertEqual(placeholder.status_code, 400)
        self.entry.refresh_from_db()
        self.assertIsNone(self.entry.public_email)

    def test_directory_list_filters_by_email_and_claim_state(self):
        self.entry.public_email = "hello@austinconcrete.example"
        self.entry.claimed = True
        self.entry.save(update_fields=["public_email", "claimed"])
        ContractorDirectoryEntry.objects.create(
            business_name="Unclaimed Missing Email Co",
            normalized_name=normalize_business_name("Unclaimed Missing Email Co"),
            city="Austin",
            state="TX",
            primary_service="Concrete",
            claimed=False,
        )

        with_email = self.client.get("/api/projects/admin/contractor-directory/", {"has_email": "true"})
        self.assertEqual(with_email.status_code, 200)
        self.assertEqual([row["business_name"] for row in with_email.data["results"]], ["Austin Concrete Co"])

        unclaimed = self.client.get("/api/projects/admin/contractor-directory/", {"claimed": "false"})
        self.assertEqual(unclaimed.status_code, 200)
        self.assertEqual([row["business_name"] for row in unclaimed.data["results"]], ["Unclaimed Missing Email Co"])

    def test_csv_import_preview_matches_by_id_and_flags_invalid_email(self):
        csv_text = (
            "id,business_name,website,public_email,phone,services,email_source_url,services_source_url,enrichment_notes\n"
            f"{self.entry.id},Austin Concrete Co,https://www.austinconcrete.example,hello@austinconcrete.example,512-555-0101,\"concrete, patio\",https://www.austinconcrete.example/contact,,Reviewed\n"
            ",Bad Email Co,https://missing.example,not-an-email,512-555-9999,roofing,,,\n"
        )
        response = self.client.post(
            "/api/projects/admin/contractor-directory/import-preview/",
            {"csv_text": csv_text},
            format="json",
        )

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.data["results"][0]["matched_entry_id"], self.entry.id)
        self.assertEqual(response.data["results"][0]["status"], "ready")
        self.assertEqual(response.data["results"][1]["status"], "no_match")

        existing = ContractorDirectoryEntry.objects.create(
            business_name="Bad Email Co",
            normalized_name=normalize_business_name("Bad Email Co"),
            website="https://missing.example",
            website_domain=normalize_website_domain("https://missing.example"),
            city="Austin",
            state="TX",
        )
        response = self.client.post(
            "/api/projects/admin/contractor-directory/import-preview/",
            {"csv_text": csv_text},
            format="json",
        )
        invalid_row = next(row for row in response.data["results"] if row["matched_entry_id"] == existing.id)
        self.assertEqual(invalid_row["status"], "invalid_email")

    def test_csv_import_apply_updates_ready_rows_and_sets_enrichment_metadata(self):
        response = self.client.post(
            "/api/projects/admin/contractor-directory/import-apply/",
            {
                "rows": [
                    {
                        "matched_entry_id": self.entry.id,
                        "status": "ready",
                        "proposed_public_email": "hello@austinconcrete.example",
                        "proposed_phone": "512-555-2222",
                        "proposed_location": {
                            "address_line1": "12703 Spectrum Dr #103",
                            "city": "San Antonio",
                            "state": "Texas",
                            "zip_code": "78249-4013",
                        },
                        "proposed_services": ["concrete contractor", "patio contractor"],
                        "email_source_url": "https://www.austinconcrete.example/contact",
                        "services_source_url": "https://www.austinconcrete.example/services",
                        "enrichment_notes": "Reviewed website.",
                    }
                ]
            },
            format="json",
        )

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.data["updated_count"], 1)
        self.entry.refresh_from_db()
        self.assertEqual(self.entry.public_email, "hello@austinconcrete.example")
        self.assertEqual(self.entry.phone, "512-555-2222")
        self.assertEqual(self.entry.address_line1, "12703 Spectrum Dr #103")
        self.assertEqual(self.entry.city, "San Antonio")
        self.assertEqual(self.entry.state, "TX")
        self.assertEqual(self.entry.zip_code, "78249")
        self.assertEqual(self.entry.services, ["concrete contractor", "patio contractor"])
        self.assertEqual(self.entry.enriched_by, self.user)

    def test_csv_import_preview_and_apply_support_address_fields_without_blank_overwrite(self):
        self.entry.address_line1 = "Existing Manual Address"
        self.entry.city = "Austin"
        self.entry.state = "TX"
        self.entry.zip_code = "78701"
        self.entry.save(update_fields=["address_line1", "city", "state", "zip_code"])

        csv_text = (
            "id,business_name,website,public_email,phone,address_line1,city,state,zip_code,services,email_source_url,services_source_url,enrichment_notes\n"
            f"{self.entry.id},Austin Concrete Co,https://www.austinconcrete.example,,512-555-0101,12703 Spectrum Dr #103,San Antonio,TX,78249,\"concrete\",,,\n"
        )
        preview = self.client.post(
            "/api/projects/admin/contractor-directory/import-preview/",
            {"csv_text": csv_text},
            format="json",
        )
        self.assertEqual(preview.status_code, 200)
        row = preview.data["results"][0]
        self.assertEqual(row["status"], "ready")
        self.assertEqual(row["proposed_location"]["address_line1"], "12703 Spectrum Dr #103")
        self.assertEqual(row["proposed_location"]["zip_code"], "78249")

        apply = self.client.post(
            "/api/projects/admin/contractor-directory/import-apply/",
            {"rows": [row]},
            format="json",
        )
        self.assertEqual(apply.status_code, 200)
        self.entry.refresh_from_db()
        self.assertEqual(self.entry.address_line1, "12703 Spectrum Dr #103")
        self.assertEqual(self.entry.city, "San Antonio")
        self.assertEqual(self.entry.state, "TX")
        self.assertEqual(self.entry.zip_code, "78249")

        blank_row = {
            "matched_entry_id": self.entry.id,
            "status": "ready",
            "proposed_location": {"address_line1": "", "city": "", "state": "", "zip_code": ""},
            "proposed_services": ["concrete"],
        }
        self.client.post(
            "/api/projects/admin/contractor-directory/import-apply/",
            {"rows": [blank_row]},
            format="json",
        )
        self.entry.refresh_from_db()
        self.assertEqual(self.entry.address_line1, "12703 Spectrum Dr #103")
        self.assertEqual(self.entry.city, "San Antonio")

    def test_csv_import_apply_does_not_overwrite_existing_email_without_approval(self):
        self.entry.public_email = "existing@austinconcrete.example"
        self.entry.save(update_fields=["public_email"])

        blocked = self.client.post(
            "/api/projects/admin/contractor-directory/import-apply/",
            {
                "rows": [
                    {
                        "matched_entry_id": self.entry.id,
                        "status": "ready",
                        "proposed_public_email": "new@austinconcrete.example",
                    }
                ]
            },
            format="json",
        )
        self.assertEqual(blocked.status_code, 200)
        self.assertEqual(blocked.data["updated_count"], 0)
        self.entry.refresh_from_db()
        self.assertEqual(self.entry.public_email, "existing@austinconcrete.example")

        approved = self.client.post(
            "/api/projects/admin/contractor-directory/import-apply/",
            {
                "rows": [
                    {
                        "matched_entry_id": self.entry.id,
                        "status": "ready",
                        "admin_approved": True,
                        "proposed_public_email": "new@austinconcrete.example",
                    }
                ]
            },
            format="json",
        )
        self.assertEqual(approved.status_code, 200)
        self.assertEqual(approved.data["updated_count"], 1)
        self.entry.refresh_from_db()
        self.assertEqual(self.entry.public_email, "new@austinconcrete.example")

    def test_service_taxonomy_normalizes_google_terms_and_preserves_manual_values(self):
        from projects.services.contractor_directory import upsert_directory_entry_from_place

        flooring = upsert_directory_entry_from_place(
            {
                "business_name": "River City Flooring",
                "google_place_id": "places/river-city-flooring",
                "types": ["point_of_interest", "establishment"],
                "primaryType": "point_of_interest",
            },
            context={"search_term": "flooring contractor"},
        )
        self.assertEqual(flooring.primary_service, "Flooring")
        self.assertEqual(flooring.normalized_services, ["Flooring"])
        self.assertIn("point of interest", flooring.raw_services)
        self.assertEqual(flooring.service_normalization_status, ContractorDirectoryEntry.SERVICE_NORMALIZATION_AUTO)

        concrete = upsert_directory_entry_from_place(
            {
                "business_name": "River City Cement",
                "types": ["building_materials_store", "establishment"],
            },
            context={"search_term": "concrete contractor"},
        )
        self.assertEqual(concrete.primary_service, "Concrete")
        self.assertEqual(concrete.normalized_services, ["Concrete"])

        addition = upsert_directory_entry_from_place(
            {"business_name": "Bedroom Addition Builders", "types": ["point_of_interest"]},
            context={"search_term": "home addition contractor", "project_subtype": "Bedroom Addition"},
        )
        self.assertEqual(addition.primary_service, "Home Addition")
        self.assertIn("General Contracting", addition.normalized_services)

        flooring.primary_service = "Custom Manual"
        flooring.normalized_services = ["Custom Manual"]
        flooring.service_normalization_status = ContractorDirectoryEntry.SERVICE_NORMALIZATION_MANUAL
        flooring.save(update_fields=["primary_service", "normalized_services", "service_normalization_status"])
        updated = upsert_directory_entry_from_place(
            {
                "business_name": "River City Flooring",
                "google_place_id": "places/river-city-flooring",
                "types": ["point_of_interest", "establishment"],
            }
        )
        self.assertEqual(updated.primary_service, "Custom Manual")
        self.assertEqual(updated.normalized_services, ["Custom Manual"])

    @patch("projects.views.contractor_discovery.geocode_project_location")
    @patch("projects.views.contractor_discovery.search_google_places_contractors_with_diagnostics")
    def test_admin_search_preview_does_not_create_directory_entries(self, mock_search, mock_geocode):
        mock_geocode.return_value = {"latitude": 30.2672, "longitude": -97.7431}
        mock_search.return_value = {
            "results": [
                {
                    "id": "places/exact",
                    "business_name": "Austin Concrete Co",
                    "formatted_address": "100 Builder Way, Austin, TX 78701, USA",
                },
                {
                    "id": "places/unrelated",
                    "business_name": "Capitol City Florist",
                    "formatted_address": "200 Flower St, Austin, TX 78701, USA",
                },
            ],
            "diagnostic": {"http_status": 200},
        }
        before_count = ContractorDirectoryEntry.objects.count()

        response = self.client.post(
            "/api/projects/admin/contractor-search/",
            {"query": "Austin Concrete Co", "city": "Austin", "state": "TX", "zip": "78701"},
            format="json",
        )

        self.assertEqual(response.status_code, 200)
        self.assertEqual(ContractorDirectoryEntry.objects.count(), before_count)
        labels = {row["business_name"]: row["relevance_label"] for row in response.data["results"]}
        self.assertEqual(labels["Austin Concrete Co"], "Strong Match")
        self.assertEqual(labels["Capitol City Florist"], "Weak Match")
        self.assertTrue(response.data["summary"]["capture_required"])

    @patch("projects.views.contractor_discovery.geocode_project_location")
    @patch("projects.views.contractor_discovery.search_google_places_contractors_with_diagnostics")
    def test_admin_search_preview_retries_broad_trade_query_without_capture(self, mock_search, mock_geocode):
        mock_geocode.return_value = {"latitude": 40.2732, "longitude": -76.8867}
        mock_search.side_effect = [
            {"results": [], "diagnostic": {"query": "roofing", "results_count": 0}},
            {
                "results": [
                    {
                        "id": "places/harrisburg-roofing",
                        "business_name": "Harrisburg Roofing Pros",
                        "types": ["roofing_contractor"],
                        "formatted_address": "10 Roof Way, Harrisburg, PA 17101, USA",
                    }
                ],
                "diagnostic": {"query": "roofing contractor", "results_count": 1},
            },
        ]
        before_count = ContractorDirectoryEntry.objects.count()

        response = self.client.post(
            "/api/projects/admin/contractor-search/",
            {"query": "roofing", "city": "Harrisburg", "state": "PA", "radius_miles": 50},
            format="json",
        )

        self.assertEqual(response.status_code, 200)
        self.assertEqual(ContractorDirectoryEntry.objects.count(), before_count)
        self.assertEqual(len(response.data["results"]), 1)
        self.assertEqual(response.data["results"][0]["business_name"], "Harrisburg Roofing Pros")
        self.assertEqual(response.data["summary"]["external_search"]["fallback_from_query"], "roofing")
        self.assertEqual(response.data["summary"]["external_search"]["fallback_query"], "roofing contractor")
        self.assertEqual(mock_search.call_count, 2)

    def test_admin_search_capture_selected_creates_only_selected_entries(self):
        response = self.client.post(
            "/api/projects/admin/contractor-search/capture/",
            {
                "query": "Austin Concrete Co",
                "city": "Austin",
                "state": "TX",
                "zip": "78701",
                "selected_results": [
                    {
                        "id": "places/selected",
                        "business_name": "Selected Concrete Co",
                        "website_url": "https://selected-concrete.example",
                        "formatted_address": "100 Builder Way, Austin, TX 78701, USA",
                    }
                ],
            },
            format="json",
        )

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.data["summary"]["captured_count"], 1)
        self.assertTrue(ContractorDirectoryEntry.objects.filter(business_name="Selected Concrete Co").exists())
        self.assertFalse(ContractorDirectoryEntry.objects.filter(business_name="Capitol City Florist").exists())

    def test_archive_hides_entry_by_default_and_restore_returns_it(self):
        archive = self.client.post(f"/api/projects/admin/contractor-directory/{self.entry.id}/archive/", {}, format="json")
        self.assertEqual(archive.status_code, 200)
        self.entry.refresh_from_db()
        self.assertTrue(self.entry.is_archived)
        self.assertIsNotNone(self.entry.archived_at)

        default_list = self.client.get("/api/projects/admin/contractor-directory/")
        self.assertEqual(default_list.status_code, 200)
        self.assertNotIn(self.entry.id, [row["id"] for row in default_list.data["results"]])

        archived_list = self.client.get("/api/projects/admin/contractor-directory/", {"archived": "archived"})
        self.assertEqual(archived_list.status_code, 200)
        self.assertIn(self.entry.id, [row["id"] for row in archived_list.data["results"]])

        restore = self.client.post(f"/api/projects/admin/contractor-directory/{self.entry.id}/restore/", {}, format="json")
        self.assertEqual(restore.status_code, 200)
        self.entry.refresh_from_db()
        self.assertFalse(self.entry.is_archived)
        self.assertIsNone(self.entry.archived_at)

        restored_list = self.client.get("/api/projects/admin/contractor-directory/")
        self.assertIn(self.entry.id, [row["id"] for row in restored_list.data["results"]])

    def test_archive_claimed_entry_preserves_claim_link_and_contractor_state(self):
        self.entry.claimed = True
        self.entry.save(update_fields=["claimed"])

        response = self.client.post(f"/api/projects/admin/contractor-directory/{self.entry.id}/archive/", {}, format="json")

        self.assertEqual(response.status_code, 200)
        self.entry.refresh_from_db()
        self.assertTrue(self.entry.is_archived)
        self.assertTrue(self.entry.claimed)
        self.assertTrue(ContractorDirectoryEntry.objects.filter(pk=self.entry.pk).exists())
