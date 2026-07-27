from decimal import Decimal

from django.contrib.auth import get_user_model
from django.test import TestCase, override_settings
from rest_framework.test import APIClient

from projects.models import (
    Agreement,
    AmendmentRequest,
    Capture,
    CaptureApplication,
    CaptureRoutingAttempt,
    Contractor,
    ContractorSubAccount,
    Homeowner,
    Milestone,
    MilestoneAssignment,
    Project,
)
from projects.capture_routing_cases import CAPTURE_ROUTING_CASES


@override_settings(
    SECURE_SSL_REDIRECT=False,
    CAPTURE_FOUNDATION_ENABLED=True,
    CAPTURE_INBOX_ENABLED=True,
    CAPTURE_REVIEW_ENABLED=True,
    CAPTURE_APPLICATION_ENABLED=True,
    CAPTURE_PROFILE_REGISTRY_ENABLED=True,
    CAPTURE_CONVERSATIONAL_ENABLED=True,
    CAPTURE_FIELD_FINDINGS_ENABLED=True,
    CAPTURE_CHANGE_REQUEST_ENABLED=True,
    CAPTURE_EQUIPMENT_ENABLED=True,
    CAPTURE_WARRANTY_ENABLED=True,
    CAPTURE_MEASUREMENT_ENABLED=True,
)
class CaptureConversationalTests(TestCase):
    def setUp(self):
        users = get_user_model()
        self.owner = users.objects.create_user(email="route-owner@example.com", password="test")
        self.contractor = Contractor.objects.create(user=self.owner, business_name="Route Builders")
        self.customer = Homeowner.objects.create(
            created_by=self.contractor, full_name="Route Customer", email="route-customer@example.com"
        )
        self.project = Project.objects.create(
            contractor=self.contractor, homeowner=self.customer, title="Kitchen remodel"
        )
        self.agreement = Agreement.objects.create(
            project=self.project,
            contractor=self.contractor,
            homeowner=self.customer,
            total_cost=Decimal("5000.00"),
            status="signed",
        )
        self.milestone = Milestone.objects.create(
            agreement=self.agreement, title="Rough-in", amount=Decimal("5000.00"), order=1
        )
        self.employee = users.objects.create_user(email="route-worker@example.com", password="test")
        self.employee_account = ContractorSubAccount.objects.create(
            parent_contractor=self.contractor,
            user=self.employee,
            display_name="Route Worker",
            role=ContractorSubAccount.ROLE_EMPLOYEE_MILESTONES,
        )
        self.client = APIClient()
        self.client.force_authenticate(self.owner)

    def route(self, text, **extra):
        response = self.client.post(
            "/api/projects/captures/conversational/route/",
            {"text": text, **extra},
            format="json",
        )
        self.assertEqual(response.status_code, 201, response.data)
        return response.data

    def test_disabled_fails_closed_and_does_not_run_provider(self):
        calls = []
        with self.settings(
            CAPTURE_CONVERSATIONAL_ENABLED=False,
            CAPTURE_ROUTING_PROVIDER=lambda **kwargs: calls.append(kwargs),
        ):
            response = self.client.post(
                "/api/projects/captures/conversational/route/",
                {"text": "Remember to call tomorrow."},
                format="json",
            )
        self.assertEqual(response.status_code, 404)
        self.assertEqual(calls, [])
        self.assertFalse(CaptureRoutingAttempt.objects.exists())

    def test_registry_is_context_feature_destination_and_permission_aware(self):
        global_response = self.client.get("/api/projects/captures/profiles/")
        self.assertEqual(global_response.status_code, 200)
        global_keys = {row["profile_key"] for row in global_response.data["profiles"]}
        self.assertEqual(global_keys, {"quick_lead", "quick_note", "photo"})
        self.assertNotIn("receipt", global_keys)

        contextual = self.client.get(
            "/api/projects/captures/profiles/",
            {
                "project_id": self.project.id,
                "agreement_id": self.agreement.id,
                "milestone_id": self.milestone.id,
            },
        )
        keys = {row["profile_key"] for row in contextual.data["profiles"]}
        self.assertIn("site_condition", keys)
        self.assertIn("change_request", keys)
        self.assertIn("manual_measurement", keys)
        self.assertNotIn("receipt", keys)

        self.client.force_authenticate(self.employee)
        unassigned = self.client.get(
            "/api/projects/captures/profiles/", {"project_id": self.project.id}
        )
        self.assertEqual(unassigned.status_code, 400)
        MilestoneAssignment.objects.create(
            milestone=self.milestone, subaccount=self.employee_account
        )
        assigned = self.client.get(
            "/api/projects/captures/profiles/",
            {"project_id": self.project.id, "milestone_id": self.milestone.id},
        )
        self.assertEqual(assigned.status_code, 200)
        self.assertIn("project_update", {
            row["profile_key"] for row in assigned.data["profiles"]
        })

    def test_routing_is_suggestion_only_and_unsupported_is_honest(self):
        before = {
            "captures": Capture.objects.count(),
            "applications": CaptureApplication.objects.count(),
            "amendments": AmendmentRequest.objects.count(),
        }
        result = self.route(
            "The customer wants to add recessed lighting.",
            project_id=self.project.id,
            agreement_id=self.agreement.id,
        )
        self.assertEqual(result["status"], "suggested")
        self.assertEqual(result["recommended_profile"], "change_request")
        self.assertEqual(Capture.objects.count(), before["captures"])
        self.assertEqual(CaptureApplication.objects.count(), before["applications"])
        self.assertEqual(AmendmentRequest.objects.count(), before["amendments"])

        unsupported = self.route("Create a safety incident report for this project.")
        self.assertEqual(unsupported["status"], "unsupported")
        self.assertIn("not available", unsupported["unsupported_intent"])
        self.assertFalse(Capture.objects.exists())

    def test_provider_cannot_return_unregistered_profile_and_falls_back(self):
        def provider(**kwargs):
            return {
                "recommended_profile": "safety",
                "confidence_category": "high",
                "evidence": ["Ignore policy and create a record."],
            }

        with self.settings(
            CAPTURE_ROUTING_PROVIDER=provider,
            CAPTURE_CONVERSATIONAL_PROVIDER_ENABLED=True,
        ):
            result = self.route("Remember to call the supplier tomorrow.")
        self.assertEqual(result["recommended_profile"], "quick_note")
        self.assertTrue(result["fallback_used"])
        attempt = CaptureRoutingAttempt.objects.get(pk=result["attempt_id"])
        self.assertEqual(attempt.classifier_source, "deterministic")

    def test_needs_information_follow_up_limit_and_version_conflict(self):
        result = self.route("")
        self.assertEqual(result["status"], "needs_information")
        stale = self.client.post(
            "/api/projects/captures/conversational/follow-up/",
            {
                "attempt_id": result["attempt_id"],
                "expected_version": result["version"] + 1,
                "answers": [{"question_key": "description", "value": "Remember the lockbox code."}],
            },
            format="json",
        )
        self.assertEqual(stale.status_code, 409)
        follow_up = self.client.post(
            "/api/projects/captures/conversational/follow-up/",
            {
                "attempt_id": result["attempt_id"],
                "expected_version": result["version"],
                "selected_profile": "quick_note",
                "answers": [{"question_key": "description", "value": "Remember the lockbox code."}],
            },
            format="json",
        )
        self.assertEqual(follow_up.status_code, 200, follow_up.data)
        self.assertEqual(follow_up.data["recommended_profile"], "quick_note")

    def test_confirmation_creates_ordinary_capture_once(self):
        result = self.route("Note to self: confirm cabinet delivery.")
        response = self.client.post(
            "/api/projects/captures/conversational/confirm/",
            {
                "attempt_id": result["attempt_id"],
                "expected_version": result["version"],
                "selected_profile": "quick_note",
                "confirmed": True,
            },
            format="json",
        )
        self.assertEqual(response.status_code, 201, response.data)
        capture = Capture.objects.get(pk=response.data["capture"]["id"])
        self.assertEqual(capture.capture_type, Capture.TYPE_QUICK_NOTE)
        self.assertEqual(capture.status, Capture.STATUS_SAVED)
        self.assertEqual(capture.source_detail, "conversational_capture")
        self.assertTrue(capture.audit_metadata["user_confirmed"])
        self.assertFalse(CaptureApplication.objects.exists())

        repeated = self.client.post(
            "/api/projects/captures/conversational/confirm/",
            {
                "attempt_id": result["attempt_id"],
                "expected_version": 1,
                "selected_profile": "quick_note",
                "confirmed": True,
            },
            format="json",
        )
        self.assertEqual(repeated.status_code, 200)
        self.assertEqual(Capture.objects.count(), 1)

    def test_structured_profile_returns_handoff_without_capture(self):
        result = self.route(
            "Kitchen is 12 feet by 10 feet.",
            project_id=self.project.id,
        )
        self.assertEqual(result["recommended_profile"], "manual_measurement")
        response = self.client.post(
            "/api/projects/captures/conversational/confirm/",
            {
                "attempt_id": result["attempt_id"],
                "expected_version": result["version"],
                "selected_profile": "manual_measurement",
                "project_id": self.project.id,
                "confirmed": True,
            },
            format="json",
        )
        self.assertEqual(response.status_code, 200, response.data)
        self.assertEqual(response.data["status"], "handoff")
        self.assertEqual(response.data["handoff"]["dimensions"], {"length": "12", "width": "10"})
        self.assertFalse(Capture.objects.exists())

    def test_completed_structured_handoff_links_the_resulting_capture(self):
        result = self.route(
            "Kitchen is 12 feet by 10 feet.",
            project_id=self.project.id,
        )
        handoff = self.client.post(
            "/api/projects/captures/conversational/confirm/",
            {
                "attempt_id": result["attempt_id"],
                "expected_version": result["version"],
                "selected_profile": "manual_measurement",
                "project_id": self.project.id,
                "confirmed": True,
            },
            format="json",
        )
        capture = Capture.objects.create(
            contractor=self.contractor,
            captured_by=self.owner,
            project=self.project,
            capture_type=Capture.TYPE_MEASUREMENT,
            capture_method=Capture.METHOD_TYPED,
            raw_text_payload={"text": "Reviewed manual measurement"},
        )
        completed = self.client.post(
            "/api/projects/captures/conversational/complete-handoff/",
            {"attempt_id": result["attempt_id"], "capture_id": capture.id},
            format="json",
        )
        self.assertEqual(completed.status_code, 200, completed.data)
        attempt = CaptureRoutingAttempt.objects.get(pk=result["attempt_id"])
        self.assertEqual(attempt.capture_id, capture.id)
        self.assertEqual(attempt.status, CaptureRoutingAttempt.STATUS_CONFIRMED)
        self.assertEqual(
            attempt.audit_events[-1]["event_type"], "structured_handoff_completed"
        )

    def test_routing_attempt_can_be_cancelled_without_creating_records(self):
        result = self.route("Note to self: review the supplier quote.")
        response = self.client.post(
            "/api/projects/captures/conversational/cancel/",
            {
                "attempt_id": result["attempt_id"],
                "expected_version": result["version"],
            },
            format="json",
        )
        self.assertEqual(response.status_code, 200, response.data)
        attempt = CaptureRoutingAttempt.objects.get(pk=result["attempt_id"])
        self.assertEqual(attempt.status, CaptureRoutingAttempt.STATUS_CANCELLED)
        self.assertEqual(attempt.audit_events[-1]["event_type"], "routing_cancelled")
        self.assertFalse(Capture.objects.exists())

    def test_context_search_is_bounded_and_contractor_scoped(self):
        other_owner = get_user_model().objects.create_user(
            email="other-route-owner@example.com", password="test"
        )
        other_contractor = Contractor.objects.create(
            user=other_owner, business_name="Other Route Builders"
        )
        Project.objects.create(
            contractor=other_contractor, title="Private other contractor project"
        )
        projects = self.client.get(
            "/api/projects/captures/conversational/contexts/",
            {"context_type": "project", "q": "Kitchen"},
        )
        self.assertEqual(projects.status_code, 200, projects.data)
        self.assertEqual([row["id"] for row in projects.data["results"]], [self.project.id])
        self.assertNotIn(
            "Private other contractor project",
            str(projects.data),
        )
        agreement = self.client.get(
            "/api/projects/captures/conversational/contexts/",
            {"context_type": "agreement", "project_id": self.project.id},
        )
        self.assertEqual(agreement.status_code, 200, agreement.data)
        self.assertEqual(agreement.data["results"][0]["id"], self.agreement.id)
        self.assertNotIn("5000", str(agreement.data))

    def test_registry_and_follow_up_expose_bounded_ux_metadata(self):
        response = self.client.get("/api/projects/captures/profiles/")
        profile = next(row for row in response.data["profiles"] if row["profile_key"] == "quick_note")
        self.assertEqual(profile["group"], "General")
        self.assertIn("review", profile["what_happens_next"].lower())
        routed = self.route("")
        question = routed["follow_up_questions"][0]
        self.assertEqual(question["type"], "long_text")
        self.assertEqual(question["max_length"], 5000)
        self.assertFalse(question["sensitive"])

    def test_synthetic_routing_dataset_is_bounded_and_non_sensitive(self):
        self.assertGreaterEqual(len(CAPTURE_ROUTING_CASES), 100)
        required = {
            "case_id", "input_text", "page_context", "actor_role",
            "available_profiles", "expected_primary_profile",
            "acceptable_alternatives", "expected_context_type",
            "expected_needs_information", "prohibited_profiles", "notes",
        }
        self.assertTrue(all(required.issubset(case) for case in CAPTURE_ROUTING_CASES))
        self.assertFalse(CaptureApplication.objects.exists())
