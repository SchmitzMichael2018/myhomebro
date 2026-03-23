from __future__ import annotations
from types import SimpleNamespace
from unittest.mock import patch

from django.contrib.auth import get_user_model
from django.core.files.uploadedfile import SimpleUploadedFile
from django.test import TestCase, override_settings
from django.urls import resolve
from django.utils import timezone
from rest_framework.test import APIClient

from projects.api.ai_agreement_views import ai_suggest_milestones
from projects.models import (
    Agreement,
    Contractor,
    ContractorSubAccount,
    Homeowner,
    Milestone,
    MilestoneAssignment,
    MilestoneComment,
    MilestoneFile,
    Notification,
    Project,
    SubcontractorCompletionStatus,
)
from projects.models import AgreementWarranty
from projects.models_sms import SMSConsentStatus
from projects.models_subcontractor import (
    SubcontractorInvitation,
    SubcontractorInvitationStatus,
)
from projects.models_dispute import Dispute


class AgreementMilestoneAIRouteTests(TestCase):
    def setUp(self):
        self.pdf_task_patcher = patch(
            "projects.signals.task_generate_full_agreement_pdf.delay",
            return_value=None,
        )
        self.pdf_task_patcher.start()
        self.addCleanup(self.pdf_task_patcher.stop)

        user_model = get_user_model()
        self.user = user_model.objects.create_user(
            email="contractor@example.com",
            password="testpass123",
        )
        self.contractor = Contractor.objects.create(
            user=self.user,
            business_name="Test Contractor",
        )
        self.homeowner = Homeowner.objects.create(
            created_by=self.contractor,
            full_name="Homeowner Test",
            email="homeowner@example.com",
        )
        self.project = Project.objects.create(
            contractor=self.contractor,
            homeowner=self.homeowner,
            title="Agreement AI Test Project",
        )
        self.agreement = Agreement.objects.create(
            project=self.project,
            contractor=self.contractor,
            homeowner=self.homeowner,
            description="Test agreement",
        )
        self.client = APIClient()
        self.client.force_authenticate(user=self.user)

    def test_ai_suggest_milestones_route_and_contract(self):
        path = f"/api/projects/agreements/{self.agreement.id}/ai/suggest-milestones/"
        match = resolve(path)
        self.assertIs(getattr(match.func, "cls", None), getattr(ai_suggest_milestones, "cls", None))

        with override_settings(AI_ENABLED=True):
            with patch(
                "projects.api.ai_agreement_views.suggest_scope_and_milestones",
                return_value={
                    "scope_text": "Scope from AI",
                    "milestones": [{"title": "Milestone 1", "amount": "100.00"}],
                    "questions": [{"key": "permits_responsibility", "label": "Who handles permits?"}],
                    "_model": "test-model",
                },
            ) as mock_suggest:
                response = self.client.post(path, {"notes": "Please suggest milestones"}, format="json")

        self.assertEqual(response.status_code, 200)
        data = response.json()

        self.assertEqual(data["scope_text"], "Scope from AI")
        self.assertIsInstance(data["milestones"], list)
        self.assertIsInstance(data["questions"], list)
        self.assertEqual(data["ai_access"], "included")
        self.assertTrue(data["ai_enabled"])
        self.assertTrue(data["ai_unlimited"])

        mock_suggest.assert_called_once_with(agreement=self.agreement, notes="Please suggest milestones")


class AgreementWarrantyApiTests(TestCase):
    def setUp(self):
        self.pdf_task_patcher = patch(
            "projects.signals.task_generate_full_agreement_pdf.delay",
            return_value=None,
        )
        self.pdf_task_patcher.start()
        self.addCleanup(self.pdf_task_patcher.stop)

        user_model = get_user_model()
        self.user = user_model.objects.create_user(
            email="warranty@example.com",
            password="testpass123",
        )
        self.contractor = Contractor.objects.create(
            user=self.user,
            business_name="Warranty Contractor",
        )
        self.homeowner = Homeowner.objects.create(
            created_by=self.contractor,
            full_name="Warranty Homeowner",
            email="homeowner-warranty@example.com",
        )
        self.project = Project.objects.create(
            contractor=self.contractor,
            homeowner=self.homeowner,
            title="Warranty Project",
        )
        self.agreement = Agreement.objects.create(
            project=self.project,
            contractor=self.contractor,
            homeowner=self.homeowner,
            description="Warranty agreement",
        )
        self.client = APIClient()
        self.client.force_authenticate(user=self.user)

    def test_can_create_and_filter_warranty_records_for_agreement(self):
        create_response = self.client.post(
            "/api/projects/warranties/",
            {
                "agreement": self.agreement.id,
                "title": "12-Month Workmanship",
                "coverage_details": "Covers workmanship defects for finish carpentry.",
                "exclusions": "Normal wear and misuse are excluded.",
                "start_date": "2026-03-01",
                "end_date": "2027-03-01",
                "status": "active",
                "applies_to": "workmanship",
            },
            format="json",
        )

        self.assertEqual(create_response.status_code, 201)
        payload = create_response.json()
        self.assertEqual(payload["title"], "12-Month Workmanship")
        self.assertEqual(payload["contractor"], self.contractor.id)
        self.assertEqual(payload["agreement"], self.agreement.id)

        list_response = self.client.get(
            f"/api/projects/warranties/?agreement={self.agreement.id}"
        )
        self.assertEqual(list_response.status_code, 200)
        rows = list_response.json()
        self.assertEqual(len(rows), 1)
        self.assertEqual(rows[0]["title"], "12-Month Workmanship")

        warranty = AgreementWarranty.objects.get(pk=payload["id"])
        self.assertEqual(warranty.contractor_id, self.contractor.id)


class AIFreeAccessRegressionTests(TestCase):
    def setUp(self):
        self.pdf_task_patcher = patch(
            "projects.signals.task_generate_full_agreement_pdf.delay",
            return_value=None,
        )
        self.pdf_task_patcher.start()
        self.addCleanup(self.pdf_task_patcher.stop)

        user_model = get_user_model()
        self.user = user_model.objects.create_user(
            email="ai-free@example.com",
            password="testpass123",
        )
        self.contractor = Contractor.objects.create(
            user=self.user,
            business_name="AI Included Contractor",
        )
        self.homeowner = Homeowner.objects.create(
            created_by=self.contractor,
            full_name="AI Included Homeowner",
            email="ai-homeowner@example.com",
        )
        self.project = Project.objects.create(
            contractor=self.contractor,
            homeowner=self.homeowner,
            title="AI Included Project",
        )
        self.agreement = Agreement.objects.create(
            project=self.project,
            contractor=self.contractor,
            homeowner=self.homeowner,
            description="Included AI agreement",
        )
        self.dispute = Dispute.objects.create(
            agreement=self.agreement,
            initiator="contractor",
            reason="Scope disagreement",
            description="Need an advisory recommendation.",
            created_by=self.user,
            fee_paid=True,
            escrow_frozen=True,
            status="open",
        )
        self.client = APIClient()
        self.client.force_authenticate(user=self.user)

    def test_ai_entitlements_endpoint_returns_included_payload(self):
        response = self.client.get("/api/projects/ai/entitlements/me/")

        self.assertEqual(response.status_code, 200)
        payload = response.json()
        self.assertTrue(payload["is_contractor"])
        self.assertEqual(payload["ai_access"], "included")
        self.assertTrue(payload["ai_enabled"])
        self.assertTrue(payload["ai_unlimited"])

    def test_ai_agreement_description_works_without_entitlement_rows(self):
        with patch(
            "projects.api.ai_agreement_views.generate_or_improve_description",
            return_value={
                "description": "AI-generated scope",
                "_mode": "generate",
                "_model": "test-model",
            },
        ):
            response = self.client.post(
                "/api/projects/agreements/ai/description/",
                {
                    "agreement_id": self.agreement.id,
                    "mode": "generate",
                    "project_title": "Kitchen Refresh",
                },
                format="json",
            )

        self.assertEqual(response.status_code, 200)
        payload = response.json()
        self.assertEqual(payload["description"], "AI-generated scope")
        self.assertEqual(payload["ai_access"], "included")
        self.assertTrue(payload["ai_enabled"])
        self.assertTrue(payload["ai_unlimited"])

    def test_dispute_ai_recommendation_works_without_entitlement_rows(self):
        with patch(
            "projects.api.disputes_ai_views.build_dispute_evidence_context",
            return_value={"agreement": {"id": self.agreement.id}, "dispute": {"id": self.dispute.id}},
        ), patch(
            "projects.api.disputes_ai_views.generate_dispute_recommendation",
            return_value=SimpleNamespace(
                model="test-model",
                payload={
                    "overview": {"neutral_summary": "Test summary", "main_issues": [], "missing_info": [], "risk_flags": []},
                    "recommendation": {
                        "recommended_option_id": "balanced",
                        "why_this_option": "It is fair.",
                        "confidence": 0.91,
                        "notes_for_parties": "Review the proposal.",
                    },
                    "options": [],
                    "draft_resolution_agreement": {"title": "Draft"},
                },
            ),
        ):
            response = self.client.post(
                f"/api/projects/disputes/{self.dispute.id}/ai/recommendation/",
                {"force": True},
                format="json",
            )

        self.assertEqual(response.status_code, 200)
        payload = response.json()
        self.assertEqual(payload["model"], "test-model")
        self.assertEqual(payload["ai_access"], "included")
        self.assertTrue(payload["ai_enabled"])
        self.assertTrue(payload["ai_unlimited"])

    def test_legacy_ai_checkout_endpoint_is_removed(self):
        response = self.client.post(
            "/api/projects/ai/checkout/recommendation/",
            {"dispute_id": self.dispute.id},
            format="json",
        )
        self.assertEqual(response.status_code, 404)

    def test_legacy_ai_void_credit_endpoint_is_removed(self):
        response = self.client.post(
            f"/api/projects/agreements/{self.agreement.id}/ai/void-credit/",
            {},
            format="json",
        )
        self.assertEqual(response.status_code, 404)


class SubcontractorInvitationApiTests(TestCase):
    def setUp(self):
        self.pdf_task_patcher = patch(
            "projects.signals.task_generate_full_agreement_pdf.delay",
            return_value=None,
        )
        self.pdf_task_patcher.start()
        self.addCleanup(self.pdf_task_patcher.stop)

        user_model = get_user_model()
        self.contractor_user = user_model.objects.create_user(
            email="owner@example.com",
            password="testpass123",
        )
        self.contractor = Contractor.objects.create(
            user=self.contractor_user,
            business_name="Owner Contractor",
        )
        self.homeowner = Homeowner.objects.create(
            created_by=self.contractor,
            full_name="Project Homeowner",
            email="homeowner@example.com",
        )
        self.project = Project.objects.create(
            contractor=self.contractor,
            homeowner=self.homeowner,
            title="Main Agreement",
        )
        self.agreement = Agreement.objects.create(
            project=self.project,
            contractor=self.contractor,
            homeowner=self.homeowner,
            description="Agreement with subcontractor invites",
        )

        self.other_user = user_model.objects.create_user(
            email="other-owner@example.com",
            password="testpass123",
        )
        self.other_contractor = Contractor.objects.create(
            user=self.other_user,
            business_name="Other Contractor",
        )
        self.other_homeowner = Homeowner.objects.create(
            created_by=self.other_contractor,
            full_name="Other Homeowner",
            email="other-homeowner@example.com",
        )
        self.other_project = Project.objects.create(
            contractor=self.other_contractor,
            homeowner=self.other_homeowner,
            title="Other Agreement",
        )
        self.other_agreement = Agreement.objects.create(
            project=self.other_project,
            contractor=self.other_contractor,
            homeowner=self.other_homeowner,
            description="Other agreement",
        )

        self.subcontractor_user = user_model.objects.create_user(
            email="subcontractor@example.com",
            password="testpass123",
            first_name="Sub",
            last_name="Contractor",
        )

        self.client = APIClient()
        self.client.force_authenticate(user=self.contractor_user)

    def _create_invitation(self, email="subcontractor@example.com"):
        with patch(
            "projects.views.subcontractor_invitations.send_subcontractor_invitation_email",
            return_value={
                "attempted": False,
                "ok": False,
                "message": "email skipped in test",
                "invite_url": "http://testserver/subcontractor-invitations/accept/test-token",
            },
        ):
            return self.client.post(
                f"/api/projects/agreements/{self.agreement.id}/subcontractor-invitations/",
                {
                    "invite_email": email,
                    "invite_name": "Sub Contract",
                    "invited_message": "Join this agreement.",
                },
                format="json",
            )

    def test_contractor_can_create_invitation_on_own_agreement(self):
        response = self._create_invitation()
        self.assertEqual(response.status_code, 201)
        payload = response.json()
        self.assertEqual(payload["invite_email"], "subcontractor@example.com")
        self.assertEqual(payload["status"], "pending")
        self.assertIn("/subcontractor-invitations/accept/", payload["invite_url"])

        list_response = self.client.get(
            f"/api/projects/agreements/{self.agreement.id}/subcontractor-invitations/"
        )
        self.assertEqual(list_response.status_code, 200)
        rows = list_response.json()
        self.assertEqual(len(rows["pending_invitations"]), 1)
        self.assertEqual(rows["accepted_subcontractors"], [])

    def test_contractor_cannot_create_invitation_on_other_contractors_agreement(self):
        response = self.client.post(
            f"/api/projects/agreements/{self.other_agreement.id}/subcontractor-invitations/",
            {"invite_email": "subcontractor@example.com"},
            format="json",
        )
        self.assertEqual(response.status_code, 404)

    def test_duplicate_active_invite_is_rejected(self):
        first = self._create_invitation()
        self.assertEqual(first.status_code, 201)

        second = self._create_invitation()
        self.assertEqual(second.status_code, 400)
        self.assertIn("pending invitation", str(second.json()).lower())

    def test_valid_token_can_be_accepted(self):
        create_response = self._create_invitation()
        invitation_id = create_response.json()["id"]
        invitation = SubcontractorInvitation.objects.get(pk=invitation_id)

        public_client = APIClient()
        lookup = public_client.get(
            f"/api/projects/subcontractor-invitations/accept/{invitation.token}/"
        )
        self.assertEqual(lookup.status_code, 200)
        self.assertEqual(lookup.json()["status"], "pending")

        public_client.force_authenticate(user=self.subcontractor_user)
        accept_response = public_client.post(
            f"/api/projects/subcontractor-invitations/accept/{invitation.token}/",
            {},
            format="json",
        )
        self.assertEqual(accept_response.status_code, 200)

        invitation.refresh_from_db()
        self.assertEqual(invitation.status, SubcontractorInvitationStatus.ACCEPTED)
        self.assertEqual(invitation.accepted_by_user_id, self.subcontractor_user.id)

        list_response = self.client.get(
            f"/api/projects/agreements/{self.agreement.id}/subcontractor-invitations/"
        )
        self.assertEqual(len(list_response.json()["accepted_subcontractors"]), 1)

    def test_revoked_or_invalid_token_cannot_be_accepted(self):
        create_response = self._create_invitation()
        invitation_id = create_response.json()["id"]

        revoke_response = self.client.post(
            f"/api/projects/agreements/{self.agreement.id}/subcontractor-invitations/{invitation_id}/revoke/",
            {},
            format="json",
        )
        self.assertEqual(revoke_response.status_code, 200)

        invitation = SubcontractorInvitation.objects.get(pk=invitation_id)
        public_client = APIClient()
        public_client.force_authenticate(user=self.subcontractor_user)

        revoked_accept = public_client.post(
            f"/api/projects/subcontractor-invitations/accept/{invitation.token}/",
            {},
            format="json",
        )
        self.assertEqual(revoked_accept.status_code, 400)

        invalid_accept = public_client.post(
            "/api/projects/subcontractor-invitations/accept/not-a-real-token/",
            {},
            format="json",
        )
        self.assertEqual(invalid_accept.status_code, 404)

    def test_acceptance_requires_matching_invited_email(self):
        create_response = self._create_invitation(email="expected@example.com")
        invitation = SubcontractorInvitation.objects.get(pk=create_response.json()["id"])

        public_client = APIClient()
        public_client.force_authenticate(user=self.subcontractor_user)
        response = public_client.post(
            f"/api/projects/subcontractor-invitations/accept/{invitation.token}/",
            {},
            format="json",
        )

        self.assertEqual(response.status_code, 403)
        self.assertIn("invited email", response.json()["detail"].lower())


class SMSWebhookTests(TestCase):
    def _post_sms(self, body, from_number="+12105551234", message_sid="SM123"):
        return self.client.post(
            "/api/sms/webhook/",
            {
                "From": from_number,
                "Body": body,
                "MessageSid": message_sid,
            },
        )

    def assertXmlResponseContains(self, response, expected_text):
        self.assertEqual(response.status_code, 200)
        self.assertIn("text/xml", response["Content-Type"])
        self.assertIn(expected_text, response.content.decode("utf-8"))

    def test_stop_response(self):
        response = self._post_sms("STOP")
        self.assertXmlResponseContains(
            response,
            "MyHomeBro: You have been unsubscribed from SMS notifications. Reply START to re-subscribe. Reply HELP for help.",
        )

    def test_stopall_response(self):
        response = self._post_sms(" STOPALL ")
        self.assertXmlResponseContains(
            response,
            "MyHomeBro: You have been unsubscribed from SMS notifications. Reply START to re-subscribe. Reply HELP for help.",
        )

    def test_help_response(self):
        response = self._post_sms("HELP")
        self.assertXmlResponseContains(
            response,
            "MyHomeBro alerts: project updates, payments, and messages. Msg frequency varies. Reply STOP to opt out. Reply START to opt back in. Help: support@myhomebro.com",
        )

    def test_info_response(self):
        response = self._post_sms(" info ")
        self.assertXmlResponseContains(
            response,
            "MyHomeBro alerts: project updates, payments, and messages. Msg frequency varies. Reply STOP to opt out. Reply START to opt back in. Help: support@myhomebro.com",
        )

    def test_start_response(self):
        response = self._post_sms("START")
        self.assertXmlResponseContains(
            response,
            "MyHomeBro: You have been re-subscribed to SMS notifications.",
        )

    def test_unstop_response(self):
        response = self._post_sms("UNSTOP")
        self.assertXmlResponseContains(
            response,
            "MyHomeBro: You have been re-subscribed to SMS notifications.",
        )

    def test_default_response(self):
        response = self._post_sms("Can you send the next update?")
        self.assertXmlResponseContains(
            response,
            "MyHomeBro: Message received. For help, reply HELP. Reply STOP to opt out.",
        )

    def test_non_post_safe_response(self):
        response = self.client.get("/api/sms/webhook/")
        self.assertXmlResponseContains(
            response,
            "MyHomeBro: Message received. For help, reply HELP. Reply STOP to opt out.",
        )

    def test_exception_path_still_returns_valid_twiml(self):
        with patch(
            "projects.views.sms_webhook.upsert_sms_consent_status",
            side_effect=RuntimeError("boom"),
        ):
            response = self._post_sms("STOP", message_sid="SM-exception")

        self.assertXmlResponseContains(
            response,
            "MyHomeBro: Message received. For help, reply HELP. Reply STOP to opt out.",
        )

    def test_opt_out_persistence_updates_local_consent_state(self):
        response = self._post_sms("STOP", message_sid="SM-stop")
        self.assertXmlResponseContains(
            response,
            "MyHomeBro: You have been unsubscribed from SMS notifications. Reply START to re-subscribe. Reply HELP for help.",
        )

        consent = SMSConsentStatus.objects.get(phone_number="+12105551234")
        self.assertFalse(consent.is_subscribed)
        self.assertEqual(consent.last_inbound_message_sid, "SM-stop")
        self.assertEqual(consent.last_keyword_type, SMSConsentStatus.KEYWORD_OPT_OUT)
        self.assertEqual(consent.last_inbound_body, "STOP")
        self.assertIsNotNone(consent.opted_out_at)

    def test_opt_in_persistence_updates_local_consent_state(self):
        SMSConsentStatus.objects.create(
            phone_number="+12105551234",
            is_subscribed=False,
            last_keyword_type=SMSConsentStatus.KEYWORD_OPT_OUT,
        )

        response = self._post_sms("START", message_sid="SM-start")
        self.assertXmlResponseContains(
            response,
            "MyHomeBro: You have been re-subscribed to SMS notifications.",
        )

        consent = SMSConsentStatus.objects.get(phone_number="+12105551234")
        self.assertTrue(consent.is_subscribed)
        self.assertEqual(consent.last_inbound_message_sid, "SM-start")
        self.assertEqual(consent.last_keyword_type, SMSConsentStatus.KEYWORD_OPT_IN)
        self.assertEqual(consent.last_inbound_body, "START")
        self.assertIsNotNone(consent.opted_in_at)


class SubcontractorMilestoneAssignmentTests(TestCase):
    def setUp(self):
        self.pdf_task_patcher = patch(
            "projects.signals.task_generate_full_agreement_pdf.delay",
            return_value=None,
        )
        self.pdf_task_patcher.start()
        self.addCleanup(self.pdf_task_patcher.stop)

        user_model = get_user_model()
        self.contractor_user = user_model.objects.create_user(
            email="assign-owner@example.com",
            password="testpass123",
        )
        self.contractor = Contractor.objects.create(
            user=self.contractor_user,
            business_name="Assign Owner",
        )
        self.homeowner = Homeowner.objects.create(
            created_by=self.contractor,
            full_name="Assign Homeowner",
            email="assign-homeowner@example.com",
        )
        self.project = Project.objects.create(
            contractor=self.contractor,
            homeowner=self.homeowner,
            title="Assignment Project",
        )
        self.agreement = Agreement.objects.create(
            project=self.project,
            contractor=self.contractor,
            homeowner=self.homeowner,
            description="Agreement for milestone assignment",
        )
        self.milestone = Milestone.objects.create(
            agreement=self.agreement,
            order=1,
            title="Cabinet Install",
            description="Install all cabinets",
            amount="2500.00",
        )

        self.accepted_user = user_model.objects.create_user(
            email="accepted-sub@example.com",
            password="testpass123",
            first_name="Accepted",
            last_name="Sub",
        )
        self.accepted_invitation = SubcontractorInvitation.objects.create(
            contractor=self.contractor,
            agreement=self.agreement,
            invite_email="accepted-sub@example.com",
            invite_name="Accepted Sub",
            status=SubcontractorInvitationStatus.ACCEPTED,
            accepted_by_user=self.accepted_user,
            accepted_at=timezone.now(),
        )

        self.pending_invitation = SubcontractorInvitation.objects.create(
            contractor=self.contractor,
            agreement=self.agreement,
            invite_email="pending-sub@example.com",
            invite_name="Pending Sub",
            status=SubcontractorInvitationStatus.PENDING,
        )

        self.other_user = user_model.objects.create_user(
            email="other-sub@example.com",
            password="testpass123",
        )
        self.other_contractor = Contractor.objects.create(
            user=user_model.objects.create_user(
                email="other-owner-assign@example.com",
                password="testpass123",
            ),
            business_name="Other Assign Owner",
        )
        self.other_homeowner = Homeowner.objects.create(
            created_by=self.other_contractor,
            full_name="Other Homeowner",
            email="other-assign-homeowner@example.com",
        )
        self.other_project = Project.objects.create(
            contractor=self.other_contractor,
            homeowner=self.other_homeowner,
            title="Other Assignment Project",
        )
        self.other_agreement = Agreement.objects.create(
            project=self.other_project,
            contractor=self.other_contractor,
            homeowner=self.other_homeowner,
            description="Other agreement",
        )
        self.other_invitation = SubcontractorInvitation.objects.create(
            contractor=self.other_contractor,
            agreement=self.other_agreement,
            invite_email="other-sub@example.com",
            invite_name="Other Sub",
            status=SubcontractorInvitationStatus.ACCEPTED,
            accepted_by_user=self.other_user,
            accepted_at=timezone.now(),
        )

        self.client = APIClient()
        self.client.force_authenticate(user=self.contractor_user)

    def test_contractor_can_assign_accepted_subcontractor_to_milestone(self):
        response = self.client.patch(
            f"/api/projects/milestones/{self.milestone.id}/",
            {"assigned_subcontractor_invitation": self.accepted_invitation.id},
            format="json",
        )

        self.assertEqual(response.status_code, 200)
        self.milestone.refresh_from_db()
        self.assertEqual(
            self.milestone.assigned_subcontractor_invitation_id,
            self.accepted_invitation.id,
        )

    def test_contractor_can_unassign_subcontractor(self):
        self.milestone.assigned_subcontractor_invitation = self.accepted_invitation
        self.milestone.save(update_fields=["assigned_subcontractor_invitation"])

        response = self.client.patch(
            f"/api/projects/milestones/{self.milestone.id}/",
            {"assigned_subcontractor_invitation": None},
            format="json",
        )

        self.assertEqual(response.status_code, 200)
        self.milestone.refresh_from_db()
        self.assertIsNone(self.milestone.assigned_subcontractor_invitation_id)

    def test_cannot_assign_pending_invitation(self):
        response = self.client.patch(
            f"/api/projects/milestones/{self.milestone.id}/",
            {"assigned_subcontractor_invitation": self.pending_invitation.id},
            format="json",
        )

        self.assertEqual(response.status_code, 400)
        self.assertIn("accepted subcontractors", str(response.json()).lower())

    def test_cannot_assign_subcontractor_from_another_agreement(self):
        response = self.client.patch(
            f"/api/projects/milestones/{self.milestone.id}/",
            {"assigned_subcontractor_invitation": self.other_invitation.id},
            format="json",
        )

        self.assertEqual(response.status_code, 400)
        self.assertIn("same agreement", str(response.json()).lower())

    def test_serializer_returns_assignment_info_correctly(self):
        self.milestone.assigned_subcontractor_invitation = self.accepted_invitation
        self.milestone.save(update_fields=["assigned_subcontractor_invitation"])

        response = self.client.get(f"/api/projects/milestones/{self.milestone.id}/")
        self.assertEqual(response.status_code, 200)
        payload = response.json()
        self.assertEqual(
            payload["assigned_subcontractor_invitation"],
            self.accepted_invitation.id,
        )
        self.assertEqual(
            payload["assigned_subcontractor"]["email"],
            "accepted-sub@example.com",
        )
        self.assertEqual(
            payload["assigned_subcontractor_display"],
            "Accepted Sub",
        )

    def test_delegated_reviewer_assignment_accepts_internal_team_member(self):
        user_model = get_user_model()
        reviewer_user = user_model.objects.create_user(
            email="reviewer-team@example.com",
            password="testpass123",
        )
        reviewer_subaccount = ContractorSubAccount.objects.create(
            parent_contractor=self.contractor,
            user=reviewer_user,
            display_name="Reviewer Team",
            role=ContractorSubAccount.ROLE_EMPLOYEE_SUPERVISOR,
        )

        response = self.client.patch(
            f"/api/projects/milestones/{self.milestone.id}/",
            {"delegated_reviewer_subaccount": reviewer_subaccount.id},
            format="json",
        )

        self.assertEqual(response.status_code, 200)
        self.milestone.refresh_from_db()
        self.assertEqual(self.milestone.delegated_reviewer_subaccount_id, reviewer_subaccount.id)

    def test_delegated_reviewer_assignment_rejects_invalid_internal_member(self):
        user_model = get_user_model()
        readonly_user = user_model.objects.create_user(
            email="readonly-reviewer@example.com",
            password="testpass123",
        )
        readonly_subaccount = ContractorSubAccount.objects.create(
            parent_contractor=self.contractor,
            user=readonly_user,
            display_name="Readonly Reviewer",
            role=ContractorSubAccount.ROLE_EMPLOYEE_READONLY,
        )

        response = self.client.patch(
            f"/api/projects/milestones/{self.milestone.id}/",
            {"delegated_reviewer_subaccount": readonly_subaccount.id},
            format="json",
        )

        self.assertEqual(response.status_code, 400)
        self.assertIn("eligible internal team member", str(response.json()).lower())


class SubcontractorAssignedWorkTests(TestCase):
    def setUp(self):
        self.pdf_task_patcher = patch(
            "projects.signals.task_generate_full_agreement_pdf.delay",
            return_value=None,
        )
        self.pdf_task_patcher.start()
        self.addCleanup(self.pdf_task_patcher.stop)

        user_model = get_user_model()
        self.contractor_user = user_model.objects.create_user(
            email="assigned-work-owner@example.com",
            password="testpass123",
        )
        self.contractor = Contractor.objects.create(
            user=self.contractor_user,
            business_name="Assigned Work Owner",
        )
        self.homeowner = Homeowner.objects.create(
            created_by=self.contractor,
            full_name="Assigned Work Homeowner",
            email="assigned-work-homeowner@example.com",
        )
        self.project = Project.objects.create(
            contractor=self.contractor,
            homeowner=self.homeowner,
            title="Assigned Work Project",
        )
        self.agreement = Agreement.objects.create(
            project=self.project,
            contractor=self.contractor,
            homeowner=self.homeowner,
            description="Agreement for assigned work",
        )

        self.user_one = user_model.objects.create_user(
            email="sub-one@example.com",
            password="testpass123",
            first_name="Sub",
            last_name="One",
        )
        self.user_two = user_model.objects.create_user(
            email="sub-two@example.com",
            password="testpass123",
            first_name="Sub",
            last_name="Two",
        )

        self.invitation_one = SubcontractorInvitation.objects.create(
            contractor=self.contractor,
            agreement=self.agreement,
            invite_email="sub-one@example.com",
            invite_name="Sub One",
            status=SubcontractorInvitationStatus.ACCEPTED,
            accepted_by_user=self.user_one,
            accepted_at=timezone.now(),
        )
        self.invitation_two = SubcontractorInvitation.objects.create(
            contractor=self.contractor,
            agreement=self.agreement,
            invite_email="sub-two@example.com",
            invite_name="Sub Two",
            status=SubcontractorInvitationStatus.ACCEPTED,
            accepted_by_user=self.user_two,
            accepted_at=timezone.now(),
        )

        self.milestone_one = Milestone.objects.create(
            agreement=self.agreement,
            order=1,
            title="Framing",
            description="Frame the room",
            amount="1200.00",
            assigned_subcontractor_invitation=self.invitation_one,
        )
        self.milestone_two = Milestone.objects.create(
            agreement=self.agreement,
            order=2,
            title="Drywall",
            description="Install drywall",
            amount="800.00",
            assigned_subcontractor_invitation=self.invitation_two,
        )

        self.client = APIClient()

    def test_subcontractor_can_fetch_only_their_assigned_milestones(self):
        self.client.force_authenticate(user=self.user_one)
        response = self.client.get("/api/projects/subcontractor/milestones/my-assigned/")

        self.assertEqual(response.status_code, 200)
        payload = response.json()
        self.assertEqual(payload["count"], 1)
        self.assertEqual(len(payload["milestones"]), 1)
        self.assertEqual(payload["milestones"][0]["id"], self.milestone_one.id)

    def test_subcontractor_cannot_see_milestones_assigned_to_someone_else(self):
        self.client.force_authenticate(user=self.user_one)
        response = self.client.get("/api/projects/subcontractor/milestones/my-assigned/")

        self.assertEqual(response.status_code, 200)
        milestone_ids = [row["id"] for row in response.json()["milestones"]]
        self.assertNotIn(self.milestone_two.id, milestone_ids)

    def test_grouped_project_linked_response_includes_expected_fields(self):
        self.client.force_authenticate(user=self.user_one)
        response = self.client.get("/api/projects/subcontractor/milestones/my-assigned/")

        self.assertEqual(response.status_code, 200)
        payload = response.json()
        self.assertEqual(len(payload["groups"]), 1)
        group = payload["groups"][0]
        self.assertEqual(group["agreement_id"], self.agreement.id)
        self.assertEqual(group["project_title"], "Assigned Work Project")
        milestone = group["milestones"][0]
        self.assertEqual(milestone["agreement_id"], self.agreement.id)
        self.assertEqual(milestone["agreement_title"], "Assigned Work Project")
        self.assertEqual(milestone["assigned_subcontractor"]["email"], "sub-one@example.com")

    def test_empty_state_works_when_no_assignments_exist(self):
        user_model = get_user_model()
        unassigned_user = user_model.objects.create_user(
            email="no-work@example.com",
            password="testpass123",
        )
        self.client.force_authenticate(user=unassigned_user)

        response = self.client.get("/api/projects/subcontractor/milestones/my-assigned/")
        self.assertEqual(response.status_code, 200)
        payload = response.json()
        self.assertEqual(payload["count"], 0)
        self.assertEqual(payload["groups"], [])
        self.assertEqual(payload["milestones"], [])


class SubcontractorCollaborationTests(TestCase):
    def setUp(self):
        self.pdf_task_patcher = patch(
            "projects.signals.task_generate_full_agreement_pdf.delay",
            return_value=None,
        )
        self.pdf_task_patcher.start()
        self.addCleanup(self.pdf_task_patcher.stop)

        user_model = get_user_model()
        self.contractor_user = user_model.objects.create_user(
            email="collab-owner@example.com",
            password="testpass123",
        )
        self.contractor = Contractor.objects.create(
            user=self.contractor_user,
            business_name="Collab Owner",
        )
        self.homeowner = Homeowner.objects.create(
            created_by=self.contractor,
            full_name="Collab Homeowner",
            email="collab-homeowner@example.com",
        )
        self.project = Project.objects.create(
            contractor=self.contractor,
            homeowner=self.homeowner,
            title="Collaboration Project",
        )
        self.agreement = Agreement.objects.create(
            project=self.project,
            contractor=self.contractor,
            homeowner=self.homeowner,
            description="Agreement for subcontractor collaboration",
        )

        self.assigned_user = user_model.objects.create_user(
            email="assigned-collab@example.com",
            password="testpass123",
            first_name="Assigned",
            last_name="Collaborator",
        )
        self.other_user = user_model.objects.create_user(
            email="other-collab@example.com",
            password="testpass123",
            first_name="Other",
            last_name="Collaborator",
        )
        self.unassigned_user = user_model.objects.create_user(
            email="unassigned-collab@example.com",
            password="testpass123",
        )

        self.assigned_invitation = SubcontractorInvitation.objects.create(
            contractor=self.contractor,
            agreement=self.agreement,
            invite_email="assigned-collab@example.com",
            invite_name="Assigned Collaborator",
            status=SubcontractorInvitationStatus.ACCEPTED,
            accepted_by_user=self.assigned_user,
            accepted_at=timezone.now(),
        )
        self.other_invitation = SubcontractorInvitation.objects.create(
            contractor=self.contractor,
            agreement=self.agreement,
            invite_email="other-collab@example.com",
            invite_name="Other Collaborator",
            status=SubcontractorInvitationStatus.ACCEPTED,
            accepted_by_user=self.other_user,
            accepted_at=timezone.now(),
        )

        self.milestone = Milestone.objects.create(
            agreement=self.agreement,
            order=1,
            title="Paint Prep",
            description="Prep all walls for paint",
            amount="900.00",
            assigned_subcontractor_invitation=self.assigned_invitation,
        )

        self.comment = MilestoneComment.objects.create(
            milestone=self.milestone,
            author=self.contractor_user,
            content="Initial contractor note",
        )
        self.file = MilestoneFile.objects.create(
            milestone=self.milestone,
            uploaded_by=self.contractor_user,
            file=SimpleUploadedFile("scope.txt", b"scope details", content_type="text/plain"),
        )

        self.client = APIClient()

    def test_assigned_subcontractor_can_list_milestone_comments_and_files(self):
        self.client.force_authenticate(user=self.assigned_user)
        detail = self.client.get(f"/api/projects/subcontractor/milestones/{self.milestone.id}/")
        self.assertEqual(detail.status_code, 200)
        payload = detail.json()
        self.assertEqual(len(payload["comments"]), 1)
        self.assertEqual(len(payload["files"]), 1)

        comments = self.client.get(
            f"/api/projects/subcontractor/milestones/{self.milestone.id}/comments/"
        )
        files = self.client.get(
            f"/api/projects/subcontractor/milestones/{self.milestone.id}/files/"
        )
        self.assertEqual(comments.status_code, 200)
        self.assertEqual(files.status_code, 200)

    def test_assigned_subcontractor_can_create_comment(self):
        self.client.force_authenticate(user=self.assigned_user)
        response = self.client.post(
            f"/api/projects/subcontractor/milestones/{self.milestone.id}/comments/",
            {"content": "Need trim dimensions."},
            format="json",
        )

        self.assertEqual(response.status_code, 201)
        self.assertTrue(
            MilestoneComment.objects.filter(
                milestone=self.milestone,
                author=self.assigned_user,
                content="Need trim dimensions.",
            ).exists()
        )

    def test_assigned_subcontractor_can_upload_file(self):
        self.client.force_authenticate(user=self.assigned_user)
        response = self.client.post(
            f"/api/projects/subcontractor/milestones/{self.milestone.id}/files/",
            {"file": SimpleUploadedFile("photo.txt", b"photo", content_type="text/plain")},
        )

        self.assertEqual(response.status_code, 201)
        self.assertTrue(
            MilestoneFile.objects.filter(
                milestone=self.milestone,
                uploaded_by=self.assigned_user,
            ).exists()
        )

    def test_unassigned_subcontractor_is_denied(self):
        self.client.force_authenticate(user=self.unassigned_user)
        response = self.client.get(
            f"/api/projects/subcontractor/milestones/{self.milestone.id}/comments/"
        )
        self.assertEqual(response.status_code, 404)

    def test_different_subcontractor_is_denied(self):
        self.client.force_authenticate(user=self.other_user)
        response = self.client.post(
            f"/api/projects/subcontractor/milestones/{self.milestone.id}/comments/",
            {"content": "I should not be able to post here."},
            format="json",
        )
        self.assertEqual(response.status_code, 404)

    def test_contractor_access_continues_to_work(self):
        self.client.force_authenticate(user=self.contractor_user)
        comments = self.client.get(f"/api/projects/milestones/{self.milestone.id}/comments/")
        files = self.client.get(f"/api/projects/milestones/{self.milestone.id}/files/")
        self.assertEqual(comments.status_code, 200)
        self.assertEqual(files.status_code, 200)


class SubcontractorReviewRequestTests(TestCase):
    def setUp(self):
        self.pdf_task_patcher = patch(
            "projects.signals.task_generate_full_agreement_pdf.delay",
            return_value=None,
        )
        self.pdf_task_patcher.start()
        self.addCleanup(self.pdf_task_patcher.stop)

        user_model = get_user_model()
        self.contractor_user = user_model.objects.create_user(
            email="review-owner@example.com",
            password="testpass123",
        )
        self.contractor = Contractor.objects.create(
            user=self.contractor_user,
            business_name="Review Owner",
        )
        self.homeowner = Homeowner.objects.create(
            created_by=self.contractor,
            full_name="Review Homeowner",
            email="review-homeowner@example.com",
        )
        self.project = Project.objects.create(
            contractor=self.contractor,
            homeowner=self.homeowner,
            title="Review Request Project",
        )
        self.agreement = Agreement.objects.create(
            project=self.project,
            contractor=self.contractor,
            homeowner=self.homeowner,
            description="Agreement for subcontractor review requests",
        )

        self.assigned_user = user_model.objects.create_user(
            email="assigned-review@example.com",
            password="testpass123",
            first_name="Assigned",
            last_name="Reviewer",
        )
        self.other_user = user_model.objects.create_user(
            email="other-review@example.com",
            password="testpass123",
        )
        self.unassigned_user = user_model.objects.create_user(
            email="unassigned-review@example.com",
            password="testpass123",
        )

        self.assigned_invitation = SubcontractorInvitation.objects.create(
            contractor=self.contractor,
            agreement=self.agreement,
            invite_email="assigned-review@example.com",
            invite_name="Assigned Reviewer",
            status=SubcontractorInvitationStatus.ACCEPTED,
            accepted_by_user=self.assigned_user,
            accepted_at=timezone.now(),
        )
        self.other_invitation = SubcontractorInvitation.objects.create(
            contractor=self.contractor,
            agreement=self.agreement,
            invite_email="other-review@example.com",
            invite_name="Other Reviewer",
            status=SubcontractorInvitationStatus.ACCEPTED,
            accepted_by_user=self.other_user,
            accepted_at=timezone.now(),
        )

        self.milestone = Milestone.objects.create(
            agreement=self.agreement,
            order=1,
            title="Tile Install",
            description="Install floor tile",
            amount="1800.00",
            assigned_subcontractor_invitation=self.assigned_invitation,
        )
        self.client = APIClient()

    def test_assigned_subcontractor_can_request_review(self):
        self.client.force_authenticate(user=self.assigned_user)
        response = self.client.post(
            f"/api/projects/subcontractor/milestones/{self.milestone.id}/request-review/",
            {},
            format="json",
        )

        self.assertEqual(response.status_code, 200)
        self.milestone.refresh_from_db()
        self.assertEqual(self.milestone.subcontractor_review_requested_by_id, self.assigned_user.id)
        self.assertIsNotNone(self.milestone.subcontractor_review_requested_at)

    def test_assigned_subcontractor_can_include_optional_note(self):
        self.client.force_authenticate(user=self.assigned_user)
        response = self.client.post(
            f"/api/projects/subcontractor/milestones/{self.milestone.id}/request-review/",
            {"note": "Tile layout is ready for inspection."},
            format="json",
        )

        self.assertEqual(response.status_code, 200)
        self.milestone.refresh_from_db()
        self.assertEqual(
            self.milestone.subcontractor_review_note,
            "Tile layout is ready for inspection.",
        )

    def test_unassigned_subcontractor_is_denied(self):
        self.client.force_authenticate(user=self.unassigned_user)
        response = self.client.post(
            f"/api/projects/subcontractor/milestones/{self.milestone.id}/request-review/",
            {},
            format="json",
        )
        self.assertEqual(response.status_code, 404)

    def test_different_subcontractor_is_denied(self):
        self.client.force_authenticate(user=self.other_user)
        response = self.client.post(
            f"/api/projects/subcontractor/milestones/{self.milestone.id}/request-review/",
            {"note": "Not my milestone."},
            format="json",
        )
        self.assertEqual(response.status_code, 404)

    def test_contractor_sees_review_request_state_in_serializer(self):
        self.milestone.subcontractor_review_requested_at = timezone.now()
        self.milestone.subcontractor_review_requested_by = self.assigned_user
        self.milestone.subcontractor_review_note = "Ready for walkthrough."
        self.milestone.save(
            update_fields=[
                "subcontractor_review_requested_at",
                "subcontractor_review_requested_by",
                "subcontractor_review_note",
            ]
        )

        self.client.force_authenticate(user=self.contractor_user)
        response = self.client.get(f"/api/projects/milestones/{self.milestone.id}/")
        self.assertEqual(response.status_code, 200)
        payload = response.json()
        self.assertTrue(payload["subcontractor_review_requested"])
        self.assertEqual(payload["subcontractor_review_note"], "Ready for walkthrough.")
        self.assertEqual(payload["subcontractor_review_requested_by_display"], "Assigned Reviewer")

    def test_request_review_does_not_complete_or_invoice_milestone(self):
        self.client.force_authenticate(user=self.assigned_user)
        response = self.client.post(
            f"/api/projects/subcontractor/milestones/{self.milestone.id}/request-review/",
            {"note": "Please review."},
            format="json",
        )

        self.assertEqual(response.status_code, 200)
        self.milestone.refresh_from_db()
        self.assertFalse(self.milestone.completed)
        self.assertFalse(self.milestone.is_invoiced)
        self.assertIsNone(self.milestone.invoice_id)


class ContractorNotificationTests(TestCase):
    def setUp(self):
        self.pdf_task_patcher = patch(
            "projects.signals.task_generate_full_agreement_pdf.delay",
            return_value=None,
        )
        self.pdf_task_patcher.start()
        self.addCleanup(self.pdf_task_patcher.stop)

        user_model = get_user_model()
        self.contractor_user = user_model.objects.create_user(
            email="notify-owner@example.com",
            password="testpass123",
        )
        self.contractor = Contractor.objects.create(
            user=self.contractor_user,
            business_name="Notify Owner",
        )
        self.homeowner = Homeowner.objects.create(
            created_by=self.contractor,
            full_name="Notify Homeowner",
            email="notify-homeowner@example.com",
        )
        self.project = Project.objects.create(
            contractor=self.contractor,
            homeowner=self.homeowner,
            title="Notification Project",
        )
        self.agreement = Agreement.objects.create(
            project=self.project,
            contractor=self.contractor,
            homeowner=self.homeowner,
            description="Agreement for notifications",
        )

        self.subcontractor_user = user_model.objects.create_user(
            email="notify-sub@example.com",
            password="testpass123",
            first_name="Taylor",
            last_name="Sub",
        )
        self.invitation = SubcontractorInvitation.objects.create(
            contractor=self.contractor,
            agreement=self.agreement,
            invite_email="notify-sub@example.com",
            invite_name="Taylor Sub",
            status=SubcontractorInvitationStatus.ACCEPTED,
            accepted_by_user=self.subcontractor_user,
            accepted_at=timezone.now(),
        )
        self.milestone = Milestone.objects.create(
            agreement=self.agreement,
            order=1,
            title="Countertop Install",
            description="Install countertops",
            amount="1500.00",
            assigned_subcontractor_invitation=self.invitation,
        )

        self.other_contractor_user = user_model.objects.create_user(
            email="other-notify-owner@example.com",
            password="testpass123",
        )
        self.other_contractor = Contractor.objects.create(
            user=self.other_contractor_user,
            business_name="Other Notify Owner",
        )

        self.client = APIClient()

    def test_contractor_receives_notification_for_subcontractor_comment(self):
        self.client.force_authenticate(user=self.subcontractor_user)
        response = self.client.post(
            f"/api/projects/subcontractor/milestones/{self.milestone.id}/comments/",
            {"content": "Cabinets are staged."},
            format="json",
        )

        self.assertEqual(response.status_code, 201)
        notification = Notification.objects.get()
        self.assertEqual(notification.contractor_id, self.contractor.id)
        self.assertEqual(notification.event_type, Notification.EVENT_SUBCONTRACTOR_COMMENT)
        self.assertEqual(notification.milestone_id, self.milestone.id)

    def test_contractor_receives_notification_for_subcontractor_file_upload(self):
        self.client.force_authenticate(user=self.subcontractor_user)
        response = self.client.post(
            f"/api/projects/subcontractor/milestones/{self.milestone.id}/files/",
            {"file": SimpleUploadedFile("progress.txt", b"progress", content_type="text/plain")},
        )

        self.assertEqual(response.status_code, 201)
        notification = Notification.objects.get()
        self.assertEqual(notification.event_type, Notification.EVENT_SUBCONTRACTOR_FILE)

    def test_contractor_receives_notification_for_review_request(self):
        self.client.force_authenticate(user=self.subcontractor_user)
        response = self.client.post(
            f"/api/projects/subcontractor/milestones/{self.milestone.id}/request-review/",
            {"note": "Ready for final walkthrough."},
            format="json",
        )

        self.assertEqual(response.status_code, 200)
        notification = Notification.objects.get()
        self.assertEqual(notification.event_type, Notification.EVENT_SUBCONTRACTOR_REVIEW)
        self.assertIn("ready for review", notification.message.lower())

    def test_other_contractors_do_not_see_notifications(self):
        Notification.objects.create(
            contractor=self.contractor,
            event_type=Notification.EVENT_SUBCONTRACTOR_COMMENT,
            agreement=self.agreement,
            milestone=self.milestone,
            actor_user=self.subcontractor_user,
            actor_display_name="Taylor Sub",
            actor_email="notify-sub@example.com",
            title="Subcontractor added a comment",
            message="Taylor Sub added a comment on Countertop Install.",
        )

        self.client.force_authenticate(user=self.other_contractor_user)
        response = self.client.get("/api/projects/notifications/")
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json(), [])


class SubcontractorCompletionReviewTests(TestCase):
    def setUp(self):
        self.pdf_task_patcher = patch(
            "projects.signals.task_generate_full_agreement_pdf.delay",
            return_value=None,
        )
        self.pdf_task_patcher.start()
        self.addCleanup(self.pdf_task_patcher.stop)

        user_model = get_user_model()
        self.contractor_user = user_model.objects.create_user(
            email="completion-owner@example.com",
            password="testpass123",
        )
        self.contractor = Contractor.objects.create(
            user=self.contractor_user,
            business_name="Completion Owner",
        )
        self.homeowner = Homeowner.objects.create(
            created_by=self.contractor,
            full_name="Completion Homeowner",
            email="completion-homeowner@example.com",
        )
        self.project = Project.objects.create(
            contractor=self.contractor,
            homeowner=self.homeowner,
            title="Completion Review Project",
        )
        self.agreement = Agreement.objects.create(
            project=self.project,
            contractor=self.contractor,
            homeowner=self.homeowner,
            description="Agreement for subcontractor completion review",
        )

        self.assigned_user = user_model.objects.create_user(
            email="assigned-complete@example.com",
            password="testpass123",
            first_name="Assigned",
            last_name="Complete",
        )
        self.other_user = user_model.objects.create_user(
            email="other-complete@example.com",
            password="testpass123",
        )
        self.unassigned_user = user_model.objects.create_user(
            email="unassigned-complete@example.com",
            password="testpass123",
        )

        self.assigned_invitation = SubcontractorInvitation.objects.create(
            contractor=self.contractor,
            agreement=self.agreement,
            invite_email="assigned-complete@example.com",
            invite_name="Assigned Complete",
            status=SubcontractorInvitationStatus.ACCEPTED,
            accepted_by_user=self.assigned_user,
            accepted_at=timezone.now(),
        )
        self.other_invitation = SubcontractorInvitation.objects.create(
            contractor=self.contractor,
            agreement=self.agreement,
            invite_email="other-complete@example.com",
            invite_name="Other Complete",
            status=SubcontractorInvitationStatus.ACCEPTED,
            accepted_by_user=self.other_user,
            accepted_at=timezone.now(),
        )

        self.milestone = Milestone.objects.create(
            agreement=self.agreement,
            order=1,
            title="Finish Carpentry",
            description="Install trim and casing",
            amount="2200.00",
            assigned_subcontractor_invitation=self.assigned_invitation,
        )
        self.reviewer_user = user_model.objects.create_user(
            email="reviewer-complete@example.com",
            password="testpass123",
        )
        self.reviewer_subaccount = ContractorSubAccount.objects.create(
            parent_contractor=self.contractor,
            user=self.reviewer_user,
            display_name="Delegated Reviewer",
            role=ContractorSubAccount.ROLE_EMPLOYEE_SUPERVISOR,
        )
        self.worker_user = user_model.objects.create_user(
            email="internal-worker@example.com",
            password="testpass123",
        )
        self.worker_subaccount = ContractorSubAccount.objects.create(
            parent_contractor=self.contractor,
            user=self.worker_user,
            display_name="Internal Worker",
            role=ContractorSubAccount.ROLE_EMPLOYEE_MILESTONES,
        )
        self.client = APIClient()

    def test_assigned_subcontractor_can_submit_completion_for_review(self):
        self.client.force_authenticate(user=self.assigned_user)
        response = self.client.post(
            f"/api/projects/subcontractor/milestones/{self.milestone.id}/submit-completion/",
            {},
            format="json",
        )

        self.assertEqual(response.status_code, 200)
        self.milestone.refresh_from_db()
        self.assertEqual(
            self.milestone.subcontractor_completion_status,
            SubcontractorCompletionStatus.SUBMITTED_FOR_REVIEW,
        )
        self.assertEqual(self.milestone.subcontractor_marked_complete_by_id, self.assigned_user.id)

    def test_internal_team_member_can_submit_work_when_assigned(self):
        self.milestone.assigned_subcontractor_invitation = None
        self.milestone.save(update_fields=["assigned_subcontractor_invitation"])
        MilestoneAssignment.objects.create(
            milestone=self.milestone,
            subaccount=self.worker_subaccount,
        )

        self.client.force_authenticate(user=self.worker_user)
        response = self.client.post(
            f"/api/projects/milestones/{self.milestone.id}/submit-work/",
            {"note": "Internal team work is ready."},
            format="json",
        )

        self.assertEqual(response.status_code, 200)
        self.milestone.refresh_from_db()
        self.assertEqual(
            self.milestone.subcontractor_completion_status,
            SubcontractorCompletionStatus.SUBMITTED_FOR_REVIEW,
        )
        self.assertEqual(self.milestone.subcontractor_marked_complete_by_id, self.worker_user.id)

    def test_optional_subcontractor_note_is_stored(self):
        self.client.force_authenticate(user=self.assigned_user)
        response = self.client.post(
            f"/api/projects/subcontractor/milestones/{self.milestone.id}/submit-completion/",
            {"note": "Trim is installed and caulked."},
            format="json",
        )

        self.assertEqual(response.status_code, 200)
        self.milestone.refresh_from_db()
        self.assertEqual(self.milestone.subcontractor_completion_note, "Trim is installed and caulked.")

    def test_unassigned_subcontractor_is_denied(self):
        self.client.force_authenticate(user=self.unassigned_user)
        response = self.client.post(
            f"/api/projects/subcontractor/milestones/{self.milestone.id}/submit-completion/",
            {},
            format="json",
        )
        self.assertEqual(response.status_code, 404)

    def test_different_subcontractor_is_denied(self):
        self.client.force_authenticate(user=self.other_user)
        response = self.client.post(
            f"/api/projects/subcontractor/milestones/{self.milestone.id}/submit-completion/",
            {"note": "Not my work."},
            format="json",
        )
        self.assertEqual(response.status_code, 404)

    def test_subcontractor_cannot_be_reviewer(self):
        self.milestone.subcontractor_completion_status = SubcontractorCompletionStatus.SUBMITTED_FOR_REVIEW
        self.milestone.subcontractor_marked_complete_at = timezone.now()
        self.milestone.subcontractor_marked_complete_by = self.assigned_user
        self.milestone.save(
            update_fields=[
                "subcontractor_completion_status",
                "subcontractor_marked_complete_at",
                "subcontractor_marked_complete_by",
            ]
        )

        self.client.force_authenticate(user=self.assigned_user)
        response = self.client.post(
            f"/api/projects/milestones/{self.milestone.id}/approve-work/",
            {},
            format="json",
        )
        self.assertEqual(response.status_code, 403)

    def test_contractor_can_approve_submitted_completion(self):
        self.milestone.subcontractor_completion_status = SubcontractorCompletionStatus.SUBMITTED_FOR_REVIEW
        self.milestone.subcontractor_marked_complete_at = timezone.now()
        self.milestone.subcontractor_marked_complete_by = self.assigned_user
        self.milestone.save(
            update_fields=[
                "subcontractor_completion_status",
                "subcontractor_marked_complete_at",
                "subcontractor_marked_complete_by",
            ]
        )

        self.client.force_authenticate(user=self.contractor_user)
        response = self.client.post(
            f"/api/projects/milestones/{self.milestone.id}/approve-subcontractor-completion/",
            {"response_note": "Looks good."},
            format="json",
        )

        self.assertEqual(response.status_code, 200)
        self.milestone.refresh_from_db()
        self.assertEqual(
            self.milestone.subcontractor_completion_status,
            SubcontractorCompletionStatus.APPROVED,
        )
        self.assertEqual(self.milestone.subcontractor_review_response_note, "Looks good.")

    def test_delegated_reviewer_can_review_if_assigned(self):
        self.milestone.subcontractor_completion_status = SubcontractorCompletionStatus.SUBMITTED_FOR_REVIEW
        self.milestone.subcontractor_marked_complete_at = timezone.now()
        self.milestone.subcontractor_marked_complete_by = self.assigned_user
        self.milestone.delegated_reviewer_subaccount = self.reviewer_subaccount
        self.milestone.save(
            update_fields=[
                "subcontractor_completion_status",
                "subcontractor_marked_complete_at",
                "subcontractor_marked_complete_by",
                "delegated_reviewer_subaccount",
            ]
        )

        self.client.force_authenticate(user=self.reviewer_user)
        response = self.client.post(
            f"/api/projects/milestones/{self.milestone.id}/approve-work/",
            {"response_note": "Approved by delegated reviewer."},
            format="json",
        )

        self.assertEqual(response.status_code, 200)
        self.milestone.refresh_from_db()
        self.assertEqual(
            self.milestone.subcontractor_completion_status,
            SubcontractorCompletionStatus.APPROVED,
        )
        self.assertEqual(self.milestone.subcontractor_reviewed_by_id, self.reviewer_user.id)

    def test_contractor_can_reject_submitted_completion(self):
        self.milestone.subcontractor_completion_status = SubcontractorCompletionStatus.SUBMITTED_FOR_REVIEW
        self.milestone.subcontractor_marked_complete_at = timezone.now()
        self.milestone.subcontractor_marked_complete_by = self.assigned_user
        self.milestone.save(
            update_fields=[
                "subcontractor_completion_status",
                "subcontractor_marked_complete_at",
                "subcontractor_marked_complete_by",
            ]
        )

        self.client.force_authenticate(user=self.contractor_user)
        response = self.client.post(
            f"/api/projects/milestones/{self.milestone.id}/reject-subcontractor-completion/",
            {"response_note": "Please tighten the outside corners."},
            format="json",
        )

        self.assertEqual(response.status_code, 200)
        self.milestone.refresh_from_db()
        self.assertEqual(
            self.milestone.subcontractor_completion_status,
            SubcontractorCompletionStatus.NEEDS_CHANGES,
        )
        self.assertEqual(
            self.milestone.subcontractor_review_response_note,
            "Please tighten the outside corners.",
        )

    def test_review_actions_do_not_mark_milestone_complete_or_invoiced(self):
        self.milestone.subcontractor_completion_status = SubcontractorCompletionStatus.SUBMITTED_FOR_REVIEW
        self.milestone.subcontractor_marked_complete_at = timezone.now()
        self.milestone.subcontractor_marked_complete_by = self.assigned_user
        self.milestone.save(
            update_fields=[
                "subcontractor_completion_status",
                "subcontractor_marked_complete_at",
                "subcontractor_marked_complete_by",
            ]
        )

        self.client.force_authenticate(user=self.contractor_user)
        response = self.client.post(
            f"/api/projects/milestones/{self.milestone.id}/approve-subcontractor-completion/",
            {},
            format="json",
        )

        self.assertEqual(response.status_code, 200)
        self.milestone.refresh_from_db()
        self.assertFalse(self.milestone.completed)
        self.assertFalse(self.milestone.is_invoiced)
        self.assertIsNone(self.milestone.invoice_id)

    def test_serializer_exposes_subcontractor_completion_review_state(self):
        self.milestone.subcontractor_completion_status = SubcontractorCompletionStatus.NEEDS_CHANGES
        self.milestone.subcontractor_marked_complete_at = timezone.now()
        self.milestone.subcontractor_marked_complete_by = self.assigned_user
        self.milestone.subcontractor_completion_note = "Trim installed."
        self.milestone.subcontractor_reviewed_at = timezone.now()
        self.milestone.subcontractor_reviewed_by = self.contractor_user
        self.milestone.subcontractor_review_response_note = "Please fix the hallway seam."
        self.milestone.save(
            update_fields=[
                "subcontractor_completion_status",
                "subcontractor_marked_complete_at",
                "subcontractor_marked_complete_by",
                "subcontractor_completion_note",
                "subcontractor_reviewed_at",
                "subcontractor_reviewed_by",
                "subcontractor_review_response_note",
            ]
        )

        self.client.force_authenticate(user=self.contractor_user)
        response = self.client.get(f"/api/projects/milestones/{self.milestone.id}/")
        self.assertEqual(response.status_code, 200)
        payload = response.json()
        self.assertEqual(payload["subcontractor_completion_status"], "needs_changes")
        self.assertEqual(payload["subcontractor_completion_note"], "Trim installed.")
        self.assertEqual(payload["subcontractor_review_response_note"], "Please fix the hallway seam.")
        self.assertEqual(payload["assigned_worker"]["kind"], "subcontractor")
        self.assertEqual(payload["reviewer"]["kind"], "contractor_owner")
        self.assertTrue(payload["can_current_user_review_work"])
