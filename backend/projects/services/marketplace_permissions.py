from __future__ import annotations

from projects.models import Contractor


def contractor_direct_invite_block_reason(contractor: Contractor | None) -> str:
    """Return why an existing contractor cannot receive a direct customer invitation."""
    if contractor is None:
        return ""
    user = getattr(contractor, "user", None)
    if user and not getattr(user, "is_active", True):
        return "This contractor account is not active."
    verification_status = getattr(contractor, "marketplace_verification_status", "")
    if verification_status == Contractor.MARKETPLACE_SUSPENDED:
        return "This contractor is suspended from marketplace invitations."
    if verification_status == Contractor.MARKETPLACE_REJECTED:
        return "This contractor is not eligible for marketplace invitations."
    if not getattr(contractor, "is_active", True):
        return "This contractor is not active."
    return ""


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
