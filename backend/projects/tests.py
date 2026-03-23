from __future__ import annotations
from types import SimpleNamespace
from unittest.mock import patch

from django.contrib.auth import get_user_model
from django.test import TestCase, override_settings
from django.urls import resolve
from django.utils import timezone
from rest_framework.test import APIClient

from projects.api.ai_agreement_views import ai_suggest_milestones
from projects.models import Agreement, Contractor, Homeowner, Milestone, Project
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
