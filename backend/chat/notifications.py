# chat/notifications.py

from django.conf import settings
from core.notifications import send_notification # Corrected import

def notify_new_message(message):
    conversation = message.conversation
    sender = message.sender
    
    for recipient in conversation.participants.exclude(pk=sender.pk):
        subject = f"New message regarding '{conversation.project.title}'"
        context = {
            "sender_name": sender.get_full_name(),
            "message_text": message.text,
            "link": f"{settings.FRONTEND_URL}/chat/{conversation.id}",
            "sms_text": f"New message from {sender.get_full_name()}: {message.text[:100]}..."
        }
        
        send_notification(
            recipient=recipient,
            subject=subject,
            template_prefix="emails/new_message",
            context=context
        )