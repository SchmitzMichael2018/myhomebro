from __future__ import annotations

import math

from django.contrib.auth import get_user_model
from django.db import transaction
from django.db.models import Count, OuterRef, Q, Subquery
from django.utils import timezone
from django.utils.dateparse import parse_date
from rest_framework import status
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

from projects.models_attribution import AccountAcquisition
from projects.models_project_intake import ProjectIntake, ProjectIntakeClassificationEvent

from .permissions import IsAdminUserRole


User = get_user_model()
CLASSIFICATIONS = {value for value, _label in ProjectIntake.TRAFFIC_CLASSIFICATION_CHOICES}
PAGE_SIZES = {25, 50, 100}


def _can_change(user):
    return bool(user.is_superuser or user.has_perm("projects.change_projectintake"))


def _positive_int(value, default):
    try:
        return max(1, int(value))
    except (TypeError, ValueError):
        return default


def _base_queryset():
    trust = User.objects.filter(email__iexact=OuterRef("customer_email")).values("trust_classification")[:1]
    verification = User.objects.filter(email__iexact=OuterRef("customer_email")).values("verification_state")[:1]
    acquisition = AccountAcquisition.objects.filter(user__email__iexact=OuterRef("customer_email")).values("first_touch")[:1]
    return (
        ProjectIntake.objects.select_related("homeowner", "contractor", "agreement", "classified_by", "source_template")
        .annotate(
            invite_count=Count("discovery_invites", distinct=True),
            opportunity_count=Count("contractor_opportunities", distinct=True),
            customer_trust=Subquery(trust),
            customer_verification=Subquery(verification),
            acquisition_touch=Subquery(acquisition),
        )
    )


def _active(qs):
    return qs.exclude(traffic_classification__in=("test", "spam_fraud", "archived")).exclude(status="converted")


def _view_filter(qs, value):
    value = (value or "active").strip().lower()
    if value == "active":
        return _active(qs)
    if value == "needs_review":
        return qs.filter(
            Q(traffic_classification="suspicious")
            | Q(customer_trust="suspicious")
            | Q(customer_verification__in=("pending_email", "pending_phone", "suspicious", "disabled"))
        ).exclude(traffic_classification__in=("test", "spam_fraud", "archived"))
    if value == "customer_pending":
        return _active(qs).filter(status__in=("draft", "submitted"), homeowner__isnull=True)
    if value == "contractor_pending":
        return _active(qs).filter(post_submit_flow="single_contractor", contractor__isnull=True)
    if value == "ready_to_route":
        return _active(qs).filter(status__in=("submitted", "analyzed"), post_submit_flow="multi_contractor", invite_count=0, opportunity_count=0)
    if value == "routed":
        return qs.filter(Q(invite_count__gt=0) | Q(opportunity_count__gt=0)).exclude(traffic_classification__in=("test", "spam_fraud", "archived"))
    if value in {"converted", "closed"}:
        return qs.filter(Q(status="converted") | Q(agreement__isnull=False)).exclude(traffic_classification__in=("test", "spam_fraud"))
    if value == "test_spam":
        return qs.filter(traffic_classification__in=("test", "spam_fraud"))
    if value == "archived":
        return qs.filter(traffic_classification="archived")
    return qs


def _apply_filters(qs, params):
    qs = _view_filter(qs, params.get("view"))
    q = (params.get("q") or "").strip()[:120]
    if q:
        search_query = (
            Q(ai_project_title__icontains=q) | Q(accomplishment_text__icontains=q)
            | Q(customer_name__icontains=q) | Q(customer_email__icontains=q)
            | Q(customer_phone__icontains=q) | Q(ai_project_type__icontains=q)
            | Q(ai_project_subtype__icontains=q) | Q(project_city__icontains=q)
            | Q(project_state__icontains=q) | Q(project_postal_code__icontains=q)
        )
        if q.isdigit():
            search_query |= Q(pk=int(q))
        qs = qs.filter(search_query)
    if params.get("status"):
        qs = qs.filter(status=params["status"])
    if params.get("classification"):
        qs = qs.filter(traffic_classification=params["classification"])
    if params.get("service"):
        service = params["service"].strip()
        qs = qs.filter(Q(ai_project_type__icontains=service) | Q(ai_project_subtype__icontains=service))
    for key, fields in {
        "city": ("project_city", "customer_city"), "state": ("project_state", "customer_state"),
        "zip": ("project_postal_code", "customer_postal_code"),
    }.items():
        if params.get(key):
            value = params[key].strip()
            qs = qs.filter(Q(**{f"{fields[0]}__iexact": value}) | Q(**{f"{fields[1]}__iexact": value}))
    if params.get("customer"):
        value = params["customer"].strip()
        qs = qs.filter(Q(customer_name__icontains=value) | Q(customer_email__icontains=value))
    if params.get("routing") == "routed":
        qs = qs.filter(Q(invite_count__gt=0) | Q(opportunity_count__gt=0))
    elif params.get("routing") == "not_routed":
        qs = qs.filter(invite_count=0, opportunity_count=0)
    if params.get("marketplace") == "multi_contractor":
        qs = qs.filter(post_submit_flow="multi_contractor")
    elif params.get("marketplace") == "single_contractor":
        qs = qs.filter(post_submit_flow="single_contractor")
    if params.get("source"):
        source = params["source"].strip().lower()
        if source == "unknown":
            qs = qs.filter(Q(acquisition_touch__isnull=True), Q(lead_source="direct") | Q(lead_source=""))
        else:
            qs = qs.filter(Q(acquisition_touch__source=source) | Q(acquisition_touch__isnull=True, lead_source=source))
    if params.get("trust"):
        qs = qs.filter(customer_trust=params["trust"])
    if params.get("verification"):
        qs = qs.filter(customer_verification=params["verification"])
    date_from = parse_date((params.get("date_from") or "").strip())
    date_to = parse_date((params.get("date_to") or "").strip())
    if date_from:
        qs = qs.filter(Q(submitted_at__date__gte=date_from) | Q(submitted_at__isnull=True, created_at__date__gte=date_from))
    if date_to:
        qs = qs.filter(Q(submitted_at__date__lte=date_to) | Q(submitted_at__isnull=True, created_at__date__lte=date_to))
    return qs


def _source(row):
    touch = row.acquisition_touch or {}
    source = str(touch.get("source") or "").strip().lower()
    medium = str(touch.get("medium") or "").strip().lower()
    if not source and row.lead_source not in {"", "direct"}:
        source = row.lead_source
    if not source:
        return {"key": "unknown", "label": "Legacy / Unknown"}
    labels = {
        "facebook": "Facebook", "instagram": "Instagram", "referral": "Referral",
        "business-card": "Business Card QR", "vehicle-magnet": "Vehicle Magnet QR",
        "hoodie": "Hoodie QR", "realtor": "Realtor QR", "contractor-outreach": "Contractor Outreach",
    }
    if source == "google":
        label = "Google Paid" if medium in {"cpc", "paid-search", "paid"} else "Google Organic"
    else:
        label = labels.get(source, source.replace("_", " ").replace("-", " ").title())
    return {"key": source, "label": label}


def _routing(row):
    if row.invite_count or row.opportunity_count:
        return "routed"
    if row.post_submit_flow == "multi_contractor" and row.status in {"submitted", "analyzed"}:
        return "ready"
    return "not_routed"


def _row(row, detail=False):
    payload = {
        "id": row.pk, "reference": f"REQ-{row.pk}",
        "title": row.ai_project_title or row.ai_project_type or row.accomplishment_text[:80] or f"Request #{row.pk}",
        "customer": {"name": row.customer_name, "email": row.customer_email, "phone": row.customer_phone},
        "location": {"city": row.project_city or row.customer_city, "state": row.project_state or row.customer_state, "zip": row.project_postal_code or row.customer_postal_code},
        "service": row.ai_project_subtype or row.ai_project_type or "Unclassified",
        "source": _source(row), "trust": row.customer_trust or "unknown", "verification": row.customer_verification or "unknown",
        "workflow_status": row.status, "classification": row.traffic_classification,
        "routing_status": _routing(row), "invite_count": row.invite_count, "opportunity_count": row.opportunity_count,
        "submitted_at": (row.submitted_at or row.created_at).isoformat(), "updated_at": row.updated_at.isoformat(),
        "agreement_id": row.agreement_id,
    }
    if detail:
        payload.update({
            "description": row.accomplishment_text, "analysis": row.ai_description,
            "project_mode": row.project_mode, "payment_preference": row.payment_preference,
            "classification_events": [{"from": event.previous_classification, "to": event.new_classification, "actor": getattr(event.actor, "email", ""), "reason": event.reason, "at": event.created_at.isoformat()} for event in row.classification_events.select_related("actor")[:50]],
        })
    return payload


def _summary(base):
    return {
        "active": _active(base).count(),
        "needs_review": _view_filter(base, "needs_review").count(),
        "ready_to_route": _view_filter(base, "ready_to_route").count(),
        "routed": _view_filter(base, "routed").count(),
        "test_spam": base.filter(traffic_classification__in=("test", "spam_fraud")).count(),
        "archived": base.filter(traffic_classification="archived").count(),
    }


class AdminRequests(APIView):
    permission_classes = [IsAuthenticated, IsAdminUserRole]

    def get(self, request):
        base = _base_queryset()
        qs = _apply_filters(base, request.query_params)
        ordering = {
            "submitted_desc": ("-submitted_at", "-created_at", "-id"), "submitted_asc": ("submitted_at", "created_at", "id"),
            "updated_desc": ("-updated_at", "-id"), "updated_asc": ("updated_at", "id"),
            "customer_asc": ("customer_name", "id"), "customer_desc": ("-customer_name", "-id"),
            "location_asc": ("project_state", "project_city", "id"), "service_asc": ("ai_project_type", "ai_project_subtype", "id"),
            "status_asc": ("status", "-submitted_at", "-id"),
        }.get(request.query_params.get("sort"), ("-submitted_at", "-created_at", "-id"))
        qs = qs.order_by(*ordering)
        page_size = _positive_int(request.query_params.get("page_size"), 25)
        page_size = page_size if page_size in PAGE_SIZES else 25
        total = qs.count()
        pages = max(1, math.ceil(total / page_size))
        page = min(_positive_int(request.query_params.get("page"), 1), pages)
        rows = list(qs[(page - 1) * page_size:page * page_size])
        return Response({
            "results": [_row(row) for row in rows], "summary": _summary(base),
            "pagination": {"page": page, "page_size": page_size, "total": total, "total_pages": pages, "has_previous": page > 1, "has_next": page < pages},
            "permissions": {"can_classify": _can_change(request.user), "can_archive": _can_change(request.user), "can_mark_spam": _can_change(request.user), "can_delete": False},
        })


class AdminRequestDetail(APIView):
    permission_classes = [IsAuthenticated, IsAdminUserRole]

    def get(self, request, request_id):
        try:
            row = _base_queryset().get(pk=request_id)
        except ProjectIntake.DoesNotExist:
            return Response({"detail": "Request not found."}, status=404)
        return Response(_row(row, detail=True))


class AdminRequestBulkAction(APIView):
    permission_classes = [IsAuthenticated, IsAdminUserRole]

    def post(self, request):
        if not _can_change(request.user):
            return Response({"detail": "You do not have permission to modify request classifications."}, status=403)
        action = str(request.data.get("action") or "").strip().lower()
        ids = list(dict.fromkeys(request.data.get("ids") or []))
        if not ids or len(ids) > 100 or any(not str(value).isdigit() for value in ids):
            return Response({"detail": "Select between 1 and 100 requests from the current page."}, status=400)
        targets = {"mark_real": "real", "mark_test": "test", "mark_suspicious": "suspicious", "mark_spam_fraud": "spam_fraud", "archive": "archived"}
        if action not in {*targets, "restore"}:
            return Response({"detail": "Unsupported bulk action."}, status=400)
        if action in {"mark_spam_fraud", "archive"} and request.data.get("confirmed") is not True:
            return Response({"detail": "Explicit confirmation is required for this action."}, status=400)
        reason = str(request.data.get("reason") or "").strip()[:500]
        changed = 0
        with transaction.atomic():
            rows = list(ProjectIntake.objects.select_for_update().filter(pk__in=ids))
            for row in rows:
                previous = row.traffic_classification
                if action == "restore":
                    new = row.classification_before_archive if row.classification_before_archive in CLASSIFICATIONS - {"archived"} else "real"
                else:
                    new = targets[action]
                if new == previous:
                    continue
                if new == "archived":
                    row.classification_before_archive = previous if previous != "archived" else row.classification_before_archive
                elif action == "restore":
                    row.classification_before_archive = ""
                row.traffic_classification = new
                row.classified_at = timezone.now()
                row.classified_by = request.user
                row.save(update_fields=["traffic_classification", "classification_before_archive", "classified_at", "classified_by", "updated_at"])
                ProjectIntakeClassificationEvent.objects.create(project_intake=row, previous_classification=previous, new_classification=new, actor=request.user, reason=reason)
                changed += 1
        return Response({"changed": changed, "requested": len(ids), "classification": action})
