# backend/projects/services/mailer.py
from django.core.mail import EmailMessage
from django.conf import settings

DEFAULT_FROM = getattr(settings, "DEFAULT_FROM_EMAIL", "no-reply@myhomebro.com")

def email_signed_agreement(agreement, *, subject=None, body=None, attach_pdf: bool = True) -> bool:
    """
    Emails the latest signed PDF to contractor + homeowner.
    """
    to_addrs = []
    if getattr(agreement.contractor, "email", None):
        to_addrs.append(agreement.contractor.email)
    if getattr(agreement, "homeowner_email", None):
        to_addrs.append(agreement.homeowner_email)

    if not to_addrs:
        return False

    subject = subject or f"MyHomeBro – Signed Agreement #{agreement.id}"
    body = body or "Attached is your signed agreement. Thank you for using MyHomeBro."

    msg = EmailMessage(subject, body, from_email=DEFAULT_FROM, to=to_addrs)
    if attach_pdf and getattr(agreement, "signed_pdf", None) and agreement.signed_pdf:
        agreement.signed_pdf.open("rb")
        try:
            msg.attach(agreement.signed_pdf.name.split("/")[-1], agreement.signed_pdf.read(), "application/pdf")
        finally:
            agreement.signed_pdf.close()
    msg.send(fail_silently=False)
    return True
