# backend/projects/services/intake_public.py

from __future__ import annotations

from django.conf import settings
from django.utils import timezone

from projects.models_project_intake import ProjectIntake
from projects.services.mailer import send_postmark_template_email


def build_public_intake_url(intake: ProjectIntake) -> str:
    """
    Builds the public intake URL sent to the homeowner.
    """

    token = intake.ensure_share_token()

    base = getattr(settings, "PUBLIC_FRONTEND_BASE_URL", "").rstrip("/")

    if not base:
        base = getattr(settings, "FRONTEND_URL", "").rstrip("/")

    return f"{base}/start-project/{token}"


def send_intake_email(intake: ProjectIntake) -> dict:
    """
    Sends an intake request email to the homeowner.
    """

    email = intake.customer_email

    if not email:
        raise ValueError("Customer email is required to send intake.")

    url = build_public_intake_url(intake)

    template_model = {
        "customer_name": intake.customer_name or "Homeowner",
        "contractor_name": (
            intake.contractor.business_name
            if intake.contractor and intake.contractor.business_name
            else "Your contractor"
        ),
        "intake_url": url,
        "year": timezone.now().year,
        "site_logo_url": getattr(settings, "PUBLIC_LOGO_URL", None),
    }

    try:
        send_postmark_template_email(
            to_email=email,
            template_alias="project-intake",
            template_model=template_model,
            tag="project-intake",
        )
    except Exception:
        # fallback handled by caller if desired
        raise

    intake.sent_to_email = email
    intake.sent_at = timezone.now()
    intake.status = "submitted"

    intake.save(update_fields=["sent_to_email", "sent_at", "status", "updated_at"])

    return {
        "ok": True,
        "intake_id": intake.id,
        "email": email,
        "url": url,
    }