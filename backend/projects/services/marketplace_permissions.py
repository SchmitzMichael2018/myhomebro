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


def direct_invite_target_contractor(contact_identity: str) -> Contractor | None:
    """Resolve an authoritative linked account from a direct-invitation identity."""
    kind, separator, raw_value = str(contact_identity or "").partition(":")
    if not separator or not raw_value:
        return None
    if kind == "contractor":
        return Contractor.objects.select_related("user").filter(pk=raw_value).first()
    if kind == "directory":
        entry = (
            ContractorDirectoryEntry.objects.select_related(
                "claimed_by_contractor__user"
            )
            .filter(pk=raw_value)
            .first()
        )
        return getattr(entry, "claimed_by_contractor", None)
    if kind == "listing":
        listing = (
            ContractorDirectoryListing.objects.select_related(
                "claimed_contractor__user"
            )
            .filter(pk=raw_value)
            .first()
        )
        return getattr(listing, "claimed_contractor", None)
    if kind == "place":
        contractor_ids = set(
            ContractorDirectoryEntry.objects.filter(
                google_place_id=raw_value,
                claimed_by_contractor__isnull=False,
            ).values_list("claimed_by_contractor_id", flat=True)
        )
        contractor_ids.update(
            ContractorDirectoryListing.objects.filter(
                google_place_id=raw_value,
                claimed_contractor__isnull=False,
            ).values_list("claimed_contractor_id", flat=True)
        )
        if len(contractor_ids) == 1:
            return (
                Contractor.objects.select_related("user")
                .filter(pk=contractor_ids.pop())
                .first()
            )
    return None


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
