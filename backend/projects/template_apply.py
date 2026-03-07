from __future__ import annotations

from dataclasses import dataclass
from datetime import date, timedelta
from decimal import Decimal, InvalidOperation
from typing import Any, Iterable, Optional

from django.db import transaction
from django.utils import timezone

from projects.models import Agreement, Contractor, Milestone
from projects.template_models import ProjectTemplate, ProjectTemplateMilestone


@dataclass
class DateRange:
    start_date: date
    end_date: date


# ----------------------------
# contractor / ownership utils
# ----------------------------

def get_request_contractor(user) -> Optional[Contractor]:
    """
    Best-effort contractor resolution.
    Supports:
    - user.contractor
    - Contractor(user=...)
    """
    contractor = getattr(user, "contractor", None)
    if contractor is not None:
        return contractor

    try:
        return Contractor.objects.filter(user=user).first()
    except Exception:
        return None


def agreement_belongs_to_contractor(agreement: Agreement, contractor: Contractor) -> bool:
    """
    Best-effort ownership check to avoid guessing your exact Agreement shape.
    Tries common relationships/fields.
    """
    if contractor is None:
        return False

    direct_candidates = [
        "contractor",
        "assigned_contractor",
        "owner_contractor",
    ]
    for field_name in direct_candidates:
        if hasattr(agreement, field_name):
            try:
                value = getattr(agreement, field_name)
                if value and getattr(value, "id", None) == contractor.id:
                    return True
            except Exception:
                pass

    project = getattr(agreement, "project", None)
    if project is not None:
        for field_name in ["contractor", "assigned_contractor", "owner_contractor"]:
            if hasattr(project, field_name):
                try:
                    value = getattr(project, field_name)
                    if value and getattr(value, "id", None) == contractor.id:
                        return True
                except Exception:
                    pass

    user = getattr(contractor, "user", None)
    agreement_user_candidates = ["user", "created_by", "owner", "contractor_user"]
    for field_name in agreement_user_candidates:
        if hasattr(agreement, field_name):
            try:
                value = getattr(agreement, field_name)
                if value and user and getattr(value, "id", None) == user.id:
                    return True
            except Exception:
                pass

    return False


# ----------------------------
# generic field helpers
# ----------------------------

def _first_existing_attr(obj: Any, field_names: Iterable[str], default=None):
    for name in field_names:
        if hasattr(obj, name):
            try:
                return getattr(obj, name)
            except Exception:
                continue
    return default


def _set_first_existing_attr(obj: Any, field_names: Iterable[str], value) -> bool:
    for name in field_names:
        if hasattr(obj, name):
            try:
                setattr(obj, name, value)
                return True
            except Exception:
                continue
    return False


def _safe_decimal(value, default=Decimal("0.00")) -> Decimal:
    try:
        if value is None or value == "":
            return default
        return Decimal(str(value))
    except (InvalidOperation, TypeError, ValueError):
        return default


def _safe_date(value, default: Optional[date] = None) -> Optional[date]:
    if value is None:
        return default
    if isinstance(value, date):
        return value
    return default


# ----------------------------
# agreement date / amount logic
# ----------------------------

def _resolve_agreement_total_amount(agreement: Agreement) -> Decimal:
    candidates = [
        "total_cost",
        "total_amount",
        "project_total",
        "contract_amount",
        "price",
        "amount",
    ]
    for field_name in candidates:
        if hasattr(agreement, field_name):
            value = _safe_decimal(getattr(agreement, field_name, None), default=Decimal("0.00"))
            if value > 0:
                return value

    return Decimal("0.00")


def _resolve_date_range(agreement: Agreement, template: ProjectTemplate) -> DateRange:
    today = timezone.localdate()

    start_candidates = [
        "start_date",
        "project_start_date",
        "scheduled_start",
        "scheduled_start_date",
    ]
    end_candidates = [
        "end_date",
        "project_end_date",
        "scheduled_end",
        "scheduled_end_date",
    ]

    start_value = _first_existing_attr(agreement, start_candidates)
    end_value = _first_existing_attr(agreement, end_candidates)

    start_date = _safe_date(start_value, default=today)
    end_date = _safe_date(end_value)

    if start_date is None:
        start_date = today

    if end_date is None:
        estimated_days = max(int(template.estimated_days or 1), 1)
        end_date = start_date + timedelta(days=max(estimated_days - 1, 0))

    if end_date < start_date:
        end_date = start_date

    return DateRange(start_date=start_date, end_date=end_date)


def distribute_milestone_dates(start_date: date, end_date: date, count: int) -> list[date]:
    """
    Evenly distribute milestone dates across the agreement range.

    Rules:
    - 1 milestone => end date
    - first milestone always = start date
    - last milestone always = end date
    - middle milestones are evenly spaced
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


# ----------------------------
# milestone create / clear logic
# ----------------------------

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
                amt = (agreement_total * _safe_decimal(row.suggested_amount_percent) / Decimal("100")).quantize(
                    Decimal("0.01")
                )
                amounts.append(amt)
                remaining -= amt
            else:
                amounts.append(Decimal("0.00"))
                unresolved_indexes.append(idx)

        if unresolved_indexes:
            split = (remaining / Decimal(len(unresolved_indexes))).quantize(Decimal("0.01")) if len(unresolved_indexes) else Decimal("0.00")
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


def _create_agreement_milestone(
    agreement: Agreement,
    template_row: ProjectTemplateMilestone,
    sort_index: int,
    start_date: date,
    due_date: date,
    amount: Decimal,
) -> Milestone:
    """
    Creates a Milestone using common field-name fallbacks to better fit your current codebase.
    """
    milestone = Milestone()

    _set_first_existing_attr(milestone, ["agreement"], agreement)
    _set_first_existing_attr(milestone, ["title", "name"], template_row.title)
    _set_first_existing_attr(milestone, ["description", "details", "notes"], template_row.description)

    _set_first_existing_attr(milestone, ["start_date", "scheduled_start", "date_start"], start_date)
    _set_first_existing_attr(milestone, ["due_date", "end_date", "scheduled_end", "date_due"], due_date)

    _set_first_existing_attr(milestone, ["amount", "price", "value"], amount)
    _set_first_existing_attr(milestone, ["sort_order", "position", "order"], sort_index)

    if template_row.materials_hint:
        _set_first_existing_attr(
            milestone,
            ["materials_hint", "materials", "suggested_materials"],
            template_row.materials_hint,
        )

    # Leave status untouched unless your model has a matching field
    if hasattr(milestone, "status") and not getattr(milestone, "status", None):
        try:
            milestone.status = "pending"
        except Exception:
            pass

    milestone.save()
    return milestone


def _copy_template_text_fields(agreement: Agreement, template: ProjectTemplate) -> None:
    """
    Optionally copy template defaults into agreement when those fields exist.
    """
    if template.description:
        _set_first_existing_attr(
            agreement,
            ["description", "scope_of_work", "project_description"],
            template.description,
        )

    if template.default_scope:
        _set_first_existing_attr(
            agreement,
            ["scope_of_work", "scope", "project_scope"],
            template.default_scope,
        )

    if template.default_clarifications:
        _set_first_existing_attr(
            agreement,
            ["clarifications", "clarifications_json", "scope_clarifications"],
            template.default_clarifications,
        )

    # Optional tracking fields if you already add them later
    _set_first_existing_attr(agreement, ["selected_template_name"], template.name)
    _set_first_existing_attr(agreement, ["selected_template_type"], template.project_type)
    _set_first_existing_attr(agreement, ["selected_template_subtype"], template.project_subtype)

    agreement.save()


# ----------------------------
# public service functions
# ----------------------------

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

    if overwrite_existing:
        deleted_count = _clear_existing_milestones(agreement)
    else:
        deleted_count = 0

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
        start_date = date_range.start_date if idx == 1 else distributed_dates[idx - 2]

        milestone = _create_agreement_milestone(
            agreement=agreement,
            template_row=row,
            sort_index=idx,
            start_date=start_date,
            due_date=due_date,
            amount=amounts[idx - 1],
        )
        created.append(milestone)

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

    project_type = str(_first_existing_attr(agreement, ["project_type", "type"], "") or "")
    project_subtype = str(_first_existing_attr(agreement, ["project_subtype", "subtype"], "") or "")
    agreement_description = str(
        _first_existing_attr(agreement, ["description", "scope_of_work", "project_description"], "") or ""
    )

    estimated_days = 1
    date_range = _resolve_date_range(
        agreement=agreement,
        template=ProjectTemplate(estimated_days=1),
    )
    estimated_days = max((date_range.end_date - date_range.start_date).days + 1, 1)

    default_clarifications = _first_existing_attr(
        agreement,
        ["clarifications", "clarifications_json", "scope_clarifications"],
        [],
    )
    if default_clarifications is None:
        default_clarifications = []

    template = ProjectTemplate.objects.create(
        contractor=contractor,
        name=name.strip(),
        project_type=project_type,
        project_subtype=project_subtype,
        description=description.strip() or agreement_description,
        estimated_days=estimated_days,
        default_scope=str(_first_existing_attr(agreement, ["scope_of_work", "scope", "project_scope"], "") or ""),
        default_clarifications=default_clarifications if isinstance(default_clarifications, list) else [],
        is_system=False,
        is_active=is_active,
        created_from_agreement=agreement,
    )

    milestone_qs = Milestone.objects.filter(agreement=agreement).order_by("id")
    for idx, milestone in enumerate(milestone_qs, start=1):
        title = _first_existing_attr(milestone, ["title", "name"], "") or f"Milestone {idx}"
        desc = _first_existing_attr(milestone, ["description", "details", "notes"], "") or ""
        amount = _safe_decimal(_first_existing_attr(milestone, ["amount", "price", "value"], None), Decimal("0.00"))

        ProjectTemplateMilestone.objects.create(
            template=template,
            title=str(title),
            description=str(desc),
            sort_order=idx,
            suggested_amount_fixed=amount if amount > 0 else None,
            materials_hint=str(
                _first_existing_attr(
                    milestone,
                    ["materials_hint", "materials", "suggested_materials"],
                    "",
                ) or ""
            ),
        )

    return template