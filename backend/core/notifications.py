# core/notifications.py

import logging
from django.conf import settings
from django.core.mail import send_mail
from django.template.loader import render_to_string
from django.contrib.auth import get_user_model
from twilio.rest import Client as TwilioClient
from twilio.base.exceptions import TwilioRestException

User = get_user_model()
logger = logging.getLogger(__name__)

twilio_client = None
if all([settings.TWILIO_ACCOUNT_SID, settings.TWILIO_AUTH_TOKEN, settings.TWILIO_PHONE_NUMBER]):
    twilio_client = TwilioClient(settings.TWILIO_ACCOUNT_SID, settings.TWILIO_AUTH_TOKEN)

def send_notification(recipient, subject, template_prefix, context):
    if not hasattr(recipient, 'email') or not recipient.email:
        logger.warning(f"Attempted to send notification to recipient {recipient} but they have no email.")
        return

    try:
        text_body = render_to_string(f"{template_prefix}.txt", context)
        html_body = render_to_string(f"{template_prefix}.html", context)
        
        send_mail(
            subject=subject,
            message=text_body,
            from_email=settings.DEFAULT_FROM_EMAIL,
            recipient_list=[recipient.email],
            html_message=html_body,
            fail_silently=False,
        )
    except Exception as e:
        logger.error(f"Failed to send email for template {template_prefix} to {recipient.email}: {e}")

    phone_number = getattr(recipient, 'phone', None) or getattr(recipient, 'phone_number', None)
    if twilio_client and phone_number:
        sms_body = context.get('sms_text', text_body[:160])
        try:
            twilio_client.messages.create(
                body=sms_body,
                from_=settings.TWILIO_PHONE_NUMBER,
                to=str(phone_number),
            )
        except TwilioRestException as e:
            logger.error(f"Failed to send SMS to {phone_number}: {e}")