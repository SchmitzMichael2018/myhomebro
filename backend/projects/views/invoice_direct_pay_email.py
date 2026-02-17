# backend/projects/views/invoice_direct_pay_email.py

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

    # Ensure Direct Pay
    payment_mode = str(getattr(invoice.agreement, "payment_mode", "")).lower()
    if payment_mode != "direct":
        return JsonResponse({"error": "Agreement is not Direct Pay."}, status=400)

    # Ensure not already paid
    if str(getattr(invoice, "status", "")).lower() == "paid" or getattr(invoice, "direct_pay_paid_at", None):
        return JsonResponse({"error": "Invoice already paid."}, status=400)

    # Ensure checkout link exists (idempotent)
    try:
        if not getattr(invoice, "direct_pay_checkout_url", ""):
            create_direct_pay_checkout_for_invoice(invoice)
            invoice.refresh_from_db()
    except Exception as e:
        return JsonResponse({"error": f"Could not create pay link: {str(e)}"}, status=400)

    homeowner = invoice.agreement.homeowner
    to_email = getattr(homeowner, "email", "")
    if not to_email:
        return JsonResponse({"error": "Customer email missing."}, status=400)

    public_link = _public_invoice_link(invoice)
    if not public_link:
        return JsonResponse({"error": "Invoice public link missing (public_token not set)."}, status=400)

    # Render HTML template (✅ use your EXISTING invoice template)
    context = {
        "homeowner_name": getattr(homeowner, "full_name", "Customer"),
        "invoice": invoice,
        "link": public_link,
    }

    # ✅ CHANGE THIS to match the filename you already have
    # Example: templates/emails/invoice.html  ->  "emails/invoice_email.html"
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
        # optional: store last_email_error if present
        try:
            if hasattr(invoice, "last_email_error"):
                invoice.last_email_error = str(e)
                invoice.save(update_fields=["last_email_error"])
        except Exception:
            pass
        return JsonResponse({"error": str(e)}, status=500)

    with transaction.atomic():
        invoice = Invoice.objects.select_for_update().get(pk=invoice.pk)
        if hasattr(invoice, "email_sent_at"):
            invoice.email_sent_at = now()
        if hasattr(invoice, "last_email_error"):
            invoice.last_email_error = ""
        invoice.save()

    return JsonResponse(
        {
            "ok": True,
            "emailed_to": to_email,
            "magic_link": public_link,
        },
        status=200,
    )
