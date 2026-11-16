"""Transactional onboarding mail, using the configured Django/Postmark backend."""
import logging

from django.conf import settings
from django.core.mail import EmailMultiAlternatives, get_connection
from django.db import transaction
from django.db.models import F
from django.template.loader import render_to_string
from django.utils import timezone

from accounts.models import ContractorWelcomeEmail, User

logger = logging.getLogger(__name__)


def eligible(user):
    return (
        user.verification_role == "contractor"
        and user.is_active and not user.is_staff and not user.is_superuser
        and user.has_full_verification
        and user.verification_state == User.VerificationState.VERIFIED
        and user.trust_classification == User.TrustClassification.NORMAL
    )


def queue_contractor_welcome(user):
    if not eligible(user):
        return
    delivery, created = ContractorWelcomeEmail.objects.get_or_create(user=user)
    if created:
        transaction.on_commit(lambda: dispatch_welcome(delivery.pk))


def dispatch_welcome(delivery_id):
    from accounts.tasks import send_contractor_welcome
    try:
        if getattr(settings, "CELERY_NOTIFICATIONS_ENABLED", False):
            send_contractor_welcome.delay(delivery_id)
        else:
            deliver_welcome(delivery_id)
    except Exception:
        # The durable pending row can be recovered without failing verification.
        logger.error("Welcome queue unavailable delivery_id=%s", delivery_id)


def deliver_welcome(delivery_id):
    delivery = ContractorWelcomeEmail.objects.select_related("user").filter(pk=delivery_id).first()
    if not delivery or not eligible(delivery.user):
        return False
    # Atomic claim prevents concurrent tasks from sending the same pending row.
    claimed = ContractorWelcomeEmail.objects.filter(
        pk=delivery_id, status__in=["pending", "failed"]
    ).update(status="sending", attempted_at=timezone.now(), attempts=F("attempts") + 1)
    if not claimed:
        return False
    try:
        site_url = str(settings.SITE_URL).rstrip("/")
        context = {
            "first_name": delivery.user.first_name or "there",
            "dashboard_url": site_url + "/app/dashboard",
            "support_email": settings.SUPPORT_EMAIL,
            "site_logo_url": getattr(settings, "PUBLIC_LOGO_URL", None)
            or site_url + "/static/myhomebro_logo.png",
        }
        message = EmailMultiAlternatives(
            subject="Welcome to MyHomeBro — let's get your first project started",
            body=render_to_string("emails/contractor_welcome.txt", context),
            from_email=settings.DEFAULT_FROM_EMAIL,
            to=[delivery.user.email],
            reply_to=[settings.SUPPORT_EMAIL],
            connection=get_connection(timeout=15),
        )
        message.attach_alternative(render_to_string("emails/contractor_welcome.html", context), "text/html")
        if message.send(fail_silently=False) != 1:
            raise RuntimeError("Welcome email was not accepted")
    except Exception:
        ContractorWelcomeEmail.objects.filter(pk=delivery_id, status="sending").update(status="failed")
        logger.error("Welcome email failed delivery_id=%s", delivery_id)
        raise
    ContractorWelcomeEmail.objects.filter(pk=delivery_id, status="sending").update(
        status="sent", sent_at=timezone.now()
    )
    return True
