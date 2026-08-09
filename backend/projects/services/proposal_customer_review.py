from __future__ import annotations

from datetime import timedelta
from decimal import Decimal

from django.conf import settings
from django.contrib.auth import get_user_model
from django.core import signing
from django.db import transaction
from django.utils import timezone

from projects.models_proposals import Proposal, ProposalActivity, ProposalLineItem, ProposalPortalActivation, ProposalReviewVersion
from projects.services.invites_delivery import send_postmark_email


TOKEN_SALT = "myhomebro.proposal-customer-review.v1"
ACKNOWLEDGEMENT = (
    "I approve this estimate as the basis for preparing the project agreement. "
    "This does not sign or execute the agreement."
)
TOKEN_MAX_AGE_SECONDS = 60 * 60 * 24 * 45
ACTIVATION_TOKEN_SALT = "myhomebro.proposal-portal-activation.v1"
ACTIVATION_MAX_AGE_SECONDS = 60 * 60 * 24 * 7
PORTAL_TOKEN_SALT = "myhomebro.customer-portal"
User = get_user_model()


class ReviewAccessError(Exception):
    pass


def _money(value) -> str:
    return f"{Decimal(value or 0):.2f}"


def build_customer_snapshot(proposal: Proposal) -> dict:
    """Deny-by-default serializer: only explicitly customer-safe fields live here."""
    items = list(proposal.line_items.all())
    subtotal = tax = discounts = incidentals = Decimal("0")
    safe_items = []
    for item in items:
        amount = Decimal(item.total or 0)
        if item.category == ProposalLineItem.CATEGORY_TAX:
            tax += amount
        elif item.category == ProposalLineItem.CATEGORY_DISCOUNT:
            discounts += abs(amount)
        elif item.category == ProposalLineItem.CATEGORY_INCIDENTALS_RESERVE:
            incidentals += amount
        else:
            subtotal += amount
        safe_items.append({
            "category": item.category,
            "category_label": item.get_category_display(),
            "description": item.description,
            "quantity": _money(item.quantity),
            "unit": item.unit,
            "unit_price": _money(item.unit_price),
            "total": _money(item.total),
        })
    contractor = proposal.contractor
    return {
        "contractor": {
            "name": contractor.business_name or contractor.user.get_full_name() or "Your contractor",
        },
        "customer": {"name": proposal.customer_name},
        "project": {
            "title": proposal.project_title,
            "property": proposal.service_location,
            "description": proposal.project_summary,
            "included_work": proposal.included_work,
            "excluded_work": proposal.excluded_work,
            "assumptions": proposal.assumptions,
            "allowances": proposal.allowances,
            "schedule": {
                "start_type": proposal.project_start_type,
                "start_date": proposal.project_start_date.isoformat() if proposal.project_start_date else "",
                "completion_type": proposal.project_completion_type,
                "completion_date": proposal.project_completion_date.isoformat() if proposal.project_completion_date else "",
            },
        },
        "pricing": {
            "line_items": safe_items,
            "subtotal": _money(subtotal),
            "tax": _money(tax),
            "discounts": _money(discounts),
            "incidentals_reserve": _money(incidentals),
            "total": _money(subtotal + tax + incidentals - discounts),
        },
        # Attachments are intentionally absent until an explicit customer-sharing flag exists.
    }


def token_for(review: ProposalReviewVersion) -> str:
    return signing.dumps(
        {
            "purpose": "proposal_review",
            "proposal_id": review.proposal_id,
            "version": review.version,
            "email": review.customer_email.lower(),
            "nonce": str(review.access_nonce),
        },
        salt=TOKEN_SALT,
        compress=True,
    )


def portal_token_for_email(email: str) -> str:
    return signing.dumps({"email": email.strip().lower()}, salt=PORTAL_TOKEN_SALT, compress=True)


def activation_token_for(activation: ProposalPortalActivation) -> str:
    return signing.dumps(
        {"purpose": "proposal_portal_activation", "activation_id": activation.id, "email": activation.email, "nonce": str(activation.nonce)},
        salt=ACTIVATION_TOKEN_SALT,
        compress=True,
    )


def resolve_activation_token(token: str, *, lock=False) -> ProposalPortalActivation:
    try:
        payload = signing.loads(token, salt=ACTIVATION_TOKEN_SALT, max_age=ACTIVATION_MAX_AGE_SECONDS)
    except signing.BadSignature as exc:
        raise ReviewAccessError("This account setup link is invalid or expired.") from exc
    if payload.get("purpose") != "proposal_portal_activation":
        raise ReviewAccessError("This account setup link is invalid or expired.")
    queryset = ProposalPortalActivation.objects.select_related("review", "review__proposal")
    if lock:
        queryset = queryset.select_for_update()
    activation = queryset.filter(pk=payload.get("activation_id"), email__iexact=payload.get("email", ""), nonce=payload.get("nonce")).first()
    if not activation or activation.used_at:
        raise ReviewAccessError("This account setup link has already been used or is no longer valid.")
    return activation


def portal_access(review: ProposalReviewVersion, request=None) -> dict:
    email = review.customer_email.strip().lower()
    user = User.objects.filter(email__iexact=email).first()
    base = (getattr(settings, "SITE_URL", "") or (request.build_absolute_uri("/") if request else "https://www.myhomebro.com")).rstrip("/")
    if user and user.has_usable_password() and user.is_active:
        return {"account_exists": True, "status": "active", "url": f"{base}/portal", "label": "Open MyHomeBro"}
    activation, _ = ProposalPortalActivation.objects.get_or_create(review=review, defaults={"email": email})
    return {"account_exists": False, "status": "setup_pending", "url": f"{base}/activate-customer/{activation_token_for(activation)}", "label": "Create MyHomeBro Account"}


def resolve_token(token: str, *, lock=False) -> ProposalReviewVersion:
    try:
        payload = signing.loads(token, salt=TOKEN_SALT, max_age=TOKEN_MAX_AGE_SECONDS)
    except signing.BadSignature as exc:
        raise ReviewAccessError("This estimate review link is invalid or expired.") from exc
    if payload.get("purpose") != "proposal_review":
        raise ReviewAccessError("This estimate review link is invalid or expired.")
    queryset = ProposalReviewVersion.objects.select_related("proposal", "proposal__contractor", "proposal__contractor__user")
    if lock:
        queryset = queryset.select_for_update()
    review = queryset.filter(
        proposal_id=payload.get("proposal_id"),
        version=payload.get("version"),
        customer_email__iexact=payload.get("email", ""),
        access_nonce=payload.get("nonce"),
    ).first()
    if not review:
        raise ReviewAccessError("This estimate review link is invalid or expired.")
    return review


def public_review_payload(review: ProposalReviewVersion, request=None) -> dict:
    return {
        "version": review.version,
        "status": review.decision if review.decision != ProposalReviewVersion.DECISION_PENDING else review.proposal.status,
        "sent_at": review.sent_at.isoformat() if review.sent_at else None,
        "viewed_at": review.viewed_at.isoformat() if review.viewed_at else None,
        "expires_at": review.expires_at.isoformat() if review.expires_at else None,
        "is_expired": bool(review.expires_at and review.expires_at <= timezone.now()),
        "acknowledgement": ACKNOWLEDGEMENT,
        "revision_request_message": review.revision_request_message,
        "decline_reason": review.decline_reason,
        "estimate": review.snapshot,
        "portal": portal_access(review, request=request),
    }


def send_review(*, proposal: Proposal, request, resend=False) -> tuple[ProposalReviewVersion, dict]:
    if proposal.status not in ({Proposal.STATUS_SENT, Proposal.STATUS_VIEWED} if resend else {Proposal.STATUS_READY, Proposal.STATUS_REVISION_REQUESTED, Proposal.STATUS_DECLINED, Proposal.STATUS_EXPIRED}):
        raise ValueError("Only a ready or revised estimate can be sent.")
    if not proposal.customer_email:
        raise ValueError("Customer email is required before sending.")
    with transaction.atomic():
        locked = Proposal.objects.select_for_update().get(pk=proposal.pk)
        latest = locked.review_versions.order_by("-version").first()
        if resend and latest:
            review = latest
        else:
            review = ProposalReviewVersion.objects.create(
                proposal=locked,
                version=(latest.version + 1 if latest else 1),
                customer_email=locked.customer_email.strip().lower(),
                snapshot=build_customer_snapshot(locked),
                sent_at=timezone.now(),
                expires_at=timezone.now() + timedelta(days=30),
            )
        locked.status = Proposal.STATUS_SENT
        locked.save(update_fields=["status", "updated_at"])
        ProposalActivity.objects.create(
            proposal=locked,
            event_type=ProposalActivity.EVENT_ESTIMATE_SENT,
            message="Estimate resent to customer" if resend else "Estimate sent to customer",
            actor=request.user,
            metadata={"review_version": review.version},
        )
    token = token_for(review)
    base = (getattr(settings, "SITE_URL", "") or request.build_absolute_uri("/")).rstrip("/")
    url = f"{base}/estimate-review/{token}"
    portal = portal_access(review, request=request)
    secondary_copy = "Keep estimates, agreements, project updates, payments, and documents together in MyHomeBro."
    ok, message = send_postmark_email(
        to_email=review.customer_email,
        subject=f"Review your estimate for {proposal.project_title or 'your project'}",
        text_body=f"Your estimate is ready.\n\n{review.snapshot['contractor']['name']} has sent an estimate for {proposal.project_title}.\n\nReview Estimate:\n{url}\n\n{secondary_copy}\n{portal['label']}:\n{portal['url']}\n\nYou can review and respond without creating an account.",
        html_body=f"<h2>Your estimate is ready</h2><p>{review.snapshot['contractor']['name']} has sent an estimate for {proposal.project_title}.</p><p><a href=\"{url}\">Review Estimate</a></p><hr><p>{secondary_copy}</p><p><a href=\"{portal['url']}\">{portal['label']}</a></p><p><small>You can review and respond without creating an account.</small></p>",
    )
    delivery = {"email": {"attempted": True, "ok": ok, "message": message}, "sms": {"attempted": False, "ok": False, "message": "SMS not sent without verified consent."}}
    review.delivery_state = delivery
    review.save(update_fields=["delivery_state"])
    return review, {"review_url": url, "delivery": delivery, "portal": portal}
