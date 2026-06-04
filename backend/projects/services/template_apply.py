from __future__ import annotations

from dataclasses import dataclass
from datetime import date, timedelta
from decimal import Decimal, InvalidOperation
import re
from typing import Optional, Any

from django.db import transaction
from django.db.models import Sum
from django.utils import timezone

from projects.models import Agreement, Contractor, Milestone
from projects.models_templates import ProjectTemplate
from projects.services.milestone_roles import infer_milestone_role, normalize_milestone_role
from projects.services.regions import build_normalized_region_key

try:
    from projects.models_ai_scope import AgreementAIScope
except Exception:  # pragma: no cover
    AgreementAIScope = None  # type: ignore


@dataclass
class DateRange:
    start_date: date
    end_date: date


TEMPLATE_APPLICATION_MODE_ENHANCE = "enhance"
TEMPLATE_APPLICATION_MODE_REPLACE_SCOPE = "replace_scope"
TEMPLATE_APPLICATION_MODE_REPLACE_IDENTITY = "replace_identity"
TEMPLATE_APPLICATION_MODES = {
    TEMPLATE_APPLICATION_MODE_ENHANCE,
    TEMPLATE_APPLICATION_MODE_REPLACE_SCOPE,
    TEMPLATE_APPLICATION_MODE_REPLACE_IDENTITY,
}


def normalize_template_application_mode(value: Any) -> str:
    mode = str(value or TEMPLATE_APPLICATION_MODE_ENHANCE).strip().lower()
    return mode if mode in TEMPLATE_APPLICATION_MODES else TEMPLATE_APPLICATION_MODE_ENHANCE


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


def user_can_use_template_ai(user) -> bool:
    """
    Template AI tools are available to contractors and admin/staff users.
    """
    if user is None or not getattr(user, "is_authenticated", False):
        return False

    if getattr(user, "is_staff", False) or getattr(user, "is_superuser", False):
        return True

    return get_request_contractor(user) is not None


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


def _normalize_project_mode(value: Any) -> str:
    text = str(value or "").strip().lower()
    if text in {"assisted_diy", "diy_assistance", "diy", "diy_help", "diyhelp"}:
        return "assisted_diy"
    if text in {"consultation", "consultation_only", "consult"}:
        return "consultation"
    if text in {"inspection", "inspection_only", "inspection_only_work"}:
        return "inspection_only"
    return "full_service"


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
    start_date_override: Optional[date] = None,
) -> DateRange:
    today = timezone.localdate()

    original_start = start_date_override or agreement.start or today
    start_date = original_start if original_start >= today else today
    end_date = agreement.end

    if start_date_override is not None:
        end_date = None

    if end_date is None:
        effective_estimated_days = estimated_days_override or int(template.estimated_days or 1)
        effective_estimated_days = max(int(effective_estimated_days), 1)
        end_date = start_date + timedelta(days=max(effective_estimated_days - 1, 0))
    elif start_date != original_start:
        end_date = agreement.end + (start_date - original_start)

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
        (
            bool(getattr(row, "pricing_advisory", False))
            and (
                row.suggested_amount_fixed is not None
                or row.suggested_amount_percent is not None
                or row.suggested_amount_low is not None
                or row.suggested_amount_high is not None
            )
        )
        or row.suggested_amount_percent is not None
        for row in rows
    )

    if has_amount_hints:
        amounts: list[Decimal] = []
        remaining = agreement_total
        unresolved_indexes: list[int] = []

        for idx, row in enumerate(rows):
            if getattr(row, "pricing_advisory", False) and row.suggested_amount_fixed is not None:
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


_MEASUREMENT_PATTERNS = [
    re.compile(r"\b\d+(?:\.\d+)?\s*(?:x|×)\s*\d+(?:\.\d+)?(?:\s*(?:x|×)\s*\d+(?:\.\d+)?)?\b", re.I),
    re.compile(r"\b\d+(?:\.\d+)?\s*(?:sq\.?\s*ft|sq ft|square feet|square foot|sf|ft|feet|foot|in|inch|inches|yd|yard|yards)\b", re.I),
    re.compile(r"\b\d+\s*(?:count|counts|pcs?|pieces|units)\b", re.I),
]


def _genericize_scope_text(scope_text: str) -> str:
    text = str(scope_text or "").strip()
    if not text:
        return ""

    generic = text
    for pattern in _MEASUREMENT_PATTERNS:
        generic = pattern.sub("standard size", generic)

    generic = re.sub(r"\s{2,}", " ", generic)
    generic = re.sub(r"\s+,", ",", generic)
    generic = re.sub(r"\s+\.", ".", generic)
    return generic.strip(" ,;:-")


def _coerce_template_offset(value) -> Optional[int]:
    try:
        if value in (None, ""):
            return None
        n = int(value)
        return n if n >= 0 else None
    except (TypeError, ValueError):
        return None


def _coerce_template_duration(value) -> Optional[int]:
    try:
        if value in (None, ""):
            return None
        n = int(value)
        return n if n > 0 else None
    except (TypeError, ValueError):
        return None


def _resolve_template_milestone_offset(row) -> Optional[int]:
    offset = _coerce_template_offset(getattr(row, "start_offset", None))
    if offset is not None:
        return offset

    legacy_days = _coerce_template_offset(getattr(row, "recommended_days_from_start", None))
    if legacy_days is None:
        return None

    return max(legacy_days - 1, 0)


def _resolve_template_milestone_duration(row) -> Optional[int]:
    duration = _coerce_template_duration(getattr(row, "duration_days", None))
    if duration is not None:
        return duration
    return _coerce_template_duration(getattr(row, "recommended_duration_days", None))


def _safe_text(value: Any) -> str:
    return str(value or "").strip()


def _shorten_text(value: Any, limit: int = 180) -> str:
    text = re.sub(r"\s+", " ", _safe_text(value))
    if len(text) <= limit:
        return text
    return text[: max(limit - 3, 0)].rstrip(" ,.;:-") + "..."


def _is_thin_template_milestone_description(row) -> bool:
    description = _safe_text(getattr(row, "description", ""))
    title = _safe_text(getattr(row, "title", ""))
    if not description:
        return True
    normalized_description = re.sub(r"[^a-z0-9]+", " ", description.lower()).strip()
    normalized_title = re.sub(r"[^a-z0-9]+", " ", title.lower()).strip()
    return len(description) < 28 or bool(normalized_title and normalized_description == normalized_title)


def _build_enriched_template_milestone_description(
    *,
    agreement: Agreement,
    template: ProjectTemplate,
    row,
) -> str:
    existing = _safe_text(getattr(row, "description", ""))
    if existing and not _is_thin_template_milestone_description(row):
        return existing

    title = _safe_text(getattr(row, "title", "")) or "Milestone"
    project_title = _safe_text(getattr(agreement, "project_title", "")) or _safe_text(
        getattr(getattr(agreement, "project", None), "title", "")
    )
    project_scope = _safe_text(getattr(agreement, "description", "")) or _safe_scope_text(template)
    template_scope = _safe_scope_text(template)
    materials_hint = _safe_text(getattr(row, "materials_hint", "")) or _safe_text(
        getattr(template, "project_materials_hint", "")
    )

    lines = []
    if project_title:
        lines.append(f"{title} for {project_title}.")
    else:
        lines.append(f"{title} for the selected project scope.")

    if project_scope:
        lines.append(f"Project context: {_shorten_text(project_scope)}")
    elif template_scope:
        lines.append(f"Template scope: {_shorten_text(template_scope)}")

    if materials_hint:
        lines.append(f"Materials / planning notes: {_shorten_text(materials_hint, 140)}")

    return "\n".join(lines).strip()


def _infer_milestone_duration_days(milestone: Milestone) -> int:
    hinted = _coerce_template_duration(getattr(milestone, "recommended_duration_days", None))
    if hinted is not None:
        return hinted

    duration = getattr(milestone, "duration", None)
    if duration is not None:
        try:
            duration_days = int(duration.days)
            if duration_days > 0:
                return duration_days
        except Exception:
            pass

    if milestone.start_date and milestone.completion_date:
        try:
            return max((milestone.completion_date - milestone.start_date).days + 1, 1)
        except Exception:
            pass

    return 1


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
    application_mode: str = TEMPLATE_APPLICATION_MODE_ENHANCE,
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
    mode = normalize_template_application_mode(application_mode)
    can_replace_identity = mode == TEMPLATE_APPLICATION_MODE_REPLACE_IDENTITY
    can_replace_scope = mode == TEMPLATE_APPLICATION_MODE_REPLACE_SCOPE

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

    current_type = str(getattr(agreement, "project_type", "") or "").strip()
    current_subtype = str(getattr(agreement, "project_subtype", "") or "").strip()
    current_description = str(getattr(agreement, "description", "") or "").strip()

    if template_type and (can_replace_identity or not current_type) and current_type != template_type:
        agreement.project_type = template_type
        agreement_update_fields.append("project_type")

    if template_subtype and (can_replace_identity or not current_subtype) and current_subtype != template_subtype:
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

    if template_description and (can_replace_scope or not current_description) and current_description != template_description:
        agreement.description = template_description
        agreement_update_fields.append("description")

    if hasattr(agreement, "step_status"):
        if getattr(agreement, "step_status", "") != "step1":
            agreement.step_status = "step1"
            agreement_update_fields.append("step_status")

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
        if can_replace_identity or not current_title or current_title.lower() in {"untitled project", "draft agreement"}:
            if current_title != template_name:
                project.title = template_name
                project_update_fields.append("title")

    _save_model_if_needed(project, project_update_fields)


def _copy_template_text_fields(
    agreement: Agreement,
    template: ProjectTemplate,
    *,
    application_mode: str = TEMPLATE_APPLICATION_MODE_ENHANCE,
) -> None:
    """
    Copy template scope/description into the agreement and persist clarification
    questions into AgreementAIScope while preserving only matching answers.
    """
    mode = normalize_template_application_mode(application_mode)
    _hydrate_agreement_core_fields(agreement, template, application_mode=mode)

    if AgreementAIScope is None:
        return

    scope_obj, _created = AgreementAIScope.objects.get_or_create(agreement=agreement)

    incoming_scope_text = _safe_scope_text(template)
    incoming_questions = _safe_question_list(template)
    current_scope_text = str(getattr(scope_obj, "scope_text", "") or "").strip()
    can_replace_scope = mode == TEMPLATE_APPLICATION_MODE_REPLACE_SCOPE

    if incoming_scope_text and hasattr(scope_obj, "scope_text") and (can_replace_scope or not current_scope_text):
        scope_obj.scope_text = incoming_scope_text

    scope_obj.questions, scope_obj.answers = _replace_questions_preserving_matching_answers(
        getattr(scope_obj, "answers", {}),
        incoming_questions,
    )

    scope_update_fields = ["questions", "answers"]
    if incoming_scope_text and hasattr(scope_obj, "scope_text") and (can_replace_scope or not current_scope_text):
        scope_update_fields.append("scope_text")

    _save_model_if_needed(scope_obj, scope_update_fields)


@transaction.atomic
def duplicate_template_for_contractor(
    *,
    contractor: Contractor | None,
    source_template: ProjectTemplate,
    template_data: dict[str, Any] | None = None,
    is_active: bool = True,
    is_system: bool = False,
    is_published: bool = False,
) -> ProjectTemplate:
    """
    Create a contractor-owned copy of a source template.

    The caller can pass edited template_data from an open draft. Any fields not
    supplied fall back to the source template so system templates can be copied
    cleanly into the contractor's library.
    """
    template_data = template_data or {}

    milestone_rows = template_data.get("milestones")
    if not isinstance(milestone_rows, list) or not milestone_rows:
        milestone_rows = [
            {
                "title": m.title,
                "description": m.description or "",
                "sort_order": m.sort_order,
                "start_offset": getattr(m, "start_offset", None),
                "duration_days": getattr(m, "duration_days", None),
                "recommended_days_from_start": m.recommended_days_from_start,
                "recommended_duration_days": m.recommended_duration_days,
                "suggested_amount_percent": m.suggested_amount_percent,
                "suggested_amount_fixed": m.suggested_amount_fixed,
                "pricing_advisory": getattr(m, "pricing_advisory", False),
                "normalized_milestone_type": m.normalized_milestone_type or "",
                "suggested_amount_low": m.suggested_amount_low,
                "suggested_amount_high": m.suggested_amount_high,
                "pricing_confidence": m.pricing_confidence or "",
                "pricing_source_note": m.pricing_source_note or "",
                "materials_hint": m.materials_hint or "",
                "is_optional": m.is_optional,
            }
            for m in source_template.milestones.all().order_by("sort_order", "id")
        ]
    milestone_rows = sequence_template_milestone_dicts(milestone_rows)

    template = ProjectTemplate.objects.create(
        contractor=contractor,
        name=(str(template_data.get("name") or "").strip() or source_template.name).strip(),
        project_type=str(template_data.get("project_type") or source_template.project_type or "").strip(),
        project_subtype=str(template_data.get("project_subtype") or source_template.project_subtype or "").strip(),
        description=str(template_data.get("description") or source_template.description or "").strip(),
        estimated_days=int(template_data.get("estimated_days") or source_template.estimated_days or 1),
        payment_structure=str(template_data.get("payment_structure") or source_template.payment_structure or "simple"),
        retainage_percent=_safe_decimal(
            template_data.get("retainage_percent", source_template.retainage_percent),
            Decimal("0.00"),
        ),
        default_scope=str(template_data.get("default_scope") or source_template.default_scope or "").strip(),
        exclusions_text=str(template_data.get("exclusions_text") or source_template.exclusions_text or "").strip(),
        assumptions_text=str(template_data.get("assumptions_text") or source_template.assumptions_text or "").strip(),
        default_clarifications=template_data.get("default_clarifications")
        if isinstance(template_data.get("default_clarifications"), list)
        else list(source_template.default_clarifications or []),
        workflow_profile=template_data.get("workflow_profile")
        if isinstance(template_data.get("workflow_profile"), dict)
        else dict(getattr(source_template, "workflow_profile", {}) or {}),
        project_materials_hint=str(
            template_data.get("project_materials_hint") or source_template.project_materials_hint or ""
        ).strip(),
        is_system=bool(is_system),
        is_system_template=bool(is_system),
        is_published=bool(is_published) if is_system else False,
        is_active=is_active,
        visibility=ProjectTemplate.Visibility.SYSTEM if is_system else ProjectTemplate.Visibility.PRIVATE,
        allow_discovery=bool(is_published) if is_system else False,
        source_system_template=source_template if source_template.is_system_template or source_template.is_system else None,
        created_from_agreement=None,
        benchmark_profile=getattr(source_template, "benchmark_profile", None),
        benchmark_match_key=str(source_template.benchmark_match_key or "").strip(),
        normalized_region_key=str(source_template.normalized_region_key or "").strip(),
        region_tags=list(template_data.get("region_tags") or source_template.region_tags or []),
        published_at=timezone.now() if is_system and is_published else None,
        published_by=None,
    )

    ProjectTemplateMilestone = template.milestones.model
    for idx, row in enumerate(milestone_rows, start=1):
        if not isinstance(row, dict):
            continue
        ProjectTemplateMilestone.objects.create(
            template=template,
            sort_order=row.get("sort_order") or idx,
            title=str(row.get("title") or "").strip(),
            description=str(row.get("description") or "").strip(),
            start_offset=row.get("start_offset"),
            duration_days=row.get("duration_days"),
            recommended_days_from_start=row.get("recommended_days_from_start"),
            recommended_duration_days=row.get("recommended_duration_days"),
            suggested_amount_percent=row.get("suggested_amount_percent"),
            suggested_amount_fixed=row.get("suggested_amount_fixed"),
            pricing_advisory=bool(row.get("pricing_advisory", False)),
            normalized_milestone_type=str(row.get("normalized_milestone_type") or "").strip(),
            suggested_amount_low=row.get("suggested_amount_low"),
            suggested_amount_high=row.get("suggested_amount_high"),
            pricing_confidence=str(row.get("pricing_confidence") or "").strip(),
            pricing_source_note=str(row.get("pricing_source_note") or "").strip(),
            materials_hint=str(row.get("materials_hint") or "").strip(),
            is_optional=bool(row.get("is_optional", False)),
        )

    return template


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


def _workflow_profile_for_agreement(agreement: Agreement) -> dict[str, Any]:
    selected_template = getattr(agreement, "selected_template", None)
    workflow_profile = getattr(selected_template, "workflow_profile", None) if selected_template else None
    if isinstance(workflow_profile, dict) and workflow_profile:
        return dict(workflow_profile)

    mode = _normalize_project_mode(getattr(agreement, "project_mode", ""))
    if mode == "consultation":
        return {
            "assistance_format": "consultation_only",
            "scheduling_mode": "session_based",
            "billing_style": "consultation",
            "participation_structure": ["shared_tasks", "inspection_review_checkpoints"],
            "workflow_notes": "Consultation-only workflows should stay review focused and contractor-led.",
        }
    if mode == "inspection_only":
        return {
            "assistance_format": "consultation_only",
            "scheduling_mode": "session_based",
            "billing_style": "consultation",
            "participation_structure": ["inspection_review_checkpoints"],
            "workflow_notes": "Inspection-only workflows should focus on review, signoff, and follow-up.",
        }
    if mode == "assisted_diy":
        return {
            "assistance_format": "milestone_based",
            "scheduling_mode": "milestone_driven",
            "billing_style": "milestone",
            "participation_structure": [
                "homeowner_prep",
                "shared_tasks",
                "contractor_led_technical_work",
                "inspection_review_checkpoints",
            ],
            "workflow_notes": "Flexible assisted DIY workflow with homeowner participation and contractor-led technical work.",
        }
    return {
        "assistance_format": "full_day",
        "scheduling_mode": "daily",
        "billing_style": "daily",
        "participation_structure": ["contractor_led_technical_work", "inspection_review_checkpoints"],
        "workflow_notes": "Standard full-service workflow with contractor-led phases and review checkpoints.",
    }


def _template_row_suggested_amount(row, agreement_total: Decimal) -> Decimal:
    if getattr(row, "pricing_advisory", False) and row.suggested_amount_fixed is not None:
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


def _template_milestones_need_sequence(rows: list[Any]) -> bool:
    if len(rows) <= 1:
        return False
    saw_positive_offset = False
    saw_any_offset = False
    for row in rows:
        offset = _coerce_template_offset(getattr(row, "start_offset", None))
        if offset is None:
            offset = _coerce_template_offset(getattr(row, "recommended_days_from_start", None))
        if offset is None:
            continue
        saw_any_offset = True
        if offset > 0:
            saw_positive_offset = True
            break
    return saw_any_offset and not saw_positive_offset


def sequence_template_milestone_dicts(rows: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """
    Sequence blank or zero-offset milestone payloads while preserving any
    manual positive offsets the caller already supplied.
    """
    if len(rows) <= 1:
        return rows

    for row in rows:
        start_offset = _coerce_template_offset(row.get("start_offset"))
        if start_offset is None:
            start_offset = _coerce_template_offset(row.get("recommended_days_from_start"))
            if start_offset is not None:
                start_offset = max(start_offset - 1, 0)
        if start_offset is not None and start_offset > 0:
            return rows

    sequenced: list[dict[str, Any]] = []
    current_offset = 0
    for idx, row in enumerate(rows, start=1):
        duration_days = max(
            _coerce_positive_int(row.get("duration_days"))
            or _coerce_positive_int(row.get("recommended_duration_days"))
            or 1,
            1,
        )
        next_row = dict(row)
        next_row["sort_order"] = row.get("sort_order") or idx
        next_row["start_offset"] = current_offset
        next_row["duration_days"] = duration_days
        next_row["recommended_days_from_start"] = current_offset + 1
        next_row["recommended_duration_days"] = duration_days
        sequenced.append(next_row)
        current_offset += duration_days
    return sequenced


def _compute_sequential_offsets(rows: list[Any]) -> list[dict[str, Any]]:
    sequenced: list[dict[str, Any]] = []
    current_offset = 0
    for idx, row in enumerate(rows, start=1):
        duration_days = max(
            _coerce_positive_int(getattr(row, "duration_days", None))
            or _coerce_positive_int(getattr(row, "recommended_duration_days", None))
            or 1,
            1,
        )
        sequenced.append(
            {
                "row": row,
                "start_offset": current_offset,
                "duration_days": duration_days,
                "recommended_days_from_start": current_offset + 1,
                "recommended_duration_days": duration_days,
                "sort_order": getattr(row, "sort_order", idx) or idx,
            }
        )
        current_offset += duration_days
    return sequenced


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
    hinted_offset = _resolve_template_milestone_offset(row)
    hinted_duration = _resolve_template_milestone_duration(row)

    if hinted_offset is not None:
        row_start = agreement_start + timedelta(days=max(hinted_offset, 0))
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
    application_mode: str = TEMPLATE_APPLICATION_MODE_ENHANCE,
    overwrite_existing: bool = True,
    copy_text_fields: bool = True,
    estimated_days: Optional[int] = None,
    start_date_override: Optional[date] = None,
    auto_schedule: bool = False,
    spread_enabled: bool = False,
    spread_total: Optional[Any] = None,
) -> dict:
    application_mode = normalize_template_application_mode(application_mode)
    template_rows = list(template.milestones.all().order_by("sort_order", "id"))
    if not template_rows:
        raise ValueError("Selected template has no milestone rows.")

    if _template_milestones_need_sequence(template_rows):
        sequenced_rows = _compute_sequential_offsets(template_rows)
        for item in sequenced_rows:
            row = item["row"]
            row.start_offset = item["start_offset"]
            row.duration_days = item["duration_days"]
            row.recommended_days_from_start = item["recommended_days_from_start"]
            row.recommended_duration_days = item["recommended_duration_days"]
            row.sort_order = item["sort_order"]

    preclear_milestone_total = _milestone_sum(agreement)
    deleted_count = 0
    if overwrite_existing:
        deleted_count = _clear_existing_milestones(agreement)

    _persist_selected_template(agreement, template)

    if copy_text_fields:
        _copy_template_text_fields(
            agreement,
            template,
            application_mode=application_mode,
        )

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
        start_date_override=start_date_override,
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
            hinted_offset = _resolve_template_milestone_offset(row)
            hinted_duration = _resolve_template_milestone_duration(row)
            row_start = None
            due_date = None
            duration_delta = None

        template_suggested_amount = _template_row_suggested_amount(
            row,
            spread_total_decimal if use_spread_total else pricing_basis_total,
        )
        milestone_description = _build_enriched_template_milestone_description(
            agreement=agreement,
            template=template,
            row=row,
        )

        milestone = Milestone.objects.create(
            agreement=agreement,
            order=idx,
            title=row.title,
            description=milestone_description,
            amount=amounts[idx - 1],
            start_date=row_start,
            completion_date=due_date,
            duration=duration_delta,
            normalized_milestone_type=(row.normalized_milestone_type or "").strip(),
            milestone_role=normalize_milestone_role(getattr(row, "milestone_role", "")) or infer_milestone_role(
                project_mode=getattr(agreement, "project_mode", ""),
                title=row.title,
                description=milestone_description,
                normalized_milestone_type=(row.normalized_milestone_type or "").strip(),
            ),
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
        "application_mode": application_mode,
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
    scope_description: str = "",
    is_active: bool = True,
) -> ProjectTemplate:
    if not name or not str(name).strip():
        raise ValueError("Template name is required.")

    raw_scope_text = (scope_description or _extract_agreement_scope_text(agreement) or "").strip()
    template_scope_text = _genericize_scope_text(raw_scope_text)
    template_questions = _extract_agreement_clarification_questions(agreement)
    milestone_qs = list(agreement.milestones.all().order_by("order", "id"))
    estimated_days = max(sum(_infer_milestone_duration_days(m) for m in milestone_qs), 1)

    template = ProjectTemplate.objects.create(
        contractor=contractor,
        name=name.strip(),
        project_type=agreement.project_type or "",
        project_subtype=agreement.project_subtype or "",
        description=(description or "").strip(),
        estimated_days=estimated_days,
        payment_structure=getattr(agreement, "payment_structure", "simple") or "simple",
        retainage_percent=_safe_decimal(getattr(agreement, "retainage_percent", None), Decimal("0.00")),
        default_scope=template_scope_text,
        default_clarifications=template_questions,
        workflow_profile=_workflow_profile_for_agreement(agreement),
        is_system=False,
        is_active=is_active,
        visibility=ProjectTemplate.Visibility.PRIVATE,
        allow_discovery=False,
        created_from_agreement=agreement,
        source_system_template=agreement.selected_template if getattr(getattr(agreement, "selected_template", None), "is_system", False) else None,
        benchmark_profile=getattr(getattr(agreement, "selected_template", None), "benchmark_profile", None),
        benchmark_match_key=(
            getattr(getattr(agreement, "selected_template", None), "benchmark_match_key", "")
            or f"{agreement.project_type}:{agreement.project_subtype}".lower()
        ),
        normalized_region_key=build_normalized_region_key(
            country="US",
            state=(
                getattr(agreement, "project_address_state", "")
                or getattr(getattr(agreement, "project", None), "project_state", "")
                or getattr(contractor, "state", "")
            ),
            city=(
                getattr(agreement, "project_address_city", "")
                or getattr(getattr(agreement, "project", None), "project_city", "")
                or getattr(contractor, "city", "")
            ),
        ),
        region_tags=list(getattr(getattr(agreement, "selected_template", None), "region_tags", []) or []),
    )

    sequential_offset = 0
    for milestone in milestone_qs:
        ProjectTemplateMilestone = template.milestones.model

        duration_days = _infer_milestone_duration_days(milestone)

        ProjectTemplateMilestone.objects.create(
            template=template,
            title=milestone.title,
            description=milestone.description or "",
            sort_order=milestone.order,
            start_offset=sequential_offset,
            duration_days=duration_days,
            recommended_days_from_start=sequential_offset + 1,
            recommended_duration_days=duration_days,
            suggested_amount_fixed=None,
            suggested_amount_percent=None,
            suggested_amount_low=None,
            suggested_amount_high=None,
            pricing_advisory=False,
            normalized_milestone_type=(getattr(milestone, "normalized_milestone_type", "") or "").strip(),
            pricing_confidence="",
            pricing_source_note="",
            materials_hint=(getattr(milestone, "materials_hint", "") or "").strip(),
        )
        sequential_offset += max(duration_days, 1)

    return template
