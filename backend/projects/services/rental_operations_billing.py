from __future__ import annotations

from datetime import datetime, timedelta, timezone as dt_timezone

from django.conf import settings
from django.utils import timezone

from payments.stripe_config import stripe
from projects.models_customer_portal import PropertyManagementCompany


PLAN_KEY = "rental_operations"
PLAN_LABEL = "Rental Operations"
DEFAULT_TRIAL_DAYS = 14
STRIPE_CHECKOUT_PURPOSE = "rental_operations_subscription"


def trial_days() -> int:
    return int(getattr(settings, "RENTAL_OPERATIONS_TRIAL_DAYS", DEFAULT_TRIAL_DAYS) or DEFAULT_TRIAL_DAYS)


def price_id() -> str:
    return str(
        getattr(settings, "STRIPE_RENTAL_OPERATIONS_PRICE_ID", "")
        or getattr(settings, "RENTAL_OPERATIONS_STRIPE_PRICE_ID", "")
        or ""
    ).strip()


def is_trial_active(company: PropertyManagementCompany | None, at=None) -> bool:
    if company is None:
        return False
    at = at or timezone.now()
    return bool(
        company.subscription_status == PropertyManagementCompany.SUBSCRIPTION_STATUS_TRIALING
        and company.trial_ends_at
        and company.trial_ends_at >= at
    )


def has_active_subscription(company: PropertyManagementCompany | None) -> bool:
    if company is None:
        return False
    return company.subscription_status == PropertyManagementCompany.SUBSCRIPTION_STATUS_ACTIVE


def has_rental_operations_access(company: PropertyManagementCompany | None) -> bool:
    return bool(has_active_subscription(company) or is_trial_active(company))


def subscription_metadata(company: PropertyManagementCompany | None) -> dict:
    now = timezone.now()
    trial_active = is_trial_active(company, at=now)
    subscription_active = has_active_subscription(company)
    trial_days_remaining = 0
    if trial_active and company and company.trial_ends_at:
        remaining = company.trial_ends_at - now
        trial_days_remaining = max(0, remaining.days + (1 if remaining.seconds else 0))
    return {
        "plan": PLAN_KEY,
        "plan_label": PLAN_LABEL,
        "subscription_status": getattr(company, "subscription_status", PropertyManagementCompany.SUBSCRIPTION_STATUS_NONE),
        "trial_active": trial_active,
        "trial_days_remaining": trial_days_remaining,
        "subscription_active": subscription_active,
        "rental_operations_locked": bool(company and not (trial_active or subscription_active)),
        "trial_ends_at": company.trial_ends_at.isoformat() if company and company.trial_ends_at else "",
        "stripe_customer_id": getattr(company, "stripe_customer_id", ""),
        "stripe_subscription_id": getattr(company, "stripe_subscription_id", ""),
        "checkout_endpoint": "",
    }


def lock_response_payload(company: PropertyManagementCompany | None) -> dict:
    meta = subscription_metadata(company)
    return {
        "detail": "Internal maintenance tools require Rental Operations.",
        "code": "rental_operations_subscription_required",
        "rental_operations": meta,
    }


def checkout_urls(request, token: str) -> tuple[str, str]:
    portal_path = f"/portal?token={token}"
    success_url = request.build_absolute_uri(f"{portal_path}&rental_operations=success")
    cancel_url = request.build_absolute_uri(f"{portal_path}&rental_operations=cancelled")
    return success_url, cancel_url


def _company_email(company: PropertyManagementCompany) -> str:
    return (company.email or getattr(company.homeowner, "email", "") or "").strip()


def create_checkout_session(*, company: PropertyManagementCompany, request, token: str):
    configured_price = price_id()
    if not configured_price:
        raise RuntimeError("STRIPE_RENTAL_OPERATIONS_PRICE_ID is not configured.")
    if not company.stripe_customer_id:
        customer = stripe.Customer.create(
            email=_company_email(company) or None,
            name=company.name or None,
            metadata={
                "company_id": str(company.id),
                "homeowner_id": str(company.homeowner_id),
                "purpose": STRIPE_CHECKOUT_PURPOSE,
            },
        )
        company.stripe_customer_id = customer.get("id") if isinstance(customer, dict) else customer.id
        company.save(update_fields=["stripe_customer_id", "updated_at"])

    success_url, cancel_url = checkout_urls(request, token)
    return stripe.checkout.Session.create(
        mode="subscription",
        customer=company.stripe_customer_id,
        line_items=[{"price": configured_price, "quantity": 1}],
        subscription_data={
            "trial_period_days": trial_days(),
            "metadata": {
                "company_id": str(company.id),
                "homeowner_id": str(company.homeowner_id),
                "plan": PLAN_KEY,
                "purpose": STRIPE_CHECKOUT_PURPOSE,
            },
        },
        metadata={
            "company_id": str(company.id),
            "homeowner_id": str(company.homeowner_id),
            "plan": PLAN_KEY,
            "purpose": STRIPE_CHECKOUT_PURPOSE,
        },
        success_url=success_url,
        cancel_url=cancel_url,
    )


def _datetime_from_stripe_timestamp(value):
    if not value:
        return None
    return datetime.fromtimestamp(int(value), tz=dt_timezone.utc)


def _company_from_metadata_or_ids(obj: dict) -> PropertyManagementCompany | None:
    metadata = obj.get("metadata") or {}
    company_id = metadata.get("company_id")
    if company_id:
        company = PropertyManagementCompany.objects.filter(pk=company_id).first()
        if company:
            return company
    subscription_id = obj.get("subscription") or obj.get("id") or ""
    customer_id = obj.get("customer") or ""
    if subscription_id:
        company = PropertyManagementCompany.objects.filter(stripe_subscription_id=subscription_id).first()
        if company:
            return company
    if customer_id:
        return PropertyManagementCompany.objects.filter(stripe_customer_id=customer_id).first()
    return None


def sync_checkout_session(session: dict) -> bool:
    metadata = session.get("metadata") or {}
    if metadata.get("purpose") != STRIPE_CHECKOUT_PURPOSE:
        return False
    company = _company_from_metadata_or_ids(session)
    if company is None:
        return False
    subscription_id = session.get("subscription") or company.stripe_subscription_id
    customer_id = session.get("customer") or company.stripe_customer_id
    status = PropertyManagementCompany.SUBSCRIPTION_STATUS_TRIALING
    if session.get("status") == "complete" and not company.trial_ends_at:
        company.trial_started_at = timezone.now()
        company.trial_ends_at = company.trial_started_at + timedelta(days=trial_days())
    company.subscription_status = status
    company.subscription_plan = PLAN_KEY
    company.stripe_subscription_id = str(subscription_id or "")
    company.stripe_customer_id = str(customer_id or "")
    company.save(
        update_fields=[
            "subscription_status",
            "subscription_plan",
            "trial_started_at",
            "trial_ends_at",
            "stripe_subscription_id",
            "stripe_customer_id",
            "updated_at",
        ]
    )
    return True


def sync_subscription(subscription: dict) -> bool:
    metadata = subscription.get("metadata") or {}
    if metadata and metadata.get("purpose") != STRIPE_CHECKOUT_PURPOSE:
        return False
    company = _company_from_metadata_or_ids(subscription)
    if company is None:
        return False
    stripe_status = str(subscription.get("status") or PropertyManagementCompany.SUBSCRIPTION_STATUS_NONE)
    allowed_statuses = {value for value, _label in PropertyManagementCompany.SUBSCRIPTION_STATUS_CHOICES}
    next_status = stripe_status if stripe_status in allowed_statuses else PropertyManagementCompany.SUBSCRIPTION_STATUS_INCOMPLETE
    trial_start = _datetime_from_stripe_timestamp(subscription.get("trial_start"))
    trial_end = _datetime_from_stripe_timestamp(subscription.get("trial_end"))
    company.subscription_status = next_status
    company.subscription_plan = PLAN_KEY
    company.stripe_subscription_id = str(subscription.get("id") or company.stripe_subscription_id or "")
    company.stripe_customer_id = str(subscription.get("customer") or company.stripe_customer_id or "")
    if trial_start:
        company.trial_started_at = trial_start
    if trial_end:
        company.trial_ends_at = trial_end
    company.save(
        update_fields=[
            "subscription_status",
            "subscription_plan",
            "trial_started_at",
            "trial_ends_at",
            "stripe_subscription_id",
            "stripe_customer_id",
            "updated_at",
        ]
    )
    return True


def sync_invoice_payment_failed(invoice: dict) -> bool:
    subscription_id = invoice.get("subscription") or ""
    customer_id = invoice.get("customer") or ""
    company = None
    if subscription_id:
        company = PropertyManagementCompany.objects.filter(stripe_subscription_id=subscription_id).first()
    if company is None and customer_id:
        company = PropertyManagementCompany.objects.filter(stripe_customer_id=customer_id).first()
    if company is None:
        return False
    company.subscription_status = PropertyManagementCompany.SUBSCRIPTION_STATUS_PAST_DUE
    company.subscription_plan = PLAN_KEY
    company.save(update_fields=["subscription_status", "subscription_plan", "updated_at"])
    return True
