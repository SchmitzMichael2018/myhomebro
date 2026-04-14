from __future__ import annotations

import logging
from decimal import Decimal, ROUND_HALF_UP
from typing import Optional, Tuple

from django.conf import settings
from django.core.mail import EmailMultiAlternatives
from django.db import transaction
from django.template.loader import render_to_string
from django.utils import timezone

from projects.models import DrawRequest, DrawRequestStatus, ExternalPaymentRecord, ExternalPaymentStatus
from projects.services.activity_feed import create_activity_event
from projects.services.draw_notifications import create_draw_lifecycle_notification
from projects.services.draw_state import derive_draw_workflow_status

log = logging.getLogger(__name__)


def _draw_activity_target(draw: DrawRequest) -> str:
    agreement_id = getattr(draw, "agreement_id", None)
    if agreement_id:
        return f"/app/agreements/{agreement_id}"
    return ""


def create_draw_activity_notification(
    draw: DrawRequest,
    *,
    event_type: str,
    title: str,
    summary: str,
    severity: str,
    dedupe_key: str,
) -> None:
    agreement = getattr(draw, "agreement", None)
    contractor = getattr(agreement, "contractor", None) if agreement else None
    line_item = None
    try:
        line_item = draw.line_items.select_related("milestone").first()
    except Exception:
        line_item = None
    milestone = getattr(line_item, "milestone", None)
    create_activity_event(
        contractor=contractor,
        agreement=agreement,
        milestone=milestone,
        event_type=event_type,
        title=title,
        summary=summary,
        severity=severity,
        related_entity_type="draw_request",
        related_entity_id=getattr(draw, "id", ""),
        related_label=f"Draw {getattr(draw, 'draw_number', '')}: {getattr(draw, 'title', '')}".strip(": "),
        icon_hint="payment",
        navigation_target=_draw_activity_target(draw),
        metadata={
            "draw_request_id": getattr(draw, "id", None),
            "agreement_id": getattr(draw, "agreement_id", None),
            "workflow_status": derive_draw_workflow_status(draw),
        },
        dedupe_key=dedupe_key,
    )


def _frontend_base_url() -> str:
    return str(getattr(settings, "FRONTEND_URL", "") or "").rstrip("/")


def _to_decimal(value) -> Decimal:
    if value in (None, ""):
        return Decimal("0.00")
    if isinstance(value, Decimal):
        return value
    return Decimal(str(value))


def _to_cents(amount) -> int:
    amount_decimal = _to_decimal(amount)
    return int((amount_decimal * Decimal("100")).quantize(Decimal("1"), rounding=ROUND_HALF_UP))


def _agreement_customer(agreement) -> Tuple[Optional[object], str, str]:
    customer = getattr(agreement, "homeowner", None) or getattr(agreement, "customer", None)
    if not customer:
        project = getattr(agreement, "project", None)
        customer = getattr(project, "homeowner", None) if project else None
    email = str(getattr(customer, "email", "") or "").strip() if customer else ""
    name = (
        getattr(customer, "full_name", None)
        or getattr(customer, "name", None)
        or getattr(customer, "display_name", None)
        or email
        or "Customer"
    )
    return customer, email, str(name or "Customer").strip()


def build_public_draw_link(draw: DrawRequest) -> str:
    token = getattr(draw, "public_token", None)
    if not token:
        return ""
    base = _frontend_base_url()
    if not base:
        return f"/draws/magic/{token}"
    return f"{base}/draws/magic/{token}"


def send_draw_request_review_email(draw: DrawRequest, *, is_resend: bool = False) -> Tuple[bool, str]:
    agreement = getattr(draw, "agreement", None)
    if agreement is None:
        return False, "Draw request is missing an agreement."

    _customer, to_email, customer_name = _agreement_customer(agreement)
    if not to_email:
        return False, "Customer email missing on agreement."

    review_link = build_public_draw_link(draw)
    if not review_link:
        return False, "Draw review link is unavailable."

    contractor = getattr(agreement, "contractor", None)
    contractor_name = (
        getattr(contractor, "business_name", None)
        or getattr(contractor, "name", None)
        or getattr(getattr(contractor, "user", None), "email", None)
        or "Your contractor"
    )
    project_title = getattr(getattr(agreement, "project", None), "title", None) or getattr(agreement, "title", None) or "Project"

    context = {
        "draw": draw,
        "agreement": agreement,
        "customer_name": customer_name,
        "contractor_name": contractor_name,
        "project_title": project_title,
        "review_link": review_link,
        "is_resend": is_resend,
    }
    html_body = render_to_string("emails/draw_request_review.html", context)
    text_body = render_to_string("emails/draw_request_review.txt", context)
    subject = f"Draw request {draw.draw_number} ready for review"

    message = EmailMultiAlternatives(
        subject=subject,
        body=text_body,
        from_email=getattr(settings, "DEFAULT_FROM_EMAIL", "no-reply@myhomebro.com"),
        to=[to_email],
    )
    message.attach_alternative(html_body, "text/html")

    try:
        message.send()
    except Exception as exc:
        log.exception("Draw review email failed for draw=%s", getattr(draw, "id", None))
        with transaction.atomic():
            locked = DrawRequest.objects.select_for_update().get(pk=draw.pk)
            locked.last_review_email_error = str(exc)
            locked.save(update_fields=["last_review_email_error", "updated_at"])
        return False, str(exc)

    with transaction.atomic():
        locked = DrawRequest.objects.select_for_update().get(pk=draw.pk)
        locked.review_email_sent_at = timezone.now()
        locked.last_review_email_error = ""
        locked.save(update_fields=["review_email_sent_at", "last_review_email_error", "updated_at"])
    return True, f"Review email sent to {to_email}."


def create_direct_checkout_for_draw(draw: DrawRequest) -> str:
    stripe_key = str(getattr(settings, "STRIPE_SECRET_KEY", "") or "").strip()
    if not stripe_key:
        raise ValueError("STRIPE_SECRET_KEY not configured.")

    agreement = getattr(draw, "agreement", None)
    if not agreement:
        raise ValueError("Draw request has no agreement.")
    if str(getattr(agreement, "payment_mode", "") or "").lower() != "direct":
        raise ValueError("Draw request is not on a Direct Pay agreement.")
    if str(getattr(draw, "status", "") or "").lower() not in {
        DrawRequestStatus.APPROVED,
        DrawRequestStatus.PAID,
    }:
        raise ValueError("Draw request must be approved before payment starts.")

    amount_cents = _to_cents(getattr(draw, "net_amount", None))
    if amount_cents <= 0:
        raise ValueError("Draw request amount must be greater than 0.")

    contractor = getattr(agreement, "contractor", None)
    stripe_account_id = str(getattr(contractor, "stripe_account_id", "") or "").strip()
    if not stripe_account_id:
        raise ValueError("Contractor has no Stripe Connect account.")

    _customer, customer_email, customer_name = _agreement_customer(agreement)
    if not customer_email:
        raise ValueError("Agreement customer email is missing.")

    review_link = build_public_draw_link(draw)
    success_url = f"{review_link}?checkout=success&session_id={{CHECKOUT_SESSION_ID}}" if review_link else "https://example.com"
    cancel_url = f"{review_link}?checkout=cancelled" if review_link else "https://example.com"

    try:
        import stripe  # type: ignore
    except Exception:
        raise ValueError("Stripe SDK not installed on server.")

    stripe.api_key = stripe_key

    project_title = getattr(getattr(agreement, "project", None), "title", "") or getattr(agreement, "title", "") or "Project"

    with transaction.atomic():
        locked = DrawRequest.objects.select_for_update().select_related(
            "agreement", "agreement__contractor", "agreement__homeowner", "agreement__project"
        ).get(pk=draw.pk)

        if locked.status == DrawRequestStatus.PAID or getattr(locked, "paid_at", None):
            return str(getattr(locked, "stripe_checkout_url", "") or "").strip()

        existing_url = str(getattr(locked, "stripe_checkout_url", "") or "").strip()
        if existing_url:
            return existing_url

        try:
            session = stripe.checkout.Session.create(
                mode="payment",
                payment_method_types=["card", "us_bank_account"],
                customer_email=customer_email,
                line_items=[
                    {
                        "quantity": 1,
                        "price_data": {
                            "currency": "usd",
                            "unit_amount": amount_cents,
                            "product_data": {
                                "name": f"Draw {locked.draw_number}: {locked.title}",
                                "description": project_title or "MyHomeBro draw request",
                            },
                        },
                    }
                ],
                metadata={
                    "kind": "draw_direct_checkout",
                    "draw_request_id": str(locked.id),
                    "draw_number": str(locked.draw_number),
                    "agreement_id": str(locked.agreement_id),
                    "payment_mode": "DIRECT",
                    "customer_email": customer_email,
                    "customer_name": customer_name,
                },
                payment_intent_data={
                    "transfer_data": {"destination": stripe_account_id},
                    "metadata": {
                        "kind": "draw_direct_checkout",
                        "draw_request_id": str(locked.id),
                        "agreement_id": str(locked.agreement_id),
                    },
                    "receipt_email": customer_email,
                },
                success_url=success_url,
                cancel_url=cancel_url,
            )
        except Exception as exc:
            log.exception("Stripe draw checkout create failed draw=%s", getattr(locked, "id", None))
            raise ValueError(f"Stripe error: {exc}")

        session_id = getattr(session, "id", None) or (session.get("id") if isinstance(session, dict) else "")
        session_url = getattr(session, "url", None) or (session.get("url") if isinstance(session, dict) else "")
        payment_intent_id = getattr(session, "payment_intent", None) or (
            session.get("payment_intent") if isinstance(session, dict) else ""
        )

        if not session_url:
            raise ValueError("Stripe did not return a checkout URL.")

        locked.stripe_checkout_session_id = str(session_id or "")
        locked.stripe_checkout_url = str(session_url or "")
        if payment_intent_id:
            locked.stripe_payment_intent_id = str(payment_intent_id)
        locked.save(
            update_fields=[
                "stripe_checkout_session_id",
                "stripe_checkout_url",
                "stripe_payment_intent_id",
                "updated_at",
            ]
        )
        return locked.stripe_checkout_url


def finalize_draw_paid(
    *,
    draw_request_id: Optional[int] = None,
    checkout_session_id: Optional[str] = None,
    payment_intent_id: Optional[str] = None,
    paid_at=None,
    payment_method: str = "stripe",
) -> DrawRequest:
    if not any([draw_request_id, checkout_session_id, payment_intent_id]):
        raise ValueError("Must provide a draw identifier.")

    paid_at = paid_at or timezone.now()

    with transaction.atomic():
        qs = DrawRequest.objects.select_for_update().select_related("agreement", "agreement__contractor", "agreement__homeowner")
        draw = None
        if draw_request_id:
            draw = qs.filter(id=draw_request_id).first()
        if draw is None and checkout_session_id:
            draw = qs.filter(stripe_checkout_session_id=checkout_session_id).first()
        if draw is None and payment_intent_id:
            draw = qs.filter(stripe_payment_intent_id=payment_intent_id).first()
        if draw is None:
            raise ValueError("Draw request not found.")

        update_fields = []
        if draw.status != DrawRequestStatus.PAID:
            draw.status = DrawRequestStatus.PAID
            update_fields.append("status")
        if not getattr(draw, "paid_at", None):
            draw.paid_at = paid_at
            update_fields.append("paid_at")
        if payment_intent_id and not str(getattr(draw, "stripe_payment_intent_id", "") or "").strip():
            draw.stripe_payment_intent_id = str(payment_intent_id)
            update_fields.append("stripe_payment_intent_id")
        if checkout_session_id and not str(getattr(draw, "stripe_checkout_session_id", "") or "").strip():
            draw.stripe_checkout_session_id = str(checkout_session_id)
            update_fields.append("stripe_checkout_session_id")
        if getattr(draw, "paid_via", "") != payment_method:
            draw.paid_via = payment_method
            update_fields.append("paid_via")
        if update_fields:
            draw.save(update_fields=list(dict.fromkeys(update_fields + ["updated_at"])))

        existing_payment = draw.external_payment_records.exclude(status=ExternalPaymentStatus.VOIDED).first()
        if existing_payment is None:
            agreement = draw.agreement
            customer = getattr(agreement, "homeowner", None)
            contractor = getattr(agreement, "contractor", None)
            ExternalPaymentRecord.objects.create(
                agreement=agreement,
                draw_request=draw,
                payer_name=getattr(customer, "full_name", "") or getattr(customer, "email", "") or "Customer",
                payee_name=getattr(contractor, "business_name", "") or getattr(contractor, "email", "") or "Contractor",
                gross_amount=getattr(draw, "gross_amount", Decimal("0.00")),
                retainage_withheld_amount=getattr(draw, "retainage_amount", Decimal("0.00")),
                net_amount=getattr(draw, "net_amount", Decimal("0.00")),
                payment_method=payment_method,
                payment_date=timezone.localdate(),
                reference_number=str(payment_intent_id or checkout_session_id or ""),
                notes="Paid through MyHomeBro Stripe Checkout.",
                status=ExternalPaymentStatus.VERIFIED,
            )

    draw.refresh_from_db()
    create_draw_activity_notification(
        draw,
        event_type="draw_paid",
        title=f"Draw {draw.draw_number} paid",
        summary="Payment completed for this draw and the record is now synced in MyHomeBro.",
        severity="success",
        dedupe_key=f"draw_paid:{draw.id}",
    )
    create_draw_lifecycle_notification(draw, event_type="draw_paid")
    return draw
