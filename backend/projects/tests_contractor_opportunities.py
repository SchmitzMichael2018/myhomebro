from unittest.mock import patch

from django.contrib.auth import get_user_model
from django.test import TestCase, override_settings
from rest_framework.test import APIClient

from projects.models import Agreement, Contractor, Homeowner, Notification
from projects.models_contractor_discovery import (
    ContractorDirectoryDiscovery,
    ContractorDirectoryEntry,
    ContractorOpportunity,
)
from projects.models_project_intake import ProjectIntake
from projects.models_sms import SMSAutomationDecision, SMSConsent
from projects.services.contractor_directory import normalize_business_name


def _use_secure_requests(client):
    client.defaults.update(
        {
            "wsgi.url_scheme": "https",
            "SERVER_PORT": "443",
            "HTTPS": "on",
            "HTTP_X_FORWARDED_PROTO": "https",
        }
    )
    for method_name in ("get", "post", "put", "patch", "delete"):
        original = getattr(client, method_name)

        def secure_method(*args, _original=original, **kwargs):
            kwargs.setdefault("secure", True)
            return _original(*args, **kwargs)

        setattr(client, method_name, secure_method)


class ContractorOpportunityFlowTests(TestCase):
    def setUp(self):
        User = get_user_model()
        self.contractor_user = User.objects.create_user(
            email="contractor@example.com",
            password="test-pass",
        )
        self.contractor = Contractor.objects.create(
            user=self.contractor_user,
            business_name="Austin Concrete Pro",
            phone="512-555-1111",
            city="Austin",
            state="TX",
        )
        self.other_user = User.objects.create_user(
            email="other@example.com",
            password="test-pass",
        )
        self.other_contractor = Contractor.objects.create(
            user=self.other_user,
            business_name="Other Contractor",
        )
        self.admin_user = User.objects.create_user(
            email="admin@example.com",
            password="test-pass",
            is_staff=True,
            is_superuser=True,
        )
        self.entry = ContractorDirectoryEntry.objects.create(
            business_name="Austin Concrete Pro",
            normalized_name=normalize_business_name("Austin Concrete Pro"),
            city="Austin",
            state="TX",
            claimed=True,
            claimed_by_contractor=self.contractor,
            services=["concrete contractor"],
        )
        self.intake = ProjectIntake.objects.create(
            initiated_by="homeowner",
            customer_name="Casey Homeowner",
            customer_email="casey@example.com",
            customer_phone="512-555-2222",
            project_address_line1="123 Main St",
            project_city="Austin",
            project_state="TX",
            project_postal_code="78701",
            accomplishment_text="Extend my concrete patio.",
            ai_description="Extend the concrete patio with a small slab.",
            ai_project_title="Concrete Patio Extension",
            ai_project_type="Concrete",
            ai_project_subtype="Patio",
            desired_timing_text="Within the next month",
        )
        self.intake.ensure_share_token()
        self.client = APIClient()
        _use_secure_requests(self.client)

    def _make_contractor_marketplace_eligible(self, contractor=None):
        contractor = contractor or self.contractor
        contractor.marketplace_verification_status = Contractor.MARKETPLACE_VERIFIED
        contractor.charges_enabled = True
        contractor.payouts_enabled = True
        contractor.details_submitted = True
        contractor.stripe_account_id = contractor.stripe_account_id or f"acct_test_{contractor.id}"
        contractor.stripe_deauthorized_at = None
        contractor.save(
            update_fields=[
                "marketplace_verification_status",
                "charges_enabled",
                "payouts_enabled",
                "details_submitted",
                "stripe_account_id",
                "stripe_deauthorized_at",
                "updated_at",
            ]
        )

    def test_selecting_contractor_creates_pending_opportunity_without_customer_or_agreement(self):
        response = self.client.post(
            "/api/projects/public-intake/select-contractor/",
            {
                "token": self.intake.share_token,
                "selected_contractors": [{"directory_entry_id": self.entry.id, "id": f"directory_entry:{self.entry.id}"}],
            },
            format="json",
        )

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.data["status"], ContractorOpportunity.STATUS_PENDING)
        opportunity = ContractorOpportunity.objects.get()
        self.assertEqual(opportunity.status, ContractorOpportunity.STATUS_PENDING)
        self.assertEqual(opportunity.directory_entry, self.entry)
        self.assertEqual(opportunity.intake_request, self.intake)
        self.assertEqual(opportunity.homeowner_email, "casey@example.com")
        self.assertEqual(Homeowner.objects.count(), 0)
        self.assertEqual(Agreement.objects.count(), 0)

    def test_selecting_contractor_creates_dashboard_notification_and_sms_suppression_without_consent(self):
        response = self.client.post(
            "/api/projects/public-intake/select-contractor/",
            {
                "token": self.intake.share_token,
                "selected_contractors": [{"directory_entry_id": self.entry.id, "id": f"directory_entry:{self.entry.id}"}],
            },
            format="json",
        )

        self.assertEqual(response.status_code, 200)
        opportunity = ContractorOpportunity.objects.get()
        notification = Notification.objects.get(
            contractor=self.contractor,
            category=Notification.EVENT_CONTRACTOR_OPPORTUNITY_RECEIVED,
        )
        self.assertIn(str(opportunity.id), notification.link)
        self.assertIn("Concrete Patio Extension", notification.message)

        decision = SMSAutomationDecision.objects.get(event_type="contractor_opportunity_received")
        self.assertEqual(decision.contractor, self.contractor)
        self.assertEqual(decision.phone_number_e164, "+15125551111")
        self.assertEqual(decision.reason_code, "no_consent")
        self.assertFalse(decision.sent)

    @override_settings(
        TWILIO_ACCOUNT_SID="",
        TWILIO_AUTH_TOKEN="",
        TWILIO_MESSAGING_SERVICE_SID="",
        TWILIO_PHONE_NUMBER="",
        TWILIO_FROM_NUMBER="",
    )
    @patch("projects.services.sms_automation._in_quiet_hours", return_value=False)
    def test_selecting_contractor_records_retryable_sms_failure_when_provider_missing(self, _quiet_hours):
        SMSConsent.objects.create(
            phone_number_e164="+15125551111",
            contractor=self.contractor,
            can_send_sms=True,
            opted_out=False,
            opted_in_source=SMSConsent.OPT_IN_SOURCE_ADMIN,
            consent_text_snapshot="Admin confirmed contractor SMS consent.",
        )

        response = self.client.post(
            "/api/projects/public-intake/select-contractor/",
            {"token": self.intake.share_token, "selected_contractors": [{"directory_entry_id": self.entry.id}]},
            format="json",
        )

        self.assertEqual(response.status_code, 200)
        decision = SMSAutomationDecision.objects.get(event_type="contractor_opportunity_received")
        self.assertEqual(decision.phone_number_e164, "+15125551111")
        self.assertEqual(decision.reason_code, "send_failed")
        self.assertFalse(decision.sent)
        self.assertIn("twilio_config_missing", str(decision.decision_context_json))

    def test_selecting_contractor_generates_project_title_when_missing(self):
        self.intake.ai_project_title = ""
        self.intake.ai_project_type = "Flooring"
        self.intake.ai_project_subtype = ""
        self.intake.accomplishment_text = "Replace old flooring in the living room."
        self.intake.ai_description = "Replace old flooring in the living room with contractor review."
        self.intake.save(
            update_fields=[
                "ai_project_title",
                "ai_project_type",
                "ai_project_subtype",
                "accomplishment_text",
                "ai_description",
                "updated_at",
            ]
        )

        response = self.client.post(
            "/api/projects/public-intake/select-contractor/",
            {"token": self.intake.share_token, "selected_contractors": [{"directory_entry_id": self.entry.id}]},
            format="json",
        )

        self.assertEqual(response.status_code, 200)
        opportunity = ContractorOpportunity.objects.get()
        self.assertEqual(opportunity.project_title, "Flooring Replacement Project")
        self.assertNotEqual(opportunity.project_title.lower(), "untitled project")

        self._make_contractor_marketplace_eligible()
        self.client.force_authenticate(self.contractor_user)
        accept = self.client.post(f"/api/projects/contractor-opportunities/{opportunity.id}/accept/", {}, format="json")

        self.assertEqual(accept.status_code, 200)
        agreement = Agreement.objects.get()
        self.assertEqual(agreement.project.title, "Flooring Replacement Project")

    def test_selecting_same_contractor_and_intake_twice_does_not_duplicate(self):
        payload = {
            "token": self.intake.share_token,
            "selected_contractors": [{"directory_entry_id": self.entry.id}],
        }
        first = self.client.post("/api/projects/public-intake/select-contractor/", payload, format="json")
        second = self.client.post("/api/projects/public-intake/select-contractor/", payload, format="json")

        self.assertEqual(first.status_code, 200)
        self.assertEqual(second.status_code, 200)
        self.assertEqual(ContractorOpportunity.objects.count(), 1)
        self.assertEqual(Notification.objects.filter(category=Notification.EVENT_CONTRACTOR_OPPORTUNITY_RECEIVED).count(), 1)
        self.assertEqual(SMSAutomationDecision.objects.filter(event_type="contractor_opportunity_received").count(), 1)
        self.assertEqual(first.data["opportunity_id"], second.data["opportunity_id"])

    def test_selected_discovery_record_is_marked_selected(self):
        discovery = ContractorDirectoryDiscovery.objects.create(
            directory_entry=self.entry,
            intake_request=self.intake,
            source_type=ContractorDirectoryDiscovery.SOURCE_PUBLIC_INTAKE,
        )
        response = self.client.post(
            "/api/projects/public-intake/select-contractor/",
            {"token": self.intake.share_token, "selected_contractors": [{"directory_entry_id": self.entry.id}]},
            format="json",
        )

        self.assertEqual(response.status_code, 200)
        discovery.refresh_from_db()
        self.assertTrue(discovery.selected_by_homeowner)

    def test_accepting_opportunity_creates_customer_and_draft_agreement_idempotently(self):
        self.client.post(
            "/api/projects/public-intake/select-contractor/",
            {"token": self.intake.share_token, "selected_contractors": [{"directory_entry_id": self.entry.id}]},
            format="json",
        )
        opportunity = ContractorOpportunity.objects.get()
        self._make_contractor_marketplace_eligible()
        self.client.force_authenticate(self.contractor_user)

        first = self.client.post(f"/api/projects/contractor-opportunities/{opportunity.id}/accept/", {}, format="json")
        second = self.client.post(f"/api/projects/contractor-opportunities/{opportunity.id}/accept/", {}, format="json")

        self.assertEqual(first.status_code, 200)
        self.assertEqual(second.status_code, 200)
        opportunity.refresh_from_db()
        self.assertEqual(opportunity.status, ContractorOpportunity.STATUS_CONVERTED)
        self.assertEqual(Homeowner.objects.count(), 1)
        self.assertEqual(Agreement.objects.count(), 1)
        agreement = Agreement.objects.get()
        self.assertEqual(agreement.status, "draft")
        self.assertEqual(agreement.contractor, self.contractor)
        self.assertEqual(agreement.homeowner.email, "casey@example.com")
        self.assertEqual(first.data["agreement_id"], second.data["agreement_id"])
        self.assertIn("/app/agreements/", first.data["next_url"])

    def test_unrelated_contractor_cannot_accept_opportunity(self):
        self.client.post(
            "/api/projects/public-intake/select-contractor/",
            {"token": self.intake.share_token, "selected_contractors": [{"directory_entry_id": self.entry.id}]},
            format="json",
        )
        opportunity = ContractorOpportunity.objects.get()
        self.client.force_authenticate(self.other_user)

        response = self.client.post(f"/api/projects/contractor-opportunities/{opportunity.id}/accept/", {}, format="json")

        self.assertEqual(response.status_code, 403)
        self.assertEqual(Homeowner.objects.count(), 0)
        self.assertEqual(Agreement.objects.count(), 0)

    def test_unverified_contractor_cannot_accept_opportunity(self):
        self.client.post(
            "/api/projects/public-intake/select-contractor/",
            {"token": self.intake.share_token, "selected_contractors": [{"directory_entry_id": self.entry.id}]},
            format="json",
        )
        opportunity = ContractorOpportunity.objects.get()
        self.client.force_authenticate(self.contractor_user)

        response = self.client.post(f"/api/projects/contractor-opportunities/{opportunity.id}/accept/", {}, format="json")

        self.assertEqual(response.status_code, 403)
        self.assertIn("not verified", response.data["detail"].lower())
        self.assertEqual(Homeowner.objects.count(), 0)
        self.assertEqual(Agreement.objects.count(), 0)

    def test_stripe_incomplete_contractor_cannot_accept_opportunity(self):
        self.contractor.marketplace_verification_status = Contractor.MARKETPLACE_VERIFIED
        self.contractor.charges_enabled = True
        self.contractor.payouts_enabled = False
        self.contractor.save(
            update_fields=[
                "marketplace_verification_status",
                "charges_enabled",
                "payouts_enabled",
                "updated_at",
            ]
        )
        self.client.post(
            "/api/projects/public-intake/select-contractor/",
            {"token": self.intake.share_token, "selected_contractors": [{"directory_entry_id": self.entry.id}]},
            format="json",
        )
        opportunity = ContractorOpportunity.objects.get()
        self.client.force_authenticate(self.contractor_user)

        response = self.client.post(f"/api/projects/contractor-opportunities/{opportunity.id}/accept/", {}, format="json")

        self.assertEqual(response.status_code, 403)
        self.assertIn("stripe setup", response.data["detail"].lower())
        self.assertEqual(Homeowner.objects.count(), 0)
        self.assertEqual(Agreement.objects.count(), 0)

    def test_admin_can_list_opportunities(self):
        self.client.post(
            "/api/projects/public-intake/select-contractor/",
            {"token": self.intake.share_token, "selected_contractors": [{"directory_entry_id": self.entry.id}]},
            format="json",
        )
        self.client.force_authenticate(self.admin_user)

        response = self.client.get("/api/projects/admin/contractor-opportunities/", {"status": "pending"})

        self.assertEqual(response.status_code, 200)
        self.assertEqual(len(response.data["results"]), 1)
        self.assertEqual(response.data["results"][0]["contractor_business_name"], "Austin Concrete Pro")
        self.assertEqual(response.data["results"][0]["homeowner_email"], "casey@example.com")

    def test_contractor_only_sees_own_opportunities_and_status_filtering(self):
        self.client.post(
            "/api/projects/public-intake/select-contractor/",
            {"token": self.intake.share_token, "selected_contractors": [{"directory_entry_id": self.entry.id}]},
            format="json",
        )
        other_entry = ContractorDirectoryEntry.objects.create(
            business_name="Other Claimed Entry",
            normalized_name=normalize_business_name("Other Claimed Entry"),
            claimed=True,
            claimed_by_contractor=self.other_contractor,
        )
        ContractorOpportunity.objects.create(
            directory_entry=other_entry,
            homeowner_name="Other Homeowner",
            homeowner_email="other-homeowner@example.com",
            project_title="Other Project",
            status=ContractorOpportunity.STATUS_PENDING,
        )
        self.client.force_authenticate(self.contractor_user)

        response = self.client.get("/api/projects/contractor-opportunities/", {"status": "submitted"})

        self.assertEqual(response.status_code, 200)
        self.assertEqual(len(response.data["results"]), 1)
        self.assertEqual(response.data["results"][0]["customer_email"], "casey@example.com")
        self.assertEqual(response.data["results"][0]["status"], "submitted")

    def test_converted_opportunities_return_agreement_info(self):
        self.client.post(
            "/api/projects/public-intake/select-contractor/",
            {"token": self.intake.share_token, "selected_contractors": [{"directory_entry_id": self.entry.id}]},
            format="json",
        )
        opportunity = ContractorOpportunity.objects.get()
        self._make_contractor_marketplace_eligible()
        self.client.force_authenticate(self.contractor_user)
        accept = self.client.post(f"/api/projects/contractor-opportunities/{opportunity.id}/accept/", {}, format="json")
        self.assertEqual(accept.status_code, 200)

        response = self.client.get("/api/projects/contractor-opportunities/", {"status": "awarded"})

        self.assertEqual(response.status_code, 200)
        self.assertEqual(len(response.data["results"]), 1)
        self.assertEqual(response.data["results"][0]["status"], "awarded")
        self.assertIsNotNone(response.data["results"][0]["linked_agreement_id"])
        self.assertIn("/app/agreements/", response.data["results"][0]["linked_agreement_url"])
