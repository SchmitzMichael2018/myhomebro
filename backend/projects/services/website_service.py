import hashlib
import json
import logging
import uuid
from datetime import timedelta

from django.conf import settings
from django.db import transaction
from django.urls import reverse
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
    project_url = _dashboard_url(project)
    if audience == "staff":
        base = str(getattr(settings, "FRONTEND_URL", "") or "").rstrip("/")
        route = (
            "admin:website-service-workspace-project"
            if project.status != "brief"
            else "admin:projects_websiteserviceproject_change"
        )
        project_url = base + reverse(route, args=[project.pk])
    for recipient in [value for value in _recipients(project, audience) if value]:
        delivered = False
        detail = ""
        try:
            delivered, detail = send_postmark_email(
                to_email=recipient,
                subject=subject,
                text_body=f"{message}\n\nProject: {project.business_name}\n{project_url}",
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


def _session_value(session, name, default=None):
    if hasattr(session, "get"):
        return session.get(name, default)
    return getattr(session, name, default)


def _expire_checkout_session(stripe, session_id):
    try:
        stripe.checkout.Session.expire(session_id)
        return True
    except Exception:
        log.exception("Could not expire superseded website Checkout session %s", session_id)
        return False


def _website_checkout_api_key():
    stripe_key = str(getattr(settings, "STRIPE_SECRET_KEY", "") or "").strip()
    allow_live = bool(getattr(settings, "WEBSITE_SERVICE_STRIPE_LIVE_ENABLED", False))
    if not stripe_key or (not stripe_key.startswith(("sk_test_", "rk_test_")) and not allow_live):
        raise ValueError("Website checkout is unavailable until Stripe test mode is configured.")
    return stripe_key


def expire_checkout_for_revision(session_id):
    """Confirm the recorded session cannot take payment before replacing its proposal."""
    import stripe

    try:
        api_key = _website_checkout_api_key()
    except ValueError:
        return False

    try:
        session = stripe.checkout.Session.expire(session_id, api_key=api_key)
    except stripe.StripeError:
        # Expiration can fail if Checkout already completed or already expired.
        try:
            session = stripe.checkout.Session.retrieve(session_id, api_key=api_key)
        except stripe.StripeError:
            return False

    return (
        _session_value(session, "id") == session_id
        and _session_value(session, "status") == "expired"
        and _session_value(session, "payment_status") == "unpaid"
    )


class ProposalChanged(ValueError):
    def __init__(self):
        super().__init__("The proposal changed. Review and accept the latest proposal before checkout.")


def create_checkout_session(project, *, terms_accepted, accepted_fingerprint):
    if not terms_accepted:
        raise ValueError("Accept the displayed proposal, service terms, and refund terms before checkout.")
    if not isinstance(accepted_fingerprint, str) or not accepted_fingerprint:
        raise ValueError("Reload the proposal and accept the displayed terms before checkout.")

    stripe_key = _website_checkout_api_key()

    import stripe

    stripe.api_key = stripe_key
    with transaction.atomic():
        current = WebsiteServiceProject.objects.select_for_update().select_related("owner").get(pk=project.pk)
        if current.payment_status == "paid":
            raise ValueError("This website project is already paid.")
        fingerprint = proposal_fingerprint(current)
        if not current.has_complete_proposal or not current.proposal_sent_at or accepted_fingerprint != fingerprint:
            raise ProposalChanged()
        checkout_price_cents = current.quoted_price_cents
        checkout_business_name = current.business_name
        checkout_customer_email = str(getattr(current.owner, "email", "") or "") or None
        reusable_session_id = ""
        if current.stripe_checkout_session_id and current.checkout_proposal_fingerprint == fingerprint:
            reusable_session_id = current.stripe_checkout_session_id
            attempt_token = ""
        else:
            if current.checkout_attempt_token and current.checkout_attempt_started_at and current.checkout_attempt_started_at > timezone.now() - timedelta(minutes=5):
                raise ValueError("Checkout is already being prepared. Wait a moment and try again.")
            attempt_token = uuid.uuid4().hex
            current.stripe_checkout_session_id = None
            current.checkout_proposal_fingerprint = ""
            current.checkout_attempt_token = attempt_token
            current.checkout_attempt_started_at = timezone.now()
            current.save(update_fields=["stripe_checkout_session_id", "checkout_proposal_fingerprint", "checkout_attempt_token", "checkout_attempt_started_at", "updated_at"])

    if reusable_session_id:
        session = stripe.checkout.Session.retrieve(reusable_session_id)
        session_status = str(_session_value(session, "status", "") or "").lower()
        session_payment_status = str(_session_value(session, "payment_status", "") or "").lower()
        with transaction.atomic():
            current = WebsiteServiceProject.objects.select_for_update().get(pk=project.pk)
            if current.payment_status == "paid":
                raise ValueError("This website project is already paid.")
            if proposal_fingerprint(current) != fingerprint:
                raise ProposalChanged()
            if current.stripe_checkout_session_id != reusable_session_id:
                raise ValueError("Checkout changed while opening. Refresh the project and try again.")
            if session_status == "open" and session_payment_status != "paid" and _session_value(session, "url"):
                return session
            if session_status == "complete" and session_payment_status == "paid":
                raise ValueError("Payment is complete and awaiting webhook confirmation. Refresh the project shortly.")
            attempt_token = uuid.uuid4().hex
            current.stripe_checkout_session_id = None
            current.checkout_proposal_fingerprint = ""
            current.checkout_attempt_token = attempt_token
            current.checkout_attempt_started_at = timezone.now()
            current.save(update_fields=["stripe_checkout_session_id", "checkout_proposal_fingerprint", "checkout_attempt_token", "checkout_attempt_started_at", "updated_at"])

    base = str(getattr(settings, "FRONTEND_URL", "") or "").rstrip("/")
    session = stripe.checkout.Session.create(
        mode="payment",
        payment_method_types=["card"],
        customer_email=checkout_customer_email,
        line_items=[{
            "quantity": 1,
            "price_data": {
                "currency": WEBSITE_SERVICE_CURRENCY,
                "unit_amount": checkout_price_cents,
                "product_data": {"name": f"Website design â€” {checkout_business_name}"},
            },
        }],
        metadata={"kind": "website_service", "website_service_project_id": str(project.pk), "proposal_fingerprint": fingerprint, "checkout_attempt_token": attempt_token},
        payment_intent_data={"metadata": {"kind": "website_service", "website_service_project_id": str(project.pk), "proposal_fingerprint": fingerprint, "checkout_attempt_token": attempt_token}},
        success_url=f"{base}/webdesign/dashboard?checkout=success&project={project.pk}",
        cancel_url=f"{base}/webdesign/dashboard?checkout=cancelled&project={project.pk}",
        idempotency_key=f"website-service-{project.pk}-{attempt_token}",
    )
    try:
        with transaction.atomic():
            current = WebsiteServiceProject.objects.select_for_update().get(pk=project.pk)
            if current.payment_status == "paid":
                raise ValueError("This website project is already paid.")
            if current.checkout_attempt_token != attempt_token:
                raise ValueError("Another checkout replaced this attempt. Use the newest checkout link.")
            if proposal_fingerprint(current) != fingerprint:
                raise ProposalChanged()
            current.stripe_checkout_session_id = session.id
            current.checkout_proposal_fingerprint = fingerprint
            current.checkout_attempt_token = ""
            current.checkout_attempt_started_at = None
            current.terms_accepted_at = timezone.now()
            current.payment_status = "checkout"
            current.save(update_fields=["stripe_checkout_session_id", "checkout_proposal_fingerprint", "checkout_attempt_token", "checkout_attempt_started_at", "terms_accepted_at", "payment_status", "updated_at"])
    except Exception:
        _expire_checkout_session(stripe, session.id)
        raise
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


def sync_checkout_unavailable(session, *, reason):
    """Invalidate only the exact unpaid website session reported by Stripe."""
    metadata = session.get("metadata") or {}
    session_id = str(session.get("id") or "").strip()
    project_id = str(metadata.get("website_service_project_id") or "").strip()
    fingerprint = str(metadata.get("proposal_fingerprint") or "").strip()
    if metadata.get("kind") != "website_service" or not session_id or not project_id or not fingerprint:
        return False
    with transaction.atomic():
        project = WebsiteServiceProject.objects.select_for_update().filter(
            stripe_checkout_session_id=session_id
        ).first()
        if not project or str(project.pk) != project_id or project.payment_status == "paid":
            return False
        if fingerprint != project.checkout_proposal_fingerprint:
            return False
        project.stripe_checkout_session_id = None
        project.checkout_proposal_fingerprint = ""
        project.checkout_attempt_token = ""
        project.checkout_attempt_started_at = None
        project.payment_status = "failed"
        project.save(update_fields=[
            "stripe_checkout_session_id",
            "checkout_proposal_fingerprint",
            "checkout_attempt_token",
            "checkout_attempt_started_at",
            "payment_status",
            "updated_at",
        ])
        log.info("Website Checkout session invalidated (%s, project=%s, reason=%s)", session_id, project.pk, reason)
    return True
