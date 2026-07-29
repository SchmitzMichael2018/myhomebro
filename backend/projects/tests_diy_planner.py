from django.contrib.auth import get_user_model
from django.core.files.uploadedfile import SimpleUploadedFile
from django.test import TestCase, override_settings
from rest_framework.test import APIClient

from projects.models import Contractor, CustomerRequest
from projects.models_contractor_discovery import ContractorDirectoryEntry, ContractorOpportunity
from projects.models_diy_planner import DIYProject, DIYProjectAsset, DIYProjectMeasurement, DIYProjectTask
from projects.models_project_intake import ProjectIntakeClarificationPhoto
from projects.services.contractor_directory import normalize_business_name
from projects.views.customer_portal import _portal_token


@override_settings(OPENAI_API_KEY="")
class DIYProjectPlannerTests(TestCase):
    def setUp(self):
        self.client = APIClient()
        self.client.defaults.update({
            "wsgi.url_scheme": "https", "SERVER_PORT": "443", "HTTPS": "on",
            "HTTP_X_FORWARDED_PROTO": "https",
        })
        self.email = "planner@example.com"
        self.token = _portal_token(self.email)
        self.other_token = _portal_token("other@example.com")
        self.base = f"/api/projects/customer-portal/{self.token}/diy-projects"

    def create_project(self):
        response = self.client.post(
            f"{self.base}/",
            {
                "title": "Laundry room refresh",
                "desired_outcome": "Replace storage and improve the work surface.",
                "existing_conditions": "Existing cabinets are damaged.",
                "work_completed": "Room cleared.",
                "category": "Remodel",
            },
            format="json",
        )
        self.assertEqual(response.status_code, 201, response.data)
        return response.data

    def test_homeowner_creates_private_project_without_contractor(self):
        payload = self.create_project()
        row = DIYProject.objects.get(id=payload["id"])
        self.assertEqual(row.owner_email, self.email)
        self.assertFalse(hasattr(row, "contractor"))

    def test_other_homeowner_and_authenticated_contractor_cannot_retrieve_project(self):
        payload = self.create_project()
        response = self.client.get(f"/api/projects/customer-portal/{self.other_token}/diy-projects/{payload['id']}/")
        self.assertEqual(response.status_code, 404)
        response = self.client.get(f"/api/projects/customer-portal/not-a-token/diy-projects/{payload['id']}/")
        self.assertIn(response.status_code, {403, 404})

    def test_phases_tasks_reorder_and_status_progress_persist(self):
        project = self.create_project()
        phase = self.client.post(f"{self.base}/{project['id']}/phases/", {"title": "Preparation", "sort_order": 2}, format="json")
        self.assertEqual(phase.status_code, 201, phase.data)
        task = self.client.post(
            f"{self.base}/{project['id']}/phases/{phase.data['id']}/tasks/",
            {"title": "Document dimensions", "participation_type": "DO_IT_MYSELF", "sort_order": 3},
            format="json",
        )
        self.assertEqual(task.status_code, 201, task.data)
        self.client.patch(
            f"{self.base}/{project['id']}/phases/{phase.data['id']}/",
            {"sort_order": 0}, format="json",
        )
        response = self.client.patch(
            f"{self.base}/{project['id']}/tasks/{task.data['id']}/",
            {"sort_order": 0, "status": "completed", "progress_note": "Measured and photographed."}, format="json",
        )
        self.assertEqual(response.status_code, 200, response.data)
        row = DIYProjectTask.objects.get(id=task.data["id"])
        self.assertEqual(row.status, DIYProjectTask.Status.COMPLETED)
        self.assertEqual(row.progress_entries.count(), 1)

    def test_measurements_default_to_homeowner_provided(self):
        project = self.create_project()
        response = self.client.post(
            f"{self.base}/{project['id']}/measurements/",
            {"label": "Wall width", "value": "122.5", "unit": "in", "verification_status": "professionally_verified"},
            format="json",
        )
        self.assertEqual(response.status_code, 201, response.data)
        row = DIYProjectMeasurement.objects.get(id=response.data["id"])
        self.assertEqual(row.verification_status, DIYProjectMeasurement.Verification.HOMEOWNER)
        self.assertIsNone(row.verified_at)

    def test_ai_proposal_is_separate_validated_and_apply_is_idempotent(self):
        project = self.create_project()
        proposal = self.client.post(f"{self.base}/{project['id']}/assistant/proposals/", {}, format="json")
        self.assertEqual(proposal.status_code, 201, proposal.data)
        self.assertEqual(DIYProjectTask.objects.count(), 0)
        task_key = proposal.data["phases"][0]["tasks"][0]["client_id"]
        apply_url = f"{self.base}/{project['id']}/assistant/proposals/{proposal.data['proposal_id']}/apply/"
        first = self.client.post(apply_url, {"selected_keys": [task_key]}, format="json")
        self.assertEqual(first.status_code, 200, first.data)
        self.assertEqual(DIYProjectTask.objects.count(), 1)
        second = self.client.post(apply_url, {"selected_keys": [task_key]}, format="json")
        self.assertEqual(second.status_code, 200, second.data)
        self.assertEqual(DIYProjectTask.objects.count(), 1)
        task = DIYProjectTask.objects.get()
        self.assertEqual(task.source, DIYProjectTask.Source.AI)
        self.assertIn("proposal_id", task.ai_metadata)

    def test_get_help_copies_selected_content_and_links_idempotently(self):
        project = self.create_project()
        phase = self.client.post(f"{self.base}/{project['id']}/phases/", {"title": "Technical work"}, format="json").data
        self.client.post(
            f"{self.base}/{project['id']}/phases/{phase['id']}/tasks/",
            {"title": "Install new circuit", "description": "Qualified professional to review and install.", "participation_type": "NEED_PROFESSIONAL"},
            format="json",
        )
        payload = {
            "selection_type": "remaining", "project_mode": "diy_assist",
            "idempotency_key": "technical-help-v1",
        }
        first = self.client.post(f"{self.base}/{project['id']}/get-help/", payload, format="json")
        self.assertEqual(first.status_code, 201, first.data)
        request_row = CustomerRequest.objects.get(id=first.data["request_id"])
        self.assertEqual(request_row.status, CustomerRequest.STATUS_DRAFT)
        self.assertIn("Install new circuit", request_row.description)
        self.assertEqual(request_row.internal_notes, "")
        second = self.client.post(f"{self.base}/{project['id']}/get-help/", payload, format="json")
        self.assertEqual(second.status_code, 200, second.data)
        self.assertFalse(second.data["created"])
        self.assertEqual(CustomerRequest.objects.count(), 1)

    def test_diy_help_selected_evidence_routes_to_contractor_without_exposing_private_assets(self):
        project = self.create_project()
        phase = self.client.post(
            f"{self.base}/{project['id']}/phases/",
            {"title": "Electrical and finish work"},
            format="json",
        ).data
        diy_task = self.client.post(
            f"{self.base}/{project['id']}/phases/{phase['id']}/tasks/",
            {"title": "Paint repaired wall", "participation_type": "DO_IT_MYSELF"},
            format="json",
        ).data
        professional_task = self.client.post(
            f"{self.base}/{project['id']}/phases/{phase['id']}/tasks/",
            {
                "title": "Connect exterior circuit",
                "description": "Review existing wiring and complete the connection.",
                "participation_type": "NEED_PROFESSIONAL",
                "professional_review_recommended": True,
            },
            format="json",
        ).data
        measurement = self.client.post(
            f"{self.base}/{project['id']}/measurements/",
            {"label": "Cable run", "value": "18", "unit": "ft"},
            format="json",
        ).data
        shared_upload = self.client.post(
            f"{self.base}/{project['id']}/assets/",
            {"file": SimpleUploadedFile("shared.jpg", b"shared-image", content_type="image/jpeg"), "caption": "Panel location"},
            format="multipart",
        )
        private_upload = self.client.post(
            f"{self.base}/{project['id']}/assets/",
            {"file": SimpleUploadedFile("private.jpg", b"private-image", content_type="image/jpeg"), "caption": "Private progress"},
            format="multipart",
        )
        self.assertEqual(shared_upload.status_code, 201, shared_upload.data)
        self.assertEqual(private_upload.status_code, 201, private_upload.data)

        conversion = self.client.post(
            f"{self.base}/{project['id']}/get-help/",
            {
                "selection_type": "task",
                "task_ids": [professional_task["id"]],
                "asset_ids": [shared_upload.data["id"]],
                "measurement_ids": [measurement["id"]],
                "project_mode": "diy_assist",
                "scope": "Please review and connect the exterior circuit.",
                "idempotency_key": "exterior-circuit-v1",
            },
            format="json",
        )
        self.assertEqual(conversion.status_code, 201, conversion.data)
        request_row = CustomerRequest.objects.select_related("source_intake").get(id=conversion.data["request_id"])
        intake = request_row.source_intake
        self.assertEqual(intake.project_mode, "assisted_diy")
        self.assertIn("Paint repaired wall", intake.homeowner_task_summary)
        self.assertIn("Connect exterior circuit", intake.homeowner_assistance_summary)
        self.assertNotIn("Paint repaired wall", request_row.description)
        self.assertEqual(ProjectIntakeClarificationPhoto.objects.filter(project_intake=intake).count(), 1)
        self.assertEqual(intake.clarification_photos.get().caption, "Panel location")
        self.assertNotIn("private.jpg", intake.clarification_photos.get().image.name)

        User = get_user_model()
        contractor_user = User.objects.create_user(email="routed@example.com", password="test-pass")
        contractor = Contractor.objects.create(
            user=contractor_user, business_name="Safe Electric", city="Austin", state="TX"
        )
        entry = ContractorDirectoryEntry.objects.create(
            business_name="Safe Electric",
            normalized_name=normalize_business_name("Safe Electric"),
            city="Austin",
            state="TX",
            claimed=True,
            claimed_by_contractor=contractor,
            services=["electrician"],
        )
        routed = self.client.post(
            f"/api/projects/customer-portal/{self.token}/requests/{request_row.id}/contractors/select/",
            {"selected_contractors": [{"directory_entry_id": entry.id}]},
            format="json",
        )
        self.assertEqual(routed.status_code, 200, routed.data)
        self.assertEqual(routed.data["opportunity_count"], 1)
        opportunity = ContractorOpportunity.objects.get(intake_request=intake, directory_entry=entry)
        self.assertIn("Connect exterior circuit", opportunity.project_description)
        self.assertNotIn("Paint repaired wall", opportunity.project_description)
        self.assertEqual(len(opportunity.photos), 1)
        self.assertEqual(opportunity.measurements, [{"label": "Cable run", "value": "18.0000", "unit": "ft"}])

        duplicate_route = self.client.post(
            f"/api/projects/customer-portal/{self.token}/requests/{request_row.id}/contractors/select/",
            {"selected_contractors": [{"directory_entry_id": entry.id}]},
            format="json",
        )
        self.assertEqual(duplicate_route.status_code, 200, duplicate_route.data)
        self.assertEqual(ContractorOpportunity.objects.filter(intake_request=intake, directory_entry=entry).count(), 1)
        self.assertEqual(
            self.client.get(
                f"/api/projects/customer-portal/{self.other_token}/diy-projects/{project['id']}/assets/{shared_upload.data['id']}/download/"
            ).status_code,
            404,
        )
        self.assertTrue(DIYProjectAsset.objects.filter(id=private_upload.data["id"]).exists())
        self.assertTrue(DIYProjectTask.objects.filter(id=diy_task["id"]).exists())
