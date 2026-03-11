# backend/projects/services/mailer.py

from __future__ import annotations

import json
from urllib import request as urlrequest
from urllib.error import HTTPError, URLError

from django.conf import settings
from django.core.mail import EmailMessage, EmailMultiAlternatives
from django.template.loader import render_to_string
from django.utils.timezone import now

DEFAULT_FROM = getattr(settings, "DEFAULT_FROM_EMAIL", "info@myhomebro.com")
POSTMARK_SERVER_TOKEN = getattr(settings, "POSTMARK_SERVER_TOKEN", "") or ""
POSTMARK_MESSAGE_STREAM = getattr(settings, "POSTMARK_MESSAGE_STREAM", "outbound") or "outbound"

POSTMARK_AGREEMENT_INVITE_TEMPLATE = (
    getattr(settings, "POSTMARK_AGREEMENT_INVITE_TEMPLATE", "agreement-invite") or "agreement-invite"
)
POSTMARK_ESCROW_FUNDING_TEMPLATE = (
    getattr(settings, "POSTMARK_ESCROW_FUNDING_TEMPLATE", "escrow-funding") or "escrow-funding"
)
POSTMARK_SIGNED_AGREEMENT_TEMPLATE = (
    getattr(settings, "POSTMARK_SIGNED_AGREEMENT_TEMPLATE", "signed-agreement") or "signed-agreement"
)


def _site_url() -> str:
    return (getattr(settings, "MHB_SITE_URL", "") or "").rstrip("/")


def _public_logo_url() -> str | None:
    return getattr(settings, "PUBLIC_LOGO_URL", None)


def _postmark_enabled() -> bool:
    return bool(POSTMARK_SERVER_TOKEN)


def _postmark_headers() -> dict[str, str]:
    return {
        "Accept": "application/json",
        "Content-Type": "application/json",
        "X-Postmark-Server-Token": POSTMARK_SERVER_TOKEN,
    }


def _postmark_request(payload: dict) -> dict:
    """
    Send a raw request to Postmark using stdlib urllib so no extra dependency is required.
    Raises on HTTP/network failure.
    """
    req = urlrequest.Request(
        url="https://api.postmarkapp.com/email/withTemplate",
        data=json.dumps(payload).encode("utf-8"),
        headers=_postmark_headers(),
        method="POST",
    )
    with urlrequest.urlopen(req, timeout=20) as resp:
        body = resp.read().decode("utf-8") or "{}"
        return json.loads(body)


def send_postmark_template_email(
    *,
    to_email: str | list[str],
    template_alias: str,
    template_model: dict,
    tag: str | None = None,
) -> dict:
    """
    Sends a Postmark template email.
    """
    if not _postmark_enabled():
        raise RuntimeError("POSTMARK_SERVER_TOKEN is not configured.")

    if isinstance(to_email, (list, tuple)):
        to_value = ",".join([str(x).strip() for x in to_email if str(x).strip()])
    else:
        to_value = str(to_email or "").strip()

    if not to_value:
        raise ValueError("to_email is required.")

    payload = {
        "From": DEFAULT_FROM,
        "To": to_value,
        "TemplateAlias": template_alias,
        "TemplateModel": template_model or {},
        "MessageStream": POSTMARK_MESSAGE_STREAM,
    }
    if tag:
        payload["Tag"] = tag

    return _postmark_request(payload)


def _attach_agreement_pdf(msg, agreement) -> bool:
    """
    Try to attach the best available final PDF file.
    Returns True if an attachment was added.
    """
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
    Keeps Django email delivery because attachments are already working here.
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


def _render_signing_invite_fallback(
    *,
    homeowner_email: str,
    subject: str,
    text_body: str,
    html_template: str,
    context: dict,
) -> bool:
    html_body = render_to_string(html_template, context)
    msg = EmailMultiAlternatives(
        subject=subject,
        body=text_body,
        from_email=DEFAULT_FROM,
        to=[homeowner_email],
    )
    msg.attach_alternative(html_body, "text/html")
    msg.send(fail_silently=False)
    return True


def email_signing_invite(agreement, *, sign_url: str) -> bool:
    """
    Sends an HTML 'Review & Sign Agreement' email to the homeowner.
    Uses Postmark template first, then falls back to Django HTML rendering.
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

    contractor_name = (
        getattr(contractor, "business_name", None)
        or getattr(contractor, "full_name", None)
        or "Your contractor"
    )

    homeowner_name = (
        getattr(homeowner, "full_name", None)
        or getattr(agreement, "homeowner_name", None)
        or "Homeowner"
    )

    ctx = {
        "homeowner_name": homeowner_name,
        "contractor_name": contractor_name,
        "project_title": project_title,
        "link": sign_url,
        "year": now().year,
        "site_logo_url": _public_logo_url(),
    }

    subject = f"Agreement for {project_title} — Signature Requested"

    text_body = (
        f"Hello {homeowner_name},\n\n"
        f"Your contractor has prepared an agreement for your project '{project_title}'.\n\n"
        f"Review and sign here:\n{sign_url}\n\n"
        "If you did not request this, you can ignore this message.\n\n"
        "— MyHomeBro"
    )

    if _postmark_enabled():
        try:
            send_postmark_template_email(
                to_email=homeowner_email,
                template_alias=POSTMARK_AGREEMENT_INVITE_TEMPLATE,
                template_model=ctx,
                tag="agreement-invite",
            )
            return True
        except (HTTPError, URLError, RuntimeError, ValueError, Exception):
            pass

    # Fallback
    return _render_signing_invite_fallback(
        homeowner_email=homeowner_email,
        subject=subject,
        text_body=text_body,
        html_template="projects/new_agreement.html",
        context=ctx,
    )


def email_escrow_funding_request(
    agreement,
    *,
    funding_url: str,
) -> bool:
    """
    Sends an escrow funding request to the homeowner.
    Uses Postmark first, falls back to local HTML rendering.
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

    contractor_name = (
        getattr(contractor, "business_name", None)
        or getattr(contractor, "full_name", None)
        or "Your contractor"
    )

    homeowner_name = (
        getattr(homeowner, "full_name", None)
        or getattr(agreement, "homeowner_name", None)
        or "Homeowner"
    )

    ctx = {
        "homeowner_name": homeowner_name,
        "contractor_name": contractor_name,
        "project_title": project_title,
        "funding_url": funding_url,
        "year": now().year,
        "site_logo_url": _public_logo_url(),
    }

    subject = f"Fund Escrow for {project_title}"

    text_body = (
        f"Hello {homeowner_name},\n\n"
        f"Your agreement for '{project_title}' is ready for escrow funding.\n\n"
        f"Review and fund escrow here:\n{funding_url}\n\n"
        "If you did not request this, you can ignore this message.\n\n"
        "— MyHomeBro"
    )

    if _postmark_enabled():
        try:
            send_postmark_template_email(
                to_email=homeowner_email,
                template_alias=POSTMARK_ESCROW_FUNDING_TEMPLATE,
                template_model=ctx,
                tag="escrow-funding",
            )
            return True
        except (HTTPError, URLError, RuntimeError, ValueError, Exception):
            pass

    logo_url = _public_logo_url()
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
          Escrow Funding Requested
        </h1>

        <p style="margin:0 0 18px 0;color:#374151;font-size:14px;line-height:1.6;">
          Hello {homeowner_name},
        </p>

        <p style="margin:0 0 18px 0;color:#374151;font-size:14px;line-height:1.6;">
          Your agreement for <b>{project_title}</b> is ready for escrow funding.
          Once escrow is funded, the project can proceed under the agreement terms.
        </p>

        <div style="margin:20px 0;text-align:center;">
          <a href="{funding_url}"
             style="display:inline-block;background:#16a34a;color:#ffffff;text-decoration:none;
                    padding:12px 18px;border-radius:999px;font-weight:700;font-size:14px;">
            Review & Fund Escrow
          </a>
        </div>

        <p style="margin:16px 0 6px 0;color:#6b7280;font-size:12px;line-height:1.6;">
          If the button does not work, copy and paste this link into your browser:
        </p>
        <p style="margin:0;color:#2563eb;font-size:12px;word-break:break-all;">
          {funding_url}
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

    logo_url = _public_logo_url()
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


# ---------------------------------------------------------------------
# Expense Request Email (customer action email + attachment links)
# ---------------------------------------------------------------------

def email_expense_request(
    expense,
    *,
    customer_email: str,
    customer_name: str,
    approve_url: str,
    pay_url: str,
    reject_url: str,
    attachment_links: list[dict],
    is_resend: bool = False,
) -> bool:
    """
    Sends an HTML email to the customer for an expense request:
    - Approve (optional)
    - Pay via Stripe
    - Reject
    - Shows attachments as links
    """
    if not customer_email:
        return False

    subject = f"MyHomeBro — {'Reminder: ' if is_resend else ''}Expense request for approval"

    description = getattr(expense, "description", "") or "Expense"
    amount = getattr(expense, "amount", None)
    incurred_date = getattr(expense, "incurred_date", None)
    notes = (getattr(expense, "notes_to_homeowner", "") or "").strip()

    text_body = (
        f"Hi {customer_name},\n\n"
        f"A contractor has sent an expense request for your review:\n"
        f"- Description: {description}\n"
        f"- Amount: ${amount}\n"
        f"- Date incurred: {incurred_date}\n\n"
        f"{('Notes from contractor:\\n' + notes + '\\n\\n') if notes else ''}"
        f"Approve: {approve_url}\n"
        f"Pay: {pay_url}\n"
        f"Reject: {reject_url}\n\n"
        "— MyHomeBro"
    )

    logo_url = _public_logo_url()
    logo_html = (
        f'<div style="text-align:center;margin:0 0 14px 0;">'
        f'<img src="{logo_url}" alt="MyHomeBro" style="height:40px;max-width:200px;" />'
        f"</div>"
        if logo_url
        else '<div style="text-align:center;font-weight:700;font-size:18px;margin:0 0 14px 0;">MyHomeBro</div>'
    )

    attachments_html = ""
    if attachment_links:
        items = "".join(
            f'<li style="margin:6px 0;"><a href="{a["url"]}" '
            f'style="color:#2563eb;text-decoration:none;">{a["name"]}</a></li>'
            for a in attachment_links
        )
        attachments_html = f"""
          <div style="margin-top:14px;">
            <div style="font-weight:700;color:#111827;margin-bottom:6px;">Attachments</div>
            <ul style="margin:0;padding-left:18px;color:#374151;font-size:14px;line-height:1.6;">
              {items}
            </ul>
          </div>
        """

    notes_html = ""
    if notes:
        notes_html = f"""
          <div style="margin-top:14px;">
            <div style="font-weight:700;color:#111827;margin-bottom:6px;">Notes from contractor</div>
            <div style="color:#374151;font-size:14px;line-height:1.6;white-space:pre-wrap;">{notes}</div>
          </div>
        """

    html_body = f"""
<!doctype html>
<html>
  <body style="margin:0;padding:0;background:#f6f7fb;font-family:Arial,Helvetica,sans-serif;">
    <div style="max-width:640px;margin:0 auto;padding:28px;">
      <div style="background:#ffffff;border:1px solid #e6e8ef;border-radius:14px;padding:26px;">
        {logo_html}

        <h1 style="margin:0 0 10px 0;font-size:22px;line-height:1.2;color:#111827;text-align:center;">
          Expense Request
        </h1>

        <p style="margin:0 0 14px 0;color:#374151;font-size:14px;line-height:1.6;">
          Hi {customer_name},
        </p>

        <div style="background:#f9fafb;border:1px solid #eef0f6;border-radius:12px;padding:14px;">
          <div style="color:#111827;font-weight:700;margin-bottom:6px;">{description}</div>
          <div style="color:#374151;font-size:14px;line-height:1.6;">
            Amount: <b>${amount}</b><br/>
            Date incurred: {incurred_date}
          </div>
        </div>

        {notes_html}
        {attachments_html}

        <div style="margin:18px 0;text-align:center;">
          <a href="{pay_url}"
             style="display:inline-block;background:#16a34a;color:#ffffff;text-decoration:none;
                    padding:12px 18px;border-radius:999px;font-weight:800;font-size:14px;">
            Approve & Pay
          </a>
        </div>

        <div style="text-align:center;margin-top:8px;">
          <a href="{reject_url}" style="color:#b91c1c;text-decoration:none;font-weight:700;font-size:13px;">
            Reject this expense
          </a>
        </div>

        <p style="margin:16px 0 6px 0;color:#6b7280;font-size:12px;line-height:1.6;">
          If the button does not work, copy and paste this link into your browser:
        </p>
        <p style="margin:0;color:#2563eb;font-size:12px;word-break:break-all;">
          {pay_url}
        </p>

        <div style="margin-top:18px;padding-top:14px;border-top:1px solid #eef0f6;color:#6b7280;font-size:12px;">
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
        to=[customer_email],
    )
    msg.attach_alternative(html_body, "text/html")
    msg.send(fail_silently=False)
    return True