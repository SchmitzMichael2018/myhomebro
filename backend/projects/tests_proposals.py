from datetime import timedelta
from types import SimpleNamespace
from unittest.mock import patch

from django.contrib.auth import get_user_model
from django.core.files.uploadedfile import SimpleUploadedFile
from django.test import TestCase, override_settings
from django.utils import timezone
from rest_framework.test import APIClient

from projects.models import Agreement, Contractor, Homeowner, Milestone, Notification, CustomerConversation, ConversationMessage, Project
from projects.models_contractor_discovery import (
    ContractorDirectoryEntry,
    ContractorOpportunity,
    OpportunityEstimateAppointment,
)
from projects.models_proposals import Proposal, ProposalActivity, ProposalAttachment, ProposalLineItem, ProposalMeasurement, ProposalPortalActivation, ProposalReviewVersion
from projects.models_sms import SMSConsent
from projects.services.proposal_customer_review import ACKNOWLEDGEMENT, activation_token_for, build_customer_snapshot, portal_access, public_customer_snapshot, review_delivery_eligibility, token_for
from projects.services.proposal_conversion import ProposalConversionError, _trusted_agreement_payload
from projects.models_templates import ProjectTemplate, ProjectTemplateMilestone
from projects.models_learning import ContractorBenchmarkAggregate, RegionalBenchmarkAggregate
from projects.services.proposal_pricing_benchmark import MIN_REGIONAL_BENCHMARK_SAMPLE, classify_proposal_benchmark
from projects.services.contractor_directory import normalize_business_name
from projects.services.sms_service import handle_inbound_sms
from projects.services import sms_service
from projects.views.customer_portal import _estimate_rows


class ProposalBenchmarkClassificationTests(TestCase):
    def _proposal(self, *, title="", project_type="", project_subtype="", summary="", template=None, opportunity=None):
        return SimpleNamespace(
            project_title=title,
            project_type=project_type,
            project_subtype=project_subtype,
            project_summary=summary,
            selected_template=template,
            selected_template_name_snapshot=getattr(template, "name", "") if template else "",
            contractor_opportunity=opportunity,
        )

    def test_bathroom_remodel_template_outranks_repair_like_scope_text(self):
        template = SimpleNamespace(
            name="Bathroom Remodel",
            project_type="Remodel",
            project_subtype="Bathroom Remodel",
            benchmark_match_key="remodel:bathroom_remodel",
            source_system_template=None,
        )
        classification, _ = classify_proposal_benchmark(self._proposal(
            title="Bathroom Remodel",
            project_type="Bathroom",
            project_subtype="Refresh",
            summary="Repair damaged drywall and replace a fixture during the full renovation.",
            template=template,
        ))
        self.assertEqual(classification["project_family_key"], "bathroom_remodel")
        self.assertEqual(classification["scope_mode"], "remodel")
        self.assertEqual(classification["match_description"], "Bathroom Remodel · Remodel")
        self.assertEqual(classification["classification_source"], "template_benchmark_metadata")

    def test_actual_bathroom_repair_remains_repair(self):
        classification, _ = classify_proposal_benchmark(self._proposal(
            title="Bathroom leak repair",
            project_type="Bathroom",
            project_subtype="Repair",
            summary="Fix a localized shower leak.",
        ))
        self.assertEqual((classification["project_family_key"], classification["scope_mode"]), ("bathroom_remodel", "repair"))

    def test_representative_project_taxonomy(self):
        cases = [
            ({"project_type": "Kitchen Remodel", "project_subtype": "Full Kitchen Remodel"}, ("kitchen_remodel", "remodel")),
            ({"project_type": "Roofing", "project_subtype": "Roof Replacement"}, ("roofing", "replacement")),
            ({"project_type": "Plumbing", "project_subtype": "Leak Repair"}, ("plumbing", "repair")),
            ({"project_type": "Electrical", "project_subtype": "Electrical Repair"}, ("electrical", "repair")),
            ({"project_type": "Flooring", "project_subtype": "Flooring Installation"}, ("flooring", "install")),
            ({"project_type": "Painting", "project_subtype": "Interior Painting"}, ("painting", "interior")),
            ({"project_type": "Handyman", "project_subtype": "General Handyman Work"}, ("handyman", "general")),
        ]
        for fields, expected in cases:
            with self.subTest(fields=fields):
                classification, _ = classify_proposal_benchmark(self._proposal(**fields))
                self.assertEqual((classification["project_family_key"], classification["scope_mode"]), expected)

    def test_custom_template_inherits_source_benchmark_metadata(self):
        source = SimpleNamespace(
            benchmark_match_key="remodel:bathroom_remodel",
            project_type="Remodel",
            project_subtype="Bathroom Remodel",
        )
        template = SimpleNamespace(
            name="My Primary Bath Workflow",
            benchmark_match_key="",
            project_type="",
            project_subtype="",
            source_system_template=source,
        )
        classification, _ = classify_proposal_benchmark(self._proposal(summary="Repair drywall", template=template))
        self.assertEqual(classification["scope_mode"], "remodel")
        self.assertEqual(classification["classification_source"], "source_template_benchmark_metadata")


class ProposalPricingBenchmarkTests(TestCase):
    def setUp(self):
        User = get_user_model()
        self.user = User.objects.create_user(email="benchmark@example.com", password="test-pass")
        self.contractor = Contractor.objects.create(user=self.user, business_name="Benchmark Builder")
        self.other_user = User.objects.create_user(email="benchmark-other@example.com", password="test-pass")
        self.other_contractor = Contractor.objects.create(user=self.other_user, business_name="Other Builder")
        self.entry = ContractorDirectoryEntry.objects.create(
            business_name="Benchmark Builder",
            normalized_name=normalize_business_name("Benchmark Builder"),
            claimed=True,
            claimed_by_contractor=self.contractor,
        )
        self.opportunity = ContractorOpportunity.objects.create(
            directory_entry=self.entry,
            project_title="Bathroom Remodel",
            project_type="Remodel",
            project_subtype="Bathroom",
            project_description="Renovate the bathroom.",
            project_city="Austin",
            project_state="TX",
        )
        self.proposal = Proposal.objects.create(
            contractor=self.contractor,
            contractor_opportunity=self.opportunity,
            source_type=Proposal.SOURCE_OPPORTUNITY,
            source_id=self.opportunity.id,
            project_title="Bathroom Remodel",
            project_type="Remodel",
            project_subtype="Bathroom",
            project_summary="Renovate the bathroom.",
        )
        ProposalLineItem.objects.create(
            proposal=self.proposal,
            category=ProposalLineItem.CATEGORY_LABOR,
            description="Bathroom work",
            quantity=1,
            unit_price="16500.00",
        )
        self.client = APIClient()
        _use_secure_requests(self.client)
        self.client.force_authenticate(self.user)

    @property
    def url(self):
        return f"/api/projects/proposals/{self.proposal.id}/pricing-benchmark/"

    def _contractor_aggregate(self, count=6):
        return ContractorBenchmarkAggregate.objects.create(
            contractor=self.contractor,
            project_family_key="bathroom_remodel",
            scope_mode="remodel",
            sample_size=count,
            p25_project_value="13500.00",
            p50_project_value="14600.00",
            p75_project_value="15800.00",
        )

    def _regional_aggregate(self, count):
        return RegionalBenchmarkAggregate.objects.create(
            region_key="US-TX-AUSTIN",
            region_label="Austin, TX",
            region_granularity="city",
            project_family_key="bathroom_remodel",
            scope_mode="remodel",
            sample_size=count,
            p25_project_value="14200.00",
            p50_project_value="15500.00",
            p75_project_value="17400.00",
        )

    def test_owned_proposal_returns_contractor_position_without_raw_records(self):
        self._contractor_aggregate()
        response = self.client.get(self.url)
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.data["contractor"]["position"], "above")
        self.assertEqual(response.data["current_total"], "16500.00")
        serialized = str(response.data).lower()
        self.assertNotIn("customer", serialized)
        self.assertNotIn("contractor_id", serialized)
        self.assertNotIn("project_id", serialized)

    def test_bathroom_template_selects_remodel_aggregate_despite_repair_wording(self):
        template = ProjectTemplate.objects.create(
            name="Bathroom Remodel",
            project_type="Remodel",
            project_subtype="Bathroom Remodel",
            benchmark_match_key="remodel:bathroom_remodel",
            is_system=True,
            is_published=True,
        )
        self.proposal.selected_template = template
        self.proposal.selected_template_name_snapshot = template.name
        self.proposal.project_summary = "Repair localized drywall while completing the bathroom renovation."
        self.proposal.save(update_fields=["selected_template", "selected_template_name_snapshot", "project_summary"])
        ContractorBenchmarkAggregate.objects.create(
            contractor=self.contractor,
            project_family_key="bathroom_remodel",
            scope_mode="remodel",
            template_used=template.name,
            sample_size=5,
            p25_project_value="14000.00",
            p50_project_value="15000.00",
            p75_project_value="17000.00",
        )
        response = self.client.get(self.url)
        self.assertEqual(response.data["classification"]["scope_mode"], "remodel")
        self.assertEqual(response.data["classification"]["classification_source"], "template_benchmark_metadata")
        self.assertEqual(response.data["classification"]["match_description"], "Bathroom Remodel · Remodel")
        self.assertTrue(response.data["contractor"]["available"])
        self.assertEqual(response.data["contractor"]["position"], "within")

    def test_other_contractor_cannot_access_proposal(self):
        self.client.force_authenticate(self.other_user)
        self.assertEqual(self.client.get(self.url).status_code, 404)

    def test_regional_values_are_fully_suppressed_below_minimum(self):
        for count in (1, 2, 4):
            RegionalBenchmarkAggregate.objects.all().delete()
            self._regional_aggregate(count)
            regional = self.client.get(self.url).data["regional"]
            self.assertEqual(regional, {
                "available": False,
                "reason": "insufficient_comparable_data",
                "minimum_required": MIN_REGIONAL_BENCHMARK_SAMPLE,
            })

    def test_regional_values_are_exposed_at_privacy_threshold(self):
        self._regional_aggregate(MIN_REGIONAL_BENCHMARK_SAMPLE)
        regional = self.client.get(self.url).data["regional"]
        self.assertTrue(regional["available"])
        self.assertEqual(regional["count"], 5)
        self.assertEqual(regional["position"], "within")

    def test_unstructured_proposal_location_is_not_claimed_as_geography(self):
        self.proposal.contractor_opportunity = None
        self.proposal.service_location = "somewhere near downtown"
        self.proposal.save(update_fields=["contractor_opportunity", "service_location"])
        response = self.client.get(self.url)
        self.assertFalse(response.data["regional"]["available"])


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


class ProposalWorkspaceFoundationTests(TestCase):
    def setUp(self):
        User = get_user_model()
        self.user = User.objects.create_user(email="contractor@example.com", password="test-pass")
        self.contractor = Contractor.objects.create(user=self.user, business_name="Proposal Builder LLC")
        self.other_user = User.objects.create_user(email="other@example.com", password="test-pass")
        self.other_contractor = Contractor.objects.create(user=self.other_user, business_name="Other Pro")
        self.entry = ContractorDirectoryEntry.objects.create(
            business_name="Proposal Builder LLC",
            normalized_name=normalize_business_name("Proposal Builder LLC"),
            claimed=True,
            claimed_by_contractor=self.contractor,
        )
        self.opportunity = ContractorOpportunity.objects.create(
            directory_entry=self.entry,
            homeowner_name="Casey Homeowner",
            homeowner_email="casey@example.com",
            homeowner_phone="512-555-2222",
            project_address="123 Main St",
            project_city="Austin",
            project_state="TX",
            project_zip="78701",
            project_title="Kitchen Refresh",
            project_type="Remodel",
            project_subtype="Kitchen",
            project_description="Refresh cabinets and counters.",
        )
        self.appointment = OpportunityEstimateAppointment.objects.create(
            contractor=self.contractor,
            source_type=OpportunityEstimateAppointment.SOURCE_OPPORTUNITY,
            contractor_opportunity=self.opportunity,
            opportunity_title="Kitchen Refresh",
            opportunity_reference=f"Opportunity #{self.opportunity.id}",
            customer_name="Casey Homeowner",
            customer_email="casey@example.com",
            customer_phone="512-555-2222",
            service_location="123 Main St, Austin, TX 78701",
            appointment_type=OpportunityEstimateAppointment.TYPE_IN_PERSON,
            scheduled_start=timezone.now() + timedelta(days=1),
            duration_minutes=60,
            notes="Bring tape measure.",
        )
        self.client = APIClient()
        _use_secure_requests(self.client)
        self.client.force_authenticate(self.user)

    def _create_proposal(self):
        return self.client.post(
            "/api/projects/proposals/",
            {
                "source_type": "opportunity",
                "source_id": self.opportunity.id,
                "estimate_appointment_id": self.appointment.id,
            },
            format="json",
        )

    def test_create_proposal_links_opportunity_and_appointment_with_snapshots(self):
        response = self._create_proposal()

        self.assertEqual(response.status_code, 201)
        self.assertTrue(response.data["created"])
        proposal = Proposal.objects.get()
        self.assertEqual(proposal.contractor, self.contractor)
        self.assertEqual(proposal.contractor_opportunity, self.opportunity)
        self.assertEqual(proposal.estimate_appointment, self.appointment)
        self.assertEqual(proposal.project_title, "Kitchen Refresh")
        self.assertEqual(proposal.customer_email, "casey@example.com")
        self.assertEqual(proposal.status, Proposal.STATUS_IN_PROGRESS)
        self.assertEqual(ProposalActivity.objects.filter(proposal=proposal).count(), 2)

    def test_create_proposal_is_idempotent_for_source(self):
        first = self._create_proposal()
        second = self._create_proposal()

        self.assertEqual(first.status_code, 201)
        self.assertEqual(second.status_code, 200)
        self.assertFalse(second.data["created"])
        self.assertEqual(Proposal.objects.count(), 1)

    def test_routine_updates_ignore_client_supplied_lifecycle_status(self):
        proposal = Proposal.objects.create(
            contractor=self.contractor,
            contractor_opportunity=self.opportunity,
            source_type=Proposal.SOURCE_OPPORTUNITY,
            source_id=self.opportunity.id,
            project_title="Kitchen Refresh",
        )

        response = self.client.patch(
            f"/api/projects/proposals/{proposal.id}/",
            {"status": Proposal.STATUS_READY, "project_title": "Updated title"},
            format="json",
        )
        self.assertEqual(response.status_code, 200)
        proposal.refresh_from_db()
        self.assertEqual(proposal.status, Proposal.STATUS_IN_PROGRESS)
        self.assertEqual(proposal.project_title, "Updated title")
        self.assertFalse(ProposalActivity.objects.filter(proposal=proposal, event_type=ProposalActivity.EVENT_STATUS_UPDATED).exists())

    def test_customer_lifecycle_status_payloads_are_ignored(self):
        proposal = Proposal.objects.create(contractor=self.contractor, source_type=Proposal.SOURCE_OPPORTUNITY, source_id=self.opportunity.id, project_title="Kitchen")
        for status in (Proposal.STATUS_VIEWED, Proposal.STATUS_ACCEPTED, Proposal.STATUS_DECLINED, Proposal.STATUS_REVISION_REQUESTED):
            with self.subTest(status=status):
                response = self.client.patch(f"/api/projects/proposals/{proposal.id}/", {"status": status}, format="json")
                self.assertEqual(response.status_code, 200)
                proposal.refresh_from_db()
                self.assertEqual(proposal.status, Proposal.STATUS_IN_PROGRESS)

    def test_readiness_promotes_pre_customer_state_but_cannot_downgrade_accepted(self):
        proposal = Proposal.objects.create(
            contractor=self.contractor,
            source_type=Proposal.SOURCE_OPPORTUNITY,
            source_id=self.opportunity.id,
            status=Proposal.STATUS_IN_PROGRESS,
            project_title="QA Bathroom Remodel",
            customer_name="Casey Homeowner",
            customer_email="casey@example.com",
            service_location="123 Main St",
            included_work="Renovate the bathroom",
        )
        ProposalLineItem.objects.create(
            proposal=proposal, category="labor", description="Bathroom work", quantity=1, unit_price=500,
        )
        ready = self.client.patch(
            f"/api/projects/proposals/{proposal.id}/", {"recalculate_readiness": True}, format="json"
        )
        self.assertEqual(ready.data["status"], Proposal.STATUS_READY)

        ProposalReviewVersion.objects.create(
            proposal=proposal,
            version=1,
            customer_email="casey@example.com",
            snapshot={},
            sent_at=timezone.now(),
            decision=ProposalReviewVersion.DECISION_ACCEPTED,
            decided_at=timezone.now(),
        )
        proposal.status = Proposal.STATUS_ACCEPTED
        proposal.save(update_fields=["status"])
        stale = self.client.patch(
            f"/api/projects/proposals/{proposal.id}/",
            {"status": Proposal.STATUS_READY, "recalculate_readiness": True, "included_work": "Updated scope"},
            format="json",
        )
        self.assertEqual(stale.status_code, 200)
        self.assertEqual(stale.data["status"], Proposal.STATUS_ACCEPTED)
        proposal.refresh_from_db()
        self.assertEqual(proposal.status, Proposal.STATUS_ACCEPTED)

    def test_reload_and_edit_cannot_downgrade_authoritatively_converted_estimate(self):
        proposal = Proposal.objects.create(
            contractor=self.contractor,
            source_type=Proposal.SOURCE_OPPORTUNITY,
            source_id=self.opportunity.id,
            status=Proposal.STATUS_READY,
            project_title="QA Bathroom Remodel",
        )
        homeowner = Homeowner.objects.create(created_by=self.contractor, full_name="Casey Homeowner")
        project = Project.objects.create(contractor=self.contractor, homeowner=homeowner, title="Bathroom Agreement")
        agreement = Agreement.objects.create(project=project, contractor=self.contractor, homeowner=homeowner)
        proposal.converted_agreement = agreement
        proposal.save(update_fields=["converted_agreement"])

        response = self.client.patch(
            f"/api/projects/proposals/{proposal.id}/",
            {"status": Proposal.STATUS_READY, "recalculate_readiness": True, "internal_notes": "Still linked"},
            format="json",
        )
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.data["status"], Proposal.STATUS_CONVERTED)
        self.assertEqual(response.data["linked_agreement_id"], agreement.id)
        proposal.refresh_from_db()
        self.assertEqual(proposal.status, Proposal.STATUS_CONVERTED)

    @patch("projects.services.proposal_customer_review.send_postmark_email", return_value=(True, "sent"))
    def test_send_view_and_accept_are_versioned_private_and_idempotent(self, _email):
        proposal = Proposal.objects.create(
            contractor=self.contractor, source_type=Proposal.SOURCE_OPPORTUNITY, source_id=self.opportunity.id,
            status=Proposal.STATUS_READY, project_title="Kitchen Refresh", project_summary="Customer-safe summary",
            customer_name="Casey Homeowner", customer_email="casey@example.com", service_location="123 Main St",
            internal_notes="private note", risk_notes="private risk",
        )
        ProposalLineItem.objects.create(proposal=proposal, category="labor", description="Installation", quantity=1, unit_price=500, notes="private margin")
        sent = self.client.post(f"/api/projects/proposals/{proposal.id}/send-review/", {}, format="json")
        self.assertEqual(sent.status_code, 200)
        review = ProposalReviewVersion.objects.get(proposal=proposal)
        self.assertEqual(review.version, 1)
        snapshot_text = str(review.snapshot)
        self.assertNotIn("private note", snapshot_text)
        self.assertNotIn("private risk", snapshot_text)
        self.assertNotIn("private margin", snapshot_text)

        public = APIClient()
        _use_secure_requests(public)
        token = token_for(review)
        viewed = public.get(f"/api/projects/proposal-reviews/{token}/")
        self.assertEqual(viewed.status_code, 200)
        proposal.refresh_from_db(); review.refresh_from_db()
        viewed_at = review.viewed_at
        self.assertEqual(proposal.status, Proposal.STATUS_VIEWED)
        self.assertIsNotNone(viewed_at)
        public.get(f"/api/projects/proposal-reviews/{token}/")
        review.refresh_from_db(); self.assertEqual(review.viewed_at, viewed_at)

        accepted = public.post(f"/api/projects/proposal-reviews/{token}/", {"action": "accept", "acknowledgement": ACKNOWLEDGEMENT}, format="json")
        self.assertEqual(accepted.status_code, 200)
        repeated = public.post(f"/api/projects/proposal-reviews/{token}/", {"action": "accept", "acknowledgement": ACKNOWLEDGEMENT}, format="json")
        self.assertEqual(repeated.status_code, 200)
        proposal.refresh_from_db(); review.refresh_from_db()
        self.assertEqual(proposal.status, Proposal.STATUS_ACCEPTED)
        self.assertEqual(review.acceptance_acknowledgement, ACKNOWLEDGEMENT)
        self.assertEqual(ProposalActivity.objects.filter(proposal=proposal, event_type=ProposalActivity.EVENT_ESTIMATE_ACCEPTED).count(), 1)
        notifications = Notification.objects.filter(contractor=self.contractor).order_by("created_at")
        self.assertEqual(notifications.count(), 2)
        viewed_notification, accepted_notification = notifications
        self.assertEqual(viewed_notification.event_type, Notification.EVENT_ESTIMATE_VIEWED)
        self.assertEqual(accepted_notification.event_type, Notification.EVENT_ESTIMATE_ACCEPTED)
        self.assertEqual(accepted_notification.link, f"/app/proposals/{proposal.id}?section=ready")
        self.assertFalse(accepted_notification.is_read)
        self.assertEqual(Notification.objects.filter(contractor=self.other_contractor).count(), 0)
        unread = self.client.get("/api/notifications/unread-count/")
        self.assertEqual(unread.status_code, 200)
        self.assertEqual(unread.data["count"], 2)
        bell_rows = self.client.get("/api/notifications/").data
        accepted_row = next(row for row in bell_rows if row["event_type"] == Notification.EVENT_ESTIMATE_ACCEPTED)
        self.assertEqual(accepted_row["action_label"], "Create Agreement")
        self.assertEqual(accepted_row["action_url"], f"/app/proposals/{proposal.id}?section=ready")
        marked = self.client.post(f"/api/notifications/{accepted_notification.id}/read/")
        self.assertEqual(marked.status_code, 200)
        self.assertTrue(marked.data["is_read"])
        self.assertEqual(self.client.get("/api/notifications/unread-count/").data["count"], 1)

    def test_revision_and_decline_notifications_are_safe_actionable_and_idempotent(self):
        public = APIClient(); _use_secure_requests(public)
        cases = [
            ("request_changes", {"message": "  I'll do <b>cleanup</b>  "}, Notification.EVENT_ESTIMATE_REVISION_REQUESTED, "Changes requested", "Review Requested Changes"),
            ("decline", {"reason": "Price"}, Notification.EVENT_ESTIMATE_DECLINED, "Estimate declined", "View Estimate"),
        ]
        for index, (action, payload, event_type, title, action_label) in enumerate(cases, start=700):
            with self.subTest(action=action):
                proposal = Proposal.objects.create(
                    contractor=self.contractor, source_type=Proposal.SOURCE_DASHBOARD, source_id=index,
                    status=Proposal.STATUS_SENT, project_title=f"Bathroom {index}", customer_name="Casey Homeowner",
                    customer_email="casey@example.com",
                )
                review = ProposalReviewVersion.objects.create(
                    proposal=proposal, version=1, customer_email=proposal.customer_email, snapshot={}, sent_at=timezone.now(),
                )
                token = token_for(review)
                first = public.post(f"/api/projects/proposal-reviews/{token}/", {"action": action, **payload}, format="json")
                replay = public.post(f"/api/projects/proposal-reviews/{token}/", {"action": action, **payload}, format="json")
                self.assertEqual(first.status_code, 200)
                self.assertEqual(replay.status_code, 200)
                rows = Notification.objects.filter(contractor=self.contractor, event_type=event_type)
                self.assertEqual(rows.count(), 1)
                notification = rows.get()
                self.assertEqual(notification.title, title)
                self.assertNotIn("<b>", notification.message)
                self.assertEqual(notification.link, f"/app/proposals/{proposal.id}?section=ready")
                from projects.services.notification_center import notification_action_label
                self.assertEqual(notification_action_label(notification), action_label)

    def test_proposal_detail_returns_versioned_customer_request_history(self):
        proposal = Proposal.objects.create(
            contractor=self.contractor, source_type=Proposal.SOURCE_DASHBOARD, source_id=702,
            status=Proposal.STATUS_REVISION_REQUESTED, project_title="Bathroom",
            customer_name="Casey", customer_email="casey@example.com",
        )
        first_time = timezone.now() - timedelta(days=2)
        second_time = timezone.now()
        ProposalReviewVersion.objects.create(
            proposal=proposal, version=1, customer_email=proposal.customer_email, snapshot={},
            decision=ProposalReviewVersion.DECISION_REVISION_REQUESTED, decided_at=first_time,
            revision_request_message="Request A",
        )
        ProposalReviewVersion.objects.create(
            proposal=proposal, version=2, customer_email=proposal.customer_email, snapshot={},
            decision=ProposalReviewVersion.DECISION_REVISION_REQUESTED, decided_at=second_time,
            revision_request_message="Request B",
        )

        response = self.client.get(f"/api/projects/proposals/{proposal.id}/")

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.data["customer_review"]["revision_request_message"], "Request B")
        self.assertEqual(
            [(row["version"], row["revision_request_message"]) for row in response.data["customer_review_history"]],
            [(2, "Request B"), (1, "Request A")],
        )

    def test_estimate_question_is_idempotent_not_a_revision_and_contractor_can_reply(self):
        proposal = Proposal.objects.create(
            contractor=self.contractor, source_type=Proposal.SOURCE_DASHBOARD, source_id=703,
            status=Proposal.STATUS_SENT, project_title="Bathroom", customer_name="Casey Homeowner",
            customer_email="casey@example.com",
        )
        review = ProposalReviewVersion.objects.create(proposal=proposal, version=1, customer_email=proposal.customer_email, snapshot={}, sent_at=timezone.now())
        public = APIClient(); _use_secure_requests(public)
        url = f"/api/projects/proposal-reviews/{token_for(review)}/messages/"
        headers = {"HTTP_IDEMPOTENCY_KEY": "question-703"}
        first = public.post(url, {"message": "Does <b>this</b> include cleanup?"}, format="json", **headers)
        replay = public.post(url, {"message": "Does <b>this</b> include cleanup?"}, format="json", **headers)
        self.assertEqual(first.status_code, 201)
        self.assertEqual(replay.status_code, 201)
        proposal.refresh_from_db()
        self.assertEqual(proposal.status, Proposal.STATUS_SENT)
        conversation = CustomerConversation.objects.get(proposal=proposal)
        self.assertEqual(conversation.messages.count(), 1)
        self.assertEqual(conversation.messages.get().message_text, "Does this include cleanup?")
        self.assertEqual(Notification.objects.filter(event_type=Notification.EVENT_ESTIMATE_CUSTOMER_MESSAGE).count(), 1)

        with patch("projects.services.customer_conversations.send_postmark_email", return_value=(True, "sent")) as email:
            reply = self.client.post(f"/api/projects/proposals/{proposal.id}/messages/", {"message": "Yes, cleanup is included."}, format="json", HTTP_IDEMPOTENCY_KEY="reply-703")
        self.assertEqual(reply.status_code, 201)
        self.assertEqual(conversation.messages.count(), 2)
        self.assertTrue(conversation.messages.get(sender_type=ConversationMessage.SENDER_CUSTOMER).contractor_read_at)
        email.assert_called_once()

    def test_conversation_links_to_agreement_and_project_during_conversion(self):
        homeowner, proposal, _review = self._accepted_proposal_for_conversion(source_id=704)
        conversation = CustomerConversation.objects.create(
            contractor=self.contractor, customer=homeowner, proposal=proposal,
            customer_name=proposal.customer_name, customer_email=proposal.customer_email,
        )
        message = ConversationMessage.objects.create(
            conversation=conversation, sender_type=ConversationMessage.SENDER_CUSTOMER,
            sender_display_name=proposal.customer_name, message_text="Does cleanup include hauling?",
            lifecycle_context=ConversationMessage.CONTEXT_ESTIMATE,
        )
        payload = {"source_proposal_id": proposal.id, "homeowner": homeowner.id, "is_draft": True, "wizard_step": 1}
        response = self.client.post("/api/projects/agreements/", payload, format="json")
        self.assertEqual(response.status_code, 201, response.data)
        conversation.refresh_from_db()
        self.assertEqual(conversation.agreement_id, response.data["id"])
        self.assertEqual(conversation.project_id, Agreement.objects.get(pk=response.data["id"]).project_id)
        self.assertEqual(CustomerConversation.objects.filter(proposal=proposal).count(), 1)
        self.assertEqual(conversation.messages.count(), 1)
        self.assertEqual(conversation.messages.get(), message)

    @patch("projects.services.proposal_customer_review.send_compliant_sms")
    @patch("projects.services.proposal_customer_review.send_postmark_email", return_value=(True, "sent"))
    @patch("projects.services.sms_service._twilio_ready", return_value=True)
    def test_review_delivery_supports_both_channels_and_persists_partial_failure(self, _ready, _email, sms):
        proposal = Proposal.objects.create(
            contractor=self.contractor, source_type=Proposal.SOURCE_OPPORTUNITY, source_id=self.opportunity.id,
            status=Proposal.STATUS_READY, project_title="Kitchen", customer_name="Casey",
            customer_email="casey@example.com", customer_phone="5125550199",
        )
        SMSConsent.objects.create(phone_number_e164="+15125550199", can_send_sms=True, opted_out=False)
        ProposalLineItem.objects.create(proposal=proposal, category="labor", description="Work", quantity=1, unit_price=500)
        sms.return_value = {"ok": False, "status": "failed", "reason_code": "twilio_error", "twilio_sid": ""}
        response = self.client.post(
            f"/api/projects/proposals/{proposal.id}/send-review/", {"channels": ["email", "sms"]}, format="json"
        )
        self.assertEqual(response.status_code, 200)
        proposal.refresh_from_db()
        review = ProposalReviewVersion.objects.get(proposal=proposal)
        self.assertEqual(proposal.status, Proposal.STATUS_SENT)
        self.assertTrue(review.delivery_state["email"]["ok"])
        self.assertFalse(review.delivery_state["sms"]["ok"])
        self.assertEqual(review.delivery_state["succeeded_channels"], ["email"])
        self.assertNotIn("twilio_error", review.delivery_state["sms"]["message"])

    def test_sms_eligibility_exposes_explicit_channel_states(self):
        proposal = Proposal.objects.create(
            contractor=self.contractor, source_type=Proposal.SOURCE_DASHBOARD, source_id=999, project_title="Kitchen",
            customer_name="Casey", customer_phone="5125550199",
        )
        with patch("projects.services.sms_service._twilio_ready", return_value=True):
            self.assertEqual(review_delivery_eligibility(proposal)["sms"]["state"], "consent_required")
            consent = SMSConsent.objects.create(phone_number_e164="+15125550199", can_send_sms=True, opted_out=False)
            self.assertEqual(review_delivery_eligibility(proposal)["sms"]["state"], "ready")
            consent.can_send_sms = False; consent.save(update_fields=["can_send_sms"])
            review = ProposalReviewVersion.objects.create(proposal=proposal, version=1, customer_email="", snapshot={}, delivery_state={"sms": {"status": "consent_pending"}})
            self.assertEqual(review_delivery_eligibility(proposal)["sms"]["state"], "consent_pending")
            consent.opted_out = True; consent.save(update_fields=["opted_out"])
            self.assertEqual(review_delivery_eligibility(proposal)["sms"]["state"], "opted_out")
            review.delete(); proposal.customer_phone = "not-a-phone"; proposal.save(update_fields=["customer_phone"])
            self.assertEqual(review_delivery_eligibility(proposal)["sms"]["state"], "no_phone")
        proposal.customer_phone = "5125550199"; proposal.save(update_fields=["customer_phone"])
        consent.opted_out = False; consent.save(update_fields=["opted_out"])
        with patch("projects.services.sms_service._twilio_ready", return_value=False):
            self.assertEqual(review_delivery_eligibility(proposal)["sms"]["state"], "provider_unavailable")

    @override_settings(
        TWILIO_ACCOUNT_SID="AC-test", TWILIO_AUTH_TOKEN="token", TWILIO_MESSAGING_SERVICE_SID="",
        TWILIO_PHONE_NUMBER="+15551234567", TWILIO_FROM_NUMBER="",
    )
    def test_twilio_sender_number_is_a_supported_provider_configuration(self):
        with patch("projects.services.sms_service.Client", object()):
            self.assertTrue(sms_service._twilio_ready())
            self.assertEqual(sms_service._twilio_send_kwargs(to="+15125550199", body="Test")["from_"], "+15551234567")

    @patch("projects.services.proposal_customer_review.send_sms_opt_in_request")
    @patch("projects.services.sms_service._twilio_ready", return_value=True)
    def test_review_sms_without_consent_waits_and_reuses_review_version(self, _ready, opt_in_request):
        proposal = Proposal.objects.create(
            contractor=self.contractor, source_type=Proposal.SOURCE_OPPORTUNITY, source_id=self.opportunity.id,
            status=Proposal.STATUS_READY, project_title="Kitchen", customer_name="Casey", customer_phone="5125550199",
        )
        ProposalLineItem.objects.create(proposal=proposal, category="labor", description="Work", quantity=1, unit_price=500)
        opt_in_request.return_value = {"ok": True, "status": "consent_request_sent", "reason_code": "consent_pending", "detail": "Opt-in request sent.", "twilio_sid": "SM-CONSENT"}
        first = self.client.post(f"/api/projects/proposals/{proposal.id}/send-review/", {"channels": ["sms"]}, format="json")
        second = self.client.post(f"/api/projects/proposals/{proposal.id}/send-review/", {"channels": ["sms"]}, format="json")
        self.assertEqual(first.status_code, 200)
        self.assertEqual(second.status_code, 200)
        proposal.refresh_from_db()
        self.assertEqual(proposal.status, Proposal.STATUS_READY)
        self.assertEqual(ProposalReviewVersion.objects.filter(proposal=proposal).count(), 1)
        review = ProposalReviewVersion.objects.get(proposal=proposal)
        self.assertEqual(review.delivery_state["sms"]["status"], "consent_pending")
        self.assertIsNone(review.sent_at)

    @patch("projects.services.proposal_customer_review.send_compliant_sms")
    def test_yes_records_consent_and_releases_same_pending_review(self, sms):
        proposal = Proposal.objects.create(
            contractor=self.contractor, source_type=Proposal.SOURCE_OPPORTUNITY, source_id=self.opportunity.id,
            status=Proposal.STATUS_READY, project_title="Kitchen", customer_name="Casey", customer_phone="5125550199",
        )
        review = ProposalReviewVersion.objects.create(
            proposal=proposal, version=1, customer_email="", snapshot={"contractor": {"name": "Builder"}},
            expires_at=timezone.now() + timedelta(days=30), delivery_state={"sms": {"status": "consent_pending"}},
        )
        SMSConsent.objects.create(phone_number_e164="+15125550199", contractor=self.contractor, can_send_sms=False, consent_text_snapshot="estimate_transactional_opt_in_v1")
        sms.return_value = {"ok": True, "status": "sent", "reason_code": "sent", "twilio_sid": "SM-ESTIMATE"}
        result = handle_inbound_sms(from_phone="+15125550199", body="YES", message_sid="SM-INBOUND")
        review.refresh_from_db(); proposal.refresh_from_db()
        consent = SMSConsent.objects.get(phone_number_e164="+15125550199")
        self.assertEqual(result["keyword"], "YES")
        self.assertTrue(consent.can_send_sms)
        self.assertEqual(consent.opted_in_source, SMSConsent.OPT_IN_SOURCE_ESTIMATE_DELIVERY)
        self.assertEqual(review.delivery_state["sms"]["status"], "sent")
        self.assertEqual(review.delivery_state["sms"]["consent_inbound_message_sid"], "SM-INBOUND")
        self.assertEqual(proposal.status, Proposal.STATUS_SENT)
        self.assertEqual(ProposalReviewVersion.objects.filter(proposal=proposal).count(), 1)

    def test_stop_cancels_pending_estimate_sms_without_affecting_email(self):
        proposal = Proposal.objects.create(
            contractor=self.contractor, source_type=Proposal.SOURCE_OPPORTUNITY, source_id=self.opportunity.id,
            status=Proposal.STATUS_SENT, project_title="Kitchen", customer_phone="5125550199",
        )
        review = ProposalReviewVersion.objects.create(
            proposal=proposal, version=1, customer_email="casey@example.com", snapshot={}, sent_at=timezone.now(),
            delivery_state={"email": {"ok": True, "status": "sent"}, "sms": {"status": "consent_pending"}},
        )
        SMSConsent.objects.create(phone_number_e164="+15125550199", contractor=self.contractor, can_send_sms=False)
        handle_inbound_sms(from_phone="+15125550199", body="STOP", message_sid="SM-STOP")
        review.refresh_from_db()
        self.assertEqual(review.delivery_state["sms"]["status"], "opted_out")
        self.assertTrue(review.delivery_state["email"]["ok"])

    @patch("projects.services.proposal_customer_review.send_compliant_sms")
    def test_late_yes_cancels_stale_pending_review_without_sending(self, sms):
        proposal = Proposal.objects.create(
            contractor=self.contractor, source_type=Proposal.SOURCE_OPPORTUNITY, source_id=self.opportunity.id,
            status=Proposal.STATUS_EXPIRED, project_title="Old Kitchen", customer_phone="5125550199",
        )
        review = ProposalReviewVersion.objects.create(
            proposal=proposal, version=1, customer_email="", snapshot={}, expires_at=timezone.now() - timedelta(minutes=1),
            delivery_state={"sms": {"status": "consent_pending"}},
        )
        SMSConsent.objects.create(phone_number_e164="+15125550199", contractor=self.contractor, can_send_sms=False)
        handle_inbound_sms(from_phone="+15125550199", body="YES", message_sid="SM-LATE")
        review.refresh_from_db()
        self.assertEqual(review.delivery_state["sms"]["status"], "cancelled")
        sms.assert_not_called()

    def test_stale_and_expired_review_versions_cannot_be_accepted(self):
        proposal = Proposal.objects.create(contractor=self.contractor, source_type=Proposal.SOURCE_OPPORTUNITY, source_id=self.opportunity.id, status=Proposal.STATUS_SENT, project_title="Kitchen", customer_email="casey@example.com")
        stale = ProposalReviewVersion.objects.create(proposal=proposal, version=1, customer_email=proposal.customer_email, snapshot={})
        ProposalReviewVersion.objects.create(proposal=proposal, version=2, customer_email=proposal.customer_email, snapshot={})
        public = APIClient(); _use_secure_requests(public)
        response = public.post(f"/api/projects/proposal-reviews/{token_for(stale)}/", {"action": "accept", "acknowledgement": ACKNOWLEDGEMENT}, format="json")
        self.assertEqual(response.status_code, 409)
        current = proposal.review_versions.get(version=2); current.expires_at = timezone.now() - timedelta(minutes=1); current.save()
        response = public.post(f"/api/projects/proposal-reviews/{token_for(current)}/", {"action": "accept", "acknowledgement": ACKNOWLEDGEMENT}, format="json")
        self.assertEqual(response.status_code, 410)

    def test_estimate_activation_creates_verified_account_without_temporary_password_and_is_single_use(self):
        proposal = Proposal.objects.create(contractor=self.contractor, source_type=Proposal.SOURCE_OPPORTUNITY, source_id=self.opportunity.id, status=Proposal.STATUS_SENT, project_title="Kitchen", customer_email="CASEY@example.com")
        review = ProposalReviewVersion.objects.create(proposal=proposal, version=1, customer_email="casey@example.com", snapshot={})
        portal = portal_access(review)
        self.assertFalse(portal["account_exists"])
        activation = ProposalPortalActivation.objects.get(review=review)
        token = activation_token_for(activation)
        public = APIClient(); _use_secure_requests(public)
        created = public.post(f"/api/projects/proposal-portal-activations/{token}/", {"password": "Unique-customer-pass-937!", "password_confirm": "Unique-customer-pass-937!"}, format="json")
        self.assertEqual(created.status_code, 200)
        customer_user = get_user_model().objects.get(email__iexact="casey@example.com")
        self.assertTrue(customer_user.is_verified)
        self.assertTrue(customer_user.check_password("Unique-customer-pass-937!"))
        replay = public.post(f"/api/projects/proposal-portal-activations/{token}/", {"password": "Different-pass-938!", "password_confirm": "Different-pass-938!"}, format="json")
        self.assertEqual(replay.status_code, 403)
        self.assertEqual(get_user_model().objects.filter(email__iexact="CASEY@example.com").count(), 1)

    def test_existing_portal_account_is_reused_case_insensitively(self):
        get_user_model().objects.create_user(email="casey@example.com", password="Existing-pass-937!", is_verified=True)
        proposal = Proposal.objects.create(contractor=self.contractor, source_type=Proposal.SOURCE_OPPORTUNITY, source_id=self.opportunity.id, status=Proposal.STATUS_SENT, project_title="Kitchen", customer_email="CASEY@EXAMPLE.COM")
        review = ProposalReviewVersion.objects.create(proposal=proposal, version=1, customer_email="casey@example.com", snapshot={})
        portal = portal_access(review)
        self.assertTrue(portal["account_exists"])
        self.assertEqual(portal["label"], "Open MyHomeBro")
        self.assertFalse(ProposalPortalActivation.objects.filter(review=review).exists())

    def test_portal_estimates_are_email_scoped_and_customer_safe(self):
        proposal = Proposal.objects.create(contractor=self.contractor, source_type=Proposal.SOURCE_OPPORTUNITY, source_id=self.opportunity.id, status=Proposal.STATUS_SENT, project_title="Kitchen", customer_email="casey@example.com", internal_notes="never expose")
        ProposalReviewVersion.objects.create(proposal=proposal, version=1, customer_email="casey@example.com", snapshot={"contractor": {"name": "Builder"}, "project": {"title": "Kitchen", "property": "123 Main"}, "pricing": {"total": "500.00"}})
        own = _estimate_rows("CASEY@example.com")
        other = _estimate_rows("different@example.com")
        self.assertEqual(len(own), 1)
        self.assertEqual(other, [])
        self.assertNotIn("never expose", str(own))

    def _accepted_proposal_for_conversion(self, *, source_id=None):
        homeowner = Homeowner.objects.create(created_by=self.contractor, full_name="Casey Homeowner", email="casey@example.com")
        proposal = Proposal.objects.create(
            contractor=self.contractor, contractor_opportunity=self.opportunity,
            source_type=Proposal.SOURCE_OPPORTUNITY, source_id=source_id or self.opportunity.id,
            status=Proposal.STATUS_ACCEPTED, project_title="Accepted Kitchen", project_summary="Approved description",
            customer_name="Casey Homeowner", customer_email="casey@example.com", service_location="123 Main St",
            included_work="Install cabinets", excluded_work="Appliances", assumptions="Clear access", allowances="Fixtures",
        )
        ProposalLineItem.objects.create(proposal=proposal, category="labor", description="Installation", quantity=1, unit_price=500)
        review = ProposalReviewVersion.objects.create(
            proposal=proposal, version=1, customer_email=proposal.customer_email,
            snapshot=build_customer_snapshot(proposal), decision=ProposalReviewVersion.DECISION_ACCEPTED,
            decided_at=timezone.now(), accepted_by="Casey Homeowner", acceptance_acknowledgement=ACKNOWLEDGEMENT,
        )
        return homeowner, proposal, review

    def test_accepted_proposal_conversion_is_authoritative_transactional_and_idempotent(self):
        homeowner, proposal, review = self._accepted_proposal_for_conversion()
        payload = {
            "source_proposal_id": proposal.id, "homeowner": homeowner.id, "project_title": "Tampered title",
            "description": "Tampered scope", "total_cost": "9999.00", "is_draft": True, "wizard_step": 1, "step_status": "step1",
        }
        created = self.client.post("/api/projects/agreements/", payload, format="json")
        self.assertEqual(created.status_code, 201, created.data)
        agreement_id = created.data["id"]
        agreement = Agreement.objects.get(pk=agreement_id)
        proposal.refresh_from_db(); self.opportunity.refresh_from_db()
        self.assertEqual(agreement.total_cost, 500)
        self.assertIn("Install cabinets", agreement.description)
        self.assertNotIn("Tampered", agreement.description)
        self.assertEqual(proposal.converted_agreement, agreement)
        self.assertEqual(proposal.converted_review_version, review)
        self.assertEqual(proposal.status, Proposal.STATUS_CONVERTED)
        self.assertEqual(proposal.conversion_method, "online")
        self.assertEqual(self.opportunity.converted_agreement, agreement)

        repeated = self.client.post("/api/projects/agreements/", payload, format="json")
        self.assertEqual(repeated.status_code, 200)
        self.assertEqual(repeated.data["id"], agreement_id)
        self.assertFalse(repeated.data["conversion"]["created"])
        self.assertEqual(Agreement.objects.filter(contractor=self.contractor).count(), 1)
        self.assertEqual(ProposalActivity.objects.filter(proposal=proposal, event_type=ProposalActivity.EVENT_AGREEMENT_CREATED).count(), 1)

    def test_accepted_estimate_template_and_project_setup_are_carried_to_agreement(self):
        homeowner, proposal, review = self._accepted_proposal_for_conversion(source_id=706)
        remodel_template = ProjectTemplate.objects.create(
            contractor=self.contractor,
            name="QA Remodel Template",
            project_type="Remodel",
            project_subtype="Bathroom Remodel",
        )
        ProjectTemplate.objects.create(
            contractor=self.contractor,
            name="Bathroom Repair Template",
            project_type="Bathroom Repair",
        )
        proposal.selected_template = remodel_template
        proposal.selected_template_name_snapshot = remodel_template.name
        proposal.project_type = "Remodel"
        proposal.project_subtype = "Bathroom Remodel"
        proposal.save(update_fields=[
            "selected_template", "selected_template_name_snapshot", "project_type", "project_subtype",
        ])
        review.snapshot = build_customer_snapshot(proposal)
        review.save(update_fields=["snapshot"])

        response = self.client.post(
            "/api/projects/agreements/",
            {"source_proposal_id": proposal.id, "homeowner": homeowner.id, "is_draft": True, "wizard_step": 1},
            format="json",
        )

        self.assertEqual(response.status_code, 201, response.data)
        agreement = Agreement.objects.get(pk=response.data["id"])
        self.assertEqual(agreement.selected_template_id, remodel_template.id)
        self.assertEqual(agreement.selected_template_name_snapshot, "QA Remodel Template")
        self.assertEqual(agreement.project_type, "Remodel")
        self.assertEqual(agreement.project_subtype, "Bathroom Remodel")
        self.assertEqual(response.data["source_proposal_id"], proposal.id)
        self.assertEqual(response.data["selected_template_id"], remodel_template.id)
        self.assertEqual(response.data["accepted_estimate_basis"]["review_version"], review.version)

        reloaded = self.client.get(f"/api/projects/agreements/{agreement.id}/")
        self.assertEqual(reloaded.status_code, 200)
        self.assertEqual(reloaded.data["selected_template"]["name"], "QA Remodel Template")

    def test_sent_estimate_template_cannot_be_changed_by_generic_update(self):
        template = ProjectTemplate.objects.create(contractor=self.contractor, name="QA Remodel Template")
        replacement = ProjectTemplate.objects.create(contractor=self.contractor, name="Bathroom Repair Template")
        proposal = Proposal.objects.create(
            contractor=self.contractor,
            source_type=Proposal.SOURCE_DASHBOARD,
            source_id=707,
            status=Proposal.STATUS_ACCEPTED,
            selected_template=template,
            selected_template_name_snapshot=template.name,
        )

        response = self.client.patch(
            f"/api/projects/proposals/{proposal.id}/",
            {"selected_template_id": replacement.id},
            format="json",
        )

        self.assertEqual(response.status_code, 409)
        proposal.refresh_from_db()
        self.assertEqual(proposal.selected_template_id, template.id)

    def test_accepted_snapshot_commercial_basis_maps_reserve_without_double_counting(self):
        homeowner, proposal, review = self._accepted_proposal_for_conversion(source_id=705)
        proposal.line_items.all().delete()
        ProposalLineItem.objects.create(
            proposal=proposal, category=ProposalLineItem.CATEGORY_LABOR,
            description="Approved work", quantity=1, unit_price="15000.00",
        )
        ProposalLineItem.objects.create(
            proposal=proposal, category=ProposalLineItem.CATEGORY_INCIDENTALS_RESERVE,
            description="Incidentals Reserve", quantity=1, unit_price="1500.00",
        )
        review.snapshot = build_customer_snapshot(proposal)
        review.save(update_fields=["snapshot"])
        accepted_snapshot = review.snapshot.copy()

        response = self.client.post(
            "/api/projects/agreements/",
            {
                "source_proposal_id": proposal.id,
                "homeowner": homeowner.id,
                "total_cost": "1.00",
                "incidentals_reserve_amount": "0.00",
                "is_draft": True,
                "wizard_step": 1,
            },
            format="json",
        )

        self.assertEqual(response.status_code, 201, response.data)
        agreement = Agreement.objects.get(pk=response.data["id"])
        review.refresh_from_db()
        self.assertEqual(agreement.total_cost, 15000)
        self.assertEqual(agreement.incidentals_reserve_amount, 1500)
        self.assertEqual(response.data["escrow_funding_summary"]["total_required"], "16500.00")
        self.assertEqual(response.data["accepted_estimate_basis"], {
            "proposal_id": proposal.id,
            "review_version": 1,
            "subtotal": "15000.00",
            "tax": "0.00",
            "discounts": "0.00",
            "incidentals_reserve": "1500.00",
            "total": "16500.00",
            "pricing_rows": review.snapshot["pricing"]["line_items"],
        })
        self.assertEqual(review.snapshot, accepted_snapshot)
        milestone = Milestone.objects.create(agreement=agreement, title="Bathroom work", amount="15000.00", order=1)
        template = ProjectTemplate.objects.create(contractor=self.contractor, name="Bathroom Remodel")
        ProjectTemplateMilestone.objects.create(template=template, title="Template default", suggested_amount_percent="100.00")
        applied = self.client.post(
            f"/api/projects/agreements/{agreement.id}/apply-template/",
            {"template_id": template.id, "overwrite_existing": True, "copy_text_fields": True},
            format="json",
        )
        self.assertEqual(applied.status_code, 200, applied.data)
        milestone.refresh_from_db(); agreement.refresh_from_db()
        self.assertEqual(list(agreement.milestones.values_list("id", flat=True)), [milestone.id])
        self.assertEqual(milestone.amount, 15000)
        self.assertEqual(agreement.incidentals_reserve_amount, 1500)
        self.assertTrue(applied.data["result"]["payment_allocation_preserved"])

        scope_patch = self.client.patch(
            f"/api/projects/agreements/{agreement.id}/",
            {"description": "AI-refined scope", "scope_of_work": "AI-refined scope"},
            format="json",
        )
        self.assertEqual(scope_patch.status_code, 200, scope_patch.data)
        milestone.refresh_from_db(); agreement.refresh_from_db()
        self.assertEqual(milestone.amount, 15000)
        self.assertEqual(agreement.total_cost, 15000)
        self.assertEqual(agreement.incidentals_reserve_amount, 1500)
        review.snapshot = {**accepted_snapshot, "pricing": {**accepted_snapshot["pricing"], "total": "999.00"}}
        with self.assertRaisesRegex(ProposalConversionError, "does not reconcile"):
            _trusted_agreement_payload(review)

    def test_latest_accepted_version_exact_lineage_creates_authoritative_milestone(self):
        homeowner, proposal, first_review = self._accepted_proposal_for_conversion(source_id=706)
        first_review.delete()
        proposal.line_items.all().delete()
        template = ProjectTemplate.objects.create(contractor=self.contractor, name="Bathroom allocation")
        source = ProjectTemplateMilestone.objects.create(template=template, title="Demolition", sort_order=1, normalized_milestone_type="demolition", suggested_amount_percent="13.00")
        line = ProposalLineItem.objects.create(
            proposal=proposal, category=ProposalLineItem.CATEGORY_LABOR, description="Demolition",
            quantity=1, unit_price="1950.00", source_template=template, source_template_milestone=source,
            source_milestone_key="demolition", source_milestone_name="Demolition",
            source_milestone_order=1, source_allocation_percent="13.00",
        )
        ProposalReviewVersion.objects.create(
            proposal=proposal, version=1, customer_email=proposal.customer_email,
            snapshot=build_customer_snapshot(proposal), decision=ProposalReviewVersion.DECISION_REVISION_REQUESTED,
        )
        line.unit_price = "1000.00"
        line.save()
        accepted = ProposalReviewVersion.objects.create(
            proposal=proposal, version=2, customer_email=proposal.customer_email,
            snapshot=build_customer_snapshot(proposal), decision=ProposalReviewVersion.DECISION_ACCEPTED,
        )

        response = self.client.post("/api/projects/agreements/", {
            "source_proposal_id": proposal.id, "homeowner": homeowner.id, "is_draft": True, "wizard_step": 1,
        }, format="json")

        self.assertEqual(response.status_code, 201, response.data)
        milestone = Agreement.objects.get(pk=response.data["id"]).milestones.get()
        self.assertEqual(milestone.amount, 1000)
        self.assertEqual(milestone.accepted_estimate_amount, 1000)
        self.assertEqual(milestone.accepted_estimate_review_version, 2)
        self.assertEqual(milestone.accepted_estimate_line_item_id, line.id)
        self.assertEqual(milestone.accepted_estimate_source_key, "demolition")
        self.assertNotEqual(milestone.amount, 1950)
        accepted.refresh_from_db()
        self.assertEqual(accepted.snapshot["pricing"]["line_items"][0]["total"], "1000.00")
        self.assertNotIn("source_template_milestone_id", public_customer_snapshot(accepted.snapshot)["pricing"]["line_items"][0])

    def test_conversion_rejects_unaccepted_cross_owner_stale_and_post_acceptance_edits(self):
        for index, status_value in enumerate((Proposal.STATUS_READY, Proposal.STATUS_SENT, Proposal.STATUS_VIEWED, Proposal.STATUS_REVISION_REQUESTED, Proposal.STATUS_DECLINED, Proposal.STATUS_EXPIRED), start=100):
            proposal = Proposal.objects.create(contractor=self.contractor, source_type=Proposal.SOURCE_DASHBOARD, source_id=index, status=status_value, project_title="Blocked", customer_name="Casey", customer_email="casey@example.com")
            response = self.client.post("/api/projects/agreements/", {"source_proposal_id": proposal.id, "is_draft": True, "wizard_step": 1}, format="json")
            self.assertEqual(response.status_code, 409, status_value)

        homeowner, accepted, _review = self._accepted_proposal_for_conversion(source_id=999)
        accepted.included_work = "Changed after acceptance"
        accepted.save(update_fields=["included_work", "updated_at"])
        changed = self.client.post("/api/projects/agreements/", {"source_proposal_id": accepted.id, "homeowner": homeowner.id, "is_draft": True, "wizard_step": 1}, format="json")
        self.assertEqual(changed.status_code, 409)
        self.assertIn("changed after acceptance", changed.data["detail"].lower())

        accepted.included_work = "Install cabinets"
        accepted.save(update_fields=["included_work", "updated_at"])
        ProposalReviewVersion.objects.create(proposal=accepted, version=2, customer_email=accepted.customer_email, snapshot=build_customer_snapshot(accepted))
        stale = self.client.post("/api/projects/agreements/", {"source_proposal_id": accepted.id, "homeowner": homeowner.id, "is_draft": True, "wizard_step": 1}, format="json")
        self.assertEqual(stale.status_code, 409)
        self.assertIn("current estimate version", stale.data["detail"].lower())

        foreign = Proposal.objects.create(contractor=self.other_contractor, source_type=Proposal.SOURCE_DASHBOARD, source_id=1000, status=Proposal.STATUS_ACCEPTED, project_title="Foreign", customer_name="Other", customer_email="other-customer@example.com")
        denied = self.client.post("/api/projects/agreements/", {"source_proposal_id": foreign.id, "is_draft": True, "wizard_step": 1}, format="json")
        self.assertEqual(denied.status_code, 404)

    def test_project_identity_contact_and_address_are_proposal_owned_and_patchable(self):
        proposal = Proposal.objects.create(
            contractor=self.contractor,
            source_type=Proposal.SOURCE_OPPORTUNITY,
            source_id=self.opportunity.id,
            project_title="Kitchen Refresh",
            customer_preferred_contact="",
            service_location="123 Main St, Austin, TX 78701",
        )

        response = self.client.patch(
            f"/api/projects/proposals/{proposal.id}/",
            {
                "project_title": "Primary Kitchen Renovation",
                "customer_preferred_contact": "email",
                "service_location": "456 Project Lane, Austin, TX 78702",
            },
            format="json",
        )

        self.assertEqual(response.status_code, 200)
        proposal.refresh_from_db()
        self.assertEqual(proposal.project_title, "Primary Kitchen Renovation")
        self.assertEqual(proposal.customer_preferred_contact, "email")
        self.assertEqual(proposal.service_location, "456 Project Lane, Austin, TX 78702")
        self.assertEqual(response.data["project_title"], "Primary Kitchen Renovation")
        self.assertEqual(response.data["customer_preferred_contact"], "email")

    def test_project_preferred_contact_rejects_unknown_values(self):
        proposal = Proposal.objects.create(
            contractor=self.contractor,
            source_type=Proposal.SOURCE_OPPORTUNITY,
            source_id=self.opportunity.id,
            project_title="Kitchen Refresh",
        )

        response = self.client.patch(
            f"/api/projects/proposals/{proposal.id}/",
            {"customer_preferred_contact": "carrier-pigeon"},
            format="json",
        )

        self.assertEqual(response.status_code, 400)
        proposal.refresh_from_db()
        self.assertEqual(proposal.customer_preferred_contact, "")

    def test_project_preferred_contact_accepts_supported_estimate_preferences(self):
        proposal = Proposal.objects.create(
            contractor=self.contractor,
            source_type=Proposal.SOURCE_OPPORTUNITY,
            source_id=self.opportunity.id,
            project_title="Kitchen Refresh",
        )

        for preference in ("email", "text", "phone", ""):
            with self.subTest(preference=preference or "no-preference"):
                response = self.client.patch(
                    f"/api/projects/proposals/{proposal.id}/",
                    {"customer_preferred_contact": preference},
                    format="json",
                )
                self.assertEqual(response.status_code, 200)
                self.assertEqual(response.data["customer_preferred_contact"], preference)

    def test_measurement_crud(self):
        proposal = Proposal.objects.create(
            contractor=self.contractor,
            source_type=Proposal.SOURCE_OPPORTUNITY,
            source_id=self.opportunity.id,
            project_title="Kitchen Refresh",
        )

        created = self.client.post(
            f"/api/projects/proposals/{proposal.id}/measurements/",
            {"label": "Kitchen width", "location": "Kitchen", "quantity": "12.5", "unit": "ft", "notes": "Wall to wall"},
            format="json",
        )
        self.assertEqual(created.status_code, 201)
        self.assertEqual(created.data["unit"], "ft")
        measurement_id = created.data["id"]
        self.assertEqual(ProposalMeasurement.objects.count(), 1)

        updated = self.client.patch(
            f"/api/projects/proposals/{proposal.id}/measurements/{measurement_id}/",
            {"quantity": "13.0", "notes": "Verified"},
            format="json",
        )
        self.assertEqual(updated.status_code, 200)
        self.assertEqual(updated.data["quantity"], "13.00")

        deleted = self.client.delete(f"/api/projects/proposals/{proposal.id}/measurements/{measurement_id}/")
        self.assertEqual(deleted.status_code, 204)
        self.assertEqual(ProposalMeasurement.objects.count(), 0)

    def test_attachment_crud(self):
        proposal = Proposal.objects.create(
            contractor=self.contractor,
            source_type=Proposal.SOURCE_OPPORTUNITY,
            source_id=self.opportunity.id,
            project_title="Kitchen Refresh",
        )
        upload = SimpleUploadedFile("before.jpg", b"fake-image", content_type="image/jpeg")

        created = self.client.post(
            f"/api/projects/proposals/{proposal.id}/attachments/",
            {"file": upload, "attachment_type": "photo", "category": "before", "caption": "Before photo"},
            format="multipart",
        )
        self.assertEqual(created.status_code, 201)
        attachment_id = created.data["id"]
        self.assertEqual(ProposalAttachment.objects.count(), 1)

        updated = self.client.patch(
            f"/api/projects/proposals/{proposal.id}/attachments/{attachment_id}/",
            {"caption": "Front wall", "category": "reference"},
            format="json",
        )
        self.assertEqual(updated.status_code, 200)
        self.assertEqual(updated.data["caption"], "Front wall")

        deleted = self.client.delete(f"/api/projects/proposals/{proposal.id}/attachments/{attachment_id}/")
        self.assertEqual(deleted.status_code, 204)
        self.assertEqual(ProposalAttachment.objects.count(), 0)

    def test_line_item_crud_and_totals(self):
        proposal = Proposal.objects.create(
            contractor=self.contractor,
            source_type=Proposal.SOURCE_OPPORTUNITY,
            source_id=self.opportunity.id,
            project_title="Kitchen Refresh",
        )

        labor = self.client.post(
            f"/api/projects/proposals/{proposal.id}/line-items/",
            {
                "category": ProposalLineItem.CATEGORY_LABOR,
                "description": "Crew labor",
                "quantity": "10",
                "unit": "hours",
                "unit_price": "75",
                "notes": "Two-person crew",
            },
            format="json",
        )
        self.assertEqual(labor.status_code, 201)
        self.assertEqual(labor.data["line_item"]["unit"], "hr")
        self.assertEqual(labor.data["line_item"]["total"], "750.00")
        self.assertEqual(labor.data["totals"]["subtotal"], "750.00")

        invalid_unit = self.client.post(
            f"/api/projects/proposals/{proposal.id}/line-items/",
            {"description": "Unsafe", "quantity": "1", "unit": "https://example.com", "unit_price": "1"},
            format="json",
        )
        self.assertEqual(invalid_unit.status_code, 400)
        self.assertIn("unit", invalid_unit.data)

        tax = self.client.post(
            f"/api/projects/proposals/{proposal.id}/line-items/",
            {
                "category": ProposalLineItem.CATEGORY_TAX,
                "description": "Sales tax",
                "quantity": "1",
                "unit_price": "50",
            },
            format="json",
        )
        self.assertEqual(tax.status_code, 201)

        discount = self.client.post(
            f"/api/projects/proposals/{proposal.id}/line-items/",
            {
                "category": ProposalLineItem.CATEGORY_DISCOUNT,
                "description": "Preferred customer discount",
                "quantity": "1",
                "unit_price": "25",
            },
            format="json",
        )
        self.assertEqual(discount.status_code, 201)
        self.assertEqual(discount.data["totals"]["total"], "775.00")

        line_item_id = labor.data["line_item"]["id"]
        updated = self.client.patch(
            f"/api/projects/proposals/{proposal.id}/line-items/{line_item_id}/",
            {"quantity": "12", "unit_price": "80"},
            format="json",
        )
        self.assertEqual(updated.status_code, 200)
        self.assertEqual(updated.data["line_item"]["total"], "960.00")
        self.assertEqual(updated.data["totals"]["total"], "985.00")

        deleted = self.client.delete(f"/api/projects/proposals/{proposal.id}/line-items/{line_item_id}/")
        self.assertEqual(deleted.status_code, 200)
        self.assertEqual(deleted.data["totals"]["subtotal"], "0.00")
        self.assertTrue(ProposalActivity.objects.filter(proposal=proposal, event_type=ProposalActivity.EVENT_LINE_ITEM_REMOVED).exists())

    def test_incidentals_reserve_line_affects_proposal_total(self):
        proposal = Proposal.objects.create(
            contractor=self.contractor,
            source_type=Proposal.SOURCE_OPPORTUNITY,
            source_id=self.opportunity.id,
            project_title="Kitchen Refresh",
        )

        base = self.client.post(
            f"/api/projects/proposals/{proposal.id}/line-items/",
            {
                "category": ProposalLineItem.CATEGORY_MATERIALS,
                "description": "Cabinet hardware",
                "quantity": "1",
                "unit_price": "500",
            },
            format="json",
        )
        self.assertEqual(base.status_code, 201)
        reserve = self.client.post(
            f"/api/projects/proposals/{proposal.id}/line-items/",
            {
                "category": ProposalLineItem.CATEGORY_INCIDENTALS_RESERVE,
                "description": "Incidentals reserve",
                "quantity": "1",
                "unit_price": "200",
            },
            format="json",
        )

        self.assertEqual(reserve.status_code, 201)
        self.assertEqual(reserve.data["totals"]["subtotal"], "500.00")
        self.assertEqual(reserve.data["totals"]["incidentals_reserve"], "200.00")
        self.assertEqual(reserve.data["totals"]["total"], "700.00")

    def test_other_contractor_cannot_access_proposal(self):
        proposal = Proposal.objects.create(
            contractor=self.contractor,
            source_type=Proposal.SOURCE_OPPORTUNITY,
            source_id=self.opportunity.id,
            project_title="Kitchen Refresh",
        )
        self.client.force_authenticate(self.other_user)

        response = self.client.get(f"/api/projects/proposals/{proposal.id}/")

        self.assertEqual(response.status_code, 404)

    def test_template_pricing_is_copied_atomically_without_mutating_template(self):
        proposal = Proposal.objects.create(contractor=self.contractor, source_type=Proposal.SOURCE_OPPORTUNITY, source_id=self.opportunity.id, project_title="Kitchen Refresh")
        ProposalLineItem.objects.create(proposal=proposal, description="Existing", quantity=1, unit_price=100)
        template = ProjectTemplate.objects.create(contractor=self.contractor, name="Kitchen Template")
        milestone = ProjectTemplateMilestone.objects.create(
            template=template,
            title="Cabinet installation",
            description="Install selected cabinets.",
            suggested_amount_fixed="1250.00",
        )

        missing_confirmation = self.client.post(
            f"/api/projects/proposals/{proposal.id}/apply-template-pricing/",
            {"template_id": template.id, "mode": "replace"},
            format="json",
        )
        self.assertEqual(missing_confirmation.status_code, 400)
        self.assertEqual(proposal.line_items.count(), 1)

        response = self.client.post(
            f"/api/projects/proposals/{proposal.id}/apply-template-pricing/",
            {"template_id": template.id, "mode": "replace", "confirm_replace": True},
            format="json",
        )
        self.assertEqual(response.status_code, 200)
        self.assertEqual(len(response.data["line_items"]), 1)
        self.assertEqual(response.data["totals"]["total"], "1250.00")
        copied = proposal.line_items.get()
        self.assertNotEqual(copied.id, milestone.id)
        self.assertEqual(copied.description, milestone.title)
        proposal.refresh_from_db()
        self.assertEqual(proposal.selected_template_id, template.id)
        self.assertEqual(proposal.pricing_template_name_snapshot, template.name)
        copied.description = "Contractor edit"
        copied.save()
        milestone.refresh_from_db()
        self.assertEqual(milestone.title, "Cabinet installation")

    def test_template_pricing_rejects_another_contractors_template(self):
        proposal = Proposal.objects.create(contractor=self.contractor, source_type=Proposal.SOURCE_OPPORTUNITY, source_id=self.opportunity.id, project_title="Kitchen Refresh")
        template = ProjectTemplate.objects.create(contractor=self.other_contractor, name="Private Template")
        ProjectTemplateMilestone.objects.create(template=template, title="Private price", suggested_amount_fixed="500.00")

        response = self.client.post(
            f"/api/projects/proposals/{proposal.id}/apply-template-pricing/",
            {"template_id": template.id, "mode": "add"},
            format="json",
        )
        self.assertEqual(response.status_code, 404)
        self.assertFalse(proposal.line_items.exists())

    def test_draft_template_cannot_be_selected_or_applied_to_estimate(self):
        proposal = Proposal.objects.create(contractor=self.contractor, source_type=Proposal.SOURCE_OPPORTUNITY, source_id=self.opportunity.id, project_title="Kitchen Refresh")
        template = ProjectTemplate.objects.create(
            contractor=self.contractor,
            name="Unfinished Template",
            lifecycle_status=ProjectTemplate.LifecycleStatus.DRAFT,
        )
        ProjectTemplateMilestone.objects.create(template=template, title="Draft price", suggested_amount_fixed="500.00")

        select_response = self.client.patch(
            f"/api/projects/proposals/{proposal.id}/",
            {"selected_template_id": template.id},
            format="json",
        )
        apply_response = self.client.post(
            f"/api/projects/proposals/{proposal.id}/apply-template-pricing/",
            {"template_id": template.id, "mode": "add"},
            format="json",
        )

        self.assertEqual(select_response.status_code, 404)
        self.assertEqual(apply_response.status_code, 404)
        self.assertFalse(proposal.line_items.exists())

    def test_reviewed_percentage_pricing_is_applied_atomically(self):
        proposal = Proposal.objects.create(contractor=self.contractor, source_type=Proposal.SOURCE_OPPORTUNITY, source_id=self.opportunity.id, project_title="Kitchen Refresh")
        template = ProjectTemplate.objects.create(contractor=self.contractor, name="Allocation Template")
        template_milestone = ProjectTemplateMilestone.objects.create(template=template, title="Demolition", sort_order=1, normalized_milestone_type="demolition", suggested_amount_percent="25.00")

        response = self.client.post(
            f"/api/projects/proposals/{proposal.id}/apply-template-pricing/",
            {
                "template_id": template.id,
                "mode": "add",
                "target_subtotal": "20000.00",
                "pricing_items": [{
                    "category": ProposalLineItem.CATEGORY_LABOR,
                    "description": "Demolition labor",
                    "quantity": "1",
                    "unit": "ls",
                    "unit_price": "5000.00",
                    "notes": "Template milestone: Demolition (25%)",
                    "source_template_milestone_id": template_milestone.id,
                }],
            },
            format="json",
        )

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.data["totals"]["subtotal"], "5000.00")
        item = proposal.line_items.get()
        self.assertEqual(item.category, ProposalLineItem.CATEGORY_LABOR)
        self.assertEqual(item.unit, "ls")
        self.assertEqual(item.source_template_milestone, template_milestone)
        self.assertEqual(item.source_milestone_name, "Demolition")
        self.assertEqual(item.source_allocation_percent, 25)
        template.refresh_from_db()
        self.assertEqual(template.milestones.get().suggested_amount_percent, 25)
