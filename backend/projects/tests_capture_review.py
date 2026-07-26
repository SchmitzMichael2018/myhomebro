from copy import deepcopy

from django.contrib.auth import get_user_model
from django.core.exceptions import ValidationError
from django.test import TestCase, override_settings
from rest_framework.test import APIClient

from projects.models import (
    Capture,
    CaptureApplication,
    Contractor,
    ContractorSubAccount,
    Homeowner,
)


def configured_review_provider(**context):
    raw = context["raw_payload"]
    return {
        "schema_version": "quick_note.v1",
        "title": raw.get("title", ""),
        "body": raw.get("text", ""),
        "suggested_destination": "unassigned_note",
        "destination_candidates": [],
        "follow_up": {"suggested": False, "subject": "", "due_at": None, "source_phrase": ""},
        "missing_fields": [],
        "uncertainties": ["Confirm destination"],
        "warnings": [],
    }


@override_settings(
    SECURE_SSL_REDIRECT=False,
    CAPTURE_FOUNDATION_ENABLED=True,
    CAPTURE_INBOX_ENABLED=True,
    CAPTURE_REVIEW_ENABLED=True,
)
class CaptureReviewTests(TestCase):
    def setUp(self):
        users = get_user_model()
        self.owner = users.objects.create_user(email="review-owner@example.com", password="test")
        self.contractor = Contractor.objects.create(user=self.owner, business_name="Review Builders")
        self.employee = users.objects.create_user(email="review-employee@example.com", password="test")
        ContractorSubAccount.objects.create(
            parent_contractor=self.contractor,
            user=self.employee,
            display_name="Reviewer",
            role=ContractorSubAccount.ROLE_EMPLOYEE_MILESTONES,
        )
        self.other_owner = users.objects.create_user(email="review-other@example.com", password="test")
        self.other_contractor = Contractor.objects.create(user=self.other_owner, business_name="Other")
        self.client = APIClient()
        self.client.force_authenticate(self.owner)

    def capture(self, capture_type=Capture.TYPE_QUICK_LEAD, raw=None, **fields):
        return Capture.objects.create(
            contractor=self.contractor,
            captured_by=fields.pop("captured_by", self.owner),
            capture_type=capture_type,
            status=fields.pop("status", Capture.STATUS_SAVED),
            raw_text_payload=raw or {
                "name": "John Rivera",
                "phone": "281-555-0100",
                "email": "john@example.com",
                "text": "Needs a deck",
            },
            **fields,
        )

    def process(self, capture, **payload):
        return self.client.post(
            f"/api/projects/captures/{capture.id}/process/",
            {"expected_version": capture.version, **payload},
            format="json",
        )

    def test_process_quick_lead_preserves_raw_and_prepares_versioned_review(self):
        capture = self.capture()
        original = deepcopy(capture.raw_text_payload)
        response = self.process(capture)
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.data["capture"]["status"], Capture.STATUS_READY_FOR_REVIEW)
        self.assertEqual(response.data["review"]["schema_version"], "quick_lead.v1")
        self.assertEqual(response.data["review"]["structured_draft"]["person"]["name"], "John Rivera")
        capture.refresh_from_db()
        self.assertEqual(capture.raw_text_payload, original)
        self.assertEqual(capture.version, 3)
        self.assertEqual(
            list(capture.events.values_list("event_type", flat=True)),
            ["status_changed", "draft_prepared"],
        )

    def test_process_quick_note_and_missing_information_transitions(self):
        note = self.capture(
            Capture.TYPE_QUICK_NOTE,
            {"title": "Supplier", "text": "Call tomorrow"},
        )
        response = self.process(note)
        self.assertEqual(response.data["capture"]["status"], Capture.STATUS_READY_FOR_REVIEW)
        self.assertEqual(response.data["review"]["schema_version"], "quick_note.v1")
        missing = self.capture(raw={"name": "", "text": "Unknown person"})
        response = self.process(missing)
        self.assertEqual(response.data["capture"]["status"], Capture.STATUS_NEEDS_INFORMATION)
        self.assertEqual(response.data["review"]["missing_fields"], ["person.name"])

    def test_unsupported_photo_is_rejected_without_status_change(self):
        capture = self.capture(Capture.TYPE_PHOTO, {})
        response = self.process(capture)
        self.assertEqual(response.status_code, 400)
        capture.refresh_from_db()
        self.assertEqual((capture.status, capture.version), (Capture.STATUS_SAVED, 1))
        self.assertFalse(capture.events.exists())

    def test_provider_failure_preserves_saved_capture_and_manual_fallback(self):
        capture = self.capture()
        original = deepcopy(capture.raw_text_payload)
        failed = self.process(capture, mode="provider")
        self.assertEqual(failed.status_code, 503)
        self.assertTrue(failed.data["capture_saved"])
        self.assertEqual(failed.data["capture"]["status"], Capture.STATUS_FAILED)
        capture.refresh_from_db()
        self.assertEqual(capture.raw_text_payload, original)
        retried = self.client.post(
            f"/api/projects/captures/{capture.id}/retry/",
            {"expected_version": capture.version, "mode": "manual"},
            format="json",
        )
        self.assertEqual(retried.status_code, 200)
        self.assertEqual(retried.data["capture"]["processing_engine"], "manual")
        self.assertEqual(retried.data["capture"]["retry_count"], 1)

    @override_settings(CAPTURE_REVIEW_PROVIDER=configured_review_provider)
    def test_configured_project_assistant_provider_is_bounded_and_validated(self):
        capture = self.capture(
            Capture.TYPE_QUICK_NOTE,
            {"title": "Provider note", "text": "Check measurements"},
        )
        response = self.process(capture, mode="provider")
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.data["capture"]["processing_engine"], "project_assistant")
        self.assertEqual(response.data["review"]["uncertainties"], ["Confirm destination"])

    def test_exact_and_strong_duplicates_require_explicit_decision(self):
        exact = Homeowner.objects.create(
            created_by=self.contractor,
            full_name="Johnny Rivera",
            email="john@example.com",
            phone_number="",
        )
        capture = self.capture()
        response = self.process(capture)
        self.assertEqual(response.data["capture"]["status"], Capture.STATUS_POSSIBLE_DUPLICATE)
        candidate = response.data["review"]["duplicate_candidates"][0]
        self.assertEqual(candidate["candidate_id"], exact.id)
        self.assertEqual(candidate["match_strength"], "exact")
        self.assertTrue(response.data["review"]["duplicate_decision_required"])
        draft = response.data["review"]["structured_draft"]
        edited = self.client.patch(
            f"/api/projects/captures/{capture.id}/review/",
            {
                "expected_version": response.data["capture"]["version"],
                "structured_draft": draft,
                "duplicate_decision": {
                    "decision": "link_existing",
                    "candidate_id": exact.id,
                },
            },
            format="json",
        )
        self.assertEqual(edited.data["capture"]["status"], Capture.STATUS_READY_FOR_REVIEW)
        self.assertTrue(edited.data["review"]["can_approve"])

        strong = self.capture(raw={
            "name": "Different Name", "phone": "281-555-0199", "text": "Roof",
        })
        Homeowner.objects.create(
            created_by=self.contractor,
            full_name="Someone Else",
            email="other@example.com",
            phone_number="(281) 555-0199",
        )
        response = self.process(strong)
        self.assertEqual(
            response.data["review"]["duplicate_candidates"][0]["match_strength"],
            "strong",
        )

    def test_advisory_name_match_does_not_block_approval(self):
        Homeowner.objects.create(
            created_by=self.contractor,
            full_name="John River",
            email="existing@example.com",
        )
        response = self.process(self.capture(raw={
            "name": "John Rivera", "email": "new@example.com", "text": "Deck",
        }))
        self.assertEqual(response.data["capture"]["status"], Capture.STATUS_READY_FOR_REVIEW)
        self.assertEqual(
            response.data["review"]["duplicate_candidates"][0]["match_strength"],
            "advisory",
        )
        self.assertFalse(response.data["review"]["duplicate_decision_required"])

    def test_duplicate_search_is_contractor_scoped_and_contacts_are_masked(self):
        Homeowner.objects.create(
            created_by=self.other_contractor,
            full_name="John Rivera",
            email="john@example.com",
            phone_number="2815550100",
        )
        capture = self.capture()
        response = self.client.get(f"/api/projects/captures/{capture.id}/duplicates/")
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.data["duplicate_candidates"], [])

    def test_review_rejects_unknown_schema_fields_and_stale_version(self):
        capture = self.capture()
        processed = self.process(capture)
        draft = processed.data["review"]["structured_draft"]
        invalid = {**draft, "provider_payload": {"secret": "no"}}
        response = self.client.patch(
            f"/api/projects/captures/{capture.id}/review/",
            {"expected_version": 3, "structured_draft": invalid},
            format="json",
        )
        self.assertEqual(response.status_code, 400)
        response = self.client.patch(
            f"/api/projects/captures/{capture.id}/review/",
            {"expected_version": 1, "structured_draft": draft},
            format="json",
        )
        self.assertEqual(response.status_code, 409)
        self.assertEqual(response.data["code"], "capture_version_conflict")
        self.assertEqual(response.data["capture"]["version"], 3)

    def test_review_edit_approval_snapshot_and_no_application(self):
        capture = self.capture()
        processed = self.process(capture)
        draft = processed.data["review"]["structured_draft"]
        draft["opportunity"]["summary"] = "Corrected deck scope"
        edited = self.client.patch(
            f"/api/projects/captures/{capture.id}/review/",
            {"expected_version": 3, "structured_draft": draft},
            format="json",
        )
        approved = self.client.post(
            f"/api/projects/captures/{capture.id}/approve/",
            {"expected_version": edited.data["capture"]["version"]},
            format="json",
        )
        self.assertEqual(approved.status_code, 200)
        self.assertEqual(approved.data["capture"]["status"], Capture.STATUS_APPROVED)
        snapshot = approved.data["capture"]["approved_snapshot"]
        self.assertEqual(snapshot["structured_draft"]["opportunity"]["summary"], "Corrected deck scope")
        self.assertFalse(CaptureApplication.objects.filter(capture=capture).exists())
        capture.refresh_from_db()
        current = deepcopy(capture.approved_snapshot)
        capture.approved_snapshot = {"changed": True}
        with self.assertRaises(ValidationError):
            capture.save()
        capture.refresh_from_db()
        self.assertEqual(capture.approved_snapshot, current)

    def test_approval_rejects_unresolved_missing_fields(self):
        capture = self.capture(raw={"name": "", "text": "Needs work"})
        processed = self.process(capture)
        response = self.client.post(
            f"/api/projects/captures/{capture.id}/approve/",
            {"expected_version": processed.data["capture"]["version"]},
            format="json",
        )
        self.assertEqual(response.status_code, 400)

    def test_creator_and_supervisor_permissions_and_cross_contractor_denials(self):
        own = self.capture(captured_by=self.employee)
        self.client.force_authenticate(self.employee)
        self.assertEqual(self.process(own).status_code, 200)
        foreign = Capture.objects.create(
            contractor=self.other_contractor,
            captured_by=self.other_owner,
            capture_type=Capture.TYPE_QUICK_LEAD,
            status=Capture.STATUS_SAVED,
            raw_text_payload={"name": "Foreign", "text": "Private"},
        )
        endpoints = [
            ("post", "process/", {"expected_version": 1}),
            ("patch", "review/", {"expected_version": 1, "structured_draft": {}}),
            ("post", "approve/", {"expected_version": 1}),
            ("get", "duplicates/", None),
        ]
        for method, suffix, data in endpoints:
            response = getattr(self.client, method)(
                f"/api/projects/captures/{foreign.id}/{suffix}",
                data=data,
                format="json",
            )
            self.assertEqual(response.status_code, 404)

    @override_settings(CAPTURE_REVIEW_ENABLED=False)
    def test_review_feature_disabled_leaves_capture_creation_and_inbox_available(self):
        capture = self.capture()
        self.assertEqual(self.process(capture).status_code, 404)
        self.assertEqual(self.client.get("/api/projects/captures/").status_code, 200)
        capture.refresh_from_db()
        self.assertEqual(capture.status, Capture.STATUS_SAVED)
