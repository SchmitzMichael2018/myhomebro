import logging

from django.conf import settings
from django.db import transaction
from django.utils import timezone

from projects.models_website_service import WebsiteServiceEvent, WebsiteServiceProject
from projects.services.invites_delivery import send_postmark_email

log = logging.getLogger(__name__)


def _dashboard_url(project):
    return f"{str(getattr(settings, 'FRONTEND_URL', '') or '').rstrip('/')}/webdesign/dashboard?project={project.pk}"


def _recipients(project, audience):
    if audience == "customer":
        return [str(getattr(project.owner, "email", "") or "").strip()]
    return [str(getattr(settings, "SUPPORT_EMAIL", "") or "").strip()]


def send_website_notification(project, event_type, subject, message, audience="staff"):
    """Deliver a best-effort email and always retain an auditable attempt."""
    for recipient in [value for value in _recipients(project, audience) if value]:
        delivered = False
        detail = ""
        try:
            delivered, detail = send_postmark_email(
                to_email=recipient,
                subject=subject,
                text_body=f"{message}\n\nProject: {project.business_name}\n{_dashboard_url(project)}",
                html_body=None,
            )
        except Exception as exc:  # Notification failures must not lose customer work.
            detail = str(exc)
            log.exception("Website service notification failed (%s, project=%s)", event_type, project.pk)
        WebsiteServiceEvent.objects.create(
            project=project,
            event_type=event_type,
            recipient=recipient,
            delivered=bool(delivered),
            detail=str(detail or "")[:500],
        )


def create_checkout_session(project, *, terms_accepted):
    if not terms_accepted:
        raise ValueError("Accept the displayed proposal, service terms, and refund terms before checkout.")
    if project.payment_status == "paid":
        raise ValueError("This website project is already paid.")
    if not project.has_complete_proposal or not project.proposal_sent_at:
        raise ValueError("A complete written proposal is required before checkout.")

    stripe_key = str(getattr(settings, "STRIPE_SECRET_KEY", "") or "").strip()
    allow_live = bool(getattr(settings, "WEBSITE_SERVICE_STRIPE_LIVE_ENABLED", False))
    if not stripe_key or (not stripe_key.startswith("sk_test_") and not allow_live):
        raise ValueError("Website checkout is unavailable until Stripe test mode is configured.")

    import stripe

    stripe.api_key = stripe_key
    if project.stripe_checkout_session_id:
        session = stripe.checkout.Session.retrieve(project.stripe_checkout_session_id)
        if getattr(session, "url", None):
            return session

    base = str(getattr(settings, "FRONTEND_URL", "") or "").rstrip("/")
    session = stripe.checkout.Session.create(
        mode="payment",
        payment_method_types=["card"],
        customer_email=str(getattr(project.owner, "email", "") or "") or None,
        line_items=[{
            "quantity": 1,
            "price_data": {
                "currency": "usd",
                "unit_amount": project.quoted_price_cents,
                "product_data": {"name": f"Website design — {project.business_name}"},
            },
        }],
        metadata={"kind": "website_service", "website_service_project_id": str(project.pk)},
        payment_intent_data={"metadata": {"kind": "website_service", "website_service_project_id": str(project.pk)}},
        success_url=f"{base}/webdesign/dashboard?checkout=success&project={project.pk}",
        cancel_url=f"{base}/webdesign/dashboard?checkout=cancelled&project={project.pk}",
        idempotency_key=f"website-service-{project.pk}-{project.proposal_sent_at.isoformat()}",
    )
    project.stripe_checkout_session_id = session.id
    project.terms_accepted_at = timezone.now()
    project.payment_status = "checkout"
    project.save(update_fields=["stripe_checkout_session_id", "terms_accepted_at", "payment_status", "updated_at"])
    return session


def sync_checkout_completed(session):
    metadata = session.get("metadata") or {}
    if metadata.get("kind") != "website_service":
        return False
    project_id = metadata.get("website_service_project_id")
    if not project_id or session.get("payment_status") != "paid":
        return False
    with transaction.atomic():
        project = WebsiteServiceProject.objects.select_for_update().select_related("owner").filter(pk=project_id).first()
        if not project:
            return False
        if project.payment_status == "paid":
            return True
        project.payment_status = "paid"
        project.stripe_checkout_session_id = session.get("id") or project.stripe_checkout_session_id
        project.stripe_payment_intent_id = session.get("payment_intent") or ""
        project.paid_at = timezone.now()
        project.save(update_fields=["payment_status", "stripe_checkout_session_id", "stripe_payment_intent_id", "paid_at", "updated_at"])
    send_website_notification(project, "payment_confirmed", "Your MyHomeBro website payment is confirmed", "Payment was received. Your project dashboard will show the next build step.", "customer")
    send_website_notification(project, "payment_confirmed_staff", "Website design payment received", "A website service checkout completed.", "staff")
    return True
