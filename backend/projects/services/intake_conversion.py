from __future__ import annotations

from decimal import Decimal
from typing import Any

from django.db import transaction
from django.utils import timezone

from projects.models import Agreement, Homeowner, Milestone, Project
from projects.models_project_intake import ProjectIntake
from projects.models_templates import ProjectTemplate


def _safe_str(value: Any) -> str:
    if value is None:
        return ""
    return str(value).strip()


def _to_decimal(value: Any) -> Decimal:
    try:
        if value in (None, "", False):
            return Decimal("0.00")
        return Decimal(str(value))
    except Exception:
        return Decimal("0.00")


def _ensure_homeowner_from_intake(intake: ProjectIntake) -> Homeowner:
    if intake.homeowner_id:
        homeowner = intake.homeowner
        changed = False

        if homeowner:
            name = _safe_str(intake.customer_name)
            email = _safe_str(intake.customer_email)
            phone = _safe_str(intake.customer_phone)

            if name and getattr(homeowner, "full_name", "") != name:
                homeowner.full_name = name
                changed = True
            if email and getattr(homeowner, "email", "") != email:
                homeowner.email = email
                changed = True
            if phone and getattr(homeowner, "phone_number", "") != phone:
                homeowner.phone_number = phone
                changed = True

            if _safe_str(intake.customer_address_line1):
                homeowner.street_address = _safe_str(intake.customer_address_line1)
                changed = True
            if _safe_str(intake.customer_city):
                homeowner.city = _safe_str(intake.customer_city)
                changed = True
            if _safe_str(intake.customer_state):
                homeowner.state = _safe_str(intake.customer_state)
                changed = True
            if _safe_str(intake.customer_postal_code):
                homeowner.zip_code = _safe_str(intake.customer_postal_code)
                changed = True

            if changed:
                homeowner.save()

            return homeowner

    return Homeowner.objects.create(
        full_name=_safe_str(intake.customer_name) or "New Customer",
        email=_safe_str(intake.customer_email),
        phone_number=_safe_str(intake.customer_phone),
        street_address=_safe_str(intake.customer_address_line1),
        city=_safe_str(intake.customer_city),
        state=_safe_str(intake.customer_state),
        zip_code=_safe_str(intake.customer_postal_code),
        status="active",
    )


def _build_project_title(intake: ProjectIntake) -> str:
    return (
        _safe_str(intake.ai_project_title)
        or _safe_str(intake.accomplishment_text)[:80]
        or "New Project"
    )


def _create_project_for_agreement(*, intake: ProjectIntake, homeowner: Homeowner):
    contractor = intake.contractor
    title = _build_project_title(intake)

    project = Project.objects.create(
        contractor=contractor,
        homeowner=homeowner,
        title=title,
        status="draft",
    )
    return project


def _apply_template_milestones(*, agreement: Agreement, template: ProjectTemplate):
    for idx, tpl_ms in enumerate(template.milestones.all().order_by("sort_order", "id"), start=1):
        amount = Decimal("0.00")

        fixed = getattr(tpl_ms, "suggested_amount_fixed", None)
        if fixed not in (None, ""):
            amount = _to_decimal(fixed)

        Milestone.objects.create(
            agreement=agreement,
            order=getattr(tpl_ms, "sort_order", idx) or idx,
            title=_safe_str(getattr(tpl_ms, "title", "")) or f"Milestone {idx}",
            description=_safe_str(getattr(tpl_ms, "description", "")),
            amount=amount,
            start_date=None,
            completion_date=None,
            completed=False,
            is_invoiced=False,
        )


def _apply_ai_milestones(*, agreement: Agreement, milestones_payload: list[dict[str, Any]]):
    for idx, row in enumerate(milestones_payload or [], start=1):
        Milestone.objects.create(
            agreement=agreement,
            order=int(row.get("sort_order") or row.get("order") or idx),
            title=_safe_str(row.get("title")) or f"Milestone {idx}",
            description=_safe_str(row.get("description")),
            amount=_to_decimal(row.get("suggested_amount_fixed")),
            start_date=None,
            completion_date=None,
            completed=False,
            is_invoiced=False,
        )


@transaction.atomic
def convert_intake_to_agreement(
    *,
    intake: ProjectIntake,
    use_recommended_template: bool = True,
    template_id_override: int | None = None,
) -> Agreement:
    if intake.agreement_id:
        return intake.agreement

    homeowner = _ensure_homeowner_from_intake(intake)
    project = _create_project_for_agreement(intake=intake, homeowner=homeowner)

    agreement = Agreement.objects.create(
        project=project,
        contractor=intake.contractor,
        homeowner=homeowner,
        project_title=_build_project_title(intake),
        project_type=_safe_str(intake.ai_project_type),
        project_subtype=_safe_str(intake.ai_project_subtype),
        description=_safe_str(intake.ai_description) or _safe_str(intake.accomplishment_text),
        address_line1=_safe_str(intake.project_address_line1),
        address_line2=_safe_str(intake.project_address_line2),
        address_city=_safe_str(intake.project_city),
        address_state=_safe_str(intake.project_state),
        address_postal_code=_safe_str(intake.project_postal_code),
        payment_mode="escrow",
        status="draft",
    )

    template_id = template_id_override if template_id_override else (
        intake.ai_recommended_template_id if use_recommended_template else None
    )
    if template_id:
        try:
            template = ProjectTemplate.objects.prefetch_related("milestones").get(id=template_id)
            _apply_template_milestones(agreement=agreement, template=template)
        except ProjectTemplate.DoesNotExist:
            _apply_ai_milestones(agreement=agreement, milestones_payload=intake.ai_milestones or [])
    else:
        _apply_ai_milestones(agreement=agreement, milestones_payload=intake.ai_milestones or [])

    intake.homeowner = homeowner
    intake.agreement = agreement
    intake.status = "converted"
    intake.converted_at = timezone.now()
    intake.save(update_fields=["homeowner", "agreement", "status", "converted_at", "updated_at"])

    return agreement
