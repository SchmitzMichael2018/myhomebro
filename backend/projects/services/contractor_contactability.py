from __future__ import annotations

from typing import Any

from projects.models_contractor_discovery import ContractorDirectoryEntry


def _has_text(value: Any) -> bool:
    return bool(str(value or "").strip())


def derive_preferred_outreach_method(entry: ContractorDirectoryEntry) -> str:
    if entry.claimed:
        return ContractorDirectoryEntry.OUTREACH_CLAIM_LINK_MANUAL
    if _has_text(entry.public_email):
        return ContractorDirectoryEntry.OUTREACH_EMAIL
    if _has_text(entry.phone):
        return ContractorDirectoryEntry.OUTREACH_SMS
    if entry.has_contact_form and _has_text(entry.contact_form_url):
        return ContractorDirectoryEntry.OUTREACH_WEBSITE_FORM
    if _has_text(entry.website):
        return ContractorDirectoryEntry.OUTREACH_CLAIM_LINK_MANUAL
    return ContractorDirectoryEntry.OUTREACH_UNKNOWN


def derive_contact_status(entry: ContractorDirectoryEntry) -> str:
    if entry.claimed:
        return ContractorDirectoryEntry.CONTACT_STATUS_CLAIMED
    if _has_text(entry.public_email):
        return ContractorDirectoryEntry.CONTACT_STATUS_EMAIL_READY
    if _has_text(entry.phone):
        return ContractorDirectoryEntry.CONTACT_STATUS_PHONE_READY
    if entry.has_contact_form and _has_text(entry.contact_form_url):
        return ContractorDirectoryEntry.CONTACT_STATUS_WEBSITE_FORM_READY
    if _has_text(entry.website):
        return ContractorDirectoryEntry.CONTACT_STATUS_WEBSITE_ONLY
    return ContractorDirectoryEntry.CONTACT_STATUS_MANUAL_REVIEW_NEEDED


def derive_contact_confidence(entry: ContractorDirectoryEntry) -> str:
    if entry.claimed or _has_text(entry.public_email) or _has_text(entry.phone):
        return ContractorDirectoryEntry.CONFIDENCE_HIGH
    if _has_text(entry.website):
        return ContractorDirectoryEntry.CONFIDENCE_MEDIUM
    return ContractorDirectoryEntry.CONFIDENCE_LOW


def detect_contact_form_from_website_metadata(entry: ContractorDirectoryEntry) -> tuple[bool, str | None]:
    if entry.has_contact_form and _has_text(entry.contact_form_url):
        return True, entry.contact_form_url
    return bool(entry.has_contact_form), entry.contact_form_url


def derive_claim_readiness(entry: ContractorDirectoryEntry) -> tuple[str, str]:
    if not (_has_text(entry.phone) or _has_text(entry.public_email) or _has_text(entry.website) or (entry.has_contact_form and _has_text(entry.contact_form_url))):
        return ContractorDirectoryEntry.CLAIM_NEEDS_CONTACT, "Add phone, email, website, or contact form before claim outreach."
    if not (_has_text(entry.city) and _has_text(entry.state)):
        return ContractorDirectoryEntry.CLAIM_NEEDS_LOCATION, "Add city and state before routing or claim outreach."
    if not (_has_text(entry.primary_service) or bool(entry.normalized_services)):
        return ContractorDirectoryEntry.CLAIM_NEEDS_SERVICE, "Add a primary or normalized service category."
    if not _has_text(entry.business_name):
        return ContractorDirectoryEntry.CLAIM_NEEDS_MANUAL_REVIEW, "Business name is missing."
    return ContractorDirectoryEntry.CLAIM_READY, "Ready for claim-link outreach."


def refresh_contactability(entry: ContractorDirectoryEntry, *, save: bool = True) -> ContractorDirectoryEntry:
    entry.has_public_email = _has_text(entry.public_email)
    entry.has_phone = _has_text(entry.phone)
    entry.has_website = _has_text(entry.website)
    has_form, form_url = detect_contact_form_from_website_metadata(entry)
    entry.has_contact_form = has_form
    if form_url:
        entry.contact_form_url = form_url
    entry.contact_status = derive_contact_status(entry)
    entry.preferred_outreach_method = derive_preferred_outreach_method(entry)
    entry.contact_confidence = derive_contact_confidence(entry)
    readiness, notes = derive_claim_readiness(entry)
    entry.claim_readiness_status = readiness
    entry.claim_readiness_notes = notes
    if save:
        entry.save(
            update_fields=[
                "has_public_email",
                "has_phone",
                "has_website",
                "has_contact_form",
                "contact_form_url",
                "contact_status",
                "preferred_outreach_method",
                "contact_confidence",
                "claim_readiness_status",
                "claim_readiness_notes",
                "last_seen_at",
            ]
        )
    return entry
