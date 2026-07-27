from copy import deepcopy
from decimal import Decimal
from uuid import uuid4

from django.contrib.auth import get_user_model
from django.test import TestCase, override_settings
from rest_framework.test import APIClient

from projects.models import (
    Agreement,
    AgreementAmendment,
    AmendmentRequest,
    Capture,
    Contractor,
    ContractorSubAccount,
    Homeowner,
    Invoice,
    Milestone,
    Project,
)


@override_settings(
    SECURE_SSL_REDIRECT=False,
    CAPTURE_FOUNDATION_ENABLED=True,
    CAPTURE_INBOX_ENABLED=True,
    CAPTURE_REVIEW_ENABLED=True,
    CAPTURE_APPLICATION_ENABLED=True,
    CAPTURE_CHANGE_REQUEST_ENABLED=True,
)
class CaptureChangeIntakeTests(TestCase):
    def setUp(self):
        users = get_user_model()
        self.owner = users.objects.create_user(email="change-owner@example.com", password="test")
        self.customer_user = users.objects.create_user(
            email="change-customer@example.com", password="test"
        )
        self.other_user = users.objects.create_user(email="other-customer@example.com", password="test")
        self.contractor = Contractor.objects.create(user=self.owner, business_name="Change Builders")
        self.customer = Homeowner.objects.create(
            created_by=self.contractor,
            full_name="Change Customer",
            email=self.customer_user.email,
        )
        self.project = Project.objects.create(
            contractor=self.contractor, homeowner=self.customer, title="Kitchen project"
        )
        self.agreement = Agreement.objects.create(
            project=self.project,
            contractor=self.contractor,
            homeowner=self.customer,
            total_cost=Decimal("2500.00"),
            status="signed",
        )
        self.milestone = Milestone.objects.create(
            agreement=self.agreement,
            order=1,
            title="Installation",
            amount=Decimal("2500.00"),
        )
        self.client = APIClient()
        self.client.force_authenticate(self.owner)

    def test_project_options_uses_project_title_and_preserves_scope(self):
        self.assertFalse(hasattr(self.agreement, "title"))
        other_owner = get_user_model().objects.create_user(
            email="other-change-owner@example.com", password="test"
        )
        other_contractor = Contractor.objects.create(
            user=other_owner, business_name="Other Change Builders"
        )
        other_customer = Homeowner.objects.create(
            created_by=other_contractor,
            full_name="Other Customer",
            email="other-project-customer@example.com",
        )
        other_project = Project.objects.create(
            contractor=other_contractor,
            homeowner=other_customer,
            title="Private project",
        )
        Agreement.objects.create(
            project=other_project,
            contractor=other_contractor,
            homeowner=other_customer,
            total_cost=Decimal("9000.00"),
        )

        response = self.client.get("/api/projects/captures/project-options/")

        self.assertEqual(response.status_code, 200, response.data)
        self.assertEqual([row["id"] for row in response.data["results"]], [self.project.id])
        agreement = response.data["results"][0]["agreements"][0]
        self.assertEqual(
            agreement,
            {
                "id": self.agreement.id,
                "title": self.project.title,
                "status": self.agreement.status,
            },
        )
        self.assertTrue(response.data["capabilities"]["change_request"]["enabled"])

        self.project.title = ""
        self.project.save(update_fields=["title"])
        fallback = self.client.get("/api/projects/captures/project-options/")
        self.assertEqual(fallback.status_code, 200, fallback.data)
        self.assertEqual(
            fallback.data["results"][0]["agreements"][0]["title"],
            f"Agreement #{self.agreement.id}",
        )

        readonly = get_user_model().objects.create_user(
            email="change-readonly@example.com", password="test"
        )
        ContractorSubAccount.objects.create(
            parent_contractor=self.contractor,
            user=readonly,
            display_name="Change Read-only",
            role=ContractorSubAccount.ROLE_EMPLOYEE_READONLY,
        )
        self.client.force_authenticate(readonly)
        scoped = self.client.get("/api/projects/captures/project-options/")
        self.assertEqual(scoped.status_code, 200, scoped.data)
        self.assertEqual(scoped.data["results"], [])

    def create_and_process(self):
        create = self.client.post(
            "/api/projects/captures/",
            {
                "capture_type": "communication",
                "capture_method": "typed",
                "project_id": self.project.id,
                "agreement_id": self.agreement.id,
                "raw_text_payload": {
                    "title": "Move pantry wall",
                    "text": "Move the pantry wall twelve inches toward the hallway.",
                    "capture_profile": "change_request",
                    "input_metadata": {
                        "capture_profile": "change_request",
                        "change_kind": "design_change",
                        "decision_boundary": "change_request",
                        "communication_type": "other",
                        "reason": "Provide more cabinet clearance.",
                    },
                },
            },
            format="json",
        )
        self.assertEqual(create.status_code, 201, create.data)
        process = self.client.post(
            f"/api/projects/captures/{create.data['id']}/process/",
            {"expected_version": create.data["version"]},
            format="json",
        )
        self.assertEqual(process.status_code, 200, process.data)
        return create, process

    def test_full_lifecycle_creates_only_open_pending_request(self):
        agreement_total = self.agreement.total_cost
        milestone_snapshot = (self.milestone.title, self.milestone.amount, self.milestone.completed)
        amendment_count = AgreementAmendment.objects.count()
        invoice_count = Invoice.objects.count()

        create, process = self.create_and_process()
        draft = deepcopy(process.data["review"]["structured_draft"])
        self.assertEqual(draft["schema_version"], "change-intake.v1")
        self.assertEqual(draft["proposed_destination"], "amendment_request")
        update = self.client.patch(
            f"/api/projects/captures/{create.data['id']}/review/",
            {"expected_version": process.data["capture"]["version"], "structured_draft": draft},
            format="json",
        )
        self.assertEqual(update.status_code, 200, update.data)
        approve = self.client.post(
            f"/api/projects/captures/{create.data['id']}/approve/",
            {"expected_version": update.data["capture"]["version"]},
            format="json",
        )
        self.assertEqual(approve.status_code, 200, approve.data)
        payload = {
            "expected_version": approve.data["capture"]["version"],
            "idempotency_key": str(uuid4()),
            "destinations": ["amendment_request"],
            "adapter_versions": {"amendment_request": "1"},
            "application_options": {},
            "confirmed": True,
        }
        preview = self.client.post(
            f"/api/projects/captures/{create.data['id']}/application-preview/",
            payload,
            format="json",
        )
        self.assertEqual(preview.status_code, 200, preview.data)
        apply = self.client.post(
            f"/api/projects/captures/{create.data['id']}/apply/", payload, format="json"
        )
        self.assertEqual(apply.status_code, 200, apply.data)

        request = AmendmentRequest.objects.get(source_capture_id=create.data["id"])
        self.assertEqual(request.status, AmendmentRequest.Status.OPEN)
        self.assertEqual(request.response_state, AmendmentRequest.ResponseState.PENDING)
        self.assertEqual(request.change_intake_category, "design_change")
        self.assertEqual(request.requested_changes["capture_provenance"]["capture_id"], create.data["id"])
        self.agreement.refresh_from_db()
        self.milestone.refresh_from_db()
        self.assertEqual(self.agreement.total_cost, agreement_total)
        self.assertEqual(
            (self.milestone.title, self.milestone.amount, self.milestone.completed),
            milestone_snapshot,
        )
        self.assertEqual(AgreementAmendment.objects.count(), amendment_count)
        self.assertEqual(Invoice.objects.count(), invoice_count)

    def test_flag_disabled_and_cross_project_agreement_fail_closed(self):
        with self.settings(CAPTURE_CHANGE_REQUEST_ENABLED=False):
            response = self.client.post(
                "/api/projects/captures/",
                {
                    "capture_type": "communication",
                    "capture_method": "typed",
                    "project_id": self.project.id,
                    "agreement_id": self.agreement.id,
                    "raw_text_payload": {
                        "text": "Please add another cabinet.",
                        "capture_profile": "change_request",
                        "input_metadata": {"capture_profile": "change_request"},
                    },
                },
                format="json",
            )
        self.assertEqual(response.status_code, 400)

        other_project = Project.objects.create(
            contractor=self.contractor, homeowner=self.customer, title="Other project"
        )
        other_agreement = Agreement.objects.create(
            project=other_project,
            contractor=self.contractor,
            homeowner=self.customer,
            total_cost=Decimal("100.00"),
        )
        mismatch = self.client.post(
            "/api/projects/captures/",
            {
                "capture_type": "communication",
                "capture_method": "typed",
                "project_id": self.project.id,
                "agreement_id": other_agreement.id,
                "raw_text_payload": {
                    "text": "Please add another cabinet.",
                    "capture_profile": "change_request",
                    "input_metadata": {"capture_profile": "change_request"},
                },
            },
            format="json",
        )
        self.assertEqual(mismatch.status_code, 404)

    def test_customer_submission_is_authenticated_scoped_and_safe(self):
        self.client.force_authenticate(self.customer_user)
        response = self.client.post(
            "/api/projects/captures/customer-change-intake/",
            {
                "project_id": self.project.id,
                "agreement_id": self.agreement.id,
                "change_kind": "customer_revision",
                "requested_change": "Use the alternate cabinet hardware we selected.",
                "reason": "The finish better matches the appliances.",
            },
            format="json",
        )
        self.assertEqual(response.status_code, 201, response.data)
        self.assertFalse(response.data["contract_effect"])
        capture = Capture.objects.get(pk=response.data["capture_id"])
        self.assertEqual(capture.captured_by, self.customer_user)
        self.assertEqual(capture.raw_text_payload["input_metadata"]["actor_type"], "customer")

        status_response = self.client.get(
            f"/api/projects/captures/customer-change-intake/{capture.id}/"
        )
        self.assertEqual(status_response.status_code, 200)
        self.assertFalse(status_response.data["contract_effect"])
        self.assertNotIn("structured_draft", status_response.data)

        self.client.force_authenticate(self.other_user)
        denied = self.client.get(f"/api/projects/captures/customer-change-intake/{capture.id}/")
        self.assertEqual(denied.status_code, 404)

    def test_inferred_formal_approval_cannot_be_approved(self):
        create = self.client.post(
            "/api/projects/captures/",
            {
                "capture_type": "communication",
                "capture_method": "typed",
                "project_id": self.project.id,
                "agreement_id": self.agreement.id,
                "raw_text_payload": {
                    "text": "I approve the new price and authorize the contractor to proceed.",
                    "capture_profile": "change_request",
                    "input_metadata": {
                        "capture_profile": "change_request",
                        "change_kind": "add_scope",
                        "communication_type": "other",
                    },
                },
            },
            format="json",
        )
        self.assertEqual(create.status_code, 201, create.data)
        process = self.client.post(
            f"/api/projects/captures/{create.data['id']}/process/",
            {"expected_version": create.data["version"]},
            format="json",
        )
        self.assertEqual(process.status_code, 200, process.data)
        self.assertEqual(
            process.data["review"]["structured_draft"]["decision_boundary"], "formal_approval"
        )
        self.assertEqual(process.data["capture"]["status"], Capture.STATUS_NEEDS_INFORMATION)
