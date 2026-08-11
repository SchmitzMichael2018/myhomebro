from datetime import timedelta
from unittest.mock import patch

from django.contrib.auth import get_user_model
from django.test import TestCase, override_settings
from django.utils import timezone
from rest_framework.test import APIClient

from projects.models import Contractor, CustomerConversation, ConversationMessage, Notification
from projects.models_proposals import Proposal, ProposalReviewVersion
from projects.models_sms import SMSConsent
from projects.services.customer_conversations import add_contractor_reply, serialize_conversation
from projects.services.proposal_customer_review import token_for


def secure(client):
    for method_name in ("get", "post"):
        original = getattr(client, method_name)
        setattr(client, method_name, lambda *args, _original=original, **kwargs: _original(*args, secure=True, **kwargs))


class EstimateConversationTests(TestCase):
    def setUp(self):
        User = get_user_model()
        self.owner = User.objects.create_user(email="owner@example.com", password="test-pass")
        self.contractor = Contractor.objects.create(user=self.owner, business_name="Builder LLC")
        self.other_user = User.objects.create_user(email="other@example.com", password="test-pass")
        self.other_contractor = Contractor.objects.create(user=self.other_user, business_name="Other LLC")
        self.proposal = Proposal.objects.create(
            contractor=self.contractor, source_type=Proposal.SOURCE_DASHBOARD, source_id=91001,
            status=Proposal.STATUS_SENT, project_title="Bathroom", customer_name="Casey",
            customer_email="casey@example.com", customer_phone="5125550199",
        )
        self.review = ProposalReviewVersion.objects.create(
            proposal=self.proposal, version=1, customer_email=self.proposal.customer_email,
            snapshot={"total": "123.00"}, sent_at=timezone.now(),
        )
        self.public = APIClient(); secure(self.public)
        self.owner_client = APIClient(); secure(self.owner_client); self.owner_client.force_authenticate(self.owner)
        self.other_client = APIClient(); secure(self.other_client); self.other_client.force_authenticate(self.other_user)

    @property
    def public_url(self):
        return f"/api/projects/proposal-reviews/{token_for(self.review)}/messages/"

    def test_question_is_plain_text_idempotent_and_does_not_request_revision(self):
        original_snapshot = self.review.snapshot.copy()
        first = self.public.post(self.public_url, {"message": "Does <script>alert(1)</script> include cleanup?"}, format="json", HTTP_IDEMPOTENCY_KEY="q-1")
        replay = self.public.post(self.public_url, {"message": "ignored replay body"}, format="json", HTTP_IDEMPOTENCY_KEY="q-1")
        self.assertEqual((first.status_code, replay.status_code), (201, 201))
        self.proposal.refresh_from_db(); self.review.refresh_from_db()
        self.assertEqual(self.proposal.status, Proposal.STATUS_SENT)
        self.assertEqual(self.review.snapshot, original_snapshot)
        self.assertEqual(self.review.decision, ProposalReviewVersion.DECISION_PENDING)
        conversation = CustomerConversation.objects.get(proposal=self.proposal)
        self.assertEqual(conversation.messages.count(), 1)
        message = conversation.messages.get()
        self.assertEqual(message.message_text, "Does alert(1) include cleanup?")
        self.assertEqual(message.lifecycle_context, ConversationMessage.CONTEXT_ESTIMATE)
        self.assertEqual(message.proposal_review_version, self.review)
        notifications = Notification.objects.filter(event_type=Notification.EVENT_ESTIMATE_CUSTOMER_MESSAGE)
        self.assertEqual(notifications.count(), 1)
        self.assertEqual(notifications.get().contractor, self.contractor)
        self.assertEqual(notifications.get().link, f"/app/proposals/{self.proposal.id}?section=ready&task=messages")

    def test_invalid_and_superseded_review_tokens_are_rejected(self):
        self.assertEqual(self.public.post("/api/projects/proposal-reviews/not-a-token/messages/", {"message": "Hi"}, format="json").status_code, 404)
        ProposalReviewVersion.objects.create(
            proposal=self.proposal, version=2, customer_email=self.proposal.customer_email,
            snapshot={}, sent_at=timezone.now(),
        )
        self.assertEqual(self.public.post(self.public_url, {"message": "Stale"}, format="json").status_code, 409)
        self.assertFalse(CustomerConversation.objects.exists())

    def test_length_limit_and_contractor_tenant_isolation(self):
        response = self.public.post(self.public_url, {"message": "x" * 4001}, format="json")
        self.assertEqual(response.status_code, 400)
        self.assertFalse(CustomerConversation.objects.exists())
        self.public.post(self.public_url, {"message": "Question"}, format="json")
        endpoint = f"/api/projects/proposals/{self.proposal.id}/messages/"
        self.assertEqual(self.public.get(endpoint).status_code, 401)
        self.assertEqual(self.other_client.get(endpoint).status_code, 404)
        self.assertEqual(self.other_client.post(endpoint, {"message": "Intrusion"}, format="json").status_code, 404)
        self.assertEqual(self.owner_client.get(endpoint).status_code, 200)

    def test_question_and_structured_request_change_histories_coexist(self):
        self.assertEqual(
            self.public.post(self.public_url, {"message": "Is cleanup included?"}, format="json").status_code,
            201,
        )
        decision_url = f"/api/projects/proposal-reviews/{token_for(self.review)}/"
        response = self.public.post(
            decision_url,
            {"action": "request_changes", "message": "Remove the vanity allowance."},
            format="json",
        )
        self.assertEqual(response.status_code, 200)
        self.proposal.refresh_from_db(); self.review.refresh_from_db()
        self.assertEqual(self.proposal.status, Proposal.STATUS_REVISION_REQUESTED)
        self.assertEqual(self.review.decision, ProposalReviewVersion.DECISION_REVISION_REQUESTED)
        self.assertEqual(self.review.revision_request_message, "Remove the vanity allowance.")
        self.assertEqual(self.proposal.customer_conversation.messages.count(), 1)

    @override_settings(FRONTEND_URL="https://app.example.test")
    @patch("projects.services.customer_conversations.send_compliant_sms")
    @patch("projects.services.customer_conversations.send_postmark_email", return_value=(True, "sent"))
    def test_reply_delivery_obeys_sms_consent_and_stop(self, email, sms):
        conversation = CustomerConversation.objects.create(contractor=self.contractor, proposal=self.proposal)
        with self.subTest("no consent"):
            add_contractor_reply(proposal=self.proposal, user=self.owner, text="No SMS", dedupe_key="r-1")
            sms.assert_not_called()
        consent = SMSConsent.objects.create(phone_number_e164="+15125550199", can_send_sms=True, opted_out=False)
        add_contractor_reply(proposal=self.proposal, user=self.owner, text="SMS allowed", dedupe_key="r-2")
        self.assertEqual(sms.call_count, 1)
        consent.can_send_sms = False; consent.opted_out = True; consent.save(update_fields=["can_send_sms", "opted_out"])
        add_contractor_reply(proposal=self.proposal, user=self.owner, text="STOP suppressed", dedupe_key="r-3")
        self.assertEqual(sms.call_count, 1)
        self.assertEqual(email.call_count, 3)
        self.assertEqual(conversation.messages.count(), 3)

    def test_recent_messages_are_bounded_ordered_and_isolated(self):
        conversation = CustomerConversation.objects.create(contractor=self.contractor, proposal=self.proposal)
        other_proposal = Proposal.objects.create(contractor=self.contractor, source_type=Proposal.SOURCE_DASHBOARD, source_id=91002)
        other = CustomerConversation.objects.create(contractor=self.contractor, proposal=other_proposal)
        base = timezone.now() - timedelta(minutes=10)
        for index in range(5):
            row = ConversationMessage.objects.create(conversation=conversation, sender_type="customer", message_text=f"message-{index}", lifecycle_context="estimate")
            ConversationMessage.objects.filter(pk=row.pk).update(created_at=base + timedelta(minutes=index))
        ConversationMessage.objects.create(conversation=other, sender_type="customer", message_text="private-other-thread", lifecycle_context="estimate")
        payload = serialize_conversation(conversation, audience="contractor", limit=3)
        self.assertEqual([row["message_text"] for row in payload["messages"]], ["message-2", "message-3", "message-4"])
        self.assertNotIn("private-other-thread", str(payload))
        self.assertEqual(payload["message_count"], 5)
