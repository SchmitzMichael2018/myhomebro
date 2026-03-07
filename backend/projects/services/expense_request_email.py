# backend/projects/services/expense_request_email.py
from __future__ import annotations

from typing import Optional, Tuple

from django.conf import settings
from django.core.mail import send_mail


def _first_nonempty(*vals) -> Optional[str]:
    for v in vals:
        if v is None:
            continue
        s = str(v).strip()
        if s:
            return s
    return None


def _resolve_customer_email(expense) -> Optional[str]:
    """
    Best-effort extraction of the customer email from an ExpenseRequest -> Agreement graph.

    Supports common field patterns:
      agreement.customer_email
      agreement.homeowner_email (legacy name)
      agreement.customer.email (FK)
      agreement.homeowner.email (FK)
    """
    ag = getattr(expense, "agreement", None)
    if not ag:
        return None

    # direct string fields
    email = _first_nonempty(
        getattr(ag, "customer_email", None),
        getattr(ag, "homeowner_email", None),
        getattr(ag, "email", None),
    )
    if email:
        return email

    # nested customer / homeowner object patterns
    cust = getattr(ag, "customer", None) or getattr(ag, "homeowner", None)
    if cust:
        email = _first_nonempty(getattr(cust, "email", None))
        if email:
            return email

    return None


def _resolve_customer_name(expense) -> str:
    ag = getattr(expense, "agreement", None)
    if not ag:
        return "Customer"
    # Try a few common patterns
    name = _first_nonempty(
        getattr(ag, "customer_name", None),
        getattr(ag, "homeowner_name", None),
        getattr(getattr(ag, "customer", None), "name", None),
        getattr(getattr(ag, "homeowner", None), "name", None),
        getattr(getattr(ag, "customer", None), "full_name", None),
        getattr(getattr(ag, "homeowner", None), "full_name", None),
    )
    return name or "Customer"


def _build_customer_link(expense) -> str:
    """
    Link the customer can use to view/respond.
    You can change this once your customer portal route is finalized.
    """
    base = getattr(settings, "MHB_SITE_URL", "") or ""
    base = base.rstrip("/")
    # default: a simple route you can implement later
    return f"{base}/customer/expenses/{expense.id}" if base else f"/customer/expenses/{expense.id}"


def send_expense_request_email(expense, *, is_resend: bool) -> Tuple[bool, str]:
    """
    Sends the expense request email using Django's configured email backend.

    Returns: (ok, message)
    """
    to_email = _resolve_customer_email(expense)
    if not to_email:
        return False, "Missing customer email on the related Agreement."

    from_email = getattr(settings, "DEFAULT_FROM_EMAIL", None) or getattr(settings, "MHB_FROM_EMAIL", None)
    if not from_email:
        return False, "Missing DEFAULT_FROM_EMAIL (or MHB_FROM_EMAIL) in settings."

    customer_name = _resolve_customer_name(expense)
    link = _build_customer_link(expense)

    subject_prefix = "[MyHomeBro] "
    subject = f"{subject_prefix}{'Reminder: ' if is_resend else ''}Expense request for approval"

    # Keep this simple and clear (plain text).
    lines = [
        f"Hi {customer_name},",
        "",
        "A contractor has sent an expense request for your review:",
        f"- Description: {expense.description}",
        f"- Amount: ${expense.amount}",
        f"- Date incurred: {getattr(expense, 'incurred_date', '')}",
    ]

    notes = (getattr(expense, "notes_to_homeowner", "") or "").strip()
    if notes:
        lines += ["", "Notes from contractor:", notes]

    lines += [
        "",
        f"Review and respond here: {link}",
        "",
        "If you have questions, reply to this email.",
        "",
        "— MyHomeBro",
    ]

    body = "\n".join(lines)

    # fail_silently=False so we can report errors back to API caller
    send_mail(
        subject=subject,
        message=body,
        from_email=from_email,
        recipient_list=[to_email],
        fail_silently=False,
    )

    return True, f"Email sent to {to_email}"