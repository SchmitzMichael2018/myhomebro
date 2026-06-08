from django.contrib.auth import get_user_model
from django.test import TestCase
from django.utils import timezone
from rest_framework.test import APIClient

from projects.models import Agreement, Contractor, ContractorPublicProfile, ContractorReview, Homeowner, Milestone, Project, ProjectStatus
from projects.services.contractor_reviews import contractor_performance_summary
from projects.views.customer_portal import _portal_token


User = get_user_model()


class ContractorReviewFoundationTests(TestCase):
    def setUp(self):
        self.contractor_user = User.objects.create_user(
            email="contractor@example.com",
            password="pass",
            first_name="Review",
            last_name="Contractor",
        )
        self.contractor = Contractor.objects.create(
            user=self.contractor_user,
            business_name="Review Builders",
            city="Austin",
            state="TX",
        )
        self.homeowner = Homeowner.objects.create(
            created_by=self.contractor,
            full_name="Pat Customer",
            email="pat@example.com",
        )
        self.project = Project.objects.create(
            contractor=self.contractor,
            homeowner=self.homeowner,
            title="Completed Kitchen Project",
            description="Kitchen project",
            status=ProjectStatus.COMPLETED,
        )
        self.agreement = Agreement.objects.create(
            project=self.project,
            contractor=self.contractor,
            homeowner=self.homeowner,
            description="Kitchen agreement",
            project_type="Remodel",
            project_subtype="Kitchen Remodel",
            status=ProjectStatus.COMPLETED,
            total_cost="12000.00",
        )
        Milestone.objects.create(
            agreement=self.agreement,
            title="Final walkthrough",
            order=1,
            amount="12000.00",
            completed=True,
            completed_at=timezone.now(),
        )
        self.client = APIClient()
        self.token = _portal_token(self.homeowner.email)

    def _review_url(self, agreement=None, token=None):
        return f"/api/projects/customer-portal/{token or self.token}/agreements/{(agreement or self.agreement).id}/review/"

    def test_customer_can_submit_review_after_eligible_completion(self):
        response = self.client.post(
            self._review_url(),
            {"rating": 5, "title": "Great work", "review_text": "Clear updates and clean finish."},
            format="json",
        )

        self.assertEqual(response.status_code, 201)
        review = ContractorReview.objects.get(agreement=self.agreement)
        self.assertEqual(review.customer_email, "pat@example.com")
        self.assertEqual(review.project_type, "Remodel")
        self.assertEqual(review.project_subtype, "Kitchen Remodel")
        self.assertTrue(review.is_verified)
        self.assertFalse(review.is_public)
        self.assertEqual(review.moderation_status, ContractorReview.MODERATION_PENDING)
        self.contractor.refresh_from_db()
        self.assertEqual(self.contractor.review_count, 0)

    def test_cannot_review_before_eligible_completion(self):
        other_project = Project.objects.create(
            contractor=self.contractor,
            homeowner=self.homeowner,
            title="Draft Project",
            status=ProjectStatus.IN_PROGRESS,
        )
        other_agreement = Agreement.objects.create(
            project=other_project,
            contractor=self.contractor,
            homeowner=self.homeowner,
            description="Still active",
            status=ProjectStatus.IN_PROGRESS,
        )

        response = self.client.post(self._review_url(other_agreement), {"rating": 5}, format="json")

        self.assertEqual(response.status_code, 400)
        self.assertIn("unlock", response.data["detail"].lower())
        self.assertFalse(ContractorReview.objects.filter(agreement=other_agreement).exists())

    def test_duplicate_customer_review_is_rejected(self):
        self.client.post(self._review_url(), {"rating": 5}, format="json")

        response = self.client.post(self._review_url(), {"rating": 4}, format="json")

        self.assertEqual(response.status_code, 400)
        self.assertIn("already", response.data["detail"].lower())
        self.assertEqual(ContractorReview.objects.filter(agreement=self.agreement).count(), 1)

    def test_unrelated_customer_cannot_review_project(self):
        other_token = _portal_token("other@example.com")

        response = self.client.post(self._review_url(token=other_token), {"rating": 5}, format="json")

        self.assertEqual(response.status_code, 404)
        self.assertFalse(ContractorReview.objects.exists())

    def test_contractor_cannot_review_own_project(self):
        self.homeowner.email = self.contractor_user.email
        self.homeowner.save(update_fields=["email"])
        token = _portal_token(self.contractor_user.email)

        response = self.client.post(self._review_url(token=token), {"rating": 5}, format="json")

        self.assertEqual(response.status_code, 400)
        self.assertIn("contractors cannot review", response.data["detail"].lower())

    def test_hidden_unapproved_review_excluded_until_admin_approves(self):
        self.client.post(self._review_url(), {"rating": 5}, format="json")
        self.contractor.refresh_from_db()
        self.assertEqual(self.contractor.review_count, 0)
        self.assertEqual(self.contractor.average_rating, 0)

        admin = User.objects.create_user(email="admin@example.com", password="pass", is_staff=True)
        self.client.force_authenticate(admin)
        review = ContractorReview.objects.get(agreement=self.agreement)
        list_response = self.client.get("/api/projects/admin/contractor-reviews/")
        self.assertEqual(list_response.status_code, 200)
        self.assertEqual(list_response.data["count"], 1)
        self.assertEqual(list_response.data["results"][0]["moderation_status"], ContractorReview.MODERATION_PENDING)
        response = self.client.post(
            f"/api/projects/admin/contractor-reviews/{review.id}/moderate/",
            {"action": "approve", "moderation_notes": "Looks valid."},
            format="json",
        )

        self.assertEqual(response.status_code, 200)
        review.refresh_from_db()
        self.assertTrue(review.is_public)
        self.assertEqual(review.moderation_status, ContractorReview.MODERATION_APPROVED)
        self.assertIsNotNone(review.published_at)
        self.contractor.refresh_from_db()
        self.assertEqual(self.contractor.review_count, 1)
        self.assertEqual(self.contractor.average_rating, 5.0)

    def test_performance_summary_uses_reviews_disputes_and_milestones(self):
        ContractorReview.objects.create(
            contractor=self.contractor,
            public_profile=ContractorPublicProfile.objects.get_or_create(contractor=self.contractor)[0],
            agreement=self.agreement,
            homeowner=self.homeowner,
            customer_name=self.homeowner.full_name,
            customer_email=self.homeowner.email,
            rating=4,
            is_verified=True,
            moderation_status=ContractorReview.MODERATION_APPROVED,
        )
        self.contractor.refresh_from_db()

        summary = contractor_performance_summary(self.contractor)

        self.assertEqual(summary["review_count"], 1)
        self.assertEqual(summary["average_rating"], 4.0)
        self.assertEqual(summary["completed_projects"], 1)
        self.assertIn("dispute_rate", summary)
        self.assertIn("data_status", summary)
