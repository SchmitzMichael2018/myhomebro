from __future__ import annotations

import re
from dataclasses import dataclass

from django.conf import settings
from django.core import signing
from django.core.mail import send_mail

from projects.models import Homeowner
from projects.models_project_intake import ProjectIntake

PORTAL_TOKEN_SALT = "myhomebro.customer-portal"


@dataclass(frozen=True)
class PublicIntakeCustomerResult:
    homeowner: Homeowner
    created: bool
    matched_by: str
    portal_link_sent: bool


def normalize_public_intake_email(value: str | None) -> str:
    return str(value or "").strip().lower()


def normalize_public_intake_phone(value: str | None) -> str:
    return re.sub(r"\D+", "", str(value or ""))


def _portal_frontend_base() -> str:
    base = getattr(settings, "PUBLIC_FRONTEND_BASE_URL", "") or getattr(settings, "FRONTEND_URL", "")
    return str(base or "").rstrip("/")


def _portal_url(email: str) -> str:
    token = signing.dumps({"email": email.lower().strip()}, salt=PORTAL_TOKEN_SALT)
    base = _portal_frontend_base()
    return f"{base}/portal/{token}" if base else f"/portal/{token}"


def _send_portal_setup_email(email: str) -> bool:
    normalized = normalize_public_intake_email(email)
    if not normalized:
        return False

    link = _portal_url(normalized)
    portal_login_url = f"{_portal_frontend_base() or 'https://www.myhomebro.com'}/portal"
    subject = "Your MyHomeBro Customer Portal Access Link"
    text_body = (
        "Hello,\n\n"
        "Thanks, we received your project request.\n\n"
        "We sent you this secure link so you can access your customer portal:\n"
        f"{link}\n\n"
        "You can use your portal to view updates, add photos, and respond to contractor questions.\n\n"
        "Returning customer?\n"
        f"You can log in directly at:\n{portal_login_url}\n\n"
        "-- MyHomeBro"
    )
    html_body = (
        "<p>Hello,</p>"
        "<p>Thanks, we received your project request.</p>"
        "<p>Use this secure link to access your customer portal:</p>"
        f"<p><a href=\"{link}\" style=\"display:inline-block;background:#fbbf24;color:#0f172a;"
        "padding:12px 18px;border-radius:12px;font-weight:700;text-decoration:none;\">"
        "Access Customer Portal</a></p>"
        "<p>You can use your portal to view updates, add photos, and respond to contractor questions.</p>"
        "<p>Returning customer?</p>"
        f"<p>You can log in directly at:<br><a href=\"{portal_login_url}\">{portal_login_url}</a></p>"
        "<p>-- MyHomeBro</p>"
    )
    send_mail(
        subject,
        text_body,
        getattr(settings, "DEFAULT_FROM_EMAIL", "info@myhomebro.com"),
        [normalized],
        html_message=html_body,
        fail_silently=False,
    )
    return True


def _find_homeowner_by_phone(phone: str) -> Homeowner | None:
    normalized = normalize_public_intake_phone(phone)
    if not normalized:
        return None
    candidates = Homeowner.objects.exclude(phone_number="").order_by("-updated_at", "-created_at")
    for homeowner in candidates[:500]:
        if normalize_public_intake_phone(homeowner.phone_number) == normalized:
            return homeowner
    return None


def get_or_create_customer_for_public_intake(
    *,
    name: str,
    email: str,
    phone: str,
    source: str = "landing_page",
) -> PublicIntakeCustomerResult:
    normalized_email = normalize_public_intake_email(email)
    normalized_phone = normalize_public_intake_phone(phone)
    clean_name = str(name or "").strip()

    homeowner = None
    matched_by = ""
    if normalized_email:
        homeowner = Homeowner.objects.filter(email__iexact=normalized_email).order_by("-updated_at", "-created_at").first()
        matched_by = "email" if homeowner else ""
    if homeowner is None and normalized_phone:
        homeowner = _find_homeowner_by_phone(normalized_phone)
        matched_by = "phone" if homeowner else ""

    created = False
    if homeowner is None:
        homeowner = Homeowner.objects.create(
            full_name=clean_name or normalized_email or normalized_phone or "Customer",
            email=normalized_email,
            phone_number=str(phone or "").strip(),
            status="active",
        )
        created = True
        matched_by = "created"
    else:
        update_fields: list[str] = []
        if clean_name and not str(homeowner.full_name or "").strip():
            homeowner.full_name = clean_name
            update_fields.append("full_name")
        if normalized_email and not str(homeowner.email or "").strip():
            homeowner.email = normalized_email
            update_fields.append("email")
        if phone and not str(homeowner.phone_number or "").strip():
            homeowner.phone_number = str(phone).strip()
            update_fields.append("phone_number")
        if update_fields:
            update_fields.append("updated_at")
            homeowner.save(update_fields=update_fields)

    portal_link_sent = _send_portal_setup_email(homeowner.email) if homeowner.email else False
    return PublicIntakeCustomerResult(
        homeowner=homeowner,
        created=created,
        matched_by=matched_by or source or "unknown",
        portal_link_sent=portal_link_sent,
    )


def link_customer_to_public_intake(intake: ProjectIntake) -> PublicIntakeCustomerResult | None:
    if not (intake.customer_email or intake.customer_phone):
        return None
    result = get_or_create_customer_for_public_intake(
        name=intake.customer_name,
        email=intake.customer_email,
        phone=intake.customer_phone,
        source=intake.lead_source or "landing_page",
    )
    if intake.homeowner_id != result.homeowner.id:
        intake.homeowner = result.homeowner
        intake.save(update_fields=["homeowner", "updated_at"])
    return result
