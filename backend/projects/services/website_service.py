import hashlib
import json
import logging

from django.conf import settings
from django.db import transaction
from django.utils import timezone

from projects.models_website_service import WebsiteServiceEvent, WebsiteServiceProject
from projects.services.invites_delivery import send_postmark_email

log = logging.getLogger(__name__)
WEBSITE_SERVICE_CURRENCY = "usd"


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


def queue_website_notification(project, event_type, subject, message, audience="staff"):
    """Send only after the surrounding write commits; delivery is never transactional."""
    project_id = project.pk

    def deliver():
        saved_project = WebsiteServiceProject.objects.select_related("owner").filter(pk=project_id).first()
        if saved_project:
            send_website_notification(saved_project, event_type, subject, message, audience)

    transaction.on_commit(deliver, robust=True)


def proposal_fingerprint(project):
    payload = {
        "project_id": project.pk,
        "price_cents": project.quoted_price_cents,
        "currency": WEBSITE_SERVICE_CURRENCY,
        "deliverables": project.proposal_deliverables,
        "service_terms": project.service_terms,
        "refund_terms": project.refund_terms,
        "proposal_sent_at": project.proposal_sent_at.isoformat() if project.proposal_sent_at else "",
    }
    return hashlib.sha256(json.dumps(payload, sort_keys=True, separators=(",", ":")).encode("utf-8")).hexdigest()


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
    fingerprint = proposal_fingerprint(project)
    if project.stripe_checkout_session_id and project.checkout_proposal_fingerprint == fingerprint:
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
                "currency": WEBSITE_SERVICE_CURRENCY,
                "unit_amount": project.quoted_price_cents,
                "product_data": {"name": f"Website design — {project.business_name}"},
            },
        }],
        metadata={"kind": "website_service", "website_service_project_id": str(project.pk), "proposal_fingerprint": fingerprint},
        payment_intent_data={"metadata": {"kind": "website_service", "website_service_project_id": str(project.pk), "proposal_fingerprint": fingerprint}},
        success_url=f"{base}/webdesign/dashboard?checkout=success&project={project.pk}",
        cancel_url=f"{base}/webdesign/dashboard?checkout=cancelled&project={project.pk}",
        idempotency_key=f"website-service-{project.pk}-{project.proposal_sent_at.isoformat()}",
    )
    with transaction.atomic():
        current = WebsiteServiceProject.objects.select_for_update().get(pk=project.pk)
        if current.payment_status == "paid":
            raise ValueError("This website project is already paid.")
        if proposal_fingerprint(current) != fingerprint:
            raise ValueError("The proposal changed while checkout was opening. Review the updated proposal and try again.")
        current.stripe_checkout_session_id = session.id
        current.checkout_proposal_fingerprint = fingerprint
        current.terms_accepted_at = timezone.now()
        current.payment_status = "checkout"
        current.save(update_fields=["stripe_checkout_session_id", "checkout_proposal_fingerprint", "terms_accepted_at", "payment_status", "updated_at"])
    return session


def sync_checkout_completed(session):
    metadata = session.get("metadata") or {}
    if metadata.get("kind") != "website_service":
        return False
    session_id = str(session.get("id") or "").strip()
    project_id = metadata.get("website_service_project_id")
    fingerprint = str(metadata.get("proposal_fingerprint") or "").strip()
    if not session_id or not project_id or not fingerprint or session.get("payment_status") != "paid":
        return False
    with transaction.atomic():
        project = WebsiteServiceProject.objects.select_for_update().select_related("owner").filter(
            stripe_checkout_session_id=session_id
        ).first()
        if not project:
            return False
        if str(project.pk) != str(project_id):
            return False
        try:
            amount_total = int(session.get("amount_total"))
        except (TypeError, ValueError):
            return False
        if amount_total != project.quoted_price_cents:
            return False
        if str(session.get("currency") or "").lower() != WEBSITE_SERVICE_CURRENCY:
            return False
        if fingerprint != project.checkout_proposal_fingerprint or fingerprint != proposal_fingerprint(project):
            return False
        if project.payment_status == "paid":
            return True
        project.payment_status = "paid"
        project.stripe_payment_intent_id = session.get("payment_intent") or ""
        project.paid_at = timezone.now()
        project.save(update_fields=["payment_status", "stripe_payment_intent_id", "paid_at", "updated_at"])
        queue_website_notification(project, "payment_confirmed", "Your MyHomeBro website payment is confirmed", "Payment was received. Your project dashboard will show the next build step.", "customer")
        queue_website_notification(project, "payment_confirmed_staff", "Website design payment received", "A website service checkout completed.", "staff")
    return True
