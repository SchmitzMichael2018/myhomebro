from __future__ import annotations

import logging

from django.conf import settings
from django.core.mail import EmailMessage
from django.utils.timezone import now

log = logging.getLogger(__name__)


def _get_email_from_user(user_obj):
    """
    Safely return user_obj.email if present and looks like an email.
    """
    if not user_obj:
        return None
    email = getattr(user_obj, "email", None)
    if email and isinstance(email, str) and "@" in email:
        return email.strip()
    return None


def _resolve_receipt_recipient_email(receipt):
    """
    Determine who should receive the receipt email.
    Primary: Agreement.homeowner.email (payer)
    Fallback: Project.homeowner.email
    Fallback: invoice/agreement string fields if present
    """
    invoice = getattr(receipt, "invoice", None)
    agreement = getattr(invoice, "agreement", None) if invoice else getattr(receipt, "agreement", None)
    project = getattr(agreement, "project", None) if agreement else None

    # 1) Prefer Agreement.homeowner.email
    email = _get_email_from_user(getattr(agreement, "homeowner", None)) if agreement else None

    # 2) Fallback: Project.homeowner.email
    if not email and project:
        email = _get_email_from_user(getattr(project, "homeowner", None))

    # 3) Last fallback: direct string fields (harmless)
    if not email:
        candidate = None
        if invoice is not None:
            candidate = getattr(invoice, "homeowner_email", None)
        if not candidate and agreement is not None:
            candidate = getattr(agreement, "homeowner_email", None)

        if candidate and isinstance(candidate, str) and "@" in candidate:
            email = candidate.strip()

    return email, invoice, agreement, project


def _default_from_email():
    return (
        getattr(settings, "DEFAULT_FROM_EMAIL", None)
        or getattr(settings, "SERVER_EMAIL", None)
        or "no-reply@myhomebro.com"
    )


def _build_subject(invoice, project):
    invoice_number = getattr(invoice, "invoice_number", None) or getattr(invoice, "id", "")
    project_title = getattr(project, "title", None) if project else None

    if project_title:
        return f"MyHomeBro Receipt – {project_title} (Invoice {invoice_number})"
    return f"MyHomeBro Payment Receipt – Invoice {invoice_number}"


def _build_body(receipt, invoice, agreement, project):
    # Payer name if available
    payer = getattr(agreement, "homeowner", None) if agreement else None
    payer_name = ""
    try:
        if payer and hasattr(payer, "get_full_name"):
            payer_name = (payer.get_full_name() or "").strip()
    except Exception:
        payer_name = ""

    if not payer_name:
        payer_name = getattr(payer, "email", "") if payer else ""

    receipt_no = getattr(receipt, "receipt_number", "")
    invoice_no = getattr(invoice, "invoice_number", "") if invoice else ""
    project_title = getattr(project, "title", "") if project else ""
    agreement_id = getattr(agreement, "id", "") if agreement else ""

    lines = []
    if payer_name:
        lines.append(f"Hi {payer_name},")
        lines.append("")
    else:
        lines.append("Hi,")
        lines.append("")

    lines.append("Thank you for your payment.")
    lines.append("Attached is your receipt for your records.")
    lines.append("")
    if receipt_no:
        lines.append(f"Receipt #: {receipt_no}")
    if invoice_no:
        lines.append(f"Invoice #: {invoice_no}")
    if agreement_id:
        lines.append(f"Agreement ID: {agreement_id}")
    if project_title:
        lines.append(f"Project: {project_title}")

    lines.append("")
    lines.append("If you have any questions, reply to this email.")
    lines.append("")
    lines.append("— MyHomeBro")

    return "\n".join(lines)


def _ensure_receipt_pdf(receipt) -> bool:
    """
    Ensure receipt.pdf_file exists. Returns True if present after ensure.
    Uses receipts.pdf.generate_receipt_pdf(receipt).
    """
    try:
        if getattr(receipt, "pdf_file", None) and getattr(receipt.pdf_file, "name", ""):
            return True
    except Exception:
        pass

    try:
        # canonical generator
        from receipts.pdf import generate_receipt_pdf  # type: ignore

        generate_receipt_pdf(receipt)
    except Exception:
        log.exception("Failed to generate receipt PDF (receipt_id=%s).", getattr(receipt, "id", None))
        return False

    try:
        return bool(receipt.pdf_file and receipt.pdf_file.name)
    except Exception:
        return False


def send_receipt_email(receipt) -> bool:
    """
    Sends the receipt PDF to the homeowner email.
    Returns True if sent, False if no email found or PDF missing.
    Logs emailed_at + email_last_error on the Receipt model (best-effort).
    Raises exceptions ONLY for unexpected catastrophic failures.
    """
    email, invoice, agreement, project = _resolve_receipt_recipient_email(receipt)
    if not email:
        # record failure reason for audit
        try:
            if hasattr(receipt, "email_last_error"):
                receipt.email_last_error = "No recipient email found for receipt."
                receipt.save(update_fields=["email_last_error"])
        except Exception:
            pass
        return False

    # Ensure PDF exists
    if not _ensure_receipt_pdf(receipt):
        try:
            if hasattr(receipt, "email_last_error"):
                receipt.email_last_error = "Receipt PDF missing and generation failed."
                receipt.save(update_fields=["email_last_error"])
        except Exception:
            pass
        return False

    subject = _build_subject(invoice, project)
    body = _build_body(receipt, invoice, agreement, project)

    msg = EmailMessage(
        subject=subject,
        body=body,
        from_email=_default_from_email(),
        to=[email],
    )

    # Attach PDF
    try:
        receipt.pdf_file.open("rb")
        try:
            msg.attach(
                receipt.pdf_file.name.split("/")[-1],
                receipt.pdf_file.read(),
                "application/pdf",
            )
        finally:
            receipt.pdf_file.close()
    except Exception as exc:
        try:
            if hasattr(receipt, "email_last_error"):
                receipt.email_last_error = f"Failed to attach PDF: {exc}"
                receipt.save(update_fields=["email_last_error"])
        except Exception:
            pass
        return False

    # Send
    try:
        msg.send(fail_silently=False)
    except Exception as exc:
        # record failure for visibility
        try:
            if hasattr(receipt, "email_last_error"):
                receipt.email_last_error = str(exc)
            if hasattr(receipt, "emailed_at"):
                receipt.emailed_at = None
            receipt.save(update_fields=[f for f in ["email_last_error", "emailed_at"] if hasattr(receipt, f)])
        except Exception:
            pass
        return False

    # record success
    try:
        update_fields = []
        if hasattr(receipt, "emailed_at"):
            receipt.emailed_at = now()
            update_fields.append("emailed_at")
        if hasattr(receipt, "email_last_error"):
            if getattr(receipt, "email_last_error", ""):
                receipt.email_last_error = ""
            update_fields.append("email_last_error")
        if update_fields:
            receipt.save(update_fields=update_fields)
    except Exception:
        pass

    return True