# backend/projects/views/invoice_direct_pay_email.py
# v2026-03-03 — Option A + Customer naming cleanup
# - Uses agreement.homeowner as canonical customer (already true)
# - Adds customer_name/customer_email template context aliases (keeps homeowner_name for compatibility)
# - Defensive: syncs agreement.project.homeowner from agreement.homeowner before creating checkout
# - Leaves endpoint behavior unchanged

from __future__ import annotations

import logging
from django.conf import settings
from django.db import transaction
from django.http import JsonResponse
from django.template.loader import render_to_string
from django.utils.timezone import now
from django.core.mail import EmailMultiAlternatives

from rest_framework.decorators import api_view, permission_classes
from rest_framework.permissions import IsAuthenticated

from projects.models import Invoice
from projects.services.contractor_onboarding import build_stripe_requirement_payload
from projects.services.direct_pay import create_direct_pay_checkout_for_invoice

log = logging.getLogger(__name__)


def _frontend_base_url() -> str:
    return str(getattr(settings, "FRONTEND_URL", "")).rstrip("/")


def _public_invoice_link(invoice: Invoice) -> str:
    """
    Builds the public magic invoice link:
      /invoice/<public_token>
    """
    token = getattr(invoice, "public_token", None)
    if not token:
        return ""

    base = _frontend_base_url()
    if not base:
        return f"/invoice/{token}"

    return f"{base}/invoice/{token}"


def _sync_project_customer_from_agreement(invoice: Invoice) -> None:
    """
    Option A hardening:
    Ensure agreement.project.homeowner matches agreement.homeowner so no legacy code path
    (including Stripe session builders) accidentally uses stale project homeowner.
    """
    try:
        agreement = getattr(invoice, "agreement", None)
        if not agreement:
            return
        customer = getattr(agreement, "homeowner", None) or getattr(agreement, "customer", None)
        if not customer:
            return
        project = getattr(agreement, "project", None)
        if not project:
            return
        if getattr(project, "homeowner_id", None) == getattr(customer, "id", None):
            return
        project.homeowner = customer
        update_fields = ["homeowner"]
        if hasattr(project, "updated_at"):
            project.updated_at = now()
            update_fields.append("updated_at")
        project.save(update_fields=update_fields)
    except Exception:
        return


@api_view(["POST"])
@permission_classes([IsAuthenticated])
def invoice_email_direct_pay_link(request, pk: int):
    """
    POST /api/projects/invoices/<pk>/direct_pay_email/

    Sends an email to the customer containing a PUBLIC magic invoice link:
      FRONTEND_URL/invoice/<public_token>

    The magic invoice page handles both escrow and direct pay flows.
    """

    try:
        invoice = (
            Invoice.objects.select_related(
                "agreement",
                "agreement__contractor",
                "agreement__homeowner",
                "agreement__project",
            ).get(pk=pk)
        )
    except Invoice.DoesNotExist:
        return JsonResponse({"error": "Invoice not found."}, status=404)

    contractor = getattr(request.user, "contractor_profile", None)
    if not contractor or invoice.agreement.contractor_id != contractor.id:
        return JsonResponse({"error": "Not allowed."}, status=403)
    if not bool(getattr(contractor, "stripe_connected", False)):
        payload = build_stripe_requirement_payload(
            contractor,
            action_key="email_direct_pay_link",
            action_label="Email Direct Pay Link",
            source="invoice_direct_pay_email",
            return_path=f"/app/invoices/{invoice.id}",
        )
        return JsonResponse(payload, status=409)

    agreement = getattr(invoice, "agreement", None)

    # Ensure Direct Pay
    payment_mode = str(getattr(agreement, "payment_mode", "")).lower()
    if payment_mode != "direct":
        return JsonResponse({"error": "Agreement is not Direct Pay."}, status=400)

    # Ensure not already paid
    if str(getattr(invoice, "status", "")).lower() == "paid" or getattr(invoice, "direct_pay_paid_at", None):
        return JsonResponse({"error": "Invoice already paid."}, status=400)

    # ✅ Option A: customer comes from agreement.homeowner
    customer = getattr(agreement, "homeowner", None) or getattr(agreement, "customer", None)
    to_email = getattr(customer, "email", "") if customer else ""
    if not to_email:
        return JsonResponse({"error": "Customer email missing."}, status=400)

    # Defensive: keep project customer aligned before checkout creation
    _sync_project_customer_from_agreement(invoice)

    # Ensure checkout link exists (idempotent)
    try:
        if not getattr(invoice, "direct_pay_checkout_url", ""):
            create_direct_pay_checkout_for_invoice(invoice)
            invoice.refresh_from_db()
    except Exception as e:
        return JsonResponse({"error": f"Could not create pay link: {str(e)}"}, status=400)

    public_link = _public_invoice_link(invoice)
    if not public_link:
        return JsonResponse({"error": "Invoice public link missing (public_token not set)."}, status=400)

    customer_name = (
        getattr(customer, "full_name", None)
        or getattr(customer, "name", None)
        or getattr(customer, "email", None)
        or "Customer"
    )

    # Render HTML template (✅ use your EXISTING invoice template)
    context = {
        # keep legacy key for templates that already use it
        "homeowner_name": customer_name,

        # preferred new keys
        "customer_name": customer_name,
        "customer_email": to_email,

        "invoice": invoice,
        "link": public_link,
    }

    # ✅ CHANGE THIS to match the filename you already have
    html_body = render_to_string("emails/invoice_email.html", context)

    subject = f"Invoice {invoice.invoice_number} — MyHomeBro"

    msg = EmailMultiAlternatives(
        subject=subject,
        body="You have a new invoice from MyHomeBro.",  # fallback plaintext
        from_email=getattr(settings, "DEFAULT_FROM_EMAIL", "no-reply@myhomebro.com"),
        to=[to_email],
    )
    msg.attach_alternative(html_body, "text/html")

    try:
        msg.send()
    except Exception as e:
        log.exception("Direct Pay email failed.")
        try:
            if hasattr(invoice, "last_email_error"):
                invoice.last_email_error = str(e)
                invoice.save(update_fields=["last_email_error"])
        except Exception:
            pass
        return JsonResponse({"error": str(e)}, status=500)

    with transaction.atomic():
        invoice = Invoice.objects.select_for_update().get(pk=invoice.pk)
        update_fields = []
        if hasattr(invoice, "email_sent_at"):
            invoice.email_sent_at = now()
            update_fields.append("email_sent_at")
        if hasattr(invoice, "last_email_error"):
            invoice.last_email_error = ""
            update_fields.append("last_email_error")
        if update_fields:
            invoice.save(update_fields=update_fields)

    return JsonResponse(
        {
            "ok": True,
            "emailed_to": to_email,
            "magic_link": public_link,
        },
        status=200,
    )
