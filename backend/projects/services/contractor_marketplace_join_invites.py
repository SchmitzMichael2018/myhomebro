from __future__ import annotations

from datetime import timedelta
from typing import Any

from django.conf import settings
from django.db import transaction
from django.utils import timezone

from projects.models_contractor_discovery import (
    ContractorDirectoryClaimToken,
    ContractorDirectoryEntry,
    ContractorDirectoryOutreachLog,
    ContractorMarketplaceJoinInvite,
)
from projects.models_sms import SMSConsentStatus
from projects.services.contractor_directory_claims import generate_directory_claim_token
from projects.services.invites_delivery import send_postmark_email, send_twilio_sms
from projects.services.sms_service import get_sms_consent, normalize_phone_to_e164


def _safe_text(value: Any) -> str:
    return "" if value is None else str(value).strip()


def _base_url(request=None) -> str:
    site = _safe_text(getattr(settings, "SITE_URL", ""))
    if site:
        return site.rstrip("/")
    try:
        return request.build_absolute_uri("/").rstrip("/") if request is not None else "https://www.myhomebro.com"
    except Exception:
        return "https://www.myhomebro.com"


def build_join_claim_url(invite: ContractorMarketplaceJoinInvite, *, request=None) -> str:
    path = invite.claim_url_path
    if not path:
        return ""
    return f"{_base_url(request)}{path}"


def _resolve_channel(entry: ContractorDirectoryEntry, preferred_channel: str = "") -> str:
    requested = _safe_text(preferred_channel).lower()
    if requested in {
        ContractorMarketplaceJoinInvite.CHANNEL_EMAIL,
        ContractorMarketplaceJoinInvite.CHANNEL_SMS,
        ContractorMarketplaceJoinInvite.CHANNEL_BOTH,
        ContractorMarketplaceJoinInvite.CHANNEL_MANUAL,
    }:
        return requested
    has_email = bool(_safe_text(entry.public_email))
    has_phone = bool(_safe_text(entry.phone))
    if has_email and has_phone:
        return ContractorMarketplaceJoinInvite.CHANNEL_BOTH
    if has_email:
        return ContractorMarketplaceJoinInvite.CHANNEL_EMAIL
    if has_phone:
        return ContractorMarketplaceJoinInvite.CHANNEL_SMS
    return ContractorMarketplaceJoinInvite.CHANNEL_MANUAL


def _sms_opted_out(phone: str) -> bool:
    normalized = normalize_phone_to_e164(phone)
    if not normalized:
        return False
    durable = get_sms_consent(normalized)
    if durable and durable.opted_out:
        return True
    status = SMSConsentStatus.objects.filter(phone_number=normalized).only("is_subscribed").first()
    return bool(status and not status.is_subscribed)


def _email_body(*, invite: ContractorMarketplaceJoinInvite, claim_url: str) -> tuple[str, str, str]:
    business = invite.invited_business_name or "your business"
    subject = "Claim your MyHomeBro marketplace profile"
    text = (
        f"Hello,\n\n"
        f"MyHomeBro helps local contractors receive homeowner project opportunities, create structured agreements, "
        f"and manage milestones, records, and payments in one workflow.\n\n"
        f"An admin created a marketplace profile for {business}. Claim it here:\n{claim_url}\n\n"
        "This is a marketplace join invitation, not a project-specific request.\n\n"
        "If you did not expect this invitation, you can ignore this email.\n\n"
        "-- MyHomeBro"
    )
    html = (
        "<div style='font-family:Arial,sans-serif;line-height:1.5;color:#0f172a'>"
        "<h2 style='margin:0 0 12px'>Claim your MyHomeBro marketplace profile</h2>"
        f"<p>MyHomeBro helps local contractors receive homeowner project opportunities, create structured agreements, "
        "and manage milestones, records, and payments in one workflow.</p>"
        f"<p>An admin created a marketplace profile for <strong>{business}</strong>.</p>"
        f"<p><a href='{claim_url}' style='display:inline-block;background:#0f172a;color:white;padding:12px 18px;border-radius:10px;text-decoration:none;font-weight:bold'>Claim Marketplace Profile</a></p>"
        "<p style='font-size:13px;color:#475569'>This is a marketplace join invitation, not a project-specific request.</p>"
        "<p style='font-size:13px;color:#475569'>If you did not expect this invitation, you can ignore this email.</p>"
        "<p>-- MyHomeBro</p>"
        "</div>"
    )
    return subject, text, html


def _sms_body(*, invite: ContractorMarketplaceJoinInvite, claim_url: str) -> str:
    business = invite.invited_business_name or "your business"
    return (
        f"MyHomeBro: claim the marketplace profile for {business}: {claim_url} "
        "Reply STOP to opt out."
    )[:1500]


def _derive_status(invite: ContractorMarketplaceJoinInvite) -> str:
    attempted = [invite.email_status, invite.sms_status]
    sent = [status for status in attempted if status == "sent"]
    failed = [status for status in attempted if status in {"failed", "suppressed"}]
    if sent and failed:
        return ContractorMarketplaceJoinInvite.STATUS_PARTIAL
    if sent:
        return ContractorMarketplaceJoinInvite.STATUS_SENT
    if failed and all(status in {"", "failed", "suppressed"} for status in attempted):
        if any(status == "suppressed" for status in attempted):
            return ContractorMarketplaceJoinInvite.STATUS_SUPPRESSED
        return ContractorMarketplaceJoinInvite.STATUS_FAILED
    return ContractorMarketplaceJoinInvite.STATUS_PENDING


def join_invite_payload(invite: ContractorMarketplaceJoinInvite, *, request=None) -> dict[str, Any]:
    return {
        "id": invite.id,
        "directory_entry_id": invite.directory_entry_id,
        "business_name": invite.invited_business_name,
        "email": invite.email,
        "phone": invite.phone,
        "invite_token": str(invite.invite_token),
        "claim_token": str(invite.claim_token.token) if invite.claim_token_id and invite.claim_token else "",
        "claim_url": invite.claim_url_path,
        "absolute_claim_url": build_join_claim_url(invite, request=request),
        "status": invite.status,
        "delivery_channel": invite.delivery_channel,
        "email_status": invite.email_status,
        "email_error": invite.email_error,
        "sms_status": invite.sms_status,
        "sms_error": invite.sms_error,
        "sms_opted_out": invite.sms_opted_out,
        "sent_at": invite.sent_at,
        "claimed_at": invite.claimed_at,
        "expires_at": invite.expires_at,
    }


@transaction.atomic
def send_marketplace_join_invite(
    *,
    entry: ContractorDirectoryEntry,
    sent_by=None,
    request=None,
    preferred_channel: str = "",
    resend: bool = False,
) -> ContractorMarketplaceJoinInvite:
    if entry.claimed:
        raise ValueError("This contractor profile is already claimed.")
    if not _safe_text(entry.public_email) and not _safe_text(entry.phone):
        raise ValueError("Add an email or phone number before sending a join invite.")

    invite = (
        ContractorMarketplaceJoinInvite.objects.select_for_update()
        .filter(directory_entry=entry)
        .exclude(status__in=[ContractorMarketplaceJoinInvite.STATUS_CLAIMED])
        .order_by("-created_at", "-id")
        .first()
    )
    claim_token = generate_directory_claim_token(entry, generated_by=sent_by)
    if invite is None:
        invite = ContractorMarketplaceJoinInvite(directory_entry=entry, claim_token=claim_token)
    elif invite.sent_at and not resend:
        return invite

    invite.claim_token = invite.claim_token or claim_token
    invite.invited_business_name = entry.business_name or ""
    invite.email = entry.public_email or ""
    invite.phone = normalize_phone_to_e164(entry.phone) or entry.phone or ""
    invite.delivery_channel = _resolve_channel(entry, preferred_channel)
    invite.sent_by = sent_by or invite.sent_by
    invite.expires_at = timezone.now() + timedelta(days=int(getattr(settings, "MARKETPLACE_JOIN_INVITE_EXPIRY_DAYS", 30) or 30))
    invite.email_status = ""
    invite.email_error = ""
    invite.sms_status = ""
    invite.sms_error = ""
    invite.sms_opted_out = False
    invite.status = ContractorMarketplaceJoinInvite.STATUS_PENDING
    invite.save()

    claim_url = build_join_claim_url(invite, request=request)
    wants_email = invite.delivery_channel in {
        ContractorMarketplaceJoinInvite.CHANNEL_EMAIL,
        ContractorMarketplaceJoinInvite.CHANNEL_BOTH,
    }
    wants_sms = invite.delivery_channel in {
        ContractorMarketplaceJoinInvite.CHANNEL_SMS,
        ContractorMarketplaceJoinInvite.CHANNEL_BOTH,
    }

    if wants_email:
        if invite.email:
            subject, text, html = _email_body(invite=invite, claim_url=claim_url)
            ok, message = send_postmark_email(to_email=invite.email, subject=subject, text_body=text, html_body=html)
            invite.email_status = "sent" if ok else "failed"
            invite.email_error = "" if ok else message
            ContractorDirectoryOutreachLog.objects.create(
                directory_entry=entry,
                outreach_type=ContractorDirectoryOutreachLog.TYPE_EMAIL,
                destination=invite.email,
                status=invite.email_status,
                created_by=sent_by,
                notes=message,
            )
        else:
            invite.email_status = "suppressed"
            invite.email_error = "No email address available."

    if wants_sms:
        if not invite.phone:
            invite.sms_status = "suppressed"
            invite.sms_error = "No phone number available."
        elif _sms_opted_out(invite.phone):
            invite.sms_status = "suppressed"
            invite.sms_error = "SMS opt-out is active for this phone number."
            invite.sms_opted_out = True
        elif not getattr(settings, "MARKETPLACE_JOIN_INVITE_SMS_ENABLED", False):
            invite.sms_status = "suppressed"
            invite.sms_error = "Marketplace join invite SMS is disabled."
        else:
            ok, message = send_twilio_sms(to_phone=invite.phone, body=_sms_body(invite=invite, claim_url=claim_url))
            invite.sms_status = "sent" if ok else "failed"
            invite.sms_error = "" if ok else message
            ContractorDirectoryOutreachLog.objects.create(
                directory_entry=entry,
                outreach_type=ContractorDirectoryOutreachLog.TYPE_SMS,
                destination=invite.phone,
                status=invite.sms_status,
                created_by=sent_by,
                notes=message,
            )

    if not wants_email and not wants_sms:
        invite.status = ContractorMarketplaceJoinInvite.STATUS_SUPPRESSED
    else:
        invite.status = _derive_status(invite)
    if invite.status in {
        ContractorMarketplaceJoinInvite.STATUS_SENT,
        ContractorMarketplaceJoinInvite.STATUS_PARTIAL,
        ContractorMarketplaceJoinInvite.STATUS_FAILED,
        ContractorMarketplaceJoinInvite.STATUS_SUPPRESSED,
    }:
        invite.sent_at = timezone.now()
    invite.save()
    return invite


def mark_join_invites_claimed_for_token(token: ContractorDirectoryClaimToken) -> None:
    now = timezone.now()
    ContractorMarketplaceJoinInvite.objects.filter(claim_token=token).exclude(
        status=ContractorMarketplaceJoinInvite.STATUS_CLAIMED
    ).update(
        status=ContractorMarketplaceJoinInvite.STATUS_CLAIMED,
        claimed_at=now,
        updated_at=now,
    )


def join_invite_for_claim_token(token: ContractorDirectoryClaimToken) -> ContractorMarketplaceJoinInvite | None:
    return token.marketplace_join_invites.order_by("-created_at", "-id").first()
