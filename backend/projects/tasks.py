# projects/tasks.py

import logging
from datetime import timedelta

from celery import shared_task  # type: ignore
from django.utils import timezone
from django.apps import apps

from .models import Agreement, Invoice, InvoiceStatus
from projects.notifications import notify_invoice_created, notify_escrow_auto_released  # type: ignore

# ✅ NEW: canonical agreement completion recompute
from projects.services.agreement_completion import recompute_and_apply_agreement_completion

logger = logging.getLogger(__name__)

# ─────────────────────────────────────────────────────────────
# Optional chat support (do not let Celery crash if chat removed)
# ─────────────────────────────────────────────────────────────
try:
    from chat.notifications import notify_new_message  # type: ignore
except Exception:
    notify_new_message = None


# ─────────────────────────────────────────────────────────────
# Notification Tasks
# ─────────────────────────────────────────────────────────────

@shared_task(name="notify_recipient_new_message")
def task_notify_recipient_new_message(message_id: int):
    if notify_new_message is None:
        logger.warning("Chat app not available; skipping message notification.")
        return

    Message = apps.get_model("chat", "Message")
    try:
        message = Message.objects.select_related("conversation", "sender").get(pk=message_id)
        notify_new_message(message)
        logger.info(f"Processed new message notification for message ID {message_id}")
    except Message.DoesNotExist:
        logger.warning(f"Message {message_id} not found")
    except Exception as e:
        logger.error(f"task_notify_recipient_new_message failed: {e}")


@shared_task(name="send_invoice_notification")
def task_send_invoice_notification(invoice_id: int):
    try:
        invoice = Invoice.objects.select_related("agreement__project__homeowner").get(id=invoice_id)
        notify_invoice_created(invoice)
        logger.info(f"Processed invoice notification for invoice {invoice_id}")
    except Invoice.DoesNotExist:
        logger.error(f"Invoice {invoice_id} does not exist")
    except Exception as e:
        logger.error(f"task_send_invoice_notification failed: {e}")


# ─────────────────────────────────────────────────────────────
# PDF Tasks
# ─────────────────────────────────────────────────────────────

@shared_task(name="generate_full_agreement_pdf")
def task_generate_full_agreement_pdf(agreement_id: int):
    """
    Generate the Agreement PDF in the background using the canonical
    service implementation: projects.services.pdf.generate_full_agreement_pdf
    """
    try:
        agreement = Agreement.objects.get(id=agreement_id)

        from projects.services.pdf import generate_full_agreement_pdf as svc_generate_full  # type: ignore

        svc_generate_full(agreement)

        logger.info(f"Generated PDF for Agreement {agreement_id}")

    except Agreement.DoesNotExist:
        logger.error(f"Agreement {agreement_id} does not exist")
    except TypeError as e:
        logger.error(f"PDF generation signature mismatch for Agreement {agreement_id}: {e}")
        raise
    except Exception as e:
        logger.error(f"PDF generation failed for Agreement {agreement_id}: {e}")


# ─────────────────────────────────────────────────────────────
# Auto-release escrow
# ─────────────────────────────────────────────────────────────

@shared_task(name="auto_release_undisputed_invoices")
def task_auto_release_undisputed_invoices():
    now = timezone.now()
    cutoff = now - timedelta(days=5)

    invoices = Invoice.objects.filter(
        status=InvoiceStatus.PENDING,
        disputed=False,
        escrow_released=False,
        marked_complete_at__lte=cutoff,
    ).select_related("agreement__project__contractor__user")

    if not invoices.exists():
        logger.info("No invoices eligible for auto-release")
        return

    for invoice in invoices:
        try:
            invoice.status = InvoiceStatus.PAID
            invoice.escrow_released = True
            invoice.escrow_released_at = now
            invoice.save(update_fields=["status", "escrow_released", "escrow_released_at"])

            # ✅ NEW: recompute agreement completion after invoice becomes paid/released
            try:
                ag_id = getattr(invoice, "agreement_id", None)
                if ag_id:
                    recompute_and_apply_agreement_completion(int(ag_id))
            except Exception as exc:
                logger.warning(f"Agreement completion recompute failed for invoice {invoice.id}: {exc}")

            notify_escrow_auto_released(invoice)
            logger.info(f"Auto-released escrow for invoice {invoice.id}")

        except Exception as e:
            logger.error(f"Auto-release failed for invoice {invoice.id}: {e}")


# ─────────────────────────────────────────────────────────────
# Agreement signing pipeline
# ─────────────────────────────────────────────────────────────

@shared_task(name="projects.tasks.process_agreement_signing")
def process_agreement_signing(agreement_id: int) -> str:
    """
    Called after a homeowner or contractor signs an Agreement:
    - regenerate the PDF (canonical service),
    - send notification emails,
    - etc.
    """
    try:
        agreement = Agreement.objects.get(pk=agreement_id)

        from projects.services.pdf import generate_full_agreement_pdf as svc_generate_full  # type: ignore
        svc_generate_full(agreement)

        return f"Agreement {agreement_id} processed"

    except Agreement.DoesNotExist:
        return f"Agreement {agreement_id} not found"
    except Exception as e:
        logger.error(f"process_agreement_signing failed for Agreement {agreement_id}: {e}")
        return f"Agreement {agreement_id} error"