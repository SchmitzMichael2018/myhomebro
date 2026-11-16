"""Owner alerts for real account creations; all recipient settings are server-side."""
import logging
import re

from django.conf import settings
from django.db import transaction
from django.db.models import F
from django.utils import timezone

from accounts.models import AdminSignupSMS, User
from projects.services.sms_service import normalize_phone_to_e164, send_compliant_sms

logger = logging.getLogger(__name__)
ROLES = {"contractor": "contractor", "homeowner": "homeowner", "property_manager": "property manager"}


def recipient():
    number = normalize_phone_to_e164(getattr(settings, "ADMIN_SIGNUP_SMS_TO", ""))
    if not getattr(settings, "ADMIN_SIGNUP_SMS_ENABLED", False):
        return ""
    return number if re.fullmatch(r"\+[1-9][0-9]{7,14}", number) else ""


def eligible(user):
    return (
        user.verification_role in ROLES
        and not user.is_staff and not user.is_superuser
        and user.trust_classification == User.TrustClassification.NORMAL
        and user.verification_state not in {User.VerificationState.DISABLED, User.VerificationState.SUSPICIOUS}
    )


def queue_signup_alert(user):
    """An alert failure must never prevent the customer from registering."""
    try:
        number = recipient()
        if not number or not eligible(user):
            return
        delivery, created = AdminSignupSMS.objects.get_or_create(user=user, defaults={"recipient": number})
        if created:
            transaction.on_commit(lambda: dispatch_signup_alert(delivery.pk))
    except Exception:
        logger.error("Could not record signup alert user_id=%s", user.pk)


def dispatch_signup_alert(delivery_id):
    try:
        if getattr(settings, "CELERY_NOTIFICATIONS_ENABLED", False):
            from accounts.tasks import send_admin_signup_sms
            send_admin_signup_sms.delay(delivery_id)
        else:
            deliver_signup_alert(delivery_id)
    except Exception:
        logger.error("Signup alert dispatch failed delivery_id=%s", delivery_id)


def deliver_signup_alert(delivery_id):
    delivery = AdminSignupSMS.objects.select_related("user").filter(pk=delivery_id).first()
    if not delivery or not recipient() or not eligible(delivery.user):
        return "skipped"
    if delivery.recipient != recipient():
        return "skipped"
    claimed = AdminSignupSMS.objects.filter(pk=delivery_id, status__in=["pending", "failed"]).update(
        status="sending", attempts=F("attempts") + 1,
    )
    if not claimed:
        return "skipped"
    state = "verified" if delivery.user.has_full_verification else "verification pending"
    url = f"{str(settings.SITE_URL).rstrip('/')}/admin/accounts/user/{delivery.user_id}/change/"
    body = f"MyHomeBro: New {ROLES[delivery.user.verification_role]} signup #{delivery.user_id} ({state}). Review: {url}"
    try:
        result = send_compliant_sms(delivery.recipient, body, category="admin_signup",
                                    dedupe_key=f"admin_signup:{delivery.pk}")
        status = "sent" if result.get("ok") or result.get("status") == "duplicate" else (
            "blocked" if result.get("blocked") else "failed"
        )
        # Persist only safe status identifiers, never raw provider exceptions.
        code = str(result.get("reason_code") or status)[:64]
        sid = str(result.get("twilio_sid") or "")[:64]
    except Exception:
        status, code, sid = "failed", "sms_unavailable", ""
    AdminSignupSMS.objects.filter(pk=delivery_id, status="sending").update(
        status=status, reason_code=code, provider_sid=sid,
        sent_at=timezone.now() if status == "sent" else None,
    )
    return status
