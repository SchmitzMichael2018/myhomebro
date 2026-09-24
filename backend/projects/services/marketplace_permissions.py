from __future__ import annotations

from accounts.models import User
from projects.models import Contractor
from projects.models_contractor_discovery import (
    ContractorDirectoryEntry,
    ContractorDirectoryListing,
)


DIRECT_INVITE_UNAVAILABLE_DETAIL = (
    "This contractor is not currently available for a direct invitation."
)


def contractor_direct_invite_block_reason(contractor: Contractor | None) -> str:
    """Return why an existing contractor cannot receive a direct customer invitation."""
    if contractor is None:
        return ""
    user = getattr(contractor, "user", None)
    if user and not getattr(user, "is_active", True):
        return "This contractor account is not active."
    if user and getattr(user, "verification_state", "") == User.VerificationState.DISABLED:
        return "This contractor account is disabled."
    if user and getattr(user, "trust_classification", "") == User.TrustClassification.SPAM_FRAUD:
        return "This contractor account is blocked."
    verification_status = getattr(contractor, "marketplace_verification_status", "")
    if verification_status == Contractor.MARKETPLACE_SUSPENDED:
        return "This contractor is suspended from marketplace invitations."
    if verification_status == Contractor.MARKETPLACE_REJECTED:
        return "This contractor is not eligible for marketplace invitations."
    if not getattr(contractor, "is_active", True):
        return "This contractor is not active."
    return ""


def direct_invite_target_resolution(contact_identity: str) -> tuple[Contractor | None, bool]:
    """Return (bound account, valid target) from the *current* authoritative record.

    Contact-only and historical invitations are unbound. A valid, unclaimed
    prospect is also unbound; missing, closed, archived, or ambiguously claimed
    stable targets fail closed rather than becoming bearer invitations.
    """
    kind, separator, raw_value = str(contact_identity or "").partition(":")
    if not separator:
        return None, not kind
    if kind in {"email", "phone", "legacy"}:
        return None, True
    if not raw_value:
        return None, False
    if kind == "contractor":
        if not raw_value.isdecimal():
            return None, False
        contractor = Contractor.objects.select_related("user").filter(pk=raw_value).first()
        return contractor, contractor is not None
    if kind == "directory":
        if not raw_value.isdecimal():
            return None, False
        entry = (
            ContractorDirectoryEntry.objects.select_related(
                "claimed_by_contractor__user"
            )
            .filter(pk=raw_value)
            .first()
        )
        if entry is None or entry.is_archived:
            return None, False
        return entry.claimed_by_contractor, True
    if kind == "listing":
        if not raw_value.isdecimal():
            return None, False
        listing = (
            ContractorDirectoryListing.objects.select_related(
                "claimed_contractor__user"
            )
            .filter(pk=raw_value)
            .first()
        )
        if listing is None or str(listing.business_status or "").upper() == "CLOSED_PERMANENTLY":
            return None, False
        return listing.claimed_contractor, True
    if kind == "place":
        entries = ContractorDirectoryEntry.objects.filter(
            google_place_id=raw_value, is_archived=False
        )
        listings = ContractorDirectoryListing.objects.filter(
            google_place_id=raw_value
        ).exclude(business_status__iexact="CLOSED_PERMANENTLY")
        if not entries.exists() and not listings.exists():
            return None, False
        contractor_ids = set(
            entries.filter(
                claimed_by_contractor__isnull=False,
            ).values_list("claimed_by_contractor_id", flat=True)
        )
        contractor_ids.update(
            listings.filter(
                claimed_contractor__isnull=False,
            ).values_list("claimed_contractor_id", flat=True)
        )
        if len(contractor_ids) == 1:
            contractor = Contractor.objects.select_related("user").filter(
                pk=contractor_ids.pop()
            ).first()
            return contractor, contractor is not None
        return None, not contractor_ids
    return None, False


def contractor_marketplace_action_block_reason(contractor: Contractor | None) -> str:
    """Return why a contractor cannot accept or be awarded marketplace work."""
    if contractor is None:
        return "Contractor profile not found."
    user = getattr(contractor, "user", None)
    if user and not getattr(user, "is_active", True):
        return "This contractor account is not active."
    if getattr(contractor, "marketplace_verification_status", "") == Contractor.MARKETPLACE_SUSPENDED:
        return "This contractor is suspended from marketplace work."
    if getattr(contractor, "marketplace_verification_status", "") != Contractor.MARKETPLACE_VERIFIED:
        return "This contractor is not verified for marketplace work."
    if not (
        getattr(contractor, "charges_enabled", False)
        and getattr(contractor, "payouts_enabled", False)
        and not getattr(contractor, "stripe_deauthorized_at", None)
    ):
        return "This contractor must complete Stripe setup before accepting marketplace work."
    return ""
