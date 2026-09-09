# projects/notifications.py

from django.conf import settings
from core.notifications import send_notification # Corrected import
from projects.services.sms_automation import evaluate_sms_automation

def notify_invoice_created(invoice):
    homeowner = invoice.agreement.project.homeowner
    contractor = invoice.agreement.project.contractor
    
    if not homeowner:
        return

    frontend_url = str(getattr(settings, "FRONTEND_URL", settings.SITE_URL) or settings.SITE_URL).rstrip("/")
    magic_link = f"{frontend_url}/invoice/{invoice.public_token}"
    contractor_name = (
        getattr(contractor, "business_name", "")
        or contractor.user.get_full_name()
        or contractor.user.email
    )

    context = {
        "homeowner_name": getattr(homeowner, "full_name", "") or homeowner.email,
        "contractor_name": contractor_name,
        "invoice": invoice,
        "link": magic_link,
        "site_name": "MyHomeBro",
        "sms_text": f"You have a new invoice for {invoice.amount} from {contractor_name} for project '{invoice.agreement.project.title}'. View: {magic_link}"
    }

    if homeowner.email:
        send_notification(
            recipient=homeowner,
            subject=f"New Invoice from MyHomeBro: #{invoice.invoice_number}",
            template_prefix="emails/new_invoice",
            context=context,
            send_sms=False,
        )

    evaluate_sms_automation(
        "invoice_ready",
        homeowner=homeowner,
        agreement=invoice.agreement,
        invoice=invoice,
        metadata={"notification_source": "invoice_created"},
    )

def notify_escrow_auto_released(invoice):
    contractor = invoice.agreement.project.contractor
    
    context = {
        "contractor_name": contractor.get_full_name(),
        "invoice": invoice,
        "agreement_title": invoice.agreement.project.title,
        "link": f"{settings.FRONTEND_URL}/invoices/{invoice.id}"
    }

    send_notification(
        recipient=contractor,
        subject=f"Milestone Payment Auto-Released: ${invoice.amount}",
        template_prefix="emails/escrow_auto_released",
        context=context
    )
