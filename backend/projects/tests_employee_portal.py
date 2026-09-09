from django.contrib.auth import get_user_model
from django.test import TestCase
from rest_framework.test import APIClient

from projects.models import (
    Agreement,
    AgreementAssignment,
    Contractor,
    ContractorSubAccount,
    Homeowner,
    Milestone,
    MilestoneAssignment,
    MilestoneComment,
    MilestoneFile,
    Project,
    SubcontractorCompletionStatus,
    Notification,
)
from projects.services.notification_center import get_notification_queryset_for_user
from projects.services.team_attention import build_contractor_attention_counts
from django.core.files.uploadedfile import SimpleUploadedFile


class EmployeePortalWorkflowTests(TestCase):
    def setUp(self):
        users = get_user_model()
        self.owner_user = users.objects.create_user(email="employee-owner@example.com", password="testpass123")
        self.employee_user = users.objects.create_user(email="employee-worker@example.com", password="testpass123")
        self.contractor = Contractor.objects.create(user=self.owner_user, business_name="Employee Test Contractor")
        self.employee = ContractorSubAccount.objects.create(
            parent_contractor=self.contractor,
            user=self.employee_user,
            display_name="Assigned Employee",
            role=ContractorSubAccount.ROLE_EMPLOYEE_MILESTONES,
            is_active=True,
        )
        homeowner = Homeowner.objects.create(
            created_by=self.contractor,
            full_name="Employee Test Customer",
            email="employee-customer@example.com",
        )
        project = Project.objects.create(contractor=self.contractor, homeowner=homeowner, title="Employee Test Project")
        self.agreement = Agreement.objects.create(
            project=project,
            contractor=self.contractor,
            homeowner=homeowner,
            description="Employee portal workflow test",
        )
        self.assigned = Milestone.objects.create(agreement=self.agreement, title="Assigned work", order=1, amount="100.00")
        self.context_only = Milestone.objects.create(agreement=self.agreement, title="Context only", order=2, amount="100.00")
        AgreementAssignment.objects.create(agreement=self.agreement, subaccount=self.employee)
        MilestoneAssignment.objects.create(milestone=self.assigned, subaccount=self.employee)
        self.client = APIClient()
        self.client.force_authenticate(user=self.employee_user)

    def test_project_context_does_not_add_unassigned_milestones_to_work_queue(self):
        response = self.client.get("/api/projects/employee/milestones/")

        self.assertEqual(response.status_code, 200, response.data)
        self.assertEqual([row["id"] for row in response.data["milestones"]], [self.assigned.id])

    def test_project_context_does_not_expose_milestone_financials(self):
        response = self.client.get(f"/api/projects/employee/agreements/{self.agreement.id}/")

        self.assertEqual(response.status_code, 200, response.data)
        self.assertEqual(len(response.data["milestones"]), 2)
        assignment_flags = {
            milestone["id"]: milestone["is_assigned_to_me"]
            for milestone in response.data["milestones"]
        }
        self.assertTrue(assignment_flags[self.assigned.id])
        self.assertFalse(assignment_flags[self.context_only.id])
        for milestone in response.data["milestones"]:
            self.assertNotIn("amount", milestone)
            self.assertNotIn("invoice_id", milestone)
            self.assertNotIn("is_invoiced", milestone)

    def test_employee_submission_waits_for_review_and_does_not_complete_milestone(self):
        MilestoneComment.objects.create(
            milestone=self.assigned,
            author=self.employee_user,
            content="Work is ready for review.",
        )

        response = self.client.post(
            f"/api/projects/employee/milestones/{self.assigned.id}/complete/",
            {"note": "Ready for the lead contractor."},
            format="json",
        )

        self.assertEqual(response.status_code, 200, response.data)
        self.assigned.refresh_from_db()
        self.assertFalse(self.assigned.completed)
        self.assertEqual(
            self.assigned.subcontractor_completion_status,
            SubcontractorCompletionStatus.SUBMITTED_FOR_REVIEW,
        )
        self.assertEqual(self.assigned.subcontractor_marked_complete_by_id, self.employee_user.id)

    def test_employee_cannot_submit_context_only_milestone(self):
        response = self.client.post(
            f"/api/projects/employee/milestones/{self.context_only.id}/complete/",
            {},
            format="json",
        )

        self.assertEqual(response.status_code, 404)

    def test_employee_can_delete_own_evidence_but_not_another_users_file(self):
        own_file = MilestoneFile.objects.create(
            milestone=self.assigned,
            uploaded_by=self.employee_user,
            file=SimpleUploadedFile("own-photo.jpg", b"photo", content_type="image/jpeg"),
        )
        owner_file = MilestoneFile.objects.create(
            milestone=self.assigned,
            uploaded_by=self.owner_user,
            file=SimpleUploadedFile("owner-photo.jpg", b"photo", content_type="image/jpeg"),
        )

        detail = self.client.get(f"/api/projects/employee/milestones/{self.assigned.id}/")
        flags = {row["id"]: row["can_delete"] for row in detail.data["files"]}
        self.assertTrue(flags[own_file.id])
        self.assertFalse(flags[owner_file.id])

        denied = self.client.delete(
            f"/api/projects/employee/milestones/{self.assigned.id}/files/{owner_file.id}/"
        )
        self.assertEqual(denied.status_code, 404)
        deleted = self.client.delete(
            f"/api/projects/employee/milestones/{self.assigned.id}/files/{own_file.id}/"
        )
        self.assertEqual(deleted.status_code, 204)
        self.assertFalse(MilestoneFile.objects.filter(id=own_file.id).exists())

    def test_employee_can_edit_and_delete_own_note_before_submission(self):
        own_note = MilestoneComment.objects.create(
            milestone=self.assigned,
            author=self.employee_user,
            content="Initial note",
        )
        owner_note = MilestoneComment.objects.create(
            milestone=self.assigned,
            author=self.owner_user,
            content="Contractor note",
        )

        updated = self.client.patch(
            f"/api/projects/employee/milestones/{self.assigned.id}/comments/{own_note.id}/",
            {"content": "Updated note"},
            format="json",
        )
        self.assertEqual(updated.status_code, 200, updated.data)
        own_note.refresh_from_db()
        self.assertEqual(own_note.content, "Updated note")

        denied = self.client.delete(
            f"/api/projects/employee/milestones/{self.assigned.id}/comments/{owner_note.id}/"
        )
        self.assertEqual(denied.status_code, 404)
        deleted = self.client.delete(
            f"/api/projects/employee/milestones/{self.assigned.id}/comments/{own_note.id}/"
        )
        self.assertEqual(deleted.status_code, 204)
        self.assertFalse(MilestoneComment.objects.filter(id=own_note.id).exists())

    def test_evidence_locks_during_review_and_unlocks_when_sent_back(self):
        note = MilestoneComment.objects.create(
            milestone=self.assigned,
            author=self.employee_user,
            content="Ready",
        )
        evidence = MilestoneFile.objects.create(
            milestone=self.assigned,
            uploaded_by=self.employee_user,
            file=SimpleUploadedFile("ready.jpg", b"photo", content_type="image/jpeg"),
        )
        self.assigned.subcontractor_completion_status = SubcontractorCompletionStatus.SUBMITTED_FOR_REVIEW
        self.assigned.save(update_fields=["subcontractor_completion_status"])

        detail = self.client.get(f"/api/projects/employee/milestones/{self.assigned.id}/")
        self.assertFalse(detail.data["evidence_editable"])
        self.assertFalse(detail.data["comments"][0]["can_edit"])
        self.assertFalse(detail.data["files"][0]["can_delete"])
        locked_note = self.client.patch(
            f"/api/projects/employee/milestones/{self.assigned.id}/comments/{note.id}/",
            {"content": "Changed while pending"},
            format="json",
        )
        locked_file = self.client.delete(
            f"/api/projects/employee/milestones/{self.assigned.id}/files/{evidence.id}/"
        )
        self.assertEqual(locked_note.status_code, 409)
        self.assertEqual(locked_file.status_code, 409)

        self.assigned.subcontractor_completion_status = SubcontractorCompletionStatus.NEEDS_CHANGES
        self.assigned.save(update_fields=["subcontractor_completion_status"])
        unlocked = self.client.get(f"/api/projects/employee/milestones/{self.assigned.id}/")
        self.assertTrue(unlocked.data["evidence_editable"])
        self.assertTrue(unlocked.data["comments"][0]["can_edit"])
        self.assertTrue(unlocked.data["files"][0]["can_delete"])

        # The legacy employee flow marked work complete before review. A
        # send-back status must still reopen evidence on those records.
        self.assigned.completed = True
        self.assigned.save(update_fields=["completed"])
        legacy_unlocked = self.client.get(
            f"/api/projects/employee/milestones/{self.assigned.id}/"
        )
        self.assertTrue(legacy_unlocked.data["evidence_editable"])
        self.assertTrue(legacy_unlocked.data["comments"][0]["can_edit"])
        self.assertTrue(legacy_unlocked.data["files"][0]["can_delete"])

    def test_employee_notification_scope_excludes_contractor_financial_events(self):
        Notification.objects.create(
            contractor=self.contractor,
            event_type=Notification.EVENT_PAYMENT_RELEASED,
            agreement=self.agreement,
            title="Payment released",
            message="Customer payment was released.",
        )

        queryset, _ = get_notification_queryset_for_user(self.employee_user)

        self.assertFalse(queryset.filter(event_type=Notification.EVENT_PAYMENT_RELEASED).exists())

    def test_employee_account_does_not_count_as_a_subcontractor(self):
        counts = build_contractor_attention_counts(self.contractor)

        self.assertEqual(counts["active_subcontractor_count"], 0)
