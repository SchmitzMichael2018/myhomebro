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
    Project,
    SubcontractorCompletionStatus,
    Notification,
)
from projects.services.notification_center import get_notification_queryset_for_user


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
