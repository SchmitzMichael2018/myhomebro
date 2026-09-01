from __future__ import annotations

from decimal import Decimal, InvalidOperation
from typing import Any


PLACEHOLDER_SCOPES = {
    "draft agreement — template/details pending.",
    "draft agreement - template/details pending.",
}


def agreement_readiness(agreement) -> dict[str, Any]:
    """Return the minimum customer-facing contract blockers."""
    blockers: list[dict[str, str]] = []

    scope = str(getattr(agreement, "description", "") or "").strip()
    if not scope or scope.lower() in PLACEHOLDER_SCOPES:
        blockers.append({"key": "scope", "message": "Add a complete Scope of Work before sending."})

    manager = getattr(agreement, "milestones", None)
    milestones = list(manager.all().order_by("order", "id")) if manager is not None else []
    if not milestones:
        blockers.append({"key": "milestones", "message": "Add at least one milestone before sending."})
    else:
        missing_outcomes: list[str] = []
        invalid_amounts: list[str] = []
        for milestone in milestones:
            title = str(getattr(milestone, "title", "") or "").strip() or f"Milestone #{milestone.pk}"
            if not str(getattr(milestone, "description", "") or "").strip():
                missing_outcomes.append(title)
            try:
                if Decimal(str(getattr(milestone, "amount", 0) or 0)) <= Decimal("0.00"):
                    invalid_amounts.append(title)
            except (InvalidOperation, TypeError, ValueError):
                invalid_amounts.append(title)
        if missing_outcomes:
            blockers.append({
                "key": "milestone_outcomes",
                "message": "Add a Completed when outcome for: " + ", ".join(missing_outcomes) + ".",
            })
        if invalid_amounts:
            blockers.append({
                "key": "milestone_amounts",
                "message": "Enter a positive amount for: " + ", ".join(invalid_amounts) + ".",
            })

    warranty_type = str(getattr(agreement, "warranty_type", "default") or "default").strip().lower()
    warranty_text = str(getattr(agreement, "warranty_text_snapshot", "") or "").strip()
    if warranty_type not in {"default", "custom", "none"}:
        blockers.append({"key": "warranty", "message": "Choose a warranty option before sending."})
    elif warranty_type in {"default", "custom"} and not warranty_text:
        blockers.append({"key": "warranty", "message": "Add the warranty coverage and duration before sending."})

    return {"ready": not blockers, "blockers": blockers}


def assert_agreement_ready_for_signature(agreement) -> dict[str, Any]:
    result = agreement_readiness(agreement)
    if not result["ready"]:
        detail = " ".join(row["message"] for row in result["blockers"])
        raise ValueError(f"Agreement needs attention: {detail}")
    return result
