# backend/projects/services/agreements/pdf_actions.py
from __future__ import annotations

from typing import Optional, Callable

from django.utils.timezone import now

from projects.models import Agreement


def mark_agreement_previewed(ag: Agreement, *, reviewed_by: str = "contractor") -> None:
    ag.reviewed = True
    ag.reviewed_at = now()
    ag.reviewed_by = reviewed_by
    ag.save(update_fields=["reviewed", "reviewed_at", "reviewed_by", "updated_at"])


def finalize_agreement_pdf(
    ag: Agreement,
    *,
    generate_full_agreement_pdf: Optional[Callable[..., None]],
) -> str | None:
    """Generate final PDF and return its URL (if available)."""
    if not generate_full_agreement_pdf:
        raise RuntimeError("PDF finalization not available.")

    generate_full_agreement_pdf(ag)
    ag.refresh_from_db()
    return getattr(getattr(ag, "pdf_file", None), "url", None)
