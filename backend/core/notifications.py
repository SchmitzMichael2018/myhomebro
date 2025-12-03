# core/notifications.py
# v2025-12-01 — Dynamic From/Reply-To:
#   From: "Contractor Name (via MyHomeBro)" <DEFAULT_FROM_EMAIL>
#   Reply-To: contractor.email (falls back to support/default)
#
# This keeps:
#   - Django send_mail for email (Postmark can still be used via SMTP)
#   - Twilio SMS behavior
#   - Template rendering with template_prefix

import logging

from django.conf import settings
from django.core.mail import send_mail
from django.template.loader import render_to_string
from django.contrib.auth import get_user_model
from twilio.rest import Client as TwilioClient
from twilio.base.exceptions import TwilioRestException

User = get_user_model()
logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Twilio client (unchanged)
# ---------------------------------------------------------------------------
twilio_client = None
if all([settings.TWILIO_ACCOUNT_SID, settings.TWILIO_AUTH_TOKEN, settings.TWILIO_PHONE_NUMBER]):
    twilio_client = TwilioClient(settings.TWILIO_ACCOUNT_SID, settings.TWILIO_AUTH_TOKEN)


# ---------------------------------------------------------------------------
# Helpers to derive contractor, From, and Reply-To
# ---------------------------------------------------------------------------

def _get_brand_name() -> str:
    """
    Human-readable brand name for email From display.
    Falls back to 'MyHomeBro' if not provided in settings.
    """
    return getattr(settings, "SITE_NAME", "MyHomeBro")


def _get_default_from_email() -> str:
    """
    Base sending address. This is the email actually used as the envelope sender.
    Typically DEFAULT_FROM_EMAIL = 'info@myhomebro.com' or 'noreply@myhomebro.com'.
    """
    return getattr(settings, "DEFAULT_FROM_EMAIL", "info@myhomebro.com")


def _get_fallback_reply_to() -> str:
    """
    Fallback Reply-To if we can't find a contractor email.
    Prefer SUPPORT_EMAIL if defined; otherwise use DEFAULT_FROM_EMAIL.
    """
    support_email = getattr(settings, "SUPPORT_EMAIL", None)
    if support_email:
        return support_email
    return _get_default_from_email()


def _extract_contractor_from_context(context, recipient):
    """
    Try to locate a Contractor-like object for this notification.
    This is intentionally duck-typed to avoid hard imports/circular deps.

    Priority:
      1. context["contractor"]
      2. context["agreement"].contractor
      3. context["invoice"].agreement.contractor
      4. recipient.created_by   (Homeowner.created_by -> Contractor)
      5. recipient.parent_contractor (ContractorSubAccount.parent_contractor)
    """
    if context is None:
        context = {}

    # 1) Explicit contractor in context
    contractor = context.get("contractor")
    if contractor and getattr(contractor, "email", None):
        return contractor

    # 2) Agreement contractor from context
    agreement = context.get("agreement")
    if agreement is not None:
        agr_contractor = getattr(agreement, "contractor", None)
        if agr_contractor and getattr(agr_contractor, "email", None):
            return agr_contractor

    # 3) Invoice -> Agreement -> Contractor
    invoice = context.get("invoice")
    if invoice is not None:
        inv_agreement = getattr(invoice, "agreement", None)
        if inv_agreement is not None:
            inv_contractor = getattr(inv_agreement, "contractor", None)
            if inv_contractor and getattr(inv_contractor, "email", None):
                return inv_contractor

    # 4) Recipient created_by (Homeowner.created_by -> Contractor)
    created_by = getattr(recipient, "created_by", None)
    if created_by and getattr(created_by, "email", None):
        return created_by

    # 5) Recipient parent_contractor (ContractorSubAccount.parent_contractor)
    parent_contractor = getattr(recipient, "parent_contractor", None)
    if parent_contractor and getattr(parent_contractor, "email", None):
        return parent_contractor

    return None


def _build_from_and_reply_to(recipient, context):
    """
    Build (from_email_header, reply_to_list) for send_mail.

    - If we find a Contractor:
        From: "Contractor Name (via Brand)" <DEFAULT_FROM_EMAIL>
        Reply-To: contractor.email
    - Else:
        From: DEFAULT_FROM_EMAIL
        Reply-To: SUPPORT_EMAIL or DEFAULT_FROM_EMAIL
    """
    brand_name = _get_brand_name()
    base_from_email = _get_default_from_email()

    contractor = _extract_contractor_from_context(context, recipient)

    if contractor is not None:
        # Contractor model in your code exposes .name and .email properties
        # where .email returns contractor.user.email under the hood.
        contractor_name = ""
        try:
            contractor_name = getattr(contractor, "name", "") or ""
        except Exception:  # pragma: no cover
            contractor_name = ""

        contractor_email = ""
        try:
            contractor_email = getattr(contractor, "email", "") or ""
        except Exception:  # pragma: no cover
            contractor_email = ""

        if contractor_email:
            # Example: "ABC Remodeling (via MyHomeBro) <info@myhomebro.com>"
            display_name = contractor_name or contractor_email
            from_header = f"{display_name} (via {brand_name}) <{base_from_email}>"
            reply_to = [contractor_email]

            logger.debug(
                "Email From/Reply-To resolved via contractor: from=%s reply_to=%s",
                from_header,
                reply_to,
            )
            return from_header, reply_to

    # Fallback: brand system email
    from_header = base_from_email
    reply_to_email = _get_fallback_reply_to()
    reply_to = [reply_to_email]

    logger.debug(
        "Email From/Reply-To using fallback: from=%s reply_to=%s",
        from_header,
        reply_to,
    )
    return from_header, reply_to


# ---------------------------------------------------------------------------
# Public notification function
# ---------------------------------------------------------------------------

def send_notification(recipient, subject, template_prefix, context):
    """
    Central notification helper for email + optional SMS.

    Args:
        recipient: A model instance with .email and optionally .phone or .phone_number.
        subject: Email subject line.
        template_prefix: Template path prefix (e.g. "emails/new_invoice").
                         Will render "<prefix>.txt" and "<prefix>.html".
        context: dict used to render the email template and SMS text.
    """
    if not hasattr(recipient, "email") or not recipient.email:
        logger.warning(
            "Attempted to send notification to recipient %r but they have no email.",
            recipient,
        )
        return

    # Resolve From & Reply-To headers
    from_email, reply_to_list = _build_from_and_reply_to(recipient, context or {})

    try:
        # Render templates
        text_body = render_to_string(f"{template_prefix}.txt", context or {})
        html_body = render_to_string(f"{template_prefix}.html", context or {})

        # Prepare custom headers (Reply-To)
        headers = {}
        if reply_to_list:
            # Django expects a single string; the mail backend will format it
            headers["Reply-To"] = ", ".join(reply_to_list)

        # Send email via Django's send_mail
        send_mail(
            subject=subject,
            message=text_body,
            from_email=from_email,
            recipient_list=[recipient.email],
            html_message=html_body,
            fail_silently=False,
            headers=headers,
        )

        logger.info(
            "Sent email to %s using from=%s reply_to=%s template_prefix=%s",
            recipient.email,
            from_email,
            reply_to_list,
            template_prefix,
        )

    except Exception as e:
        logger.error(
            "Failed to send email for template %s to %s: %s",
            template_prefix,
            getattr(recipient, "email", "N/A"),
            e,
        )

    # -----------------------------------------------------------------------
    # SMS (Twilio) behavior unchanged
    # -----------------------------------------------------------------------
    phone_number = getattr(recipient, "phone", None) or getattr(recipient, "phone_number", None)
    if twilio_client and phone_number:
        # Prefer context["sms_text"] if provided; otherwise truncate email body.
        sms_body = (context or {}).get("sms_text")
        if not sms_body:
            # Basic fallback: use first 160 chars of text_body.
            try:
                sms_body = text_body[:160]
            except Exception:  # pragma: no cover
                sms_body = "You have a new notification from {}".format(_get_brand_name())

        try:
            twilio_client.messages.create(
                body=sms_body,
                from_=settings.TWILIO_PHONE_NUMBER,
                to=str(phone_number),
            )
            logger.info("Sent SMS to %s", phone_number)
        except TwilioRestException as e:
            logger.error(f"Failed to send SMS to {phone_number}: {e}")
        except Exception as e:  # pragma: no cover
            logger.error(f"Unexpected error sending SMS to {phone_number}: {e}")
