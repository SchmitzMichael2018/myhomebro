from __future__ import annotations

import base64
import uuid

from datetime import timedelta
from decimal import Decimal, InvalidOperation

from django.conf import settings
from django.core.exceptions import ImproperlyConfigured
from django.contrib.auth import get_user_model
from django.core import signing
from django.db import transaction
from django.utils import timezone
from urllib.parse import urlsplit, urlunsplit
from django.utils.html import strip_tags

from projects.models_proposals import Proposal, ProposalActivity, ProposalLineItem, ProposalPortalActivation, ProposalReviewVersion
from projects.models import Notification
from projects.services.notification_center import create_notification
from projects.services.invites_delivery import send_postmark_email
from projects.services.sms_service import get_sms_status_payload, normalize_phone_to_e164, send_compliant_sms, send_sms_opt_in_request


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


def trusted_public_site_url() -> str:
    value = str(getattr(settings, "SITE_URL", "") or "").strip()
    parsed = urlsplit(value)
    if (
        parsed.scheme not in {"http", "https"}
        or not parsed.hostname
        or parsed.username
        or parsed.password
        or parsed.query
        or parsed.fragment
    ):
        raise ImproperlyConfigured("SITE_URL must be a valid absolute public URL.")
    if parsed.scheme != "https" and parsed.hostname.lower() not in {"localhost", "127.0.0.1", "::1"}:
        raise ImproperlyConfigured("SITE_URL must use HTTPS outside local development.")
    return urlunsplit((parsed.scheme, parsed.netloc, parsed.path.rstrip("/"), "", ""))


def public_review_short_url(review: ProposalReviewVersion) -> str:
    return f"{trusted_public_site_url()}/r/{short_code_for(review)}"


def _notification_preview(value: str, limit: int = 140) -> str:
    value = " ".join(strip_tags(str(value or "")).split())
    return value if len(value) <= limit else f"{value[:limit - 1].rstrip()}…"


def notify_contractor_of_review_event(review: ProposalReviewVersion, event_type: str):
    proposal = review.proposal
    customer = proposal.customer_name.strip() or "Your customer"
    project = proposal.project_title.strip() or "this estimate"
    title_body = {
        Notification.EVENT_ESTIMATE_VIEWED: ("Estimate viewed", f"{customer} viewed the estimate for {project}."),
        Notification.EVENT_ESTIMATE_REVISION_REQUESTED: ("Changes requested", f"{customer} requested changes to {project}."),
        Notification.EVENT_ESTIMATE_ACCEPTED: ("Estimate accepted", f"{customer} accepted the estimate for {project}."),
        Notification.EVENT_ESTIMATE_DECLINED: ("Estimate declined", f"{customer} declined the estimate for {project}."),
    }
    if event_type not in title_body:
        return None, False
    title, body = title_body[event_type]
    preview = review.revision_request_message if event_type == Notification.EVENT_ESTIMATE_REVISION_REQUESTED else review.decline_reason if event_type == Notification.EVENT_ESTIMATE_DECLINED else ""
    if preview:
        body = f'{body} “{_notification_preview(preview)}”'
    return create_notification(
        contractor=proposal.contractor,
        category=event_type,
        title=title,
        body=body,
        link=f"/app/proposals/{proposal.id}?section=ready",
        actor_display_name=customer,
        dedupe_key=f"proposal_review:{review.id}:{event_type}",
    )


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
            "proposal_line_item_id": item.id,
            "category": item.category,
            "category_label": item.get_category_display(),
            "description": item.description,
            "quantity": _money(item.quantity),
            "unit": item.unit,
            "unit_price": _money(item.unit_price),
            "total": _money(item.total),
            "source_template_id": item.source_template_id,
            "source_template_milestone_id": item.source_template_milestone_id,
            "source_milestone_key": item.source_milestone_key,
            "source_milestone_name": item.source_milestone_name,
            "source_milestone_order": item.source_milestone_order,
            "source_allocation_percent": _money(item.source_allocation_percent) if item.source_allocation_percent is not None else None,
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


def public_customer_snapshot(snapshot: dict) -> dict:
    """Remove conversion-only provenance before returning an Estimate publicly."""
    public = dict(snapshot or {})
    pricing = dict(public.get("pricing") or {})
    internal_keys = {
        "proposal_line_item_id", "source_template_id", "source_template_milestone_id",
        "source_milestone_key", "source_milestone_name", "source_milestone_order",
        "source_allocation_percent",
    }
    pricing["line_items"] = [
        {key: value for key, value in dict(row).items() if key not in internal_keys}
        for row in (pricing.get("line_items") or [])
    ]
    public["pricing"] = pricing
    return public


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


def short_code_for(review: ProposalReviewVersion) -> str:
    """Opaque, collision-resistant first-party code backed by the review nonce."""
    return base64.b32encode(review.access_nonce.bytes).decode("ascii").rstrip("=").lower()


def resolve_short_code(code: str) -> ProposalReviewVersion:
    try:
        padded = str(code or "").strip().upper() + "=" * ((8 - len(str(code or "").strip()) % 8) % 8)
        raw = base64.b32decode(padded, casefold=True)
        if len(raw) != 16:
            raise ValueError
        nonce = uuid.UUID(bytes=raw)
    except (ValueError, TypeError, base64.binascii.Error) as exc:
        raise ReviewAccessError("This estimate review link is invalid or expired.") from exc
    review = ProposalReviewVersion.objects.filter(access_nonce=nonce).first()
    if not review or (review.expires_at and review.expires_at <= timezone.now()):
        raise ReviewAccessError("This estimate review link is invalid or expired.")
    return review


def estimate_sms_body(*, review: ProposalReviewVersion, short_url: str) -> str:
    snapshot = review.snapshot or {}
    contractor = str((snapshot.get("contractor") or {}).get("name") or "").strip()
    project = str((snapshot.get("project") or {}).get("title") or "").strip()
    raw_total = (snapshot.get("pricing") or {}).get("total")
    try:
        if raw_total in (None, ""):
            raise InvalidOperation
        total = Decimal(str(raw_total)).quantize(Decimal("0.01"))
        formatted_total = f"${total:,.0f}" if total == total.to_integral() else f"${total:,.2f}"
    except (InvalidOperation, TypeError, ValueError):
        formatted_total = "the provided total"
    if contractor and project and formatted_total != "the provided total":
        lead = f"{contractor} sent your {project} estimate for {formatted_total}."
    elif contractor and project:
        lead = f"{contractor} sent your {project} estimate."
    elif contractor:
        lead = f"{contractor} sent you an estimate."
    else:
        lead = "Your contractor sent you a project estimate."
    return f"{lead} Review: {short_url}. No MyHomeBro account needed."


def public_review_payload(review: ProposalReviewVersion, request=None) -> dict:
    from projects.services.customer_conversations import conversation_for_proposal, serialize_conversation
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
        "estimate": public_customer_snapshot(review.snapshot),
        "portal": portal_access(review, request=request),
        "conversation": serialize_conversation(conversation_for_proposal(review.proposal), audience="customer"),
    }


def review_delivery_eligibility(proposal: Proposal) -> dict:
    email = proposal.customer_email.strip().lower()
    sms = get_sms_status_payload(phone_number=proposal.customer_phone)
    normalized_phone = sms["phone_number_e164"]
    valid_phone = bool(normalized_phone.startswith("+") and normalized_phone[1:].isdigit() and 8 <= len(normalized_phone[1:]) <= 15)
    latest = proposal.review_versions.order_by("-version").first()
    pending = bool(latest and (latest.delivery_state or {}).get("sms", {}).get("status") == "consent_pending")
    if not valid_phone:
        sms_state = "no_phone"
    elif sms["sms_opted_out"]:
        sms_state = "opted_out"
    elif not sms["twilio_configured"]:
        sms_state = "provider_unavailable"
    elif sms["sms_enabled"]:
        sms_state = "ready"
    elif pending:
        sms_state = "consent_pending"
    else:
        sms_state = "consent_required"
    sms_available = sms_state in {"ready", "consent_required", "consent_pending"}
    return {
        "email": {"available": bool(email), "address": email, "reason": "" if email else "No valid email address."},
        "sms": {
            "state": sms_state,
            "available": sms_available,
            "immediate": sms_state == "ready",
            "requires_opt_in": sms_state == "consent_required",
            "can_request_consent": sms_state in {"consent_required", "consent_pending"},
            "consent_active": sms_state == "ready",
            "phone": normalized_phone,
            "consent_on_file": sms["consent_on_file"],
            "opted_out": sms["sms_opted_out"],
            "twilio_configured": sms["twilio_configured"],
            "reason": (
                "No valid mobile number." if sms_state == "no_phone" else
                "Customer opted out of SMS." if sms_state == "opted_out" else
                "Text delivery is temporarily unavailable." if sms_state == "provider_unavailable" else
                "Waiting for customer opt-in." if sms_state == "consent_pending" else
                "SMS authorization required." if sms_state == "consent_required" else "Text available."
            ),
        },
    }


def send_review(*, proposal: Proposal, request, resend=False, channels=None) -> tuple[ProposalReviewVersion, dict]:
    initial_statuses = {Proposal.STATUS_DRAFT, Proposal.STATUS_SITE_VISIT, Proposal.STATUS_IN_PROGRESS, Proposal.STATUS_READY, Proposal.STATUS_REVISION_REQUESTED, Proposal.STATUS_DECLINED, Proposal.STATUS_EXPIRED}
    if proposal.status not in ({Proposal.STATUS_SENT, Proposal.STATUS_VIEWED} if resend else initial_statuses):
        raise ValueError("Only a ready or revised estimate can be sent.")
    requested = list(dict.fromkeys(str(channel).strip().lower() for channel in (channels or ["email"])))
    if not requested or any(channel not in {"email", "sms"} for channel in requested):
        raise ValueError("Choose Email, Text, or Email + Text.")
    eligibility = review_delivery_eligibility(proposal)
    for channel in requested:
        if not eligibility[channel]["available"]:
            raise ValueError(eligibility[channel]["reason"])
    if not proposal.customer_name.strip() or not proposal.project_title.strip() or not proposal.line_items.exists():
        raise ValueError("Complete the customer, project title, and pricing before sending the estimate.")
    with transaction.atomic():
        locked = Proposal.objects.select_for_update().get(pk=proposal.pk)
        latest = locked.review_versions.order_by("-version").first()
        current_snapshot = build_customer_snapshot(locked)
        if latest and (resend or (locked.status in initial_statuses and latest.decision == ProposalReviewVersion.DECISION_PENDING and latest.snapshot == current_snapshot)):
            review = latest
        else:
            review = ProposalReviewVersion.objects.create(
                proposal=locked,
                version=(latest.version + 1 if latest else 1),
                customer_email=locked.customer_email.strip().lower(),
                snapshot=current_snapshot,
                expires_at=timezone.now() + timedelta(days=30),
            )
    token = token_for(review)
    base = trusted_public_site_url()
    url = f"{base}/estimate-review/{token}"
    short_url = public_review_short_url(review)
    portal = portal_access(review, request=request)
    secondary_copy = "Keep estimates, agreements, project updates, payments, and documents together in MyHomeBro."
    previous = review.delivery_state or {}
    delivery = {
        "requested_channels": requested,
        "email": previous.get("email", {"attempted": False, "ok": False}),
        "sms": previous.get("sms", {"attempted": False, "ok": False}),
    }
    if "email" in requested:
        ok, _provider_message = send_postmark_email(
            to_email=review.customer_email,
            subject=f"Review your estimate for {proposal.project_title or 'your project'}",
            text_body=f"Your estimate is ready.\n\n{review.snapshot['contractor']['name']} has sent an estimate for {proposal.project_title}.\n\nReview Estimate:\n{url}\n\nA MyHomeBro account is not required to review this estimate.\n\n{secondary_copy}\n{portal['label']}:\n{portal['url']}",
            html_body=f"<h2>Your estimate is ready</h2><p>{review.snapshot['contractor']['name']} has sent an estimate for {proposal.project_title}.</p><p><a href=\"{url}\">Review Estimate</a></p><p><strong>A MyHomeBro account is not required to review this estimate.</strong></p><hr><p>{secondary_copy}</p><p><a href=\"{portal['url']}\">{portal['label']}</a></p>",
        )
        delivery["email"] = {"attempted": True, "ok": ok, "status": "sent" if ok else "failed", "message": "Email sent." if ok else "Email could not be delivered.", "attempted_at": timezone.now().isoformat()}
    if "sms" in requested and eligibility["sms"]["immediate"]:
        sms_result = send_compliant_sms(
            proposal.customer_phone,
            estimate_sms_body(review=review, short_url=short_url),
            category="customer_care",
            dedupe_key=f"proposal-review:{review.id}:sms:{timezone.now().strftime('%Y%m%d%H%M')}",
        )
        delivery["sms"] = {
            "attempted": True, "ok": sms_result["ok"], "status": sms_result["status"],
            "message": "Text message sent." if sms_result["ok"] else "Text message could not be delivered.",
            "reason_code": sms_result["reason_code"], "provider_id": sms_result["twilio_sid"],
            "attempted_at": timezone.now().isoformat(),
        }
    elif "sms" in requested:
        consent_request = send_sms_opt_in_request(
            phone_number=proposal.customer_phone,
            company_name=review.snapshot["contractor"]["name"], contractor=proposal.contractor,
            dedupe_key=f"proposal-review-opt-in:{review.id}",
        )
        pending = consent_request["ok"] or consent_request["status"] == "duplicate"
        delivery["sms"] = {
            "attempted": False, "ok": False, "status": "consent_pending" if pending else consent_request["status"],
            "message": "Waiting for customer opt-in." if pending else consent_request["detail"],
            "reason_code": consent_request["reason_code"], "consent_request_sent": pending,
            "consent_request_provider_id": consent_request["twilio_sid"], "attempted_at": timezone.now().isoformat(),
            "phone_number_e164": eligibility["sms"]["phone"],
        }
    succeeded = [channel for channel in requested if delivery[channel].get("ok")]
    delivery["succeeded_channels"] = succeeded
    attempts = list(previous.get("attempts") or [])
    attempts.append({
        "attempted_at": timezone.now().isoformat(), "requested_channels": requested,
        "results": {channel: {"ok": bool(delivery[channel].get("ok")), "status": delivery[channel].get("status", "failed")} for channel in requested},
    })
    delivery["attempts"] = attempts[-20:]
    review.delivery_state = delivery
    if succeeded:
        review.sent_at = review.sent_at or timezone.now()
    review.save(update_fields=["delivery_state", "sent_at"])
    if succeeded:
        proposal.status = Proposal.STATUS_SENT
        proposal.save(update_fields=["status", "updated_at"])
        ProposalActivity.objects.create(
            proposal=proposal, event_type=ProposalActivity.EVENT_ESTIMATE_SENT,
            message="Estimate resent to customer" if resend else "Estimate sent to customer", actor=request.user,
            metadata={"review_version": review.version, "requested_channels": requested, "succeeded_channels": succeeded},
        )
    return review, {"review_url": url, "delivery": delivery, "portal": portal}


def _pending_reviews_for_phone(phone_number: str):
    normalized = normalize_phone_to_e164(phone_number)
    rows = ProposalReviewVersion.objects.select_related("proposal", "proposal__contractor", "proposal__contractor__user").order_by("-created_at")[:200]
    return [row for row in rows if normalize_phone_to_e164(row.proposal.customer_phone) == normalized and (row.delivery_state or {}).get("sms", {}).get("status") == "consent_pending"]


def release_pending_estimate_sms(phone_number: str, *, message_sid: str = "") -> int:
    """Release only current, actionable review versions after an inbound affirmative reply."""
    sent = 0
    now = timezone.now()
    for review in _pending_reviews_for_phone(phone_number):
        proposal = review.proposal
        latest = proposal.review_versions.order_by("-version").first()
        delivery = dict(review.delivery_state or {})
        sms_state = dict(delivery.get("sms") or {})
        if latest is None or latest.pk != review.pk or review.decision != ProposalReviewVersion.DECISION_PENDING or (review.expires_at and review.expires_at <= now) or proposal.status in {Proposal.STATUS_DECLINED, Proposal.STATUS_ACCEPTED, Proposal.STATUS_CONVERTED, Proposal.STATUS_EXPIRED, Proposal.STATUS_CANCELLED}:
            sms_state.update({"status": "cancelled", "message": "Pending text cancelled because this estimate is no longer current."})
        else:
            url = public_review_short_url(review)
            result = send_compliant_sms(
                phone_number,
                estimate_sms_body(review=review, short_url=url),
                category="customer_care", dedupe_key=f"proposal-review:{review.id}:sms",
            )
            sms_state.update({
                "attempted": True, "ok": result["ok"], "status": "sent" if result["ok"] else result["status"],
                "message": "Text message sent." if result["ok"] else "Text message could not be delivered.",
                "reason_code": result["reason_code"], "provider_id": result["twilio_sid"],
                "consent_granted_at": now.isoformat(), "consent_inbound_message_sid": message_sid,
            })
            if result["ok"]:
                sent += 1
                review.sent_at = review.sent_at or now
                if proposal.status not in {Proposal.STATUS_SENT, Proposal.STATUS_VIEWED}:
                    proposal.status = Proposal.STATUS_SENT
                    proposal.save(update_fields=["status", "updated_at"])
        delivery["sms"] = sms_state
        delivery["succeeded_channels"] = list(dict.fromkeys((delivery.get("succeeded_channels") or []) + (["sms"] if sms_state.get("ok") else [])))
        review.delivery_state = delivery
        review.save(update_fields=["delivery_state", "sent_at"])
    return sent


def cancel_pending_estimate_sms(phone_number: str) -> int:
    cancelled = 0
    for review in _pending_reviews_for_phone(phone_number):
        delivery = dict(review.delivery_state or {})
        sms_state = dict(delivery.get("sms") or {})
        sms_state.update({"status": "opted_out", "ok": False, "message": "Customer opted out of SMS."})
        delivery["sms"] = sms_state
        review.delivery_state = delivery
        review.save(update_fields=["delivery_state"])
        cancelled += 1
    return cancelled
