from django.contrib.auth import get_user_model
from django.test import TestCase
from django.utils import timezone
from datetime import timedelta
from rest_framework.test import APIClient

from projects.models import Agreement, Contractor, Homeowner, Invoice, Milestone
from projects.models_templates import ProjectTemplate, ProjectTemplateMilestone


class AgreementListPaginationTests(TestCase):
    def setUp(self):
        self.user = get_user_model().objects.create_user(
            email="agreement-pagination@example.com",
            password="testpass123",
        )
        self.contractor = Contractor.objects.create(
            user=self.user,
            business_name="Agreement Pagination Contractor",
        )
        self.homeowner = Homeowner.objects.create(
            created_by=self.contractor,
            full_name="Agreement Pagination Customer",
            email="agreement-pagination-customer@example.com",
        )
        self.client = APIClient()
        self.client.force_authenticate(user=self.user)

    def _create_agreement(self, title, **overrides):
        payload = {
            "is_draft": True,
            "wizard_step": 1,
            "homeowner": self.homeowner.id,
            "project_title": title,
            "title": title,
            "description": f"{title} scope.",
            "payment_mode": "escrow",
            "project_class": "residential",
            "project_mode": "full_service",
        }
        payload.update(overrides)
        response = self.client.post("/api/projects/agreements/", payload, format="json")
        self.assertEqual(response.status_code, 201, response.data)
        return Agreement.objects.get(pk=response.data["id"])

    def test_agreement_list_returns_page_number_pagination(self):
        for index in range(3):
            self._create_agreement(f"Paginated Agreement {index + 1}")

        response = self.client.get("/api/projects/agreements/?page=1&page_size=2")

        self.assertEqual(response.status_code, 200, response.data)
        self.assertEqual(response.data["count"], 3)
        self.assertEqual(len(response.data["results"]), 2)
        self.assertIsNotNone(response.data["next"])
        self.assertIsNone(response.data["previous"])

    def test_agreement_list_filters_search_and_project_class_with_pagination(self):
        self._create_agreement("Residential Kitchen Remodel", project_class="residential")
        self._create_agreement("Commercial Lobby Buildout", project_class="commercial")

        response = self.client.get(
            "/api/projects/agreements/?page=1&page_size=10&search=lobby&project_class=commercial"
        )

        self.assertEqual(response.status_code, 200, response.data)
        self.assertEqual(response.data["count"], 1)
        self.assertEqual(response.data["results"][0]["project_title"], "Commercial Lobby Buildout")

    def test_needs_attention_signature_filter_applies_before_pagination(self):
        target = self._create_agreement("Unsigned Older Agreement")
        for index in range(5):
            agreement = self._create_agreement(f"Signed Newer Agreement {index + 1}")
            agreement.signed_by_contractor = True
            agreement.signed_by_homeowner = True
            agreement.status = "signed"
            agreement.save(update_fields=["signed_by_contractor", "signed_by_homeowner", "status", "updated_at"])

        response = self.client.get(
            "/api/projects/agreements/?page=1&page_size=2&focus=needs_attention&filter=awaiting_signature"
        )

        self.assertEqual(response.status_code, 200, response.data)
        self.assertEqual(response.data["count"], 1)
        self.assertEqual(response.data["results"][0]["id"], target.id)

    def test_schedule_filter_applies_before_pagination(self):
        target = self._create_agreement("Due Today Agreement")
        target.start = timezone.localdate()
        target.save(update_fields=["start", "updated_at"])
        for index in range(5):
            future = self._create_agreement(f"Future Agreement {index + 1}")
            future.start = timezone.localdate() + timedelta(days=20 + index)
            future.save(update_fields=["start", "updated_at"])

        response = self.client.get(
            "/api/projects/agreements/?page=1&page_size=2&focus=schedule&range=today"
        )

        self.assertEqual(response.status_code, 200, response.data)
        self.assertEqual(response.data["count"], 1)
        self.assertEqual(response.data["results"][0]["id"], target.id)

    def test_bulk_delete_deletes_safe_drafts_and_skips_protected_agreements(self):
        draft = self._create_agreement("Bulk Delete Draft")
        signed = self._create_agreement("Bulk Delete Signed")
        signed.signed_by_contractor = True
        signed.status = "signed"
        signed.save(update_fields=["signed_by_contractor", "status", "updated_at"])
        invoiced = self._create_agreement("Bulk Delete Invoiced")
        Invoice.objects.create(agreement=invoiced, amount="125.00")

        response = self.client.post(
            "/api/projects/agreements/bulk-delete/",
            {"agreement_ids": [draft.id, signed.id, invoiced.id, 999999]},
            format="json",
        )

        self.assertEqual(response.status_code, 200, response.data)
        self.assertEqual(response.data["deleted_count"], 1)
        self.assertEqual(response.data["deleted"][0]["id"], draft.id)
        self.assertEqual(response.data["skipped_count"], 3)
        self.assertFalse(Agreement.objects.filter(pk=draft.id).exists())
        self.assertTrue(Agreement.objects.filter(pk=signed.id).exists())
        self.assertTrue(Agreement.objects.filter(pk=invoiced.id).exists())

        skipped = {item["id"]: item["reason"] for item in response.data["skipped"]}
        self.assertIn("Signed", skipped[signed.id])
        self.assertIn("invoices", skipped[invoiced.id])
        self.assertIn("not found", skipped[999999])

    def test_bulk_delete_requires_at_least_one_agreement(self):
        response = self.client.post(
            "/api/projects/agreements/bulk-delete/",
            {"agreement_ids": []},
            format="json",
        )

        self.assertEqual(response.status_code, 400, response.data)
        self.assertIn("Select at least one", response.data["detail"])

    def test_update_source_template_from_agreement_updates_scope_and_milestones(self):
        template = ProjectTemplate.objects.create(
            contractor=self.contractor,
            name="Original Flooring Template",
            project_type="Flooring",
            project_subtype="Flooring Installation",
            default_scope="Original weak scope.",
        )
        ProjectTemplateMilestone.objects.create(
            template=template,
            title="Old milestone",
            description="Old details",
            sort_order=1,
        )
        agreement = self._create_agreement(
            "Improved Flooring Agreement",
            project_type="Flooring",
            project_subtype="Luxury Vinyl Plank",
            description="Included Work:\n- Remove existing flooring\n- Install LVP in kitchen and hallway",
        )
        agreement.selected_template = template
        agreement.selected_template_name_snapshot = template.name
        agreement.save(update_fields=["selected_template", "selected_template_name_snapshot", "updated_at"])
        Milestone.objects.create(
            agreement=agreement,
            order=1,
            title="Prep and Level Subfloor",
            description="Remove old flooring, inspect substrate, and level minor low spots.",
            amount="750.00",
        )
        Milestone.objects.create(
            agreement=agreement,
            order=2,
            title="Install LVP",
            description="Install luxury vinyl plank through kitchen and hallway with transitions.",
            amount="2250.00",
        )

        response = self.client.post(
            f"/api/projects/agreements/{agreement.id}/update-source-template/",
            {"template_id": template.id},
            format="json",
        )

        self.assertEqual(response.status_code, 200, response.data)
        template.refresh_from_db()
        self.assertIn("Install LVP", template.default_scope)
        self.assertEqual(template.name, "Original Flooring Template")
        milestones = list(template.milestones.order_by("sort_order", "id"))
        self.assertEqual(len(milestones), 2)
        self.assertEqual(milestones[0].title, "Prep and Level Subfloor")
        self.assertEqual(str(milestones[0].suggested_amount_fixed), "750.00")

    def test_update_source_template_blocks_non_admin_system_template_update(self):
        template = ProjectTemplate.objects.create(
            name="System Flooring Template",
            project_type="Flooring",
            project_subtype="Flooring Installation",
            default_scope="System scope.",
            is_system=True,
            is_system_template=True,
            is_published=True,
        )
        agreement = self._create_agreement("System Template Agreement")
        agreement.selected_template = template
        agreement.selected_template_name_snapshot = template.name
        agreement.save(update_fields=["selected_template", "selected_template_name_snapshot", "updated_at"])

        response = self.client.post(
            f"/api/projects/agreements/{agreement.id}/update-source-template/",
            {"template_id": template.id},
            format="json",
        )

        self.assertEqual(response.status_code, 403, response.data)
        self.assertIn("Only admins", response.data["detail"])
