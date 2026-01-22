# backend/projects/views/employee_milestones.py
# v2026-01-08 — require evidence + auto set completed_at
# v2026-01-09 — allow employee_supervisor to work milestones (same as employee_milestones)

from __future__ import annotations

from django.utils import timezone
from rest_framework.decorators import api_view, permission_classes, parser_classes
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.exceptions import PermissionDenied
from rest_framework.parsers import MultiPartParser, FormParser

from projects.models import (
    Milestone,
    MilestoneFile,
    MilestoneComment,
    AgreementAssignment,
    MilestoneAssignment,
)
from projects.utils.accounts import get_subaccount_for_user
from projects.utils.subaccount_scope import get_visible_milestones_for_subaccount


ROLE_READONLY = "employee_readonly"
ROLE_MILESTONES = "employee_milestones"
ROLE_SUPERVISOR = "employee_supervisor"  # ✅ NEW


def _require_active_subaccount(request):
    sub = get_subaccount_for_user(request.user)
    if sub is None:
        raise PermissionDenied("Employee subaccount required.")
    if not getattr(sub, "is_active", False):
        raise PermissionDenied("Employee account inactive.")
    return sub


def _can_work(sub) -> bool:
    """
    Who can perform work actions (comment/upload/complete)?
      - employee_milestones
      - employee_supervisor
    """
    role = (getattr(sub, "role", "") or "").strip().lower()
    return role in {ROLE_MILESTONES, ROLE_SUPERVISOR}


def _pick(*vals):
    for v in vals:
        if v is None:
            continue
        if isinstance(v, str) and v.strip() == "":
            continue
        return v
    return None


def _safe_get(obj, attr, default=None):
    try:
        return getattr(obj, attr)
    except Exception:
        return default


def _stringify(v):
    if v is None:
        return None
    return str(v)


def _agreement_number_from_agreement(ag):
    return _pick(_safe_get(ag, "agreement_number", None), _safe_get(ag, "id", None))


def _project_title_from_agreement(ag):
    proj = _safe_get(ag, "project", None)
    return _pick(
        _safe_get(proj, "title", None),
        _safe_get(ag, "project_title", None),
        _safe_get(ag, "title", None),
        _safe_get(proj, "name", None),
    )


def _customer_name_from_agreement(ag):
    homeowner = _safe_get(ag, "homeowner", None)
    return _pick(
        _safe_get(homeowner, "full_name", None),
        _safe_get(ag, "homeowner_name", None),
        _safe_get(ag, "customer_name", None),
        _safe_get(ag, "client_name", None),
    )


def _address_from_agreement(ag):
    line1 = _pick(_safe_get(ag, "project_address_line1", None), None)
    line2 = _pick(_safe_get(ag, "project_address_line2", None), None)
    city = _pick(_safe_get(ag, "project_address_city", None), None)
    state = _pick(_safe_get(ag, "project_address_state", None), None)
    zip_code = _pick(_safe_get(ag, "project_postal_code", None), None)

    proj = _safe_get(ag, "project", None)
    if not any([line1, city, state, zip_code]) and proj is not None:
        line1 = _pick(line1, _safe_get(proj, "project_street_address", None))
        line2 = _pick(line2, _safe_get(proj, "project_address_line_2", None))
        city = _pick(city, _safe_get(proj, "project_city", None))
        state = _pick(state, _safe_get(proj, "project_state", None))
        zip_code = _pick(zip_code, _safe_get(proj, "project_zip_code", None))

    homeowner = _safe_get(ag, "homeowner", None)
    if not any([line1, city, state, zip_code]) and homeowner is not None:
        line1 = _pick(line1, _safe_get(homeowner, "street_address", None))
        line2 = _pick(line2, _safe_get(homeowner, "address_line_2", None))
        city = _pick(city, _safe_get(homeowner, "city", None))
        state = _pick(state, _safe_get(homeowner, "state", None))
        zip_code = _pick(zip_code, _safe_get(homeowner, "zip_code", None))

    parts = []
    if line1:
        parts.append(str(line1).strip())
    if line2:
        parts.append(str(line2).strip())
    city_state_zip = " ".join([p for p in [city, state, zip_code] if p and str(p).strip()])
    if city_state_zip.strip():
        parts.append(city_state_zip.strip())

    return _pick(" • ".join(parts), None)


def _milestone_payload(m: Milestone, ag=None):
    payload = {
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

    if ag is not None:
        payload.update(
            {
                "agreement_number": _stringify(_agreement_number_from_agreement(ag) or m.agreement_id),
                "project_title": _stringify(_project_title_from_agreement(ag)),
                "customer_name": _stringify(_customer_name_from_agreement(ag)),
                "project_address": _stringify(_address_from_agreement(ag)),
            }
        )

    return payload


@api_view(["GET"])
@permission_classes([IsAuthenticated])
def my_milestones(request):
    sub = _require_active_subaccount(request)

    qs = (
        get_visible_milestones_for_subaccount(
            subaccount=sub,
            MilestoneModel=Milestone,
            AgreementAssignmentModel=AgreementAssignment,
            MilestoneAssignmentModel=MilestoneAssignment,
        )
        .select_related("agreement", "agreement__project", "agreement__homeowner")
        .order_by("agreement_id", "order", "id")
    )

    out = []
    for m in qs:
        out.append(_milestone_payload(m, ag=getattr(m, "agreement", None)))

    return Response({"can_work": _can_work(sub), "milestones": out})


@api_view(["GET"])
@permission_classes([IsAuthenticated])
def milestone_detail(request, milestone_id: int):
    sub = _require_active_subaccount(request)

    qs = (
        get_visible_milestones_for_subaccount(
            subaccount=sub,
            MilestoneModel=Milestone,
            AgreementAssignmentModel=AgreementAssignment,
            MilestoneAssignmentModel=MilestoneAssignment,
        )
        .select_related("agreement", "agreement__project", "agreement__homeowner")
    )

    try:
        m = qs.get(id=milestone_id)
    except Milestone.DoesNotExist:
        return Response({"detail": "Not found."}, status=404)

    comments = (
        MilestoneComment.objects.filter(milestone=m)
        .select_related("author")
        .order_by("-created_at")[:100]
    )
    files = (
        MilestoneFile.objects.filter(milestone=m)
        .select_related("uploaded_by")
        .order_by("-uploaded_at")[:100]
    )

    return Response(
        {
            "can_work": _can_work(sub),
            "milestone": _milestone_payload(m, ag=getattr(m, "agreement", None)),
            "comments": [
                {
                    "id": c.id,
                    "author_email": getattr(getattr(c, "author", None), "email", None),
                    "content": c.content,
                    "created_at": c.created_at,
                }
                for c in comments
            ],
            "files": [
                {
                    "id": f.id,
                    "uploaded_by_email": getattr(getattr(f, "uploaded_by", None), "email", None),
                    "file_url": request.build_absolute_uri(f.file.url) if getattr(f, "file", None) else None,
                    "uploaded_at": f.uploaded_at,
                }
                for f in files
            ],
        }
    )


@api_view(["POST"])
@permission_classes([IsAuthenticated])
def add_comment(request, milestone_id: int):
    sub = _require_active_subaccount(request)
    if not _can_work(sub):
        return Response({"detail": "Read-only employee."}, status=403)

    content = (request.data.get("content") or "").strip()
    if not content:
        return Response({"detail": "content is required"}, status=400)

    qs = get_visible_milestones_for_subaccount(
        subaccount=sub,
        MilestoneModel=Milestone,
        AgreementAssignmentModel=AgreementAssignment,
        MilestoneAssignmentModel=MilestoneAssignment,
    )

    try:
        m = qs.get(id=milestone_id)
    except Milestone.DoesNotExist:
        return Response({"detail": "Not found."}, status=404)

    obj = MilestoneComment.objects.create(milestone=m, author=request.user, content=content)

    return Response(
        {
            "id": obj.id,
            "author_email": getattr(getattr(obj, "author", None), "email", None),
            "content": obj.content,
            "created_at": obj.created_at,
        },
        status=201,
    )


@api_view(["POST"])
@permission_classes([IsAuthenticated])
@parser_classes([MultiPartParser, FormParser])
def upload_file(request, milestone_id: int):
    sub = _require_active_subaccount(request)
    if not _can_work(sub):
        return Response({"detail": "Read-only employee."}, status=403)

    qs = get_visible_milestones_for_subaccount(
        subaccount=sub,
        MilestoneModel=Milestone,
        AgreementAssignmentModel=AgreementAssignment,
        MilestoneAssignmentModel=MilestoneAssignment,
    )

    try:
        m = qs.get(id=milestone_id)
    except Milestone.DoesNotExist:
        return Response({"detail": "Not found."}, status=404)

    f = request.FILES.get("file")
    if not f:
        return Response({"detail": "file is required"}, status=400)

    obj = MilestoneFile.objects.create(milestone=m, uploaded_by=request.user, file=f)

    return Response(
        {
            "id": obj.id,
            "uploaded_by_email": getattr(getattr(obj, "uploaded_by", None), "email", None),
            "file_url": request.build_absolute_uri(obj.file.url) if obj.file else None,
            "uploaded_at": obj.uploaded_at,
        },
        status=201,
    )


@api_view(["POST"])
@permission_classes([IsAuthenticated])
def mark_milestone_complete(request, milestone_id: int):
    """
    Requires evidence (>=1 comment OR >=1 file) before completion.
    Sets completed_at when completed.
    """
    sub = _require_active_subaccount(request)
    if not _can_work(sub):
        return Response({"detail": "Read-only employee."}, status=403)

    qs = get_visible_milestones_for_subaccount(
        subaccount=sub,
        MilestoneModel=Milestone,
        AgreementAssignmentModel=AgreementAssignment,
        MilestoneAssignmentModel=MilestoneAssignment,
    )

    try:
        m = qs.get(id=milestone_id)
    except Milestone.DoesNotExist:
        return Response({"detail": "Not found."}, status=404)

    # Idempotent: if completed but timestamp missing, backfill
    if getattr(m, "completed", False):
        if getattr(m, "completed_at", None) is None:
            m.completed_at = timezone.now()
            m.save(update_fields=["completed_at"])
        return Response({"updated": False, "completed": True, "completed_at": m.completed_at})

    comment_count = MilestoneComment.objects.filter(milestone=m).count()
    file_count = MilestoneFile.objects.filter(milestone=m).count()
    if comment_count == 0 and file_count == 0:
        return Response(
            {
                "detail": "Evidence required: add at least one note or upload at least one file before completing."
            },
            status=400,
        )

    m.completed = True
    m.completed_at = timezone.now()
    m.save(update_fields=["completed", "completed_at"])
    return Response({"updated": True, "completed": True, "completed_at": m.completed_at})
