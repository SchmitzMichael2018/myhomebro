from __future__ import annotations

from decimal import Decimal

from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

from projects.models import AgreementProjectClass, PublicContractorLead
from projects.models_project_intake import ProjectIntake
from projects.services.agreements.project_create import resolve_contractor_for_user
from projects.services.bid_workflow import (
    bid_next_action,
    bid_status_group,
    bid_status_label,
    format_money,
    infer_project_class,
    normalize_bid_status,
    parse_money_like_text,
    project_class_label,
)


def _resolve_contractor(user):
    return resolve_contractor_for_user(user)


def _safe_text(value) -> str:
    if value is None:
        return ""
    return str(value).strip()


def _format_date(value):
    if not value:
        return None
    try:
        return value.isoformat()
    except Exception:
        return None


def _agreement_label(agreement) -> str:
    if agreement is None:
        return ""
    project = getattr(agreement, "project", None)
    return (
        _safe_text(getattr(project, "title", ""))
        or _safe_text(getattr(agreement, "project_title", ""))
        or f"Agreement #{agreement.id}"
    )


def _agreement_reference(agreement) -> str:
    if agreement is None:
        return ""
    project = getattr(agreement, "project", None)
    project_number = _safe_text(getattr(project, "number", ""))
    if project_number:
        return f"Agreement {project_number}"
    return f"Agreement #{agreement.id}"


def _milestone_preview(payload) -> list[str]:
    items = payload if isinstance(payload, list) else []
    out: list[str] = []
    for row in items[:3]:
        if isinstance(row, dict):
            title = _safe_text(row.get("title") or row.get("name"))
            if title:
                out.append(title)
    return out


def _estimate_amount_from_payload(payload) -> Decimal | None:
    if not isinstance(payload, dict):
        return None
    estimate = payload.get("estimate_preview")
    if not isinstance(estimate, dict):
        return None
    return parse_money_like_text(estimate.get("suggested_total_price"))


def _format_bid_amount(amount: Decimal | None) -> str:
    if amount is None:
        return "-"
    return f"${amount:,.2f}"


def _bid_row_from_lead(lead) -> dict:
    linked_agreement = getattr(lead, "converted_agreement", None)
    source_intake = getattr(lead, "source_intake", None)
    if linked_agreement is None and getattr(source_intake, "agreement_id", None):
        linked_agreement = source_intake.agreement

    analysis = lead.ai_analysis or {}
    project_title = (
        _safe_text(analysis.get("suggested_title"))
        or _safe_text(lead.project_type)
        or _safe_text(lead.project_description)
        or f"Lead #{lead.id}"
    )
    project_notes = (
        _safe_text(analysis.get("suggested_description"))
        or _safe_text(lead.project_description)
        or _safe_text(lead.project_type)
    )
    project_class = (
        _safe_text(getattr(linked_agreement, "project_class", ""))
        or infer_project_class(
            lead.project_type,
            lead.project_description,
            lead.preferred_timeline,
            lead.budget_text,
            analysis.get("project_type"),
            analysis.get("project_subtype"),
            project_notes,
        )
    )
    status = normalize_bid_status(
        raw_status=lead.status,
        has_agreement=bool(getattr(linked_agreement, "id", None)),
        record_kind="lead",
    )
    submitted_at = lead.accepted_at or lead.converted_at or lead.created_at
    bid_amount = (
        getattr(linked_agreement, "total_cost", None)
        or parse_money_like_text(lead.budget_text)
        or parse_money_like_text(analysis.get("suggested_total_price"))
    )

    return {
        "bid_id": f"lead-{lead.id}",
        "record_id": lead.id,
        "source_kind": "lead",
        "source_kind_label": "Lead",
        "source_id": lead.id,
        "source_reference": f"Lead #{lead.id}",
        "project_title": project_title,
        "customer_name": _safe_text(lead.full_name) or "Unknown Customer",
        "customer_email": _safe_text(lead.email),
        "customer_phone": _safe_text(lead.phone),
        "project_class": project_class,
        "project_class_label": project_class_label(project_class),
        "bid_amount": format_money(bid_amount) if bid_amount is not None else None,
        "bid_amount_label": _format_bid_amount(bid_amount),
        "submitted_at": _format_date(submitted_at),
        "status": status,
        "status_label": bid_status_label(status),
        "status_group": bid_status_group(status),
        "linked_agreement_id": getattr(linked_agreement, "id", None),
        "linked_agreement_label": _agreement_label(linked_agreement),
        "linked_agreement_reference": _agreement_reference(linked_agreement),
        "linked_agreement_url": f"/app/agreements/{linked_agreement.id}" if linked_agreement else "",
        "notes": project_notes,
        "timeline": _safe_text(lead.preferred_timeline),
        "budget_text": _safe_text(lead.budget_text),
        "milestone_preview": _milestone_preview(analysis.get("milestones") or []),
        "next_action": bid_next_action(
            status=status,
            linked_agreement_id=getattr(linked_agreement, "id", None),
            source_kind="lead",
        ),
    }


def _bid_row_from_intake(intake) -> dict:
    if getattr(intake, "public_lead_id", None):
        return {}

    linked_agreement = getattr(intake, "agreement", None)
    analysis = intake.ai_analysis_payload or {}
    project_title = (
        _safe_text(intake.ai_project_title)
        or _safe_text(analysis.get("project_title"))
        or _safe_text(intake.accomplishment_text)
        or f"Intake #{intake.id}"
    )
    project_notes = (
        _safe_text(intake.ai_description)
        or _safe_text(intake.accomplishment_text)
        or _safe_text(intake.ai_project_subtype)
        or _safe_text(intake.ai_project_type)
    )
    project_class = (
        _safe_text(getattr(linked_agreement, "project_class", ""))
        or infer_project_class(
            intake.ai_project_type,
            intake.ai_project_subtype,
            intake.ai_description,
            intake.accomplishment_text,
            intake.customer_name,
            project_notes,
        )
    )
    status = normalize_bid_status(
        raw_status=intake.status,
        has_agreement=bool(getattr(linked_agreement, "id", None)),
        record_kind="intake",
    )
    submitted_at = intake.submitted_at or intake.analyzed_at or intake.converted_at or intake.created_at
    bid_amount = (
        getattr(linked_agreement, "total_cost", None)
        or _estimate_amount_from_payload(analysis)
    )

    return {
        "bid_id": f"intake-{intake.id}",
        "record_id": intake.id,
        "source_kind": "intake",
        "source_kind_label": "Intake",
        "source_id": intake.id,
        "source_reference": f"Intake #{intake.id}",
        "project_title": project_title,
        "customer_name": _safe_text(intake.customer_name) or "Unknown Customer",
        "customer_email": _safe_text(intake.customer_email),
        "customer_phone": _safe_text(intake.customer_phone),
        "project_class": project_class,
        "project_class_label": project_class_label(project_class),
        "bid_amount": format_money(bid_amount) if bid_amount is not None else None,
        "bid_amount_label": _format_bid_amount(bid_amount),
        "submitted_at": _format_date(submitted_at),
        "status": status,
        "status_label": bid_status_label(status),
        "status_group": bid_status_group(status),
        "linked_agreement_id": getattr(linked_agreement, "id", None),
        "linked_agreement_label": _agreement_label(linked_agreement),
        "linked_agreement_reference": _agreement_reference(linked_agreement),
        "linked_agreement_url": f"/app/agreements/{linked_agreement.id}" if linked_agreement else "",
        "notes": project_notes,
        "timeline": "",
        "budget_text": "",
        "milestone_preview": _milestone_preview(analysis.get("milestones") or intake.ai_milestones or []),
        "next_action": bid_next_action(
            status=status,
            linked_agreement_id=getattr(linked_agreement, "id", None),
            source_kind="intake",
        ),
    }


def _filter_rows(rows: list[dict], *, status_filter: str = "", project_class_filter: str = "", search: str = "") -> list[dict]:
    status_value = _safe_text(status_filter).lower()
    class_value = _safe_text(project_class_filter).lower()
    query = _safe_text(search).lower()

    out = []
    for row in rows:
        if status_value and status_value != "all" and row.get("status") != status_value:
            continue
        if class_value and class_value != "all" and row.get("project_class") != class_value:
            continue
        if query:
            haystack = " ".join(
                [
                    _safe_text(row.get("project_title")),
                    _safe_text(row.get("customer_name")),
                    _safe_text(row.get("customer_email")),
                    _safe_text(row.get("customer_phone")),
                    _safe_text(row.get("notes")),
                    _safe_text(row.get("budget_text")),
                    _safe_text(row.get("status_label")),
                    _safe_text(row.get("source_reference")),
                    _safe_text(row.get("linked_agreement_reference")),
                ]
            ).lower()
            if query not in haystack:
                continue
        out.append(row)
    return out


class ContractorBidsView(APIView):
    permission_classes = [IsAuthenticated]

    def get(self, request):
        contractor = _resolve_contractor(request.user)
        if contractor is None:
            return Response({"detail": "Contractor profile not found."}, status=404)

        leads = list(
            contractor.public_leads.select_related(
                "converted_agreement",
                "source_intake",
                "source_intake__agreement",
            ).order_by("-created_at", "-id")
        )
        intakes = list(
            ProjectIntake.objects.filter(contractor=contractor)
            .select_related("agreement", "public_lead", "public_lead__converted_agreement")
            .order_by("-created_at", "-id")
        )

        rows: list[dict] = []
        linked_intake_ids = set()
        for lead in leads:
            source_intake = getattr(lead, "source_intake", None)
            if source_intake is not None:
                linked_intake_ids.add(source_intake.id)
            row = _bid_row_from_lead(lead)
            rows.append(row)

        for intake in intakes:
            if intake.id in linked_intake_ids or getattr(intake, "public_lead_id", None):
                continue
            row = _bid_row_from_intake(intake)
            if row:
                rows.append(row)

        rows.sort(
            key=lambda row: (
                row.get("submitted_at") or "",
                row.get("bid_id") or 0,
            ),
            reverse=True,
        )

        status_filter = _safe_text(request.GET.get("status", "")).lower()
        project_class_filter = _safe_text(request.GET.get("project_class", "")).lower()
        search = _safe_text(request.GET.get("search", ""))
        filtered_rows = _filter_rows(
            rows,
            status_filter=status_filter,
            project_class_filter=project_class_filter,
            search=search,
        )

        summary = {
            "total_bids": len(filtered_rows),
            "open_bids": sum(1 for row in filtered_rows if row.get("status_group") == "open"),
            "under_review_bids": sum(1 for row in filtered_rows if row.get("status_group") == "under_review"),
            "awarded_bids": sum(1 for row in filtered_rows if row.get("status_group") == "awarded"),
            "declined_expired_bids": sum(
                1 for row in filtered_rows if row.get("status_group") == "declined_expired"
            ),
            "residential_count": sum(
                1 for row in filtered_rows if row.get("project_class") == AgreementProjectClass.RESIDENTIAL
            ),
            "commercial_count": sum(
                1 for row in filtered_rows if row.get("project_class") == AgreementProjectClass.COMMERCIAL
            ),
        }

        return Response(
            {
                "results": filtered_rows,
                "summary": summary,
                "filters": {
                    "status": status_filter or "all",
                    "project_class": project_class_filter or "all",
                    "search": search,
                },
            },
            status=200,
        )
