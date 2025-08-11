# projects/notifications.py

from django.conf import settings
from django.urls import reverse
from core.notifications import send_notification # Corrected import

def notify_invoice_created(invoice):
    homeowner = invoice.agreement.project.homeowner
    contractor = invoice.agreement.project.contractor
    
    if not homeowner or not homeowner.email:
        return

    magic_link = f"{settings.SITE_URL}{reverse('projects_api:magic-invoice-detail', kwargs={'pk': invoice.pk})}?token={invoice.agreement.homeowner_access_token}"

    context = {
        "homeowner_name": homeowner.name,
        "contractor_name": contractor.get_full_name(),
        "invoice": invoice,
        "link": magic_link,
        "site_name": "MyHomeBro",
        "sms_text": f"You have a new invoice for {invoice.amount} from {contractor.get_full_name()} for project '{invoice.agreement.project.title}'. View: {magic_link}"
    }

    send_notification(
        recipient=homeowner,
        subject=f"New Invoice from MyHomeBro: #{invoice.invoice_number}",
        template_prefix="emails/new_invoice",
        context=context
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