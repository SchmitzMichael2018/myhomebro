# backend/projects/views/invoice.py
# v2026-01-10 — Dispute hard-lock: prevent submit/resend while dispute active
# v2026-02-11 — Direct Pay invoices: create Stripe Checkout link for subcontractor jobs (no escrow)
# Keeps all existing behavior otherwise.

import logging
import os
from django.shortcuts import get_object_or_404
from django.http import HttpResponse, FileResponse
from django.conf import settings
from django.utils import timezone

from rest_framework import viewsets, status
from rest_framework.decorators import action
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView
from rest_framework.exceptions import PermissionDenied

from postmarker.core import PostmarkClient

from ..models import Invoice, InvoiceStatus, MilestoneComment, MilestoneFile
from ..serializers.invoices import InvoiceSerializer
from projects.services.invoice_pdf import generate_invoice_pdf_bytes

# ✅ NEW: Direct Pay service
from projects.services.direct_pay import create_direct_pay_checkout_for_invoice

logger = logging.getLogger(__name__)


def _frontend_base() -> str:
    return getattr(settings, "FRONTEND_BASE_URL", "https://www.myhomebro.com").rstrip("/")


def _api_base() -> str:
    return getattr(settings, "API_BASE_URL", _frontend_base()).rstrip("/")


def _get_homeowner(invoice: Invoice):
    agreement = getattr(invoice, "agreement", None)
    project = getattr(agreement, "project", None) if agreement else None
    homeowner = getattr(project, "homeowner", None) if project else None
    return homeowner


def _get_homeowner_email(invoice: Invoice) -> str | None:
    homeowner = _get_homeowner(invoice)
    email = getattr(homeowner, "email", None) if homeowner else None
    return email or getattr(invoice, "homeowner_email", None) or None


def _get_homeowner_name(invoice: Invoice) -> str:
    homeowner = _get_homeowner(invoice)
    if homeowner:
        for attr in ["full_name", "name", "display_name"]:
            val = getattr(homeowner, attr, None)
            if val:
                return val
    return getattr(invoice, "homeowner_name", None) or "Homeowner"


def _magic_token(invoice: Invoice) -> str:
    return str(getattr(invoice, "public_token", "") or "")


def _build_magic_invoice_action_url(invoice: Invoice, action: str) -> str:
    base = _frontend_base()
    tok = _magic_token(invoice)
    return f"{base}/invoice/{tok}?action={action}"


def _build_magic_invoice_pdf_url(invoice: Invoice) -> str:
    base = _api_base()
    tok = _magic_token(invoice)
    return f"{base}/api/projects/invoices/magic/{tok}/pdf/"


def _safe_text(value: str) -> str:
    return (value or "").strip()


def _format_notes_html(text: str) -> str:
    t = _safe_text(text)
    if not t:
        return "<div style='color:#6b7280;font-size:12px;'>—</div>"
    t = t.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")
    return (
        "<div style='white-space:pre-wrap;background:#f9fafb;border:1px solid #e5e7eb;"
        f"padding:10px;border-radius:10px;font-size:13px;color:#111827;'>{t}</div>"
    )


def _render_attachments_html(attachments) -> str:
    if not isinstance(attachments, list) or not attachments:
        return "<div style='color:#6b7280;font-size:12px;'>—</div>"

    items = []
    for a in attachments:
        name = _safe_text(a.get("name") if isinstance(a, dict) else "") or "Attachment"
        url = _safe_text(a.get("url") if isinstance(a, dict) else "")
        safe_name = name.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")
        safe_url = url.replace("&", "&amp;").replace("<", "%3C").replace(">", "%3E")

        if safe_url:
            items.append(
                f"<li style='margin:4px 0;'><a href='{safe_url}' style='color:#1D4ED8;text-decoration:underline;'>{safe_name}</a></li>"
            )
        else:
            items.append(f"<li style='margin:4px 0;color:#6b7280;'>{safe_name}</li>")

    return "<ul style='margin:8px 0 0 18px;padding:0;'>" + "".join(items) + "</ul>"


def _fallback_notes_and_attachments(invoice: Invoice) -> tuple[str, list[dict]]:
    m = getattr(invoice, "source_milestone", None)
    if not m:
        return "", []

    comments = MilestoneComment.objects.filter(milestone=m).order_by("created_at")
    lines = []
    for c in comments:
        content = (getattr(c, "content", "") or "").strip()
        if content:
            lines.append(f"- {content}")
    notes = "\n".join(lines).strip()

    files = MilestoneFile.objects.filter(milestone=m).order_by("-uploaded_at")
    atts: list[dict] = []
    for f in files:
        if not getattr(f, "file", None):
            continue
        try:
            url = f.file.url
            if url.startswith("/"):
                url = _frontend_base() + url
        except Exception:
            url = ""
        atts.append(
            {
                "id": f.id,
                "name": os.path.basename(getattr(f.file, "name", "") or "") or f"file_{f.id}",
                "url": url,
                "uploaded_at": f.uploaded_at.isoformat() if getattr(f, "uploaded_at", None) else None,
            }
        )

    return notes, atts


def _invoice_notes_and_attachments(invoice: Invoice) -> tuple[str, list[dict]]:
    notes = (getattr(invoice, "milestone_completion_notes", "") or "").strip()
    atts = getattr(invoice, "milestone_attachments_snapshot", None)
    if not isinstance(atts, list):
        atts = []

    if not notes or not atts:
        fb_notes, fb_atts = _fallback_notes_and_attachments(invoice)
        if not notes and fb_notes:
            notes = fb_notes
        if (not atts) and fb_atts:
            atts = fb_atts

    return notes, atts


def _send_invoice_email_postmark(invoice: Invoice) -> dict:
    token = getattr(settings, "POSTMARK_SERVER_TOKEN", None)
    if not token:
        raise RuntimeError("POSTMARK_SERVER_TOKEN is missing from settings/environment.")

    from_email = getattr(settings, "POSTMARK_FROM_EMAIL", "info@myhomebro.com")
    message_stream = getattr(settings, "POSTMARK_MESSAGE_STREAM", "outbound")

    to_email = _get_homeowner_email(invoice)
    if not to_email:
        raise RuntimeError("Homeowner email not found for this invoice.")

    homeowner_name = _get_homeowner_name(invoice)

    inv_number = getattr(invoice, "invoice_number", None) or str(invoice.id)
    amount_val = getattr(invoice, "amount", None) or 0

    project = getattr(getattr(invoice, "agreement", None), "project", None)
    project_title = getattr(project, "title", None) or getattr(invoice, "project_title", None) or "Your Project"

    ms_id = getattr(invoice, "milestone_id_snapshot", None) or getattr(invoice, "milestone_id", None) or ""
    ms_title = _safe_text(getattr(invoice, "milestone_title_snapshot", "") or getattr(invoice, "milestone_title", "") or "Milestone")

    notes, atts = _invoice_notes_and_attachments(invoice)

    approve_url = _build_magic_invoice_action_url(invoice, action="approve")
    dispute_url = _build_magic_invoice_action_url(invoice, action="dispute")
    pdf_url = _build_magic_invoice_pdf_url(invoice)

    subject = f"MyHomeBro Invoice #{inv_number} – {project_title}"
    milestone_line = f"#{ms_id} — {ms_title}" if ms_id else ms_title

    html = f"""
    <div style="font-family: Arial, sans-serif; line-height: 1.45; color:#111827;">
      <h2 style="margin:0 0 10px;">Invoice Ready</h2>

      <p style="margin:0 0 10px;">Hi {homeowner_name},</p>

      <p style="margin:0 0 14px;">
        Your contractor submitted an invoice for <b>{project_title}</b>.
      </p>

      <div style="margin:0 0 14px;padding:12px;border:1px solid #e5e7eb;border-radius:12px;background:#ffffff;">
        <div style="margin:0 0 10px;">
          <b>Invoice:</b> {inv_number}<br/>
          <b>Amount:</b> ${float(amount_val):.2f}<br/>
          <b>Milestone:</b> {milestone_line}
        </div>

        <div style="margin:0 0 10px;">
          <b>Completion Notes:</b><br/>
          {_format_notes_html(notes)}
        </div>

        <div style="margin:0 0 6px;">
          <b>Attachments:</b>
          {_render_attachments_html(atts)}
        </div>
      </div>

      <div style="margin:0 0 14px;">
        <a href="{approve_url}"
           style="display:inline-block;padding:12px 16px;border-radius:12px;text-decoration:none;background:#16a34a;color:#fff;font-weight:800;">
          Approve &amp; Pay
        </a>
        <a href="{dispute_url}"
           style="display:inline-block;margin-left:10px;padding:12px 16px;border-radius:12px;text-decoration:none;background:#dc2626;color:#fff;font-weight:800;">
          Dispute
        </a>
      </div>

      <div style="margin:0 0 14px;">
        <a href="{pdf_url}"
           style="display:inline-block;padding:10px 14px;border-radius:12px;text-decoration:none;background:#111827;color:#fff;font-weight:800;">
          View Invoice PDF
        </a>
      </div>

      <p style="margin:0;color:#6b7280;font-size:12px;">
        This link is unique to you. If you have questions, reply to this email.
      </p>
    </div>
    """

    client = PostmarkClient(server_token=token)
    return client.emails.send(
        From=from_email,
        To=to_email,
        Subject=subject,
        HtmlBody=html,
        MessageStream=message_stream,
    )


def _agreement_has_active_dispute(agreement) -> bool:
    """
    HARD LOCK:
    Block submit/resend while any active dispute exists on the agreement.
    """
    if not agreement:
        return False
    try:
        return agreement.disputes.filter(status__in=("initiated", "open", "under_review")).exists()
    except Exception:
        return False


class InvoiceViewSet(viewsets.ModelViewSet):
    serializer_class = InvoiceSerializer
    permission_classes = [IsAuthenticated]

    def get_queryset(self):
        user = self.request.user
        return (
            Invoice.objects
            .filter(agreement__project__contractor__user=user)
            .select_related("agreement__project__contractor__user", "agreement__project__homeowner", "agreement__contractor", "agreement__project")
            .distinct()
        )

    @action(detail=True, methods=["get"], url_path="pdf")
    def pdf(self, request, pk=None):
        invoice = self.get_object()
        try:
            pdf_bytes = generate_invoice_pdf_bytes(invoice)
            filename = f"invoice_{getattr(invoice, 'invoice_number', pk)}.pdf"
            resp = HttpResponse(pdf_bytes, content_type="application/pdf")
            resp["Content-Disposition"] = f'attachment; filename="{filename}"'
            return resp
        except Exception:
            logger.exception("PDF generation for Invoice %s failed", getattr(invoice, "id", pk))
            return Response({"detail": "Failed to generate invoice PDF."}, status=status.HTTP_500_INTERNAL_SERVER_ERROR)

    # ------------------------------------------------------------------
    # ✅ NEW: Direct Pay (Subcontractor / no escrow) — create Stripe Checkout link
    # POST /api/projects/invoices/<id>/direct_pay_link/
    # ------------------------------------------------------------------
    @action(detail=True, methods=["post"], url_path="direct_pay_link")
    def direct_pay_link(self, request, pk=None):
        invoice = self.get_object()

        # Ownership guard (match your submit/resend rule)
        if request.user != invoice.agreement.project.contractor.user:
            raise PermissionDenied("Only the contractor can create a Direct Pay link for this invoice.")

        # 🔒 Reuse dispute hard-lock
        if _agreement_has_active_dispute(getattr(invoice, "agreement", None)):
            return Response(
                {"detail": "This agreement has an active dispute. Direct Pay link creation is paused."},
                status=400,
            )

        # Must be direct pay agreement
        if getattr(invoice.agreement, "payment_mode", None) != "direct":
            return Response(
                {"detail": "This agreement is not in Direct Pay mode."},
                status=400,
            )

        # Safety: paid invoices cannot get a new pay link
        if str(getattr(invoice, "status", "") or "").lower() == "paid" or getattr(invoice, "direct_pay_paid_at", None):
            return Response(
                {"detail": "This invoice is already paid and cannot generate a new pay link."},
                status=400,
            )

        # If a link already exists, just return it (idempotent behavior)
        existing_url = (getattr(invoice, "direct_pay_checkout_url", "") or "").strip()
        if existing_url:
            return Response({"checkout_url": existing_url}, status=status.HTTP_200_OK)

        try:
            checkout_url = create_direct_pay_checkout_for_invoice(invoice)
        except Exception as e:
            logger.exception("Direct Pay link creation failed for invoice %s", getattr(invoice, "id", pk))
            return Response({"detail": "Failed to create Direct Pay link.", "error": str(e)}, status=400)

        return Response({"checkout_url": checkout_url}, status=status.HTTP_200_OK)

    @action(detail=True, methods=["post"])
    def submit(self, request, pk=None):
        invoice = self.get_object()
        if request.user != invoice.agreement.project.contractor.user:
            raise PermissionDenied("Only the contractor can submit invoice notifications.")

        # 🔒 NEW: block submit while dispute active
        if _agreement_has_active_dispute(getattr(invoice, "agreement", None)):
            return Response({"detail": "This agreement has an active dispute. Invoice submission is paused."}, status=400)

        # ✅ Safety: never downgrade released/paid invoices to pending
        if getattr(invoice, "escrow_released", False) or str(invoice.status or "").lower() == "paid":
            return Response({"detail": "This invoice is already paid/released and cannot be re-submitted."}, status=400)

        if invoice.status != InvoiceStatus.PENDING:
            invoice.status = InvoiceStatus.PENDING

        invoice.last_email_error = ""
        invoice.save(update_fields=["status", "last_email_error"])

        try:
            result = _send_invoice_email_postmark(invoice)
            message_id = None
            if isinstance(result, dict):
                message_id = result.get("MessageID") or result.get("MessageId")

            invoice.email_sent_at = timezone.now()
            invoice.email_message_id = message_id or ""
            invoice.last_email_error = ""
            invoice.save(update_fields=["email_sent_at", "email_message_id", "last_email_error"])

            return Response(self.get_serializer(invoice, context={"request": request}).data, status=status.HTTP_200_OK)

        except Exception as e:
            logger.exception("Invoice submit email failed for invoice %s", invoice.id)
            invoice.last_email_error = str(e)
            invoice.save(update_fields=["last_email_error"])
            return Response({"detail": "Invoice saved but email failed to send.", "error": str(e)}, status=status.HTTP_500_INTERNAL_SERVER_ERROR)

    @action(detail=True, methods=["post"])
    def resend(self, request, pk=None):
        invoice = self.get_object()
        if request.user != invoice.agreement.project.contractor.user:
            raise PermissionDenied("Only the contractor can resend invoice notifications.")

        # 🔒 NEW: block resend while dispute active
        if _agreement_has_active_dispute(getattr(invoice, "agreement", None)):
            return Response({"detail": "This agreement has an active dispute. Invoice resend is paused."}, status=400)

        # ✅ Safety: never resend/alter state for released/paid invoices
        if getattr(invoice, "escrow_released", False) or str(invoice.status or "").lower() == "paid":
            return Response({"detail": "This invoice is already paid/released and cannot be resent."}, status=400)

        invoice.last_email_error = ""
        invoice.save(update_fields=["last_email_error"])

        try:
            result = _send_invoice_email_postmark(invoice)
            message_id = None
            if isinstance(result, dict):
                message_id = result.get("MessageID") or result.get("MessageId")

            invoice.email_sent_at = timezone.now()
            invoice.email_message_id = message_id or ""
            invoice.last_email_error = ""
            invoice.save(update_fields=["email_sent_at", "email_message_id", "last_email_error"])

            return Response(self.get_serializer(invoice, context={"request": request}).data, status=status.HTTP_200_OK)

        except Exception as e:
            logger.exception("Invoice resend email failed for invoice %s", invoice.id)
            invoice.last_email_error = str(e)
            invoice.save(update_fields=["last_email_error"])
            return Response({"detail": "Resend failed.", "error": str(e)}, status=status.HTTP_500_INTERNAL_SERVER_ERROR)


class InvoicePDFView(APIView):
    """
    Legacy authenticated PDF file view kept for urls.py compatibility.
    """
    permission_classes = [IsAuthenticated]

    def get(self, request, pk):
        invoice = get_object_or_404(Invoice, pk=pk)
        user = request.user

        if (
            user != invoice.agreement.project.contractor.user and
            user != invoice.agreement.project.homeowner.created_by.user
        ):
            return Response({"detail": "Unauthorized access."}, status=status.HTTP_403_FORBIDDEN)

        if not getattr(invoice, "pdf_file", None):
            return Response({"detail": "No PDF file found for this invoice."}, status=status.HTTP_404_NOT_FOUND)

        file_path = invoice.pdf_file.path
        if not os.path.exists(file_path):
            return Response({"detail": "File not found."}, status=status.HTTP_404_NOT_FOUND)

        return FileResponse(open(file_path, "rb"), as_attachment=True, filename=os.path.basename(file_path))
