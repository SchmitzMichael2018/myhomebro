from copy import deepcopy
from decimal import Decimal
from uuid import uuid4

from django.contrib.auth import get_user_model
from django.test import TestCase, override_settings
from rest_framework.test import APIClient

from projects.models import (
    Agreement,
    Capture,
    Contractor,
    ContractorSubAccount,
    Homeowner,
    Milestone,
    MilestoneAssignment,
    Project,
    ProjectCaptureIssue,
)


@override_settings(
    SECURE_SSL_REDIRECT=False,
    CAPTURE_FOUNDATION_ENABLED=True,
    CAPTURE_INBOX_ENABLED=True,
    CAPTURE_REVIEW_ENABLED=True,
    CAPTURE_APPLICATION_ENABLED=True,
    CAPTURE_FIELD_FINDINGS_ENABLED=True,
)
class CaptureFieldFindingsTests(TestCase):
    def setUp(self):
        users = get_user_model()
        self.owner = users.objects.create_user(email="field-findings@example.com", password="test")
        self.contractor = Contractor.objects.create(user=self.owner, business_name="Findings Builders")
        self.customer = Homeowner.objects.create(
            created_by=self.contractor, full_name="Field Customer", email="field-customer@example.com"
        )
        self.project = Project.objects.create(
            contractor=self.contractor, homeowner=self.customer, title="Field project"
        )
        self.agreement = Agreement.objects.create(
            project=self.project, contractor=self.contractor, homeowner=self.customer,
            total_cost=Decimal("1000.00"), status="signed",
        )
        self.milestone = Milestone.objects.create(
            agreement=self.agreement, order=1, title="Closeout", amount=Decimal("1000.00")
        )
        self.employee = users.objects.create_user(email="assigned-field@example.com", password="test")
        subaccount = ContractorSubAccount.objects.create(
            parent_contractor=self.contractor, user=self.employee, display_name="Assigned Field",
            role=ContractorSubAccount.ROLE_EMPLOYEE_MILESTONES,
        )
        MilestoneAssignment.objects.create(milestone=self.milestone, subaccount=subaccount)
        self.client = APIClient()
        self.client.force_authenticate(self.owner)

    def create_and_process(self, profile="punch_item"):
        create = self.client.post("/api/projects/captures/", {
            "capture_type": "issue", "capture_method": "typed",
            "project_id": self.project.id, "milestone_id": self.milestone.id,
            "raw_text_payload": {
                "title": "Walkthrough",
                "text": "Paint touch-up — Living room\nMissing outlet cover — Kitchen",
                "capture_profile": profile,
                "input_metadata": {
                    "capture_profile": profile,
                    "issue_classification": profile,
                },
            },
        }, format="json")
        self.assertEqual(create.status_code, 201, create.data)
        process = self.client.post(
            f"/api/projects/captures/{create.data['id']}/process/",
            {"expected_version": create.data["version"]}, format="json",
        )
        self.assertEqual(process.status_code, 200, process.data)
        return create, process

    def test_flag_disabled_fails_closed_without_changing_regular_issue(self):
        with self.settings(CAPTURE_FIELD_FINDINGS_ENABLED=False):
            response = self.client.post("/api/projects/captures/", {
                "capture_type": "issue", "capture_method": "typed", "project_id": self.project.id,
                "raw_text_payload": {
                    "text": "Paint touch-up", "capture_profile": "punch_item",
                    "input_metadata": {
                        "capture_profile": "punch_item", "issue_classification": "punch_item",
                    },
                },
            }, format="json")
            self.assertEqual(response.status_code, 400)
            regular = self.client.post("/api/projects/captures/", {
                "capture_type": "issue", "capture_method": "typed", "project_id": self.project.id,
                "raw_text_payload": {
                    "text": "Ordinary issue",
                    "input_metadata": {"issue_classification": "project_issue"},
                },
            }, format="json")
            self.assertEqual(regular.status_code, 201)

    def test_site_condition_and_multi_finding_review_apply_selected(self):
        create, process = self.create_and_process("site_condition")
        draft = deepcopy(process.data["review"]["structured_draft"])
        self.assertEqual(draft["schema_version"], "field-findings.v1")
        self.assertEqual(len(draft["findings"]), 2)
        self.assertEqual(draft["findings"][0]["classification"], "site_condition")
        draft["findings"][0]["review_status"] = "approved"
        draft["findings"][1]["review_status"] = "excluded"
        update = self.client.patch(
            f"/api/projects/captures/{create.data['id']}/review/",
            {"expected_version": process.data["capture"]["version"], "structured_draft": draft},
            format="json",
        )
        self.assertEqual(update.status_code, 200, update.data)
        approve = self.client.post(
            f"/api/projects/captures/{create.data['id']}/approve/",
            {"expected_version": update.data["capture"]["version"]}, format="json",
        )
        self.assertEqual(approve.status_code, 200, approve.data)
        payload = {
            "expected_version": approve.data["capture"]["version"],
            "idempotency_key": str(uuid4()), "selected_child_keys": ["finding-1"],
            "destinations": ["project_issue"], "adapter_versions": {"project_issue": "1"},
            "application_options": {}, "confirmed": True,
        }
        apply = self.client.post(
            f"/api/projects/captures/{create.data['id']}/apply/", payload, format="json"
        )
        self.assertEqual(apply.status_code, 200, apply.data)
        issue = ProjectCaptureIssue.objects.get(origin_capture_id=create.data["id"])
        self.assertEqual(issue.child_key, "finding-1")
        self.assertEqual(issue.classification, "site_condition")
        self.assertEqual(apply.data["receipt"]["selected_child_keys"], ["finding-1"])
        self.milestone.refresh_from_db()
        self.assertFalse(self.milestone.completed)

    def test_duplicate_child_key_and_forged_artifact_are_rejected(self):
        _, process = self.create_and_process()
        draft = deepcopy(process.data["review"]["structured_draft"])
        draft["findings"][1]["child_key"] = draft["findings"][0]["child_key"]
        duplicate = self.client.patch(
            f"/api/projects/captures/{process.data['capture']['id']}/review/",
            {"expected_version": process.data["capture"]["version"], "structured_draft": draft},
            format="json",
        )
        self.assertEqual(duplicate.status_code, 400)
        draft = deepcopy(process.data["review"]["structured_draft"])
        draft["findings"][0]["artifact_ids"] = [str(uuid4())]
        forged = self.client.patch(
            f"/api/projects/captures/{process.data['capture']['id']}/review/",
            {"expected_version": process.data["capture"]["version"], "structured_draft": draft},
            format="json",
        )
        self.assertEqual(forged.status_code, 400)

    def test_assigned_employee_can_create_but_cannot_apply(self):
        self.client.force_authenticate(self.employee)
        create, _ = self.create_and_process()
        capture = Capture.objects.get(pk=create.data["id"])
        capture.status = Capture.STATUS_APPROVED
        capture.approved_snapshot = {
            "schema_version": "field-findings.v1",
            "capture_version": capture.version,
            "structured_draft": capture.structured_draft,
            "review_decisions": {},
        }
        capture.save(update_fields=["status", "approved_snapshot"])
        denied = self.client.post(f"/api/projects/captures/{capture.id}/apply/", {
            "expected_version": capture.version, "idempotency_key": str(uuid4()),
            "selected_child_keys": ["finding-1"], "confirmed": True,
        }, format="json")
        self.assertEqual(denied.status_code, 403)
