from django.conf import settings
from django.db import transaction
from django.utils import timezone
from django.utils.html import strip_tags

from projects.models import ConversationMessage, CustomerConversation, Notification
from projects.services.notification_center import create_notification
from projects.services.invites_delivery import send_postmark_email
from projects.services.sms_service import normalize_phone_to_e164, send_compliant_sms
from projects.models_sms import SMSConsent


MAX_MESSAGE_LENGTH = 4000


def clean_message_text(value) -> str:
    text = "\n".join(line.strip() for line in strip_tags(str(value or "")).splitlines())
    text = "\n".join(line for line in text.splitlines() if line).strip()
    if not text:
        raise ValueError("Enter a message.")
    if len(text) > MAX_MESSAGE_LENGTH:
        raise ValueError(f"Messages must be {MAX_MESSAGE_LENGTH} characters or fewer.")
    return text


def conversation_for_proposal(proposal, *, create=False):
    defaults = {
        "contractor": proposal.contractor,
        "customer_name": proposal.customer_name,
        "customer_email": proposal.customer_email,
        "customer_id": getattr(getattr(proposal, "contractor_opportunity", None), "converted_customer_id", None),
    }
    if create:
        conversation, _ = CustomerConversation.objects.get_or_create(proposal=proposal, defaults=defaults)
        return conversation
    return CustomerConversation.objects.filter(proposal=proposal).first()


def serialize_conversation(conversation, *, audience: str, limit=100):
    if conversation is None:
        return {"id": None, "messages": [], "message_count": 0, "unread_count": 0}
    rows = list(conversation.messages.select_related("sender_user", "proposal_review_version").order_by("-created_at", "-id")[:limit])
    rows.reverse()
    unread = sum(1 for row in rows if (audience == "contractor" and row.sender_type == row.SENDER_CUSTOMER and not row.contractor_read_at) or (audience == "customer" and row.sender_type != row.SENDER_CUSTOMER and not row.customer_read_at))
    return {
        "id": conversation.id,
        "message_count": conversation.messages.count(),
        "unread_count": unread,
        "messages": [{
            "id": row.id, "sender_type": row.sender_type, "sender_name": row.sender_display_name,
            "message_text": row.message_text, "lifecycle_context": row.lifecycle_context,
            "estimate_version": getattr(row.proposal_review_version, "version", None),
            "created_at": row.created_at.isoformat(),
        } for row in rows],
    }


@transaction.atomic
def add_estimate_customer_message(*, review, text, dedupe_key=""):
    conversation = conversation_for_proposal(review.proposal, create=True)
    message, created = ConversationMessage.objects.get_or_create(
        conversation=conversation, dedupe_key=str(dedupe_key or "")[:255],
        defaults={"sender_type": ConversationMessage.SENDER_CUSTOMER, "sender_display_name": review.proposal.customer_name or "Customer", "message_text": clean_message_text(text), "lifecycle_context": ConversationMessage.CONTEXT_ESTIMATE, "proposal_review_version": review},
    ) if dedupe_key else (ConversationMessage.objects.create(conversation=conversation, sender_type=ConversationMessage.SENDER_CUSTOMER, sender_display_name=review.proposal.customer_name or "Customer", message_text=clean_message_text(text), lifecycle_context=ConversationMessage.CONTEXT_ESTIMATE, proposal_review_version=review), True)
    if created:
        preview = message.message_text if len(message.message_text) <= 140 else f"{message.message_text[:139].rstrip()}…"
        create_notification(contractor=review.proposal.contractor, category=Notification.EVENT_ESTIMATE_CUSTOMER_MESSAGE, title="New estimate message", body=f"{review.proposal.customer_name or 'Your customer'} sent a message about {review.proposal.project_title or 'an estimate'}. “{preview}”", link=f"/app/proposals/{review.proposal_id}?section=ready&task=messages", actor_display_name=review.proposal.customer_name, dedupe_key=f"conversation_message:{message.id}")
    return conversation, message, created


@transaction.atomic
def add_contractor_reply(*, proposal, user, text, dedupe_key=""):
    conversation = conversation_for_proposal(proposal, create=True)
    message, created = ConversationMessage.objects.get_or_create(
        conversation=conversation, dedupe_key=str(dedupe_key or "")[:255],
        defaults={"sender_type": ConversationMessage.SENDER_CONTRACTOR, "sender_user": user, "sender_display_name": proposal.contractor.business_name or user.get_full_name() or "Contractor", "message_text": clean_message_text(text), "lifecycle_context": ConversationMessage.CONTEXT_ESTIMATE, "proposal_review_version": proposal.review_versions.order_by("-version").first()},
    ) if dedupe_key else (ConversationMessage.objects.create(conversation=conversation, sender_type=ConversationMessage.SENDER_CONTRACTOR, sender_user=user, sender_display_name=proposal.contractor.business_name or user.get_full_name() or "Contractor", message_text=clean_message_text(text), lifecycle_context=ConversationMessage.CONTEXT_ESTIMATE, proposal_review_version=proposal.review_versions.order_by("-version").first()), True)
    conversation.messages.filter(sender_type=ConversationMessage.SENDER_CUSTOMER, contractor_read_at__isnull=True).update(contractor_read_at=timezone.now())
    if created:
        from projects.services.proposal_customer_review import token_for
        review = message.proposal_review_version
        base = (getattr(settings, "FRONTEND_URL", "") or getattr(settings, "SITE_URL", "")).rstrip("/")
        link = f"{base}/estimate-review/{token_for(review)}" if review else ""
        contractor_name = proposal.contractor.business_name or "Your contractor"
        if proposal.customer_email:
            send_postmark_email(to_email=proposal.customer_email, subject=f"{contractor_name} replied to your estimate question", text_body=f"{contractor_name} replied to your estimate question.\n\nView the response: {link}", html_body=f"<p>{contractor_name} replied to your estimate question.</p><p><a href=\"{link}\">View the response</a></p>")
        phone = normalize_phone_to_e164(proposal.customer_phone)
        consent = SMSConsent.objects.filter(phone_number_e164=phone, can_send_sms=True, opted_out=False).first() if phone else None
        if consent:
            send_compliant_sms(phone, f"MyHomeBro: {contractor_name} replied to your estimate question. View the response: {link}", category="customer_care", dedupe_key=f"conversation-reply:{message.id}")
    return conversation, message, created


def link_conversation_to_agreement(proposal, agreement):
    conversation = conversation_for_proposal(proposal)
    if conversation and (conversation.agreement_id != agreement.id or conversation.project_id != agreement.project_id):
        conversation.agreement = agreement
        conversation.project = agreement.project
        conversation.save(update_fields=["agreement", "project", "updated_at"])
    return conversation
