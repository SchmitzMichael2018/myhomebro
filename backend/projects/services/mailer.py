# backend/projects/services/mailer.py

from django.core.mail import EmailMessage, EmailMultiAlternatives
from django.conf import settings
from django.template.loader import render_to_string
from django.utils.timezone import now

DEFAULT_FROM = getattr(settings, "DEFAULT_FROM_EMAIL", "no-reply@myhomebro.com")


def _attach_agreement_pdf(msg, agreement) -> bool:
    """
    Try to attach the best available final PDF file.
    Returns True if an attachment was added.
    """
    # Prefer pdf_file if present (your newer system)
    pdf_file = getattr(agreement, "pdf_file", None)
    if pdf_file and getattr(pdf_file, "name", ""):
        try:
            pdf_file.open("rb")
            try:
                msg.attach(
                    pdf_file.name.split("/")[-1],
                    pdf_file.read(),
                    "application/pdf",
                )
                return True
            finally:
                pdf_file.close()
        except Exception:
            pass

    # Fallback to signed_pdf if you still have it (legacy)
    signed_pdf = getattr(agreement, "signed_pdf", None)
    if signed_pdf and getattr(signed_pdf, "name", ""):
        try:
            signed_pdf.open("rb")
            try:
                msg.attach(
                    signed_pdf.name.split("/")[-1],
                    signed_pdf.read(),
                    "application/pdf",
                )
                return True
            finally:
                signed_pdf.close()
        except Exception:
            pass

    return False


def email_signed_agreement(
    agreement,
    *,
    subject=None,
    body=None,
    attach_pdf: bool = True,
) -> bool:
    """
    Emails the latest signed PDF to contractor + homeowner.
    """
    to_addrs = []

    contractor = getattr(agreement, "contractor", None)
    homeowner = getattr(agreement, "homeowner", None)

    if contractor and getattr(contractor, "email", None):
        to_addrs.append(contractor.email)
    if homeowner and getattr(homeowner, "email", None):
        to_addrs.append(homeowner.email)

    if not to_addrs:
        return False

    subject = subject or f"MyHomeBro – Signed Agreement #{agreement.id}"
    body = body or "Attached is your signed agreement. Thank you for using MyHomeBro."

    msg = EmailMessage(subject, body, from_email=DEFAULT_FROM, to=to_addrs)

    if attach_pdf:
        _attach_agreement_pdf(msg, agreement)

    msg.send(fail_silently=False)
    return True


def email_signing_invite(agreement, *, sign_url: str) -> bool:
    """
    Sends an HTML 'Review & Sign Agreement' email to the homeowner.
    Used ONLY when a signature is still required.
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
        "site_logo_url": getattr(settings, "PUBLIC_LOGO_URL", None),
    }

    subject = f"Agreement for {project_title} — Signature Requested"

    text_body = (
        f"Hello {ctx['homeowner_name']},\n\n"
        f"Your contractor has prepared an agreement for your project '{project_title}'.\n\n"
        f"Review and sign here:\n{sign_url}\n\n"
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


def email_final_agreement_copy(
    agreement,
    *,
    view_url: str,
    attach_pdf: bool = True,
) -> bool:
    """
    Sends a VIEW-ONLY email for a fully signed agreement.
    Attaches the final PDF by default.
    Sends to both contractor + homeowner when emails exist.
    """
    to_addrs = []

    contractor = getattr(agreement, "contractor", None)
    homeowner = getattr(agreement, "homeowner", None)

    if homeowner and getattr(homeowner, "email", None):
        to_addrs.append(homeowner.email)
    if contractor and getattr(contractor, "email", None):
        to_addrs.append(contractor.email)

    if not to_addrs:
        return False

    project_title = (
        getattr(agreement, "project_title", None)
        or getattr(getattr(agreement, "project", None), "title", None)
        or f"Agreement #{agreement.id}"
    )

    homeowner_name = (
        getattr(homeowner, "full_name", None)
        or getattr(agreement, "homeowner_name", None)
        or "Homeowner"
    )

    contractor_name = (
        getattr(contractor, "business_name", None)
        or getattr(contractor, "full_name", None)
        or "Your contractor"
    )

    subject = f"Your Signed Agreement for {project_title}"

    text_body = (
        f"Hi {homeowner_name},\n\n"
        f"Attached is a copy of your final signed agreement for '{project_title}'.\n\n"
        f"You can also view it online here:\n{view_url}\n\n"
        "No further action is required.\n\n"
        "— MyHomeBro"
    )

    logo_url = getattr(settings, "PUBLIC_LOGO_URL", None)
    logo_html = (
        f'<div style="text-align:center;margin:0 0 14px 0;">'
        f'<img src="{logo_url}" alt="MyHomeBro" style="height:40px;max-width:200px;" />'
        f"</div>"
        if logo_url
        else '<div style="text-align:center;font-weight:700;font-size:18px;margin:0 0 14px 0;">MyHomeBro</div>'
    )

    html_body = f"""
<!doctype html>
<html>
  <body style="margin:0;padding:0;background:#f6f7fb;font-family:Arial,Helvetica,sans-serif;">
    <div style="max-width:640px;margin:0 auto;padding:28px;">
      <div style="background:#ffffff;border:1px solid #e6e8ef;border-radius:14px;padding:26px;">
        {logo_html}
        <h1 style="margin:0 0 10px 0;font-size:24px;line-height:1.2;color:#111827;text-align:center;">
          Signed Agreement Copy
        </h1>
        <p style="margin:0 0 18px 0;color:#374151;font-size:14px;line-height:1.6;">
          Hi {homeowner_name},
        </p>
        <p style="margin:0 0 18px 0;color:#374151;font-size:14px;line-height:1.6;">
          Attached is a copy of your <b>final signed agreement</b> for your project <b>{project_title}</b>.
          No further action is required.
        </p>

        <div style="margin:20px 0;text-align:center;">
          <a href="{view_url}"
             style="display:inline-block;background:#2563eb;color:#ffffff;text-decoration:none;
                    padding:12px 18px;border-radius:999px;font-weight:700;font-size:14px;">
            View Signed Agreement
          </a>
        </div>

        <p style="margin:16px 0 6px 0;color:#6b7280;font-size:12px;line-height:1.6;">
          If the button does not work, copy and paste this link into your browser:
        </p>
        <p style="margin:0;color:#2563eb;font-size:12px;word-break:break-all;">
          {view_url}
        </p>

        <div style="margin-top:18px;padding-top:14px;border-top:1px solid #eef0f6;color:#6b7280;font-size:12px;">
          Contractor: {contractor_name}<br/>
          Year: {now().year}
        </div>
      </div>
    </div>
  </body>
</html>
"""

    msg = EmailMultiAlternatives(
        subject=subject,
        body=text_body,
        from_email=DEFAULT_FROM,
        to=to_addrs,
    )
    msg.attach_alternative(html_body, "text/html")

    if attach_pdf:
        _attach_agreement_pdf(msg, agreement)

    msg.send(fail_silently=False)
    return True
