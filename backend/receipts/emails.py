from django.conf import settings
from django.core.mail import EmailMessage


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


def send_receipt_email(receipt):
    """
    Sends the receipt PDF to the homeowner email.
    Returns True if sent, False if no email found.
    Raises exceptions if email backend fails.
    """
    invoice = receipt.invoice
    agreement = getattr(invoice, "agreement", None)
    project = getattr(agreement, "project", None) if agreement else None

    # 1) Prefer Agreement.homeowner.email
    email = _get_email_from_user(getattr(agreement, "homeowner", None)) if agreement else None

    # 2) Fallback: Project.homeowner.email
    if not email and project:
        email = _get_email_from_user(getattr(project, "homeowner", None))

    # 3) Last fallback: any direct string fields if you ever add them later
    if not email:
        # These don't exist today, but harmless to check
        email = getattr(invoice, "homeowner_email", None) or getattr(agreement, "homeowner_email", None)
        if email and isinstance(email, str) and "@" in email:
            email = email.strip()
        else:
            email = None

    if not email:
        return False

    invoice_number = getattr(invoice, "invoice_number", None) or getattr(invoice, "id", "")
    project_title = getattr(project, "title", None) if project else None

    subject = f"Payment Receipt – Invoice {invoice_number}"
    if project_title:
        subject = f"MyHomeBro Receipt – {project_title} (Invoice {invoice_number})"

    msg = EmailMessage(
        subject=subject,
        body=(
            "Thank you for your payment.\n\n"
            "Attached is your receipt for your records.\n\n"
            "— MyHomeBro"
        ),
        from_email=getattr(settings, "DEFAULT_FROM_EMAIL", None),
        to=[email],
    )

    # Ensure PDF exists
    if not receipt.pdf_file or not receipt.pdf_file.name:
        receipt.generate_pdf()

    if not receipt.pdf_file or not receipt.pdf_file.name:
        return False

    receipt.pdf_file.open("rb")
    try:
        msg.attach(
            receipt.pdf_file.name.split("/")[-1],
            receipt.pdf_file.read(),
            "application/pdf",
        )
    finally:
        receipt.pdf_file.close()

    msg.send(fail_silently=False)
    return True
