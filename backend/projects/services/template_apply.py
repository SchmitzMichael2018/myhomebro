from __future__ import annotations

from dataclasses import dataclass
from datetime import date, timedelta
from decimal import Decimal, InvalidOperation
from typing import Optional, Any

from django.db import transaction
from django.db.models import Sum
from django.utils import timezone

from projects.models import Agreement, Contractor, Milestone
from projects.models_templates import ProjectTemplate

try:
    from projects.models_ai_scope import AgreementAIScope
except Exception:  # pragma: no cover
    AgreementAIScope = None  # type: ignore


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


def _milestone_sum(agreement: Agreement) -> Decimal:
    total = (
        Milestone.objects.filter(agreement=agreement)
        .aggregate(total=Sum("amount"))
        .get("total")
        or Decimal("0.00")
    )
    return _safe_decimal(total, Decimal("0.00")).quantize(Decimal("0.01"))


def _resolve_template_apply_pricing_basis(
    agreement: Agreement,
    *,
    spread_enabled: bool = False,
    spread_total: Optional[Any] = None,
    milestone_total_override: Optional[Decimal] = None,
) -> Decimal:
    spread_total_decimal = _safe_decimal(spread_total, Decimal("0.00")).quantize(Decimal("0.01"))
    if spread_enabled and spread_total_decimal > 0:
        return spread_total_decimal

    milestone_total = (
        _safe_decimal(milestone_total_override, Decimal("0.00")).quantize(Decimal("0.01"))
        if milestone_total_override is not None
        else _milestone_sum(agreement)
    )
    if milestone_total > 0:
        return milestone_total

    return _resolve_agreement_total_amount(agreement).quantize(Decimal("0.01"))


def _resolve_date_range(
    agreement: Agreement,
    template: ProjectTemplate,
    *,
    estimated_days_override: Optional[int] = None,
) -> DateRange:
    today = timezone.localdate()

    start_date = agreement.start or today
    end_date = agreement.end

    if end_date is None:
        effective_estimated_days = estimated_days_override or int(template.estimated_days or 1)
        effective_estimated_days = max(int(effective_estimated_days), 1)
        end_date = start_date + timedelta(days=max(effective_estimated_days - 1, 0))

    if end_date < start_date:
        end_date = start_date

    return DateRange(start_date=start_date, end_date=end_date)


def _date_range_duration_days(date_range: DateRange) -> int:
    if date_range.end_date < date_range.start_date:
        return 1
    return max((date_range.end_date - date_range.start_date).days + 1, 1)


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
                for unresolved_idx in unresolved_indexes[:-1]:
                    amounts[unresolved_idx] = split
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


def _build_milestone_amounts_with_spread_total(
    template: ProjectTemplate,
    spread_total: Decimal,
) -> list[Decimal]:
    rows = list(template.milestones.all().order_by("sort_order", "id"))
    if not rows:
        return []

    row_count = len(rows)
    if row_count == 0:
        return []

    if spread_total <= 0:
        return [Decimal("0.00") for _ in rows]

    equal = (spread_total / Decimal(row_count)).quantize(Decimal("0.01"))
    amounts = [equal for _ in rows]
    diff = spread_total - sum(amounts)
    amounts[-1] = (amounts[-1] + diff).quantize(Decimal("0.01"))
    return [amt if amt >= 0 else Decimal("0.00") for amt in amounts]


def _sync_agreement_total_cost(agreement: Agreement) -> Decimal:
    total = _milestone_sum(agreement)
    if getattr(agreement, "total_cost", None) != total:
        agreement.total_cost = total
        agreement.save(update_fields=["total_cost"])
    return total


def _safe_scope_text(template: ProjectTemplate) -> str:
    return (
        getattr(template, "default_scope", None)
        or getattr(template, "description", None)
        or ""
    ).strip()


def _safe_question_list(template: ProjectTemplate) -> list[dict]:
    raw = getattr(template, "default_clarifications", None) or []
    if not isinstance(raw, list):
        return []

    out: list[dict] = []
    for item in raw:
        if not isinstance(item, dict):
            continue

        key = str(item.get("key") or "").strip()
        label = str(item.get("label") or "").strip()
        qtype = str(item.get("type") or "text").strip() or "text"
        required = bool(item.get("required", False))
        help_text = "" if item.get("help") is None else str(item.get("help")).strip()
        options_raw = item.get("options", [])
        options = (
            [str(x).strip() for x in options_raw if str(x).strip()]
            if isinstance(options_raw, list)
            else []
        )

        if not key:
            continue

        out.append(
            {
                "key": key,
                "label": label or key.replace("_", " ").title(),
                "type": qtype,
                "required": required,
                "help": help_text,
                "options": options,
                "source": "template",
            }
        )
    return out


def _replace_questions_preserving_matching_answers(
    existing_answers: Any,
    incoming_questions: list[dict],
) -> tuple[list[dict], dict]:
    cleaned_questions: list[dict] = []
    seen: set[str] = set()

    for item in incoming_questions or []:
        if not isinstance(item, dict):
            continue

        key = str(item.get("key") or "").strip()
        if not key or key in seen:
            continue

        seen.add(key)
        cleaned_questions.append(
            {
                "key": key,
                "label": str(item.get("label") or key.replace("_", " ").title()).strip(),
                "type": str(item.get("type") or "text").strip() or "text",
                "required": bool(item.get("required", False)),
                "help": "" if item.get("help") is None else str(item.get("help")).strip(),
                "options": item.get("options", []) if isinstance(item.get("options", []), list) else [],
                "source": str(item.get("source") or "").strip() or "template",
            }
        )

    src_answers = existing_answers if isinstance(existing_answers, dict) else {}
    preserved_answers = {
        str(k): v for k, v in src_answers.items() if str(k) in seen
    }

    return cleaned_questions, preserved_answers


def _save_model_if_needed(instance, update_fields: list[str]) -> None:
    if instance is None or not update_fields:
        return

    if hasattr(instance, "updated_at") and "updated_at" not in update_fields:
        update_fields.append("updated_at")

    instance.save(update_fields=update_fields)


def _persist_selected_template(agreement: Agreement, template: ProjectTemplate) -> None:
    """
    Persist the applied template selection onto the agreement using the actual schema.
    """
    update_fields: list[str] = []

    if hasattr(agreement, "selected_template"):
        agreement.selected_template = template
        update_fields.append("selected_template")

    if hasattr(agreement, "selected_template_name_snapshot"):
        agreement.selected_template_name_snapshot = template.name
        update_fields.append("selected_template_name_snapshot")

    _save_model_if_needed(agreement, update_fields)


def _hydrate_agreement_core_fields(
    agreement: Agreement,
    template: ProjectTemplate,
    *,
    overwrite_payment_settings: bool = False,
) -> None:
    """
    Copy template-level fields onto the agreement and linked project.

    Important:
    - Agreement model stores project_type/project_subtype snapshots.
    - Project title lives on agreement.project.title, not on Agreement directly.
    """
    agreement_update_fields: list[str] = []
    project_update_fields: list[str] = []

    template_type = (getattr(template, "project_type", None) or "").strip()
    template_subtype = (getattr(template, "project_subtype", None) or "").strip()
    template_description = (getattr(template, "description", None) or "").strip()
    template_name = (getattr(template, "name", None) or "").strip()
    template_payment_structure = (
        getattr(template, "payment_structure", None) or getattr(agreement, "payment_structure", "simple")
    )
    template_retainage_percent = _safe_decimal(
        getattr(template, "retainage_percent", None),
        getattr(agreement, "retainage_percent", Decimal("0.00")),
    ).quantize(Decimal("0.01"))
    current_payment_structure = str(getattr(agreement, "payment_structure", "simple") or "simple").strip().lower()
    current_retainage_percent = _safe_decimal(
        getattr(agreement, "retainage_percent", None),
        Decimal("0.00"),
    ).quantize(Decimal("0.01"))
    can_apply_template_payment_settings = overwrite_payment_settings or (
        current_payment_structure == "simple"
        and current_retainage_percent == Decimal("0.00")
        and not bool(getattr(agreement, "signed_by_contractor", False))
        and not bool(getattr(agreement, "signed_by_homeowner", False))
        and not bool(getattr(agreement, "escrow_funded", False))
        and not bool(getattr(agreement, "invoices").exists())
        and not bool(getattr(agreement, "draw_requests").exists())
        and not bool(getattr(agreement, "external_payment_records").exists())
    )

    if template_type and getattr(agreement, "project_type", "") != template_type:
      agreement.project_type = template_type
      agreement_update_fields.append("project_type")

    if template_subtype and (getattr(agreement, "project_subtype", "") or "") != template_subtype:
        agreement.project_subtype = template_subtype
        agreement_update_fields.append("project_subtype")

    if hasattr(agreement, "selected_template"):
        agreement.selected_template = template
        if "selected_template" not in agreement_update_fields:
            agreement_update_fields.append("selected_template")

    if hasattr(agreement, "selected_template_name_snapshot"):
        agreement.selected_template_name_snapshot = template.name
        if "selected_template_name_snapshot" not in agreement_update_fields:
            agreement_update_fields.append("selected_template_name_snapshot")

    if template_description and getattr(agreement, "description", "") != template_description:
        agreement.description = template_description
        agreement_update_fields.append("description")

    if can_apply_template_payment_settings and getattr(agreement, "payment_structure", None) != template_payment_structure:
        agreement.payment_structure = template_payment_structure
        agreement_update_fields.append("payment_structure")

    if can_apply_template_payment_settings and _safe_decimal(getattr(agreement, "retainage_percent", None), Decimal("0.00")).quantize(
        Decimal("0.01")
    ) != template_retainage_percent:
        agreement.retainage_percent = template_retainage_percent
        agreement_update_fields.append("retainage_percent")

    _save_model_if_needed(agreement, agreement_update_fields)

    project = getattr(agreement, "project", None)
    if project is not None and template_name:
        current_title = str(getattr(project, "title", "") or "").strip()
        if not current_title or current_title.lower() in {"untitled project", "draft agreement"}:
            if current_title != template_name:
                project.title = template_name
                project_update_fields.append("title")

    _save_model_if_needed(project, project_update_fields)


def _copy_template_text_fields(agreement: Agreement, template: ProjectTemplate) -> None:
    """
    Copy template scope/description into the agreement and persist clarification
    questions into AgreementAIScope while preserving only matching answers.
    """
    _hydrate_agreement_core_fields(agreement, template)

    if AgreementAIScope is None:
        return

    scope_obj, _created = AgreementAIScope.objects.get_or_create(agreement=agreement)

    incoming_scope_text = _safe_scope_text(template)
    incoming_questions = _safe_question_list(template)

    if incoming_scope_text and hasattr(scope_obj, "scope_text"):
        scope_obj.scope_text = incoming_scope_text

    scope_obj.questions, scope_obj.answers = _replace_questions_preserving_matching_answers(
        getattr(scope_obj, "answers", {}),
        incoming_questions,
    )

    scope_update_fields = ["questions", "answers"]
    if incoming_scope_text and hasattr(scope_obj, "scope_text"):
        scope_update_fields.append("scope_text")

    _save_model_if_needed(scope_obj, scope_update_fields)


def _extract_agreement_scope_text(agreement: Agreement) -> str:
    try:
        scope_obj = getattr(agreement, "ai_scope", None)
        txt = getattr(scope_obj, "scope_text", None) if scope_obj else None
        if txt and str(txt).strip():
            return str(txt).strip()
    except Exception:
        pass
    return (agreement.description or "").strip()


def _extract_agreement_clarification_questions(agreement: Agreement) -> list[dict]:
    try:
        scope_obj = getattr(agreement, "ai_scope", None)
        questions = getattr(scope_obj, "questions", None) if scope_obj else None
        if isinstance(questions, list):
            cleaned: list[dict] = []
            for q in questions:
                if not isinstance(q, dict):
                    continue
                key = str(q.get("key") or "").strip()
                if not key:
                    continue
                cleaned.append(
                    {
                        "key": key,
                        "label": str(q.get("label") or key.replace("_", " ").title()).strip(),
                        "type": str(q.get("type") or "text").strip() or "text",
                        "required": bool(q.get("required", False)),
                        "help": "" if q.get("help") is None else str(q.get("help")).strip(),
                        "options": q.get("options", []) if isinstance(q.get("options", []), list) else [],
                    }
                )
            return cleaned
    except Exception:
        pass
    return []


def _template_row_suggested_amount(row, agreement_total: Decimal) -> Decimal:
    if row.suggested_amount_fixed is not None:
        return _safe_decimal(row.suggested_amount_fixed)

    if row.suggested_amount_percent is not None and agreement_total > 0:
        return (
            agreement_total
            * _safe_decimal(row.suggested_amount_percent)
            / Decimal("100")
        ).quantize(Decimal("0.01"))

    return Decimal("0.00")


def _coerce_positive_int(value) -> Optional[int]:
    try:
        if value in (None, ""):
            return None
        n = int(value)
        return n if n > 0 else None
    except (TypeError, ValueError):
        return None


def _fallback_duration_days(row_start: date, due_date: date) -> int:
    if due_date < row_start:
        return 1
    return max((due_date - row_start).days + 1, 1)


def _resolve_row_schedule(
    *,
    agreement_start: date,
    fallback_start: date,
    fallback_due: date,
    row,
) -> tuple[date, date, timedelta, Optional[int], Optional[int]]:
    """
    Prefer row-level scheduling hints when present; otherwise fall back
    to even distribution across agreement date range.
    """
    hinted_offset = _coerce_positive_int(getattr(row, "recommended_days_from_start", None))
    hinted_duration = _coerce_positive_int(getattr(row, "recommended_duration_days", None))

    if hinted_offset is not None:
        row_start = agreement_start + timedelta(days=max(hinted_offset - 1, 0))
    else:
        row_start = fallback_start

    if hinted_duration is not None:
        due_date = row_start + timedelta(days=max(hinted_duration - 1, 0))
        duration_days = hinted_duration
    else:
        due_date = fallback_due
        duration_days = _fallback_duration_days(row_start, due_date)

    duration_delta = timedelta(days=max(duration_days, 1))
    return row_start, due_date, duration_delta, hinted_offset, hinted_duration


@transaction.atomic
def apply_template_to_agreement(
    agreement: Agreement,
    template: ProjectTemplate,
    *,
    overwrite_existing: bool = True,
    copy_text_fields: bool = True,
    estimated_days: Optional[int] = None,
    auto_schedule: bool = False,
    spread_enabled: bool = False,
    spread_total: Optional[Any] = None,
) -> dict:
    template_rows = list(template.milestones.all().order_by("sort_order", "id"))
    if not template_rows:
        raise ValueError("Selected template has no milestone rows.")

    preclear_milestone_total = _milestone_sum(agreement)
    deleted_count = 0
    if overwrite_existing:
        deleted_count = _clear_existing_milestones(agreement)

    _persist_selected_template(agreement, template)

    if copy_text_fields:
        _copy_template_text_fields(agreement, template)

    effective_estimated_days = _coerce_positive_int(estimated_days)
    spread_total_decimal = _safe_decimal(spread_total, Decimal("0.00"))
    use_spread_total = bool(spread_enabled and spread_total_decimal > 0)
    pricing_basis_total = _resolve_template_apply_pricing_basis(
        agreement,
        spread_enabled=spread_enabled,
        spread_total=spread_total_decimal,
        milestone_total_override=preclear_milestone_total,
    )

    if use_spread_total:
        amounts = _build_milestone_amounts_with_spread_total(template, spread_total_decimal)
    else:
        amounts = _build_milestone_amounts(template, pricing_basis_total)

    date_range = _resolve_date_range(
        agreement,
        template,
        estimated_days_override=effective_estimated_days,
    )
    applied_estimated_days = _date_range_duration_days(date_range)

    distributed_dates = distribute_milestone_dates(
        date_range.start_date,
        date_range.end_date,
        len(template_rows),
    )

    created = []
    for idx, row in enumerate(template_rows, start=1):
        fallback_due = distributed_dates[idx - 1]
        fallback_start = distributed_dates[idx - 2] if idx > 1 else date_range.start_date

        if auto_schedule:
            row_start, due_date, duration_delta, hinted_offset, hinted_duration = _resolve_row_schedule(
                agreement_start=date_range.start_date,
                fallback_start=fallback_start,
                fallback_due=fallback_due,
                row=row,
            )
        else:
            hinted_offset = _coerce_positive_int(getattr(row, "recommended_days_from_start", None))
            hinted_duration = _coerce_positive_int(getattr(row, "recommended_duration_days", None))
            row_start = None
            due_date = None
            duration_delta = None

        template_suggested_amount = _template_row_suggested_amount(
            row,
            spread_total_decimal if use_spread_total else pricing_basis_total,
        )

        milestone = Milestone.objects.create(
            agreement=agreement,
            order=idx,
            title=row.title,
            description=row.description or "",
            amount=amounts[idx - 1],
            start_date=row_start,
            completion_date=due_date,
            duration=duration_delta,
            normalized_milestone_type=(row.normalized_milestone_type or "").strip(),
            template_suggested_amount=template_suggested_amount if template_suggested_amount > 0 else None,
            ai_suggested_amount=amounts[idx - 1] if amounts[idx - 1] > 0 else None,
            suggested_amount_low=row.suggested_amount_low,
            suggested_amount_high=row.suggested_amount_high,
            pricing_confidence=(row.pricing_confidence or "").strip(),
            pricing_source_note=(row.pricing_source_note or "").strip(),
            recommended_days_from_start=hinted_offset,
            recommended_duration_days=hinted_duration,
            materials_hint=(row.materials_hint or "").strip(),
        )
        created.append(milestone)

    _sync_agreement_total_cost(agreement)
    agreement.start = date_range.start_date
    agreement.end = date_range.end_date
    agreement.milestone_count = len(created)

    update_fields = ["start", "end", "milestone_count"]
    if hasattr(agreement, "selected_template"):
        update_fields.append("selected_template")
    if hasattr(agreement, "selected_template_name_snapshot"):
        update_fields.append("selected_template_name_snapshot")

    _save_model_if_needed(agreement, update_fields)

    return {
        "template_id": template.id,
        "template_name": template.name,
        "selected_template_id": template.id,
        "selected_template_name_snapshot": template.name,
        "deleted_existing_count": deleted_count,
        "created_count": len(created),
        "milestone_ids": [m.id for m in created],
        "start_date": date_range.start_date,
        "end_date": date_range.end_date,
        "applied_estimated_days": applied_estimated_days,
        "auto_schedule": bool(auto_schedule),
        "spread_enabled": bool(use_spread_total),
        "spread_total": str(spread_total_decimal.quantize(Decimal("0.01"))) if use_spread_total else None,
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

    template_scope_text = _extract_agreement_scope_text(agreement)
    template_questions = _extract_agreement_clarification_questions(agreement)

    template = ProjectTemplate.objects.create(
        contractor=contractor,
        name=name.strip(),
        project_type=agreement.project_type or "",
        project_subtype=agreement.project_subtype or "",
        description=(description or agreement.description or "").strip(),
        estimated_days=estimated_days,
        payment_structure=getattr(agreement, "payment_structure", "simple") or "simple",
        retainage_percent=_safe_decimal(getattr(agreement, "retainage_percent", None), Decimal("0.00")),
        default_scope=template_scope_text,
        default_clarifications=template_questions,
        is_system=False,
        is_active=is_active,
        created_from_agreement=agreement,
    )

    milestone_qs = agreement.milestones.all().order_by("order", "id")
    for milestone in milestone_qs:
        ProjectTemplateMilestone = template.milestones.model

        recommended_days_from_start = None
        if milestone.start_date and start_date:
            try:
                recommended_days_from_start = max((milestone.start_date - start_date).days + 1, 1)
            except Exception:
                recommended_days_from_start = None

        recommended_duration_days = None
        if getattr(milestone, "recommended_duration_days", None):
            recommended_duration_days = milestone.recommended_duration_days
        elif getattr(milestone, "duration", None):
            try:
                recommended_duration_days = max(int(milestone.duration.days), 1)
            except Exception:
                recommended_duration_days = None
        elif milestone.start_date and milestone.completion_date:
            try:
                recommended_duration_days = max(
                    (milestone.completion_date - milestone.start_date).days + 1,
                    1,
                )
            except Exception:
                recommended_duration_days = None

        ProjectTemplateMilestone.objects.create(
            template=template,
            title=milestone.title,
            description=milestone.description or "",
            sort_order=milestone.order,
            recommended_days_from_start=recommended_days_from_start,
            recommended_duration_days=recommended_duration_days,
            suggested_amount_fixed=milestone.amount if milestone.amount and milestone.amount > 0 else None,
            normalized_milestone_type=(getattr(milestone, "normalized_milestone_type", "") or "").strip(),
            suggested_amount_low=getattr(milestone, "suggested_amount_low", None),
            suggested_amount_high=getattr(milestone, "suggested_amount_high", None),
            pricing_confidence=(getattr(milestone, "pricing_confidence", "") or "").strip(),
            pricing_source_note=(getattr(milestone, "pricing_source_note", "") or "").strip(),
            materials_hint=(getattr(milestone, "materials_hint", "") or "").strip(),
        )

    return template
