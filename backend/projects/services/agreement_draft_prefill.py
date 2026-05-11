from __future__ import annotations

from decimal import Decimal
import re
from typing import Any

from django.db import transaction

from projects.models import Agreement, Milestone, PublicContractorLead
from projects.models_project_intake import ProjectIntake
from projects.services.assisted_diy import build_assisted_diy_snapshot
from projects.services.milestone_roles import annotate_milestone_roles


def _safe_text(value: Any) -> str:
    if value is None:
        return ""
    return str(value).strip()


def _safe_decimal(value: Any) -> Decimal | None:
    if value in (None, "", []):
        return None
    try:
        text = str(value).strip()
        text = re.sub(r"[^0-9.\-]", "", text)
        if not text:
            return None
        return Decimal(text)
    except Exception:
        return None


def _safe_bool(value: Any) -> bool:
    if isinstance(value, bool):
        return value
    return str(value or "").strip().lower() in {"1", "true", "yes", "on"}


def _normalize_milestones(payload: Any, total_cost: Decimal | None = None) -> list[dict[str, Any]]:
    rows = payload if isinstance(payload, list) else []
    normalized: list[dict[str, Any]] = []
    parsed_amounts: list[Decimal] = []

    for index, item in enumerate(rows, start=1):
        if isinstance(item, str):
            title = _safe_text(item)
            description = ""
            amount = None
            start_date = None
            completion_date = None
        elif isinstance(item, dict):
            title = _safe_text(item.get("title") or item.get("name") or item.get("label"))
            description = _safe_text(item.get("description"))
            amount = _safe_decimal(item.get("amount") or item.get("suggested_amount_fixed"))
            start_date = item.get("start_date") or item.get("start") or None
            completion_date = item.get("completion_date") or item.get("end") or item.get("end_date") or None
        else:
            continue

        row = {
            "order": int(item.get("order") or item.get("sort_order") or index) if isinstance(item, dict) else index,
            "title": title,
            "description": description,
            "amount": amount,
            "start_date": start_date,
            "completion_date": completion_date,
        }
        if amount is not None:
            parsed_amounts.append(amount)
        normalized.append(row)

    if normalized and total_cost and total_cost > 0:
        should_equalize = not parsed_amounts or all(amount <= 0 for amount in parsed_amounts)
        if should_equalize:
            share = (total_cost / Decimal(str(len(normalized)))).quantize(Decimal("0.01"))
            for row in normalized:
                row["amount"] = share

    for row in normalized:
        if row["amount"] is None:
            row["amount"] = Decimal("0.00")

    return normalized


def _extract_payload(payload: Any) -> dict[str, Any]:
    if not isinstance(payload, dict):
        return {}
    nested = payload.get("draft_payload")
    if isinstance(nested, dict):
        return nested
    return payload


def _apply_source_prefill(source, payload: dict[str, Any]) -> None:
    if source is None:
        return

    update_fields: list[str] = []
    if isinstance(source, PublicContractorLead):
        if _safe_text(payload.get("project_type")):
            source.project_type = _safe_text(payload.get("project_type"))
            update_fields.append("project_type")
        description = _safe_text(
            payload.get("project_description")
            or payload.get("description")
            or payload.get("project_summary")
        )
        if description:
            source.project_description = description
            update_fields.append("project_description")
        timing = _safe_text(payload.get("desired_timing_text") or payload.get("timeline"))
        if timing:
            source.preferred_timeline = timing
            update_fields.append("preferred_timeline")
        budget = _safe_text(payload.get("budget_range_text") or payload.get("budget") or payload.get("total_cost"))
        if budget:
            source.budget_text = budget
            update_fields.append("budget_text")
        ai_analysis = dict(getattr(source, "ai_analysis", {}) or {})
        if _safe_text(payload.get("project_title")):
            ai_analysis["suggested_title"] = _safe_text(payload.get("project_title"))
        if description:
            ai_analysis["suggested_description"] = description
            ai_analysis["project_scope_summary"] = description
            ai_analysis["refined_description"] = description
        if _safe_text(payload.get("project_type")):
            ai_analysis["project_type"] = _safe_text(payload.get("project_type"))
        if _safe_text(payload.get("project_subtype")):
            ai_analysis["project_subtype"] = _safe_text(payload.get("project_subtype"))
        if timing:
            ai_analysis["desired_timing_text"] = timing
        if budget:
            ai_analysis["budget_range_text"] = budget
        if _safe_text(payload.get("preferred_contact_method")):
            ai_analysis["preferred_contact_method"] = _safe_text(payload.get("preferred_contact_method"))
        if "contact_consent" in payload:
            ai_analysis["contact_consent"] = _safe_bool(payload.get("contact_consent"))
        milestones = _extract_milestones_for_source(payload, source)
        if milestones:
            ai_analysis["milestones"] = milestones
            ai_analysis["milestone_outline"] = milestones
        source.ai_analysis = ai_analysis
        update_fields.append("ai_analysis")
        if update_fields:
            source.save(update_fields=update_fields + ["updated_at"])
        return

    if isinstance(source, ProjectIntake):
        if _safe_text(payload.get("project_title")):
            source.ai_project_title = _safe_text(payload.get("project_title"))
            update_fields.append("ai_project_title")
        description = _safe_text(
            payload.get("project_description")
            or payload.get("description")
            or payload.get("project_summary")
        )
        if description:
            source.ai_description = description
            source.accomplishment_text = description
            update_fields.extend(["ai_description", "accomplishment_text"])
        project_type = _safe_text(payload.get("project_type"))
        if project_type:
            source.ai_project_type = project_type
            update_fields.append("ai_project_type")
        project_subtype = _safe_text(payload.get("project_subtype"))
        if project_subtype:
            source.ai_project_subtype = project_subtype
            update_fields.append("ai_project_subtype")
        if _safe_text(payload.get("project_class")):
            source.project_class = _safe_text(payload.get("project_class"))
            update_fields.append("project_class")
        timing = _safe_text(payload.get("desired_timing_text") or payload.get("timeline"))
        if timing:
            source.desired_timing_text = timing
            update_fields.append("desired_timing_text")
        budget = _safe_text(payload.get("budget_range_text") or payload.get("budget") or payload.get("total_cost"))
        if budget:
            source.budget_range_text = budget
            update_fields.append("budget_range_text")
        if _safe_text(payload.get("preferred_contact_method")):
            source.preferred_contact_method = _safe_text(payload.get("preferred_contact_method"))
            update_fields.append("preferred_contact_method")
        if "contact_consent" in payload:
            source.contact_consent = _safe_bool(payload.get("contact_consent"))
            update_fields.append("contact_consent")
        if payload.get("ai_project_budget") not in (None, "", []):
            source.ai_project_budget = _safe_decimal(payload.get("ai_project_budget"))
            update_fields.append("ai_project_budget")
        elif budget:
            source.ai_project_budget = _safe_decimal(payload.get("total_cost") or payload.get("budget"))
            update_fields.append("ai_project_budget")
        if timing and timing.isdigit():
            source.ai_project_timeline_days = int(timing)
            update_fields.append("ai_project_timeline_days")
        milestones = _extract_milestones_for_source(payload, source)
        if milestones:
            source.ai_milestones = milestones
            update_fields.append("ai_milestones")
        if update_fields:
            source.save(update_fields=update_fields + ["updated_at"])


def _extract_milestones_for_source(payload: dict[str, Any], source) -> list[dict[str, Any]]:
    milestones = payload.get("milestones")
    if isinstance(milestones, list) and milestones:
        return milestones

    if isinstance(source, PublicContractorLead):
        analysis = dict(getattr(source, "ai_analysis", {}) or {})
        outline = analysis.get("milestones")
        if isinstance(outline, list) and outline:
            return outline
        outline = analysis.get("milestone_outline")
        if isinstance(outline, list) and outline:
            return outline

    if isinstance(source, ProjectIntake):
        outline = getattr(source, "ai_milestones", None)
        if isinstance(outline, list) and outline:
            return outline

    return []


@transaction.atomic
def apply_conversion_prefill(*, agreement: Agreement, payload: Any, source=None) -> list[dict[str, Any]]:
    data = _extract_payload(payload)
    _apply_source_prefill(source, data)

    project = getattr(agreement, "project", None)
    if project is not None:
        project_title = _safe_text(data.get("project_title") or data.get("title"))
        if project_title:
            project.title = project_title
        project_description = _safe_text(
            data.get("project_description") or data.get("description") or data.get("project_summary")
        )
        if project_description:
            project.description = project_description
        address_line1 = _safe_text(data.get("project_address_line1") or data.get("address_line1"))
        if address_line1:
            project.project_street_address = address_line1
        address_line2 = _safe_text(data.get("project_address_line2") or data.get("address_line2"))
        if address_line2:
            project.project_address_line_2 = address_line2
        city = _safe_text(data.get("project_city") or data.get("city"))
        if city:
            project.project_city = city
        state = _safe_text(data.get("project_state") or data.get("state"))
        if state:
            project.project_state = state
        postal_code = _safe_text(data.get("project_postal_code") or data.get("postal_code") or data.get("zip_code"))
        if postal_code:
            project.project_zip_code = postal_code
        project.save()

    agreement_updates: list[str] = []
    project_class = _safe_text(data.get("project_class"))
    if project_class:
        agreement.project_class = project_class
        agreement_updates.append("project_class")
    project_mode = _safe_text(data.get("project_mode"))
    if project_mode:
        agreement.project_mode = project_mode
        agreement_updates.append("project_mode")
    payment_mode = _safe_text(data.get("payment_mode"))
    if not payment_mode and data.get("escrow_enabled") is not None:
        payment_mode = "escrow" if _safe_bool(data.get("escrow_enabled")) else "direct"
    if payment_mode:
        agreement.payment_mode = payment_mode
        agreement_updates.append("payment_mode")
    payment_structure = _safe_text(data.get("payment_structure"))
    if payment_structure:
        agreement.payment_structure = payment_structure
        agreement_updates.append("payment_structure")
    project_type = _safe_text(data.get("project_type"))
    if project_type:
        agreement.project_type = project_type
        agreement_updates.append("project_type")
    project_subtype = _safe_text(data.get("project_subtype"))
    if project_subtype:
        agreement.project_subtype = project_subtype
        agreement_updates.append("project_subtype")
    homeowner_participation_notes = _safe_text(data.get("homeowner_participation_notes"))
    if homeowner_participation_notes:
        agreement.homeowner_participation_notes = homeowner_participation_notes
        agreement_updates.append("homeowner_participation_notes")
    homeowner_responsibilities = _safe_text(data.get("homeowner_responsibilities"))
    if homeowner_responsibilities:
        agreement.homeowner_responsibilities = homeowner_responsibilities
        agreement_updates.append("homeowner_responsibilities")
    contractor_responsibilities = _safe_text(data.get("contractor_responsibilities"))
    if contractor_responsibilities:
        agreement.contractor_responsibilities = contractor_responsibilities
        agreement_updates.append("contractor_responsibilities")
    excluded_work = _safe_text(data.get("excluded_work"))
    if excluded_work:
        agreement.excluded_work = excluded_work
        agreement_updates.append("excluded_work")
    try:
        agreement.collaboration_summary_snapshot = build_assisted_diy_snapshot(agreement, milestones=agreement.milestones.all())
        agreement_updates.append("collaboration_summary_snapshot")
    except Exception:
        pass
    description = _safe_text(data.get("project_description") or data.get("description") or data.get("project_summary"))
    if description:
        agreement.description = description
        agreement_updates.append("description")
    total_cost = (
        _safe_decimal(data.get("total_cost"))
        or _safe_decimal(data.get("project_budget"))
        or _safe_decimal(data.get("budget"))
        or _safe_decimal(data.get("amount"))
    )
    if total_cost is not None:
        agreement.total_cost = total_cost
        agreement_updates.append("total_cost")

    milestones_payload = _extract_milestones_for_source(data, source)
    normalized_milestones = _normalize_milestones(milestones_payload, total_cost=total_cost)
    if normalized_milestones:
        agreement.milestones.all().delete()
        created = []
        for row in annotate_milestone_roles(normalized_milestones, project_mode=getattr(agreement, "project_mode", "")):
            created.append(
                Milestone.objects.create(
                    agreement=agreement,
                    order=int(row["order"]),
                    title=_safe_text(row["title"]) or f"Milestone {row['order']}",
                    description=_safe_text(row["description"]),
                    amount=row["amount"] if row["amount"] is not None else Decimal("0.00"),
                    start_date=row["start_date"] or None,
                    completion_date=row["completion_date"] or None,
                    completed=False,
                    is_invoiced=False,
                    milestone_role=_safe_text(row.get("milestone_role")),
                )
            )
        agreement.milestone_count = len(created)
        agreement_updates.append("milestone_count")

    if agreement_updates:
        agreement.save(update_fields=sorted(set(agreement_updates + ["updated_at"])))

    return normalized_milestones
