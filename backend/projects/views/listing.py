# backend/projects/views/listing.py
# v2025-10-22-pro — Scoped, robust list endpoints:
# - GET /api/projects/milestones/?agreement=<id>
# - GET /api/projects/invoices/?agreement=<id>
# - GET /api/projects/expenses/?agreement=<id>
# Staff sees all; contractors see only their agreements’ data.
# Returns {"count": N, "results": [...]}. Falls back gracefully if models/serializers are absent.

from __future__ import annotations

from typing import Any, Dict, List, Optional

from django.http import JsonResponse
from django.db.models import QuerySet
from rest_framework.permissions import IsAuthenticated
from rest_framework.views import APIView

# Try models (fallback to None if missing)
try:
    from projects.models import Agreement as _AgreementModel  # type: ignore
except Exception:
    _AgreementModel = None  # type: ignore

try:
    from projects.models import Milestone as _MilestoneModel  # type: ignore
except Exception:
    _MilestoneModel = None  # type: ignore

try:
    from projects.models import Invoice as _InvoiceModel  # type: ignore
except Exception:
    _InvoiceModel = None  # type: ignore

try:
    from projects.models import Expense as _ExpenseModel  # type: ignore
except Exception:
    _ExpenseModel = None  # type: ignore

# Try serializers (fallback to minimal dict)
try:
    from projects.serializers.milestone import MilestoneSerializer as _MilestoneSerializer  # type: ignore
except Exception:
    _MilestoneSerializer = None  # type: ignore

try:
    from projects.serializers.invoice import InvoiceSerializer as _InvoiceSerializer  # type: ignore
except Exception:
    _InvoiceSerializer = None  # type: ignore

try:
    from projects.serializers.expense import ExpenseSerializer as _ExpenseSerializer  # type: ignore
except Exception:
    _ExpenseSerializer = None  # type: ignore


def _scope_by_contractor_user(qs: QuerySet, request) -> QuerySet:
    """Restrict queryset to agreements owned by the logged-in contractor (unless staff)."""
    user = getattr(request, "user", None)
    if not user or getattr(user, "is_staff", False) or getattr(user, "is_superuser", False):
        return qs  # staff/superusers see all
    try:
        return qs.filter(agreement__contractor__user=user)
    except Exception:
        return qs.none()


def _apply_agreement_filter(qs: QuerySet, request) -> QuerySet:
    """Support ?agreement=<id> (or ?agreement_id=<id>) to narrow results."""
    ag_id = request.query_params.get("agreement") or request.query_params.get("agreement_id")
    if ag_id:
        try:
            return qs.filter(agreement_id=int(ag_id))
        except Exception:
            return qs.none()
    return qs


def _serialize_qs(qs, serializer_cls, fields: List[str]) -> List[Dict[str, Any]]:
    if qs is None:
        return []
    if serializer_cls is not None:
        try:
            return serializer_cls(qs, many=True).data  # type: ignore
        except Exception:
            pass
    out: List[Dict[str, Any]] = []
    for obj in qs:
        row: Dict[str, Any] = {}
        for f in fields:
            row[f] = getattr(obj, f, None)
        out.append(row)
    return out


def _ok(results: List[Dict[str, Any]]) -> JsonResponse:
    return JsonResponse({"count": len(results), "results": results}, safe=False)


class MilestonesList(APIView):
    permission_classes = [IsAuthenticated]

    def get(self, request, *args, **kwargs):
        if _MilestoneModel is None:
            return _ok([])

        try:
            qs = _MilestoneModel.objects.all().select_related("agreement", "agreement__contractor").order_by(
                "start_date", "end_date", "id"
            )
        except Exception:
            qs = _MilestoneModel.objects.all()

        qs = _scope_by_contractor_user(qs, request)
        qs = _apply_agreement_filter(qs, request)

        data = _serialize_qs(
            qs,
            _MilestoneSerializer,
            fields=[
                "id", "title", "description", "status", "amount",
                "start_date", "end_date", "completion_date", "agreement_id"
            ],
        )
        return _ok(data)


class InvoicesList(APIView):
    permission_classes = [IsAuthenticated]

    def get(self, request, *args, **kwargs):
        if _InvoiceModel is None:
            return _ok([])

        try:
            qs = _InvoiceModel.objects.all().select_related("agreement", "agreement__contractor").order_by("-created_at")
        except Exception:
            qs = _InvoiceModel.objects.all()

        qs = _scope_by_contractor_user(qs, request)
        qs = _apply_agreement_filter(qs, request)

        data = _serialize_qs(
            qs,
            _InvoiceSerializer,
            fields=["id", "agreement_id", "milestone_id", "amount", "status", "due_date", "created_at"],
        )
        return _ok(data)


class ExpensesList(APIView):
    permission_classes = [IsAuthenticated]

    def get(self, request, *args, **kwargs):
        if _ExpenseModel is None:
            return _ok([])

        try:
            qs = _ExpenseModel.objects.all().select_related("agreement", "agreement__contractor").order_by("-date", "-id")
        except Exception:
            qs = _ExpenseModel.objects.all()

        qs = _scope_by_contractor_user(qs, request)
        qs = _apply_agreement_filter(qs, request)

        data = _serialize_qs(
            qs,
            _ExpenseSerializer,
            fields=["id", "category", "amount", "note", "date", "project_id", "agreement_id"],
        )
        return _ok(data)
