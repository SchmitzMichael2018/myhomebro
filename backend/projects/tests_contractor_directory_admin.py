from django.contrib.auth import get_user_model
from django.test import TestCase
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
            services=["concrete contractor"],
        )

    def test_patch_updates_public_email_and_services_with_enrichment_metadata(self):
        response = self.client.patch(
            f"/api/projects/admin/contractor-directory/{self.entry.id}/",
            {
                "public_email": "hello@austinconcrete.example",
                "services": "concrete contractor, patio contractor",
                "email_source_url": "https://www.austinconcrete.example/contact",
                "services_source_url": "https://www.austinconcrete.example/services",
                "enrichment_notes": "Reviewed public website.",
            },
            format="json",
        )

        self.assertEqual(response.status_code, 200)
        self.entry.refresh_from_db()
        self.assertEqual(self.entry.public_email, "hello@austinconcrete.example")
        self.assertEqual(self.entry.services, ["concrete contractor", "patio contractor"])
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
        self.assertEqual(self.entry.services, ["concrete contractor", "patio contractor"])
        self.assertEqual(self.entry.enriched_by, self.user)

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
