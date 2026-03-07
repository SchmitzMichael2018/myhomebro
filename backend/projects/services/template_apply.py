from __future__ import annotations

from dataclasses import dataclass
from datetime import date, timedelta
from decimal import Decimal, InvalidOperation
from typing import Optional

from django.db import transaction
from django.utils import timezone

from projects.models import Agreement, Contractor, Milestone
from projects.models_templates import ProjectTemplate


@dataclass
class DateRange:
    start_date: date
    end_date: date


def get_request_contractor(user) -> Optional[Contractor]:
    """
    Your actual schema uses user.contractor_profile.
    """
    contractor = getattr(user, "contractor_profile", None)
    if contractor is not None:
        return contractor

    try:
        return Contractor.objects.filter(user=user).first()
    except Exception:
        return None


def agreement_belongs_to_contractor(agreement: Agreement, contractor: Contractor) -> bool:
    if contractor is None:
        return False
    return agreement.contractor_id == contractor.id


def _safe_decimal(value, default=Decimal("0.00")) -> Decimal:
    try:
        if value is None or value == "":
            return default
        return Decimal(str(value))
    except (InvalidOperation, TypeError, ValueError):
        return default


def _resolve_agreement_total_amount(agreement: Agreement) -> Decimal:
    return _safe_decimal(getattr(agreement, "total_cost", None), Decimal("0.00"))


def _resolve_date_range(agreement: Agreement, template: ProjectTemplate) -> DateRange:
    today = timezone.localdate()

    start_date = agreement.start or today
    end_date = agreement.end

    if end_date is None:
        estimated_days = max(int(template.estimated_days or 1), 1)
        end_date = start_date + timedelta(days=max(estimated_days - 1, 0))

    if end_date < start_date:
        end_date = start_date

    return DateRange(start_date=start_date, end_date=end_date)


def distribute_milestone_dates(start_date: date, end_date: date, count: int) -> list[date]:
    """
    Even distribution across agreement date range.
    """
    if count <= 0:
        return []

    if count == 1:
        return [end_date]

    total_days = max((end_date - start_date).days, 0)

    if total_days == 0:
        return [start_date for _ in range(count)]

    results: list[date] = []
    for i in range(count):
        ratio = i / (count - 1)
        offset_days = round(total_days * ratio)
        results.append(start_date + timedelta(days=offset_days))
    return results


def _clear_existing_milestones(agreement: Agreement) -> int:
    qs = Milestone.objects.filter(agreement=agreement)
    deleted_count = qs.count()
    qs.delete()
    return deleted_count


def _build_milestone_amounts(template: ProjectTemplate, agreement_total: Decimal) -> list[Decimal]:
    rows = list(template.milestones.all().order_by("sort_order", "id"))
    if not rows:
        return []

    has_amount_hints = any(
        row.suggested_amount_fixed is not None or row.suggested_amount_percent is not None
        for row in rows
    )

    if has_amount_hints:
        amounts: list[Decimal] = []
        remaining = agreement_total
        unresolved_indexes: list[int] = []

        for idx, row in enumerate(rows):
            if row.suggested_amount_fixed is not None:
                amt = _safe_decimal(row.suggested_amount_fixed)
                amounts.append(amt)
                remaining -= amt
            elif row.suggested_amount_percent is not None and agreement_total > 0:
                amt = (
                    agreement_total
                    * _safe_decimal(row.suggested_amount_percent)
                    / Decimal("100")
                ).quantize(Decimal("0.01"))
                amounts.append(amt)
                remaining -= amt
            else:
                amounts.append(Decimal("0.00"))
                unresolved_indexes.append(idx)

        if unresolved_indexes:
            if len(unresolved_indexes) == 1:
                amounts[unresolved_indexes[0]] = remaining.quantize(Decimal("0.01"))
            else:
                split = (remaining / Decimal(len(unresolved_indexes))).quantize(Decimal("0.01"))
                for idx in unresolved_indexes[:-1]:
                    amounts[idx] = split
                    remaining -= split
                amounts[unresolved_indexes[-1]] = remaining.quantize(Decimal("0.01"))

        return [amt if amt >= 0 else Decimal("0.00") for amt in amounts]

    if agreement_total > 0:
        equal = (agreement_total / Decimal(len(rows))).quantize(Decimal("0.01"))
        amounts = [equal for _ in rows]
        diff = agreement_total - sum(amounts)
        amounts[-1] = (amounts[-1] + diff).quantize(Decimal("0.01"))
        return amounts

    return [Decimal("0.00") for _ in rows]


def _copy_template_text_fields(agreement: Agreement, template: ProjectTemplate) -> None:
    """
    Copy template defaults into agreement.
    Your schema does not yet have a clarifications JSON field on Agreement,
    so for now we copy description only.
    """
    if template.description:
        agreement.description = template.description

    agreement.save(update_fields=["description", "updated_at"])


@transaction.atomic
def apply_template_to_agreement(
    agreement: Agreement,
    template: ProjectTemplate,
    *,
    overwrite_existing: bool = True,
    copy_text_fields: bool = True,
) -> dict:
    template_rows = list(template.milestones.all().order_by("sort_order", "id"))
    if not template_rows:
        raise ValueError("Selected template has no milestone rows.")

    deleted_count = 0
    if overwrite_existing:
        deleted_count = _clear_existing_milestones(agreement)

    if copy_text_fields:
        _copy_template_text_fields(agreement, template)

    agreement_total = _resolve_agreement_total_amount(agreement)
    date_range = _resolve_date_range(agreement, template)
    distributed_dates = distribute_milestone_dates(
        date_range.start_date,
        date_range.end_date,
        len(template_rows),
    )
    amounts = _build_milestone_amounts(template, agreement_total)

    created = []
    for idx, row in enumerate(template_rows, start=1):
        due_date = distributed_dates[idx - 1]
        row_start = distributed_dates[idx - 2] if idx > 1 else date_range.start_date

        milestone = Milestone.objects.create(
            agreement=agreement,
            order=idx,
            title=row.title,
            description=row.description or "",
            amount=amounts[idx - 1],
            start_date=row_start,
            completion_date=due_date,
        )
        created.append(milestone)

    agreement.milestone_count = len(created)

    # Track which template generated this agreement's current milestone set.
    if hasattr(agreement, "selected_template"):
        agreement.selected_template = template
    if hasattr(agreement, "selected_template_name_snapshot"):
        agreement.selected_template_name_snapshot = template.name

    update_fields = ["milestone_count", "updated_at"]
    if hasattr(agreement, "selected_template"):
        update_fields.append("selected_template")
    if hasattr(agreement, "selected_template_name_snapshot"):
        update_fields.append("selected_template_name_snapshot")

    agreement.save(update_fields=update_fields)

    return {
        "template_id": template.id,
        "template_name": template.name,
        "deleted_existing_count": deleted_count,
        "created_count": len(created),
        "milestone_ids": [m.id for m in created],
        "start_date": date_range.start_date,
        "end_date": date_range.end_date,
    }


@transaction.atomic
def save_agreement_as_template(
    *,
    agreement: Agreement,
    contractor: Contractor,
    name: str,
    description: str = "",
    is_active: bool = True,
) -> ProjectTemplate:
    if not name or not str(name).strip():
        raise ValueError("Template name is required.")

    start_date = agreement.start or timezone.localdate()
    end_date = agreement.end or start_date
    estimated_days = max((end_date - start_date).days + 1, 1)

    template = ProjectTemplate.objects.create(
        contractor=contractor,
        name=name.strip(),
        project_type=agreement.project_type or "",
        project_subtype=agreement.project_subtype or "",
        description=(description or agreement.description or "").strip(),
        estimated_days=estimated_days,
        default_scope="",
        default_clarifications=[],
        is_system=False,
        is_active=is_active,
        created_from_agreement=agreement,
    )

    milestone_qs = agreement.milestones.all().order_by("order", "id")
    for milestone in milestone_qs:
        ProjectTemplateMilestone = template.milestones.model
        ProjectTemplateMilestone.objects.create(
            template=template,
            title=milestone.title,
            description=milestone.description or "",
            sort_order=milestone.order,
            suggested_amount_fixed=milestone.amount if milestone.amount and milestone.amount > 0 else None,
            materials_hint="",
        )

    return template