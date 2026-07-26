import json
from copy import deepcopy
from datetime import timedelta
from decimal import Decimal
from unittest.mock import patch
from uuid import uuid4

from django.contrib.auth import get_user_model
from django.core.files.uploadedfile import SimpleUploadedFile
from django.test import TestCase, override_settings
from django.utils import timezone
from rest_framework.test import APIClient

from projects.models import (
    Agreement,
    AgreementAssignment,
    AgreementWarranty,
    Capture,
    CaptureArtifact,
    Contractor,
    ContractorSubAccount,
    CustomerCommunicationLog,
    Homeowner,
    Milestone,
    MilestoneAssignment,
    Project,
    ProjectCaptureActivity,
    ProjectCaptureAttachment,
    ProjectCaptureIssue,
    ProjectCaptureNote,
)
from projects.models_dispute import Dispute
from projects.services.capture_processing import (
    build_project_capture_draft,
    validate_structured_draft,
)
from projects.views.customer_portal import _project_activity, _project_photo_rows


@override_settings(
    SECURE_SSL_REDIRECT=False,
    CAPTURE_FOUNDATION_ENABLED=True,
    CAPTURE_INBOX_ENABLED=True,
    CAPTURE_REVIEW_ENABLED=True,
    CAPTURE_APPLICATION_ENABLED=True,
)
class ProjectCaptureTests(TestCase):
    def setUp(self):
        users = get_user_model()
        self.owner = users.objects.create_user(email="project-capture@example.com", password="test")
        self.contractor = Contractor.objects.create(
            user=self.owner, business_name="Project Capture Builders"
        )
        self.customer = Homeowner.objects.create(
            created_by=self.contractor,
            full_name="Casey Customer",
            email="casey@example.com",
        )
        self.project = Project.objects.create(
            contractor=self.contractor,
            homeowner=self.customer,
            title="Flooring installation",
            status="in_progress",
        )
        self.agreement = Agreement.objects.create(
            project=self.project,
            contractor=self.contractor,
            homeowner=self.customer,
            total_cost=Decimal("12000.00"),
            status="signed",
        )
        self.milestone = Milestone.objects.create(
            agreement=self.agreement,
            order=1,
            title="Install flooring",
            amount=Decimal("8000.00"),
        )
        self.employee = users.objects.create_user(email="field-worker@example.com", password="test")
        self.employee_account = ContractorSubAccount.objects.create(
            parent_contractor=self.contractor,
            user=self.employee,
            display_name="Field Worker",
            role=ContractorSubAccount.ROLE_EMPLOYEE_MILESTONES,
        )
        self.readonly = users.objects.create_user(email="readonly-worker@example.com", password="test")
        ContractorSubAccount.objects.create(
            parent_contractor=self.contractor,
            user=self.readonly,
            display_name="Read Only",
            role=ContractorSubAccount.ROLE_EMPLOYEE_READONLY,
        )
        self.supervisor = users.objects.create_user(email="supervisor@example.com", password="test")
        ContractorSubAccount.objects.create(
            parent_contractor=self.contractor,
            user=self.supervisor,
            display_name="Supervisor",
            role=ContractorSubAccount.ROLE_EMPLOYEE_SUPERVISOR,
        )
        self.client = APIClient()
        self.client.force_authenticate(self.owner)

    def raw(self, capture_type, *, visible=False):
        metadata = {"customer_visible": visible}
        if capture_type == Capture.TYPE_ISSUE:
            metadata["issue_classification"] = "punch_item"
        if capture_type == Capture.TYPE_COMMUNICATION:
            metadata.update({
                "communication_type": "phone_call",
                "communication_direction": "inbound",
            })
        return {
            "title": {
                Capture.TYPE_PROJECT_UPDATE: "Living room flooring",
                Capture.TYPE_PROGRESS_PHOTO: "Flooring progress",
                Capture.TYPE_ISSUE: "Baseboard damage",
                Capture.TYPE_COMMUNICATION: "Customer phone call",
                Capture.TYPE_DOCUMENT: "Flooring specification",
            }[capture_type],
            "text": "Installed flooring in the living room and documented the current condition.",
            "input_metadata": metadata,
        }

    def approved_capture(
        self, capture_type, *, visible=False, with_file=False, follow_up=None
    ):
        capture = Capture.objects.create(
            contractor=self.contractor,
            captured_by=self.owner,
            capture_type=capture_type,
            status=Capture.STATUS_SAVED,
            project=self.project,
            milestone=self.milestone,
            customer=self.customer,
            raw_text_payload=self.raw(capture_type, visible=visible),
        )
        if with_file:
            file = SimpleUploadedFile(
                "floor.jpg" if capture_type != Capture.TYPE_DOCUMENT else "spec.pdf",
                b"project-file-content",
                content_type=(
                    "image/jpeg"
                    if capture_type != Capture.TYPE_DOCUMENT
                    else "application/pdf"
                ),
            )
            CaptureArtifact.objects.create(
                capture=capture,
                artifact_type=(
                    CaptureArtifact.TYPE_DOCUMENT
                    if capture_type == Capture.TYPE_DOCUMENT
                    else CaptureArtifact.TYPE_PHOTO
                ),
                file=file,
                original_filename=file.name,
                mime_type=file.content_type,
                file_size=file.size,
                file_sha256="a" * 64,
                uploaded_by=self.owner,
            )
        draft = validate_structured_draft(
            capture_type, build_project_capture_draft(capture)
        )
        if follow_up is not None:
            draft["follow_up"] = follow_up
        capture.structured_draft = deepcopy(draft)
        capture.approved_snapshot = {
            "schema_version": draft["schema_version"],
            "structured_draft": deepcopy(draft),
            "review_decisions": {},
            "capture_version": 2,
            "approved_by_id": self.owner.id,
            "approved_at": timezone.now().isoformat(),
        }
        capture.approved_by = self.owner
        capture.approved_at = timezone.now()
        capture.status = Capture.STATUS_APPROVED
        capture.version = 3
        capture.save()
        return capture

    def apply(self, capture, *, key=None):
        destinations = capture.approved_snapshot["structured_draft"]["proposed_destinations"]
        payload = {
            "expected_version": capture.version,
            "idempotency_key": key or str(uuid4()),
            "destinations": destinations,
            "adapter_versions": {name: "1" for name in destinations},
            "application_options": {"include_follow_up": False},
            "confirmed": True,
        }
        return self.client.post(
            f"/api/projects/captures/{capture.id}/apply/",
            payload,
            format="json",
        ), payload

    def test_project_update_processes_reviews_applies_and_never_completes_milestone(self):
        create = self.client.post(
            "/api/projects/captures/",
            {
                "capture_type": "project_update",
                "capture_method": "typed",
                "project_id": self.project.id,
                "milestone_id": self.milestone.id,
                "raw_text_payload": self.raw(Capture.TYPE_PROJECT_UPDATE),
            },
            format="json",
        )
        self.assertEqual(create.status_code, 201)
        capture_id = create.data["id"]
        process = self.client.post(
            f"/api/projects/captures/{capture_id}/process/",
            {"expected_version": create.data["version"]},
            format="json",
        )
        self.assertEqual(process.status_code, 200)
        self.assertEqual(process.data["review"]["schema_version"], "project_update.v1")
        review = process.data["review"]["structured_draft"]
        update = self.client.patch(
            f"/api/projects/captures/{capture_id}/review/",
            {"expected_version": process.data["capture"]["version"], "structured_draft": review},
            format="json",
        )
        approve = self.client.post(
            f"/api/projects/captures/{capture_id}/approve/",
            {"expected_version": update.data["capture"]["version"]},
            format="json",
        )
        capture = Capture.objects.get(pk=capture_id)
        response, _ = self.apply(capture)
        self.assertEqual(response.status_code, 200)
        self.assertEqual(ProjectCaptureNote.objects.filter(origin_capture=capture).count(), 1)
        self.assertEqual(ProjectCaptureActivity.objects.filter(origin_capture=capture).count(), 1)
        self.milestone.refresh_from_db()
        self.assertFalse(self.milestone.completed)
        self.assertEqual(approve.data["capture"]["status"], Capture.STATUS_APPROVED)
        self.assertEqual(response.data["receipt"]["source_category"], capture.source_category)

    def test_progress_photo_and_document_create_durable_project_attachments(self):
        photo = self.approved_capture(
            Capture.TYPE_PROGRESS_PHOTO, visible=True, with_file=True
        )
        response, _ = self.apply(photo)
        self.assertEqual(response.status_code, 200)
        photo_attachment = ProjectCaptureAttachment.objects.get(
            artifact__capture=photo
        )
        self.assertTrue(photo_attachment.customer_visible)
        self.assertEqual(photo_attachment.kind, ProjectCaptureAttachment.KIND_PHOTO)

        document = self.approved_capture(
            Capture.TYPE_DOCUMENT, visible=False, with_file=True
        )
        response, _ = self.apply(document)
        self.assertEqual(response.status_code, 200)
        document_attachment = ProjectCaptureAttachment.objects.get(
            artifact__capture=document
        )
        self.assertFalse(document_attachment.customer_visible)
        self.assertEqual(document_attachment.kind, ProjectCaptureAttachment.KIND_DOCUMENT)

    def test_progress_photo_api_accepts_multiple_files(self):
        response = self.client.post(
            "/api/projects/captures/",
            {
                "capture_type": Capture.TYPE_PROGRESS_PHOTO,
                "capture_method": Capture.METHOD_TYPED,
                "project_id": str(self.project.id),
                "raw_text_payload": json.dumps(
                    {
                        "title": "North elevation",
                        "text": "Two progress views from the north side.",
                        "input_metadata": {"customer_visible": True},
                    }
                ),
                "files": [
                    SimpleUploadedFile(
                        "north-1.jpg", b"photo-one", content_type="image/jpeg"
                    ),
                    SimpleUploadedFile(
                        "north-2.jpg", b"photo-two", content_type="image/jpeg"
                    ),
                ],
            },
            format="multipart",
        )

        self.assertEqual(response.status_code, 201, response.data)
        capture = Capture.objects.get(id=response.data["id"])
        self.assertEqual(capture.artifacts.count(), 2)
        self.assertEqual(capture.project, self.project)

    def test_issue_requires_confirmed_classification_and_does_not_touch_warranty_or_dispute(self):
        capture = self.approved_capture(Capture.TYPE_ISSUE)
        response, _ = self.apply(capture)
        self.assertEqual(response.status_code, 200)
        issue = ProjectCaptureIssue.objects.get(origin_capture=capture)
        self.assertEqual(issue.classification, "punch_item")
        self.assertEqual(issue.status, ProjectCaptureIssue.STATUS_OPEN)
        self.assertEqual(AgreementWarranty.objects.filter(agreement=self.agreement).count(), 0)
        self.assertEqual(Dispute.objects.filter(agreement=self.agreement).count(), 0)

    def test_communication_uses_existing_customer_history(self):
        capture = self.approved_capture(Capture.TYPE_COMMUNICATION)
        response, _ = self.apply(capture)
        self.assertEqual(response.status_code, 200)
        log = CustomerCommunicationLog.objects.get(
            origin_capture=capture,
            communication_type=CustomerCommunicationLog.TYPE_PHONE_CALL,
        )
        self.assertEqual(log.project, self.project)
        self.assertEqual(log.customer, self.customer)
        self.assertEqual(log.direction, CustomerCommunicationLog.DIRECTION_INBOUND)

    def test_project_update_can_create_optional_follow_up(self):
        capture = self.approved_capture(
            Capture.TYPE_PROJECT_UPDATE,
            follow_up={
                "suggested": True,
                "subject": "Confirm site access",
                "due_at": (timezone.now() + timedelta(days=2)).isoformat(),
                "source_phrase": "Confirm access before Monday.",
            },
        )
        draft = capture.approved_snapshot["structured_draft"]
        destinations = [*draft["proposed_destinations"], "follow_up"]
        response = self.client.post(
            f"/api/projects/captures/{capture.id}/apply/",
            {
                "expected_version": capture.version,
                "idempotency_key": str(uuid4()),
                "destinations": destinations,
                "adapter_versions": {name: "1" for name in destinations},
                "application_options": {"include_follow_up": True},
                "confirmed": True,
            },
            format="json",
        )

        self.assertEqual(response.status_code, 200, response.data)
        follow_up = CustomerCommunicationLog.objects.get(
            origin_capture=capture,
            communication_type=CustomerCommunicationLog.TYPE_INTERNAL_NOTE,
        )
        self.assertEqual(follow_up.project, self.project)
        self.assertEqual(follow_up.customer, self.customer)
        self.assertIsNotNone(follow_up.follow_up_at)

    def test_permissions_are_project_and_assignment_scoped(self):
        self.client.force_authenticate(self.employee)
        denied = self.client.post(
            "/api/projects/captures/",
            {
                "capture_type": "project_update",
                "project_id": self.project.id,
                "raw_text_payload": self.raw(Capture.TYPE_PROJECT_UPDATE),
            },
            format="json",
        )
        self.assertEqual(denied.status_code, 404)
        MilestoneAssignment.objects.create(
            milestone=self.milestone, subaccount=self.employee_account
        )
        allowed = self.client.post(
            "/api/projects/captures/",
            {
                "capture_type": "project_update",
                "project_id": self.project.id,
                "milestone_id": self.milestone.id,
                "raw_text_payload": self.raw(Capture.TYPE_PROJECT_UPDATE),
            },
            format="json",
        )
        self.assertEqual(allowed.status_code, 201)
        self.client.force_authenticate(self.readonly)
        self.assertEqual(
            self.client.get("/api/projects/captures/project-options/").data["results"],
            [],
        )
        self.client.force_authenticate(self.supervisor)
        self.assertEqual(
            self.client.get("/api/projects/captures/project-options/").status_code,
            200,
        )

    def test_portal_visibility_defaults_internal_and_only_publishes_selected_records(self):
        visible = self.approved_capture(
            Capture.TYPE_PROGRESS_PHOTO, visible=True, with_file=True
        )
        hidden = self.approved_capture(
            Capture.TYPE_PROGRESS_PHOTO, visible=False, with_file=True
        )
        self.apply(visible)
        self.apply(hidden)
        photos = _project_photo_rows(self.agreement)
        self.assertEqual(len(photos), 1)
        activity = _project_activity(self.agreement, [], {}, [], [], [])
        self.assertEqual(
            [row["id"] for row in activity if row["id"].startswith("project-capture-")],
            [f"project-capture-{visible.created_project_activity.id}"],
        )

    def test_application_is_idempotent_and_receipt_lists_project_records(self):
        capture = self.approved_capture(Capture.TYPE_PROJECT_UPDATE)
        key = str(uuid4())
        first, payload = self.apply(capture, key=key)
        self.assertEqual(first.status_code, 200)
        capture.refresh_from_db()
        payload["expected_version"] = capture.version
        replay = self.client.post(
            f"/api/projects/captures/{capture.id}/apply/", payload, format="json"
        )
        self.assertEqual(replay.status_code, 200)
        self.assertEqual(ProjectCaptureNote.objects.filter(origin_capture=capture).count(), 1)
        self.assertEqual(ProjectCaptureActivity.objects.filter(origin_capture=capture).count(), 1)
        types = {row["type"] for row in replay.data["receipt"]["created_records"]}
        self.assertEqual(types, {"project_note", "project_activity"})

    def test_adapter_failure_rolls_back_all_project_records(self):
        capture = self.approved_capture(Capture.TYPE_PROJECT_UPDATE)
        with patch(
            "projects.services.capture_adapters.project_activity.ProjectActivityAdapter.apply",
            side_effect=RuntimeError("forced failure"),
        ):
            response, _ = self.apply(capture)
        self.assertEqual(response.status_code, 422)
        self.assertFalse(ProjectCaptureNote.objects.filter(origin_capture=capture).exists())
        self.assertFalse(ProjectCaptureActivity.objects.filter(origin_capture=capture).exists())
