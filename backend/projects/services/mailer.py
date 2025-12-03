# backend/projects/services/mailer.py
from django.core.mail import EmailMessage, EmailMultiAlternatives
from django.conf import settings
from django.template.loader import render_to_string
from django.utils.timezone import now

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
          msg.attach(
              agreement.signed_pdf.name.split("/")[-1],
              agreement.signed_pdf.read(),
              "application/pdf",
          )
      finally:
          agreement.signed_pdf.close()
  msg.send(fail_silently=False)
  return True


def email_signing_invite(agreement, *, sign_url: str) -> bool:
  """
  Sends an HTML 'Review & Sign Agreement' invite email to the homeowner
  using the new_agreement.html template.

  This relies on your EMAIL_BACKEND being configured for Postmark.
  """
  homeowner = getattr(agreement, "homeowner", None)
  homeowner_email = getattr(homeowner, "email", None)
  if not homeowner or not homeowner_email:
      return False

  contractor = getattr(agreement, "contractor", None)

  project_title = (
      getattr(agreement, "project_title", None)
      or getattr(getattr(agreement, "project", None), "title", None)
      or f"Agreement #{agreement.id}"
  )

  ctx = {
      "homeowner_name": getattr(homeowner, "full_name", None)
      or getattr(agreement, "homeowner_name", None)
      or "Homeowner",
      "contractor_name": getattr(contractor, "business_name", None)
      or getattr(contractor, "full_name", None)
      or "Your contractor",
      "project_title": project_title,
      "link": sign_url,
      "year": now().year,
      # Optional: if you have a public logo URL, you can build it here:
      "site_logo_url": getattr(settings, "PUBLIC_LOGO_URL", None),
  }

  subject = f"Agreement for {project_title} — Signature Requested"

  # Plain text fallback
  text_body = (
      f"Hello {ctx['homeowner_name']},\n\n"
      f"Your contractor has prepared an agreement for your project '{project_title}'.\n\n"
      f"Review and sign here: {sign_url}\n\n"
      "If you did not request this, you can ignore this message.\n\n"
      "— MyHomeBro"
  )

  html_body = render_to_string("projects/new_agreement.html", ctx)

  msg = EmailMultiAlternatives(
      subject=subject,
      body=text_body,
      from_email=DEFAULT_FROM,
      to=[homeowner_email],
  )
  msg.attach_alternative(html_body, "text/html")
  msg.send(fail_silently=False)
  return True
