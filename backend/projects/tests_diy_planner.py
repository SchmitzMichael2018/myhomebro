from django.test import TestCase, override_settings
from rest_framework.test import APIClient

from projects.models import CustomerRequest
from projects.models_diy_planner import DIYProject, DIYProjectMeasurement, DIYProjectTask
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
