# backend/projects/views/employee_agreements.py
# v2026-01-09 — employee “My Agreements” (supervisors can oversee multiple agreements)

from __future__ import annotations

from rest_framework.decorators import api_view, permission_classes
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.exceptions import PermissionDenied

from projects.models import (
    Agreement,
    Milestone,
    AgreementAssignment,
    MilestoneAssignment,
)
from projects.utils.accounts import get_subaccount_for_user
from projects.utils.subaccount_scope import get_visible_milestones_for_subaccount


def _require_active_subaccount(request):
    sub = get_subaccount_for_user(request.user)
    if sub is None:
        raise PermissionDenied("Employee subaccount required.")
    if not getattr(sub, "is_active", False):
        raise PermissionDenied("Employee account inactive.")
    return sub


def _pick(*vals):
    for v in vals:
        if v is None:
            continue
        if isinstance(v, str) and v.strip() == "":
            continue
        return v
    return None


def _agreement_title(ag: Agreement):
    proj = getattr(ag, "project", None)
    return _pick(
        getattr(proj, "title", None),
        getattr(ag, "project_title", None),
        getattr(ag, "title", None),
        f"Agreement #{ag.id}",
    )


def _customer_name(ag: Agreement):
    homeowner = getattr(ag, "homeowner", None)
    return _pick(
        getattr(homeowner, "full_name", None),
        getattr(ag, "homeowner_name", None),
        getattr(ag, "customer_name", None),
    )


def _address(ag: Agreement):
    parts = []
    line1 = _pick(getattr(ag, "project_address_line1", None), None)
    line2 = _pick(getattr(ag, "project_address_line2", None), None)
    city = _pick(getattr(ag, "project_address_city", None), None)
    state = _pick(getattr(ag, "project_address_state", None), None)
    zip_code = _pick(getattr(ag, "project_postal_code", None), None)

    proj = getattr(ag, "project", None)
    if not any([line1, city, state, zip_code]) and proj is not None:
        line1 = _pick(line1, getattr(proj, "project_street_address", None))
        line2 = _pick(line2, getattr(proj, "project_address_line_2", None))
        city = _pick(city, getattr(proj, "project_city", None))
        state = _pick(state, getattr(proj, "project_state", None))
        zip_code = _pick(zip_code, getattr(proj, "project_zip_code", None))

    if line1:
        parts.append(str(line1).strip())
    if line2:
        parts.append(str(line2).strip())
    cs = " ".join([p for p in [city, state, zip_code] if p and str(p).strip()])
    if cs.strip():
        parts.append(cs.strip())

    return " • ".join(parts) if parts else None


@api_view(["GET"])
@permission_classes([IsAuthenticated])
def my_agreements(request):
    """
    GET /api/projects/employee/agreements/

    Returns agreements visible to the employee:
      - agreement assignments (supervisor/foreman use-case)
      - OR agreements containing milestones explicitly assigned to them (worker use-case)
    """
    sub = _require_active_subaccount(request)

    # Agreements assigned directly
    assigned_agreement_ids = AgreementAssignment.objects.filter(
        subaccount=sub
    ).values_list("agreement_id", flat=True)

    # Agreements implied by milestone assignment
    milestone_agreement_ids = MilestoneAssignment.objects.filter(
        subaccount=sub
    ).values_list("milestone__agreement_id", flat=True)

    ag_ids = list(set(list(assigned_agreement_ids) + list(milestone_agreement_ids)))
    if not ag_ids:
        return Response({"agreements": []})

    qs = (
        Agreement.objects.filter(id__in=ag_ids)
        .select_related("project", "homeowner")
        .order_by("-updated_at")
    )

    out = []
    for ag in qs:
        ms_qs = get_visible_milestones_for_subaccount(
            subaccount=sub,
            MilestoneModel=Milestone,
            AgreementAssignmentModel=AgreementAssignment,
            MilestoneAssignmentModel=MilestoneAssignment,
        ).filter(agreement_id=ag.id)

        total = ms_qs.count()
        complete = ms_qs.filter(completed=True).count()
        percent = int(round((complete / total) * 100)) if total else 0

        out.append(
            {
                "id": ag.id,
                "status": getattr(ag, "status", None),
                "project_title": _agreement_title(ag),
                "customer_name": _customer_name(ag),
                "project_address": _address(ag),
                "start": getattr(ag, "start", None),
                "end": getattr(ag, "end", None),
                "milestones_total": total,
                "milestones_complete": complete,
                "milestones_percent": percent,
            }
        )

    return Response({"agreements": out})


@api_view(["GET"])
@permission_classes([IsAuthenticated])
def agreement_detail(request, agreement_id: int):
    """
    GET /api/projects/employee/agreements/<agreement_id>/

    Read-only agreement header + visible milestones.
    """
    sub = _require_active_subaccount(request)

    has_agreement_assignment = AgreementAssignment.objects.filter(
        agreement_id=agreement_id, subaccount=sub
    ).exists()

    has_milestone_assignment = MilestoneAssignment.objects.filter(
        milestone__agreement_id=agreement_id, subaccount=sub
    ).exists()

    if not (has_agreement_assignment or has_milestone_assignment):
        return Response({"detail": "Not found."}, status=404)

    try:
        ag = Agreement.objects.select_related("project", "homeowner").get(id=agreement_id)
    except Agreement.DoesNotExist:
        return Response({"detail": "Not found."}, status=404)

    ms_qs = (
        get_visible_milestones_for_subaccount(
            subaccount=sub,
            MilestoneModel=Milestone,
            AgreementAssignmentModel=AgreementAssignment,
            MilestoneAssignmentModel=MilestoneAssignment,
        )
        .filter(agreement_id=agreement_id)
        .order_by("order", "id")
    )

    milestones = []
    for m in ms_qs:
        milestones.append(
            {
                "id": m.id,
                "agreement_id": m.agreement_id,
                "order": getattr(m, "order", None),
                "title": getattr(m, "title", "") or "",
                "description": getattr(m, "description", "") or "",
                "amount": str(getattr(m, "amount", None)) if getattr(m, "amount", None) is not None else None,
                "start_date": getattr(m, "start_date", None),
                "completion_date": getattr(m, "completion_date", None),
                "completed": bool(getattr(m, "completed", False)),
                "completed_at": getattr(m, "completed_at", None),
                "is_invoiced": bool(getattr(m, "is_invoiced", False)),
                "invoice_id": getattr(m, "invoice_id", None),
                "is_late": bool(getattr(m, "is_late", False)),
            }
        )

    return Response(
        {
            "agreement": {
                "id": ag.id,
                "status": getattr(ag, "status", None),
                "project_title": _agreement_title(ag),
                "customer_name": _customer_name(ag),
                "project_address": _address(ag),
                "start": getattr(ag, "start", None),
                "end": getattr(ag, "end", None),
            },
            "milestones": milestones,
        }
    )
