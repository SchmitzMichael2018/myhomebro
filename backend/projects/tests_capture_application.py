from copy import deepcopy
from datetime import timedelta
from unittest.mock import patch
from uuid import uuid4

from django.contrib.auth import get_user_model
from django.core.exceptions import ValidationError
from django.db import IntegrityError, transaction
from django.test import TestCase, override_settings
from django.utils import timezone
from rest_framework.test import APIClient

from projects.models import (
    Agreement,
    Capture,
    CaptureApplication,
    Contractor,
    ContractorSubAccount,
    CustomerCommunicationLog,
    Homeowner,
    Project,
)
from projects.models_contractor_discovery import (
    ContractorOpportunity,
    OpportunityEstimateAppointment,
)


@override_settings(
    SECURE_SSL_REDIRECT=False,
    CAPTURE_FOUNDATION_ENABLED=True,
    CAPTURE_INBOX_ENABLED=True,
    CAPTURE_REVIEW_ENABLED=True,
    CAPTURE_APPLICATION_ENABLED=True,
)
class CaptureApplicationTests(TestCase):
    def setUp(self):
        users = get_user_model()
        self.owner = users.objects.create_user(email="apply-owner@example.com", password="test")
        self.contractor = Contractor.objects.create(user=self.owner, business_name="Apply Builders")
        self.other_owner = users.objects.create_user(email="apply-other@example.com", password="test")
        self.other_contractor = Contractor.objects.create(user=self.other_owner, business_name="Other Builders")
        self.employee = users.objects.create_user(email="apply-employee@example.com", password="test")
        ContractorSubAccount.objects.create(
            parent_contractor=self.contractor,
            user=self.employee,
            display_name="Employee",
            role=ContractorSubAccount.ROLE_EMPLOYEE_MILESTONES,
        )
        self.supervisor = users.objects.create_user(email="apply-supervisor@example.com", password="test")
        ContractorSubAccount.objects.create(
            parent_contractor=self.contractor,
            user=self.supervisor,
            display_name="Supervisor",
            role=ContractorSubAccount.ROLE_EMPLOYEE_SUPERVISOR,
        )
        self.client = APIClient()
        self.client.force_authenticate(self.owner)

    def lead_snapshot(self, *, name="John Smith", email="john@example.com", phone="281-555-0100", decision=None, follow_up=False):
        due_at = (timezone.now() + timedelta(days=2)).isoformat() if follow_up else None
        return {
            "schema_version": "quick_lead.v1",
            "capture_version": 4,
            "structured_draft": {
                "schema_version": "quick_lead.v1",
                "person": {"name": name, "email": email, "phone": phone},
                "opportunity": {
                    "title": "Deck project",
                    "summary": "Build a replacement deck",
                    "project_type": "Deck",
                    "location_text": "123 Main St",
                },
                "follow_up": {
                    "suggested": follow_up,
                    "subject": "Call John",
                    "due_at": due_at,
                    "source_phrase": "Call in two days",
                },
                "proposed_destinations": ["customer", "opportunity"],
                "missing_fields": [],
                "uncertainties": [],
                "warnings": [],
            },
            "review_decisions": {"duplicate": decision} if decision else {},
            "approved_by_id": self.owner.id,
            "approved_at": timezone.now().isoformat(),
        }

    def note_snapshot(self, *, destination="unassigned_note", follow_up=False):
        return {
            "schema_version": "quick_note.v1",
            "capture_version": 4,
            "structured_draft": {
                "schema_version": "quick_note.v1",
                "title": "Supplier note",
                "body": "Call the supplier tomorrow",
                "suggested_destination": destination,
                "destination_candidates": [],
                "follow_up": {
                    "suggested": follow_up,
                    "subject": "Supplier follow-up",
                    "due_at": (timezone.now() + timedelta(days=1)).isoformat() if follow_up else None,
                    "source_phrase": "tomorrow",
                },
                "missing_fields": [],
                "uncertainties": [],
                "warnings": [],
            },
            "review_decisions": {},
            "approved_by_id": self.owner.id,
            "approved_at": timezone.now().isoformat(),
        }

    def capture(self, capture_type=Capture.TYPE_QUICK_LEAD, snapshot=None, **fields):
        return Capture.objects.create(
            contractor=self.contractor,
            captured_by=fields.pop("captured_by", self.owner),
            capture_type=capture_type,
            status=fields.pop("status", Capture.STATUS_APPROVED),
            version=fields.pop("version", 5),
            raw_text_payload=fields.pop("raw_text_payload", {"name": "Forged raw value"}),
            structured_draft=deepcopy((snapshot or self.lead_snapshot())["structured_draft"]),
            approved_snapshot=deepcopy(snapshot or self.lead_snapshot()),
            approved_by=self.owner,
            approved_at=timezone.now(),
            **fields,
        )

    def lead_payload(self, capture, *, key=None, follow_up=False, confirmed=True):
        destinations = ["customer", "opportunity"] + (["follow_up"] if follow_up else [])
        return {
            "expected_version": capture.version,
            "idempotency_key": key or str(uuid4()),
            "destinations": destinations,
            "adapter_versions": {name: "1" for name in destinations},
            "application_options": {"include_follow_up": follow_up},
            "confirmed": confirmed,
        }

    def note_payload(self, capture, destination="unassigned_note", *, customer_id=None, follow_up=False, key=None):
        destinations = [destination] + (["follow_up"] if follow_up else [])
        return {
            "expected_version": capture.version,
            "idempotency_key": key or str(uuid4()),
            "destinations": destinations,
            "adapter_versions": {name: "1" for name in destinations},
            "application_options": {
                "include_follow_up": follow_up,
                **({"customer_id": customer_id} if customer_id else {}),
            },
            "confirmed": True,
        }

    def test_preview_is_non_mutating_and_uses_approved_fields(self):
        capture = self.capture()
        before = {
            "customers": Homeowner.objects.count(),
            "opportunities": ContractorOpportunity.objects.count(),
            "applications": CaptureApplication.objects.count(),
        }
        payload = self.lead_payload(capture)
        response = self.client.post(
            f"/api/projects/captures/{capture.id}/application-preview/",
            payload,
            format="json",
        )
        self.assertEqual(response.status_code, 200)
        self.assertTrue(response.data["valid"])
        self.assertEqual([row["record_type"] for row in response.data["records"]], ["customer", "opportunity"])
        self.assertEqual(response.data["records"][0]["fields"]["name"], "John Smith")
        self.assertEqual(before, {
            "customers": Homeowner.objects.count(),
            "opportunities": ContractorOpportunity.objects.count(),
            "applications": CaptureApplication.objects.count(),
        })

    def test_apply_requires_approved_confirmation_version_and_known_adapters(self):
        saved = self.capture(status=Capture.STATUS_SAVED)
        self.assertEqual(
            self.client.post(
                f"/api/projects/captures/{saved.id}/apply/",
                self.lead_payload(saved),
                format="json",
            ).status_code,
            400,
        )
        capture = self.capture()
        missing = self.lead_payload(capture, confirmed=False)
        self.assertEqual(self.client.post(f"/api/projects/captures/{capture.id}/apply/", missing, format="json").status_code, 400)
        stale = self.lead_payload(capture)
        stale["expected_version"] = 2
        self.assertEqual(self.client.post(f"/api/projects/captures/{capture.id}/apply/", stale, format="json").status_code, 409)
        wrong = self.lead_payload(capture)
        wrong["adapter_versions"]["customer"] = "99"
        self.assertEqual(self.client.post(f"/api/projects/captures/{capture.id}/apply/", wrong, format="json").status_code, 400)
        unknown = self.lead_payload(capture)
        unknown["destinations"].append("expense")
        unknown["adapter_versions"]["expense"] = "1"
        self.assertEqual(self.client.post(f"/api/projects/captures/{capture.id}/apply/", unknown, format="json").status_code, 400)

    def test_quick_lead_applies_customer_and_opportunity_only(self):
        capture = self.capture()
        response = self.client.post(
            f"/api/projects/captures/{capture.id}/apply/",
            self.lead_payload(capture),
            format="json",
        )
        self.assertEqual(response.status_code, 200)
        capture.refresh_from_db()
        self.assertEqual(capture.status, Capture.STATUS_APPLIED)
        customer = Homeowner.objects.get(origin_capture=capture)
        opportunity = ContractorOpportunity.objects.get(origin_capture=capture)
        self.assertEqual(opportunity.customer, customer)
        self.assertIsNone(opportunity.converted_customer)
        self.assertEqual(opportunity.project_description, "Build a replacement deck")
        self.assertFalse(Project.objects.exists())
        self.assertFalse(Agreement.objects.exists())
        self.assertFalse(OpportunityEstimateAppointment.objects.exists())
        self.assertEqual([row["type"] for row in response.data["application"]["created_records"]], ["customer", "opportunity"])

    def test_customer_email_phone_and_name_only_compatibility(self):
        for index, values in enumerate([
            {"email": "email-only@example.com", "phone": ""},
            {"email": "", "phone": "281-555-0199"},
            {"email": "", "phone": ""},
        ]):
            snapshot = self.lead_snapshot(
                name=f"Person {index}",
                email=values["email"],
                phone=values["phone"],
            )
            capture = self.capture(snapshot=snapshot)
            response = self.client.post(
                f"/api/projects/captures/{capture.id}/apply/",
                self.lead_payload(capture),
                format="json",
            )
            self.assertEqual(response.status_code, 200)
        customers = list(Homeowner.objects.order_by("id"))
        self.assertFalse(customers[0].contact_information_needed)
        self.assertFalse(customers[1].contact_information_needed)
        self.assertTrue(customers[2].contact_information_needed)
        self.assertEqual(customers[1].normalized_phone, "2815550199")
        self.assertEqual(customers[2].email, "")

    def test_non_empty_email_uniqueness_is_contractor_scoped_and_normalized(self):
        Homeowner.objects.create(created_by=self.contractor, full_name="One", email="Same@Example.com")
        with self.assertRaises(IntegrityError):
            with transaction.atomic():
                Homeowner.objects.create(created_by=self.contractor, full_name="Two", email="same@example.com")
        other = Homeowner.objects.create(created_by=self.other_contractor, full_name="Other", email="same@example.com")
        self.assertEqual(other.normalized_email, "same@example.com")
        Homeowner.objects.create(created_by=self.contractor, full_name="No Email One", email="")
        Homeowner.objects.create(created_by=self.contractor, full_name="No Email Two", email="")

    def test_approved_duplicate_link_is_honored_without_identity_mutation(self):
        customer = Homeowner.objects.create(
            created_by=self.contractor,
            full_name="Existing John",
            email="existing@example.com",
        )
        decision = {"decision": "link_existing", "candidate_id": customer.id}
        snapshot = self.lead_snapshot(decision=decision)
        capture = self.capture(snapshot=snapshot, duplicate_candidates=[{
            "candidate_id": customer.id,
            "match_strength": "exact",
        }])
        payload = self.lead_payload(capture)
        payload["application_options"]["duplicate_resolution"] = {
            "action": "link",
            "customer_id": customer.id,
        }
        response = self.client.post(f"/api/projects/captures/{capture.id}/apply/", payload, format="json")
        self.assertEqual(response.status_code, 200)
        self.assertEqual(Homeowner.objects.filter(created_by=self.contractor).count(), 1)
        opportunity = ContractorOpportunity.objects.get(origin_capture=capture)
        self.assertEqual(opportunity.customer, customer)
        customer.refresh_from_db()
        self.assertEqual(customer.email, "existing@example.com")
        self.assertEqual(response.data["receipt"]["duplicate_decision"], decision)

    def test_unresolved_strong_duplicate_blocks_apply(self):
        capture = self.capture(duplicate_candidates=[{"candidate_id": 99, "match_strength": "strong"}])
        response = self.client.post(
            f"/api/projects/captures/{capture.id}/apply/",
            self.lead_payload(capture),
            format="json",
        )
        self.assertEqual(response.status_code, 400)
        self.assertFalse(Homeowner.objects.exists())

    def test_follow_up_is_opt_in_and_requires_approved_due_date(self):
        capture = self.capture(snapshot=self.lead_snapshot(follow_up=True))
        response = self.client.post(
            f"/api/projects/captures/{capture.id}/apply/",
            self.lead_payload(capture, follow_up=True),
            format="json",
        )
        self.assertEqual(response.status_code, 200)
        follow_up = CustomerCommunicationLog.objects.get(origin_capture=capture)
        self.assertIsNotNone(follow_up.follow_up_at)
        self.assertEqual(follow_up.opportunity.origin_capture, capture)

        no_due = self.capture(snapshot=self.lead_snapshot(follow_up=False))
        payload = self.lead_payload(no_due, follow_up=True)
        response = self.client.post(f"/api/projects/captures/{no_due.id}/apply/", payload, format="json")
        self.assertEqual(response.status_code, 400)
        self.assertFalse(Homeowner.objects.filter(origin_capture=no_due).exists())

    def test_idempotent_replay_and_already_applied_return_one_receipt(self):
        capture = self.capture()
        key = str(uuid4())
        payload = self.lead_payload(capture, key=key)
        first = self.client.post(f"/api/projects/captures/{capture.id}/apply/", payload, format="json")
        self.assertEqual(first.status_code, 200)
        second = self.client.post(f"/api/projects/captures/{capture.id}/apply/", payload, format="json")
        self.assertEqual(second.status_code, 200)
        self.assertTrue(second.data["idempotent_replay"])
        self.assertEqual(first.data["receipt"], second.data["receipt"])
        self.assertEqual(Homeowner.objects.filter(origin_capture=capture).count(), 1)
        self.assertEqual(ContractorOpportunity.objects.filter(origin_capture=capture).count(), 1)
        capture.refresh_from_db()
        different = self.lead_payload(capture, key=str(uuid4()))
        third = self.client.post(f"/api/projects/captures/{capture.id}/apply/", different, format="json")
        self.assertEqual(third.status_code, 200)
        self.assertTrue(third.data["idempotent_replay"])
        self.assertEqual(CaptureApplication.objects.filter(capture=capture).count(), 1)

    def test_conflicting_idempotency_key_returns_409(self):
        capture = self.capture()
        key = str(uuid4())
        payload = self.lead_payload(capture, key=key)
        self.client.post(f"/api/projects/captures/{capture.id}/apply/", payload, format="json")
        capture.refresh_from_db()
        conflicting = self.lead_payload(capture, key=key)
        conflicting["application_options"]["customer_id"] = 999
        response = self.client.post(f"/api/projects/captures/{capture.id}/apply/", conflicting, format="json")
        self.assertEqual(response.status_code, 409)
        self.assertEqual(response.data["code"], "capture_idempotency_conflict")

    def test_atomic_failure_rolls_back_records_and_retry_succeeds(self):
        capture = self.capture()
        with patch(
            "projects.services.capture_adapters.opportunity.OpportunityAdapter.apply",
            side_effect=RuntimeError("sensitive internal error"),
        ):
            failed = self.client.post(
                f"/api/projects/captures/{capture.id}/apply/",
                self.lead_payload(capture),
                format="json",
            )
        self.assertEqual(failed.status_code, 422)
        self.assertNotContains(failed, "sensitive internal error", status_code=422)
        capture.refresh_from_db()
        self.assertEqual(capture.status, Capture.STATUS_APPLY_FAILED)
        self.assertFalse(Homeowner.objects.filter(origin_capture=capture).exists())
        self.assertFalse(ContractorOpportunity.objects.filter(origin_capture=capture).exists())
        retry = self.client.post(
            f"/api/projects/captures/{capture.id}/apply/",
            self.lead_payload(capture, key=str(uuid4())),
            format="json",
        )
        self.assertEqual(retry.status_code, 200)
        capture.refresh_from_db()
        self.assertEqual(capture.status, Capture.STATUS_APPLIED)
        self.assertEqual(CaptureApplication.objects.filter(capture=capture).count(), 2)

    def test_receipt_and_events_are_immutable_and_append_only(self):
        capture = self.capture()
        response = self.client.post(
            f"/api/projects/captures/{capture.id}/apply/",
            self.lead_payload(capture),
            format="json",
        )
        application = CaptureApplication.objects.get(capture=capture)
        self.assertNotIn("idempotency_key", response.data["receipt"])
        self.assertIn("idempotency_reference", response.data["receipt"])
        application.receipt_payload = {"changed": True}
        with self.assertRaises(ValidationError):
            application.save()
        event = capture.events.filter(event_type="application_completed").get()
        event.reason = "changed"
        with self.assertRaises(ValidationError):
            event.save()

    def test_quick_note_unassigned_creates_receipt_without_domain_note(self):
        snapshot = self.note_snapshot()
        capture = self.capture(Capture.TYPE_QUICK_NOTE, snapshot=snapshot)
        response = self.client.post(
            f"/api/projects/captures/{capture.id}/apply/",
            self.note_payload(capture),
            format="json",
        )
        self.assertEqual(response.status_code, 200)
        self.assertFalse(CustomerCommunicationLog.objects.filter(origin_capture=capture).exists())
        self.assertEqual(response.data["receipt"]["linked_records"][0]["type"], "capture_note")

    def test_quick_note_customer_note_and_optional_follow_up(self):
        customer = Homeowner.objects.create(
            created_by=self.contractor, full_name="Note Customer", email=""
        )
        snapshot = self.note_snapshot(destination="customer_note", follow_up=True)
        capture = self.capture(Capture.TYPE_QUICK_NOTE, snapshot=snapshot)
        response = self.client.post(
            f"/api/projects/captures/{capture.id}/apply/",
            self.note_payload(
                capture,
                "customer_note",
                customer_id=customer.id,
                follow_up=True,
            ),
            format="json",
        )
        self.assertEqual(response.status_code, 200)
        note = CustomerCommunicationLog.objects.get(origin_capture=capture)
        self.assertEqual(note.customer, customer)
        self.assertEqual(note.visibility, CustomerCommunicationLog.VISIBILITY_INTERNAL_ONLY)
        self.assertIsNotNone(note.follow_up_at)
        self.assertEqual(CustomerCommunicationLog.objects.filter(origin_capture=capture).count(), 1)

    def test_permissions_and_cross_contractor_customer_are_enforced(self):
        employee_capture = self.capture(captured_by=self.employee)
        self.client.force_authenticate(self.employee)
        response = self.client.post(
            f"/api/projects/captures/{employee_capture.id}/application-preview/",
            self.lead_payload(employee_capture),
            format="json",
        )
        self.assertEqual(response.status_code, 403)

        foreign_customer = Homeowner.objects.create(
            created_by=self.other_contractor, full_name="Foreign", email=""
        )
        note = self.capture(
            Capture.TYPE_QUICK_NOTE,
            snapshot=self.note_snapshot(destination="customer_note"),
        )
        self.client.force_authenticate(self.owner)
        response = self.client.post(
            f"/api/projects/captures/{note.id}/apply/",
            self.note_payload(note, "customer_note", customer_id=foreign_customer.id),
            format="json",
        )
        self.assertEqual(response.status_code, 400)
        self.assertFalse(CustomerCommunicationLog.objects.filter(origin_capture=note).exists())

        foreign_capture = Capture.objects.create(
            contractor=self.other_contractor,
            captured_by=self.other_owner,
            capture_type=Capture.TYPE_QUICK_LEAD,
            status=Capture.STATUS_APPROVED,
            version=5,
            approved_snapshot=self.lead_snapshot(),
        )
        self.assertEqual(
            self.client.post(
                f"/api/projects/captures/{foreign_capture.id}/apply/",
                self.lead_payload(foreign_capture),
                format="json",
            ).status_code,
            404,
        )

    @override_settings(CAPTURE_APPLICATION_ENABLED=False)
    def test_application_feature_disabled_preserves_approved_capture(self):
        capture = self.capture()
        preview = self.client.post(
            f"/api/projects/captures/{capture.id}/application-preview/",
            self.lead_payload(capture),
            format="json",
        )
        apply = self.client.post(
            f"/api/projects/captures/{capture.id}/apply/",
            self.lead_payload(capture),
            format="json",
        )
        self.assertEqual(preview.status_code, 404)
        self.assertEqual(apply.data["code"], "capture_application_disabled")
        capture.refresh_from_db()
        self.assertEqual(capture.status, Capture.STATUS_APPROVED)
        self.assertFalse(CaptureApplication.objects.filter(capture=capture).exists())
