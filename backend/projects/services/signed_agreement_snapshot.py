from __future__ import annotations

from decimal import Decimal
from typing import Any

from django.db import transaction
from django.utils import timezone

from projects.models import Agreement, AgreementPDFVersion, Milestone
from projects.models_learning import AgreementDraftIntelligenceSnapshot, SignedAgreementSnapshot


def _safe_text(value: Any) -> str:
    return "" if value is None else str(value).strip()


def _safe_decimal(value: Any) -> Decimal:
    try:
        return Decimal(str(value or "0")).quantize(Decimal("0.01"))
    except Exception:
        return Decimal("0.00")


def _dt(value: Any):
    return value if value else None


def _agreement_title(agreement: Agreement) -> str:
    project = getattr(agreement, "project", None)
    return (
        _safe_text(getattr(project, "title", ""))
        or _safe_text(getattr(agreement, "title", ""))
        or f"Agreement #{getattr(agreement, 'id', '')}"
    )


def _milestone_details(agreement: Agreement) -> list[dict[str, Any]]:
    details: list[dict[str, Any]] = []
    milestones = (
        Milestone.objects.filter(agreement=agreement)
        .order_by("order", "id")
    )
    for milestone in milestones:
        details.append(
            {
                "id": milestone.id,
                "order": int(getattr(milestone, "order", 0) or 0),
                "title": _safe_text(getattr(milestone, "title", "")),
                "description": _safe_text(getattr(milestone, "description", "")),
                "amount": str(_safe_decimal(getattr(milestone, "amount", None))),
                "start_date": getattr(milestone, "start_date", None).isoformat()
                if getattr(milestone, "start_date", None)
                else None,
                "completion_date": getattr(milestone, "completion_date", None).isoformat()
                if getattr(milestone, "completion_date", None)
                else None,
                "milestone_role": _safe_text(getattr(milestone, "milestone_role", "")),
                "pricing_strategy": _safe_text(getattr(milestone, "pricing_strategy", "")),
            }
        )
    return details


def _draft_snapshot(agreement: Agreement) -> AgreementDraftIntelligenceSnapshot | None:
    try:
        return agreement.draft_intelligence_snapshot
    except AgreementDraftIntelligenceSnapshot.DoesNotExist:
        return AgreementDraftIntelligenceSnapshot.objects.filter(agreement=agreement).first()
    except Exception:
        return AgreementDraftIntelligenceSnapshot.objects.filter(agreement=agreement).first()


def _latest_pdf_version(agreement: Agreement) -> AgreementPDFVersion | None:
    try:
        return (
            AgreementPDFVersion.objects.filter(
                agreement=agreement,
                signed_by_contractor=True,
                signed_by_homeowner=True,
            )
            .order_by("-version_number", "-created_at", "-id")
            .first()
        )
    except Exception:
        return None


def _signature_satisfied(agreement: Agreement) -> bool:
    try:
        value = getattr(agreement, "signature_is_satisfied", False)
        return bool(value() if callable(value) else value)
    except Exception:
        return bool(
            getattr(agreement, "signed_by_contractor", False)
            and getattr(agreement, "signed_by_homeowner", False)
        )


def build_signed_agreement_snapshot_payload(agreement: Agreement) -> dict[str, Any] | None:
    if not _signature_satisfied(agreement):
        return None

    draft = _draft_snapshot(agreement)
    selected_template = getattr(agreement, "selected_template", None)
    if selected_template is None and draft is not None:
        selected_template = getattr(draft, "selected_template", None)

    milestone_details = _milestone_details(agreement)
    pdf_version = _latest_pdf_version(agreement)

    contractor_signed_at = (
        _dt(getattr(agreement, "signed_at_contractor", None))
        or _dt(getattr(agreement, "contractor_signed_at", None))
        or (getattr(pdf_version, "contractor_signed_at", None) if pdf_version else None)
    )
    homeowner_signed_at = (
        _dt(getattr(agreement, "signed_at_homeowner", None))
        or _dt(getattr(agreement, "homeowner_signed_at", None))
        or (getattr(pdf_version, "homeowner_signed_at", None) if pdf_version else None)
    )
    fully_signed_at = max(
        [dt for dt in (contractor_signed_at, homeowner_signed_at) if dt],
        default=timezone.now(),
    )

    return {
        "agreement": agreement,
        "contractor": getattr(agreement, "contractor", None),
        "homeowner": getattr(agreement, "homeowner", None),
        "selected_template": selected_template,
        "draft_intelligence_snapshot": draft,
        "project_title": _agreement_title(agreement),
        "project_type": _safe_text(getattr(agreement, "project_type", "")),
        "project_subtype": _safe_text(getattr(agreement, "project_subtype", "")),
        "signed_scope": _safe_text(getattr(agreement, "description", "")),
        "exclusions": _safe_text(getattr(agreement, "excluded_work", "")),
        "customer_responsibilities": _safe_text(getattr(agreement, "homeowner_responsibilities", "")),
        "milestone_count": len(milestone_details),
        "milestone_details": milestone_details,
        "contract_amount": _safe_decimal(getattr(agreement, "total_cost", None)),
        "pricing_structure": _safe_text(getattr(agreement, "pricing_strategy", "")),
        "payment_structure": _safe_text(getattr(agreement, "payment_structure", "")),
        "payment_mode": _safe_text(getattr(agreement, "payment_mode", "")),
        "retainage_percent": _safe_decimal(getattr(agreement, "retainage_percent", None)),
        "draft_source": _safe_text(getattr(draft, "draft_source", "")) if draft else "",
        "template_name_snapshot": _safe_text(getattr(selected_template, "name", "")),
        "template_recommendation_result": getattr(draft, "template_recommendation_result", {}) if draft else {},
        "template_recommendation_tier": _safe_text(getattr(draft, "template_recommendation_tier", "")) if draft else "",
        "amendment_number": int(getattr(agreement, "amendment_number", 0) or 0),
        "pdf_version": int(getattr(pdf_version, "version_number", None) or getattr(agreement, "pdf_version", 0) or 0),
        "pdf_version_id": getattr(pdf_version, "id", None),
        "warranty_type": _safe_text(getattr(agreement, "warranty_type", "")),
        "warranty_text": _safe_text(getattr(agreement, "warranty_text_snapshot", "")),
        "contractor_signed_at": contractor_signed_at,
        "homeowner_signed_at": homeowner_signed_at,
        "fully_signed_at": fully_signed_at,
    }


@transaction.atomic
def capture_signed_agreement_snapshot(agreement: Agreement | int) -> SignedAgreementSnapshot | None:
    if isinstance(agreement, int):
        agreement = Agreement.objects.select_related(
            "project",
            "contractor",
            "homeowner",
            "selected_template",
        ).get(pk=agreement)

    payload = build_signed_agreement_snapshot_payload(agreement)
    if payload is None:
        return None

    existing = SignedAgreementSnapshot.objects.filter(
        agreement=agreement,
        amendment_number=payload["amendment_number"],
        pdf_version=payload["pdf_version"],
    ).first()
    if existing is not None:
        return existing

    return SignedAgreementSnapshot.objects.create(**payload)
