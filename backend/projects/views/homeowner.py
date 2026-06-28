# backend/projects/views/homeowner.py
from __future__ import annotations

from datetime import datetime, time
from decimal import Decimal

from django.db.models import Count, Max, Q, Sum
from django.db.models.functions import Lower
from django.utils import timezone
from django.utils.dateparse import parse_date, parse_datetime
from rest_framework import viewsets, filters, permissions, status
from rest_framework.decorators import action, api_view, permission_classes
from rest_framework.response import Response
from rest_framework.exceptions import PermissionDenied, NotFound
from rest_framework.request import Request

from projects.models import (
    Agreement,
    CustomerCommunicationLog,
    DrawRequest,
    DrawRequestStatus,
    ExternalPaymentRecord,
    ExternalPaymentStatus,
    Homeowner,
    Invoice,
    InvoiceStatus,
    Project,
    PublicContractorLead,
)
from projects.models_contractor_discovery import ContractorOpportunity
from projects.models_customer_portal import CustomerRequest, PropertyDocument, PropertyProfile
from projects.models_project_intake import ProjectIntake
from projects.serializers import HomeownerSerializer, HomeownerWriteSerializer
from core.pagination import DefaultPageNumberPagination


def _get_contractor_for_user(user):
    """Support current and legacy relationships without crashing."""
    return getattr(user, "contractor", None) or getattr(user, "contractor_profile", None)


class IsContractorOnly(permissions.BasePermission):
    """
    Only users with an attached contractor profile may access this ViewSet.
    """

    message = "Your account must be linked to a Contractor profile to access customers."

    def has_permission(self, request: Request, view) -> bool:
        if not (request.user and request.user.is_authenticated):
            return False
        contractor = _get_contractor_for_user(request.user)
        return contractor is not None

    def has_object_permission(self, request: Request, view, obj) -> bool:
        contractor = _get_contractor_for_user(request.user)
        # Enforce ownership: the object's created_by must be this contractor
        return contractor is not None and getattr(obj, "created_by_id", None) == getattr(contractor, "id", None)


class HomeownerViewSet(viewsets.ModelViewSet):
    """
    Contractor-scoped customers endpoint.

    Base URL is registered under:
      /api/projects/homeowners/            (primary)
    And core/urls.py aliases:
      /api/homeowners/  → /api/projects/homeowners/   (302/307 redirect)

    Supports:
      - Pagination: ?page=1&page_size=20
      - Search:     ?q=smith   (name/email/phone if present on model)
      - Ordering:   ?ordering=-created_at (falls back safely)
      - Status:     ?status=active|prospect|archived (optional)
    """

    permission_classes = [IsContractorOnly]
    pagination_class = DefaultPageNumberPagination
    filter_backends = [filters.OrderingFilter]  # simple ordering via ?ordering=

    def get_serializer_class(self):
        if self.action in ["create", "update", "partial_update"]:
            return HomeownerWriteSerializer
        return HomeownerSerializer

    # ---------- Queryset strictly scoped to the signed-in contractor ----------
    def get_queryset(self):
        user = self.request.user
        contractor = _get_contractor_for_user(user)
        if contractor is None:
            # Deny with a clear code (UI can redirect to onboarding)
            raise PermissionDenied(detail={
                "detail": "Your account must be linked to a Contractor profile to access customers.",
                "code": "contractor_required",
            })

        # Calculate active projects if you expose it on the list (adjust related_name/statuses if needed)
        active_statuses = ["signed", "funded", "in_progress"]

        qs = (
            Homeowner.objects.filter(created_by=contractor)
            .annotate(
                active_projects_count=Count(
                    "projects",
                    filter=Q(projects__status__in=active_statuses),
                )
            )
            .distinct()
        )

        # Optional status filter (safe)
        status_val = (self.request.query_params.get("status") or "").strip()
        if status_val and "status" in {f.name for f in Homeowner._meta.get_fields()}:
            qs = qs.filter(status__iexact=status_val)

        # Optional search across best-effort fields
        q = (self.request.query_params.get("q") or "").strip()
        if q:
            model_fields = {f.name for f in Homeowner._meta.get_fields()}

            # ✅ UPDATED: include company_name
            search_candidates = (
                "company_name",
                "name",
                "full_name",
                "first_name",
                "last_name",
                "email",
                "phone",
                "phone_number",
            )

            search_fields = [f for f in search_candidates if f in model_fields]
            if search_fields:
                cond = Q()
                for f in search_fields:
                    cond |= Q(**{f"{f}__icontains": q})
                qs = qs.filter(cond)

        # Safe ordering (fallback to -created_at then -id)
        ordering = (self.request.query_params.get("ordering") or "-created_at").strip()
        model_fields = {f.name for f in Homeowner._meta.get_fields()}
        if ordering.lstrip("-") in model_fields:
            if ordering.lstrip("-") == "id":
                qs = qs.order_by(ordering)
            else:
                qs = qs.order_by(ordering, "-id")
        else:
            qs = qs.order_by("-created_at", "-id")

        return qs

    def list(self, request: Request, *args, **kwargs):
        queryset = self.filter_queryset(self.get_queryset())

        page = self.paginate_queryset(queryset)
        if page is not None:
            contractor = _get_contractor_for_user(request.user)
            attach_customer_directory_metrics(page, contractor)
            serializer = self.get_serializer(page, many=True)
            return self.get_paginated_response(serializer.data)

        contractor = _get_contractor_for_user(request.user)
        customers = list(queryset)
        attach_customer_directory_metrics(customers, contractor)
        serializer = self.get_serializer(customers, many=True)
        return Response(serializer.data)

    # ---------- Create / Update / Destroy enforce contractor ownership ----------
    def perform_create(self, serializer):
        contractor = _get_contractor_for_user(self.request.user)
        if contractor is None:
            raise PermissionDenied(detail={
                "detail": "Your account must be linked to a Contractor profile to add customers.",
                "code": "contractor_required",
            })
        # Force ownership; ignore any incoming created_by attempt
        serializer.save(created_by=contractor)

    def perform_update(self, serializer):
        instance: Homeowner = self.get_object()
        contractor = _get_contractor_for_user(self.request.user)
        if contractor is None or instance.created_by_id != contractor.id:
            raise PermissionDenied(detail={
                "detail": "You do not have permission to modify this customer.",
                "code": "forbidden_not_owner",
            })
        serializer.save(created_by=contractor)

    def destroy(self, request: Request, *args, **kwargs):
        instance: Homeowner = self.get_object()
        contractor = _get_contractor_for_user(request.user)
        if contractor is None or instance.created_by_id != contractor.id:
            raise PermissionDenied(detail={
                "detail": "You do not have permission to delete this customer.",
                "code": "forbidden_not_owner",
            })
        return super().destroy(request, *args, **kwargs)

    @action(detail=True, methods=["get"], url_path="workspace")
    def workspace(self, request: Request, pk=None):
        customer: Homeowner = self.get_object()
        contractor = _get_contractor_for_user(request.user)
        payload = build_customer_workspace_payload(customer, contractor, request=request)
        return Response(payload)

    @action(detail=True, methods=["get", "post"], url_path="communications")
    def communications(self, request: Request, pk=None):
        customer: Homeowner = self.get_object()
        contractor = _get_contractor_for_user(request.user)
        if request.method.lower() == "get":
            rows = CustomerCommunicationLog.objects.filter(contractor=contractor, customer=customer).order_by("-occurred_at", "-id")
            communication_type = (request.query_params.get("type") or "").strip()
            if communication_type:
                rows = rows.filter(communication_type=communication_type)
            return Response({"results": [_communication_payload(row) for row in rows[:100]]})

        serializer = _validate_communication_payload(request.data)
        if serializer.get("errors"):
            return Response(serializer["errors"], status=status.HTTP_400_BAD_REQUEST)

        row = CustomerCommunicationLog.objects.create(
            contractor=contractor,
            customer=customer,
            created_by=request.user,
            **serializer["data"],
        )
        return Response(_communication_payload(row), status=status.HTTP_201_CREATED)

    @action(detail=True, methods=["patch", "delete"], url_path=r"communications/(?P<log_id>[^/.]+)")
    def communication_detail(self, request: Request, pk=None, log_id=None):
        customer: Homeowner = self.get_object()
        contractor = _get_contractor_for_user(request.user)
        try:
            row = CustomerCommunicationLog.objects.get(id=log_id, contractor=contractor, customer=customer)
        except CustomerCommunicationLog.DoesNotExist:
            raise NotFound("Communication log not found.")

        if request.method.lower() == "delete":
            row.delete()
            return Response(status=status.HTTP_204_NO_CONTENT)

        serializer = _validate_communication_payload(request.data, partial=True)
        if serializer.get("errors"):
            return Response(serializer["errors"], status=status.HTTP_400_BAD_REQUEST)
        for field, value in serializer["data"].items():
            setattr(row, field, value)
        row.save(update_fields=[*serializer["data"].keys(), "updated_at"])
        return Response(_communication_payload(row))


def _safe_text(value) -> str:
    return "" if value is None else str(value).strip()


def _money(value) -> str:
    if value is None:
        return "0.00"
    try:
        return f"{Decimal(value):.2f}"
    except Exception:
        return "0.00"


def _iso(value):
    return value.isoformat() if value else None


def _date(value):
    return value.isoformat() if value else None


def _parse_optional_datetime(value, *, default=None):
    if value in (None, ""):
        return default
    if hasattr(value, "isoformat"):
        parsed = value
    else:
        parsed = parse_datetime(str(value))
    if parsed is None:
        raise ValueError("Enter a valid date/time.")
    if timezone.is_naive(parsed):
        parsed = timezone.make_aware(parsed, timezone.get_current_timezone())
    return parsed


def _validate_choice(field, value, choices):
    allowed = {choice[0] for choice in choices}
    if value not in allowed:
        return f"Invalid {field}."
    return ""


def _validate_communication_payload(payload, *, partial=False):
    errors = {}
    data = {}

    if not partial or "communication_type" in payload:
        communication_type = (payload.get("communication_type") or CustomerCommunicationLog.TYPE_INTERNAL_NOTE).strip()
        error = _validate_choice("communication_type", communication_type, CustomerCommunicationLog.COMMUNICATION_TYPE_CHOICES)
        if error:
            errors["communication_type"] = [error]
        else:
            data["communication_type"] = communication_type

    if not partial or "direction" in payload:
        direction = (payload.get("direction") or CustomerCommunicationLog.DIRECTION_INTERNAL).strip()
        error = _validate_choice("direction", direction, CustomerCommunicationLog.DIRECTION_CHOICES)
        if error:
            errors["direction"] = [error]
        else:
            data["direction"] = direction

    if not partial or "visibility" in payload:
        visibility = (payload.get("visibility") or CustomerCommunicationLog.VISIBILITY_INTERNAL_ONLY).strip()
        error = _validate_choice("visibility", visibility, CustomerCommunicationLog.VISIBILITY_CHOICES)
        if error:
            errors["visibility"] = [error]
        else:
            data["visibility"] = visibility

    if not partial or "subject" in payload:
        data["subject"] = _safe_text(payload.get("subject"))[:255]
    if not partial or "body" in payload:
        data["body"] = _safe_text(payload.get("body"))

    if not partial or "occurred_at" in payload:
        try:
            data["occurred_at"] = _parse_optional_datetime(payload.get("occurred_at"), default=timezone.now())
        except ValueError as exc:
            errors["occurred_at"] = [str(exc)]

    if not partial or "follow_up_at" in payload:
        try:
            data["follow_up_at"] = _parse_optional_datetime(payload.get("follow_up_at"), default=None)
        except ValueError as exc:
            errors["follow_up_at"] = [str(exc)]

    if not data.get("subject") and not data.get("body") and not partial:
        errors["body"] = ["Add a subject or note body."]

    return {"data": data, "errors": errors}


def _communication_payload(row: CustomerCommunicationLog) -> dict:
    return {
        "id": row.id,
        "type": "communication",
        "communication_type": row.communication_type,
        "communication_type_label": row.get_communication_type_display(),
        "direction": row.direction,
        "direction_label": row.get_direction_display(),
        "subject": row.subject,
        "title": row.subject or row.get_communication_type_display(),
        "body": row.body,
        "description": row.body,
        "occurred_at": _iso(row.occurred_at),
        "follow_up_at": _iso(row.follow_up_at),
        "created_by": getattr(row.created_by, "email", "") if row.created_by_id else "",
        "created_at": _iso(row.created_at),
        "updated_at": _iso(row.updated_at),
        "visibility": row.visibility,
        "visibility_label": row.get_visibility_display(),
        "status": row.direction,
        "url": "",
    }


def _event(events, *, event_type, title, description="", timestamp=None, source="", source_id=None, url="", amount=None, status=""):
    events.append(
        {
            "type": event_type,
            "title": title,
            "description": description,
            "timestamp": _iso(timestamp),
            "source": source,
            "source_id": source_id,
            "url": url,
            "amount": _money(amount) if amount is not None else None,
            "status": status or "",
        }
    )


def _customer_email(customer: Homeowner) -> str:
    return _safe_text(getattr(customer, "email", "")).lower()


def _matching_email_filter(field: str, email: str) -> Q:
    return Q(**{f"{field}__iexact": email}) if email else Q(pk__isnull=True)


def _empty_directory_metrics(customer: Homeowner) -> dict:
    timestamp = customer.updated_at or customer.created_at
    return {
        "open_requests_count": 0,
        "active_requests_count": 0,
        "active_agreements_projects_count": 0,
        "active_agreements_count": 0,
        "active_projects_count": 0,
        "closed_work_count": 0,
        "open_balance": Decimal("0.00"),
        "lifetime_value": Decimal("0.00"),
        "last_activity": "Customer updated" if customer.updated_at else "Customer created",
        "last_activity_at": timestamp,
    }


def _customer_email_key(value) -> str:
    return _safe_text(value).lower()


def _attach_count(metrics, customer_id, key, value):
    if customer_id in metrics and value:
        metrics[customer_id][key] += int(value or 0)


def _attach_money(metrics, customer_id, key, value):
    if customer_id in metrics and value is not None:
        metrics[customer_id][key] += Decimal(value or 0)


def _attach_latest(metrics, customer_id, timestamp, label):
    if customer_id not in metrics or not timestamp:
        return
    current = metrics[customer_id].get("last_activity_at")
    if not current or timestamp > current:
        metrics[customer_id]["last_activity_at"] = timestamp
        metrics[customer_id]["last_activity"] = label


def attach_customer_directory_metrics(customers, contractor) -> None:
    """
    Attach CRM directory metrics to a page of customers in batched queries.

    Lifetime value intentionally uses agreement value where available instead
    of adding invoices on top, because invoices normally represent payment
    against the same agreement value and would otherwise double-count work.
    """
    customers = list(customers or [])
    if not customers or contractor is None:
        return

    customer_ids = [customer.id for customer in customers if customer.id]
    email_to_customer_id = {
        _customer_email_key(customer.email): customer.id
        for customer in customers
        if _customer_email_key(customer.email)
    }
    email_keys = list(email_to_customer_id.keys())
    metrics = {customer.id: _empty_directory_metrics(customer) for customer in customers}

    public_lead_open_statuses = [
        PublicContractorLead.STATUS_NEW,
        PublicContractorLead.STATUS_PENDING_CUSTOMER_RESPONSE,
        PublicContractorLead.STATUS_READY_FOR_REVIEW,
        PublicContractorLead.STATUS_FOLLOW_UP,
        PublicContractorLead.STATUS_ACCEPTED,
        PublicContractorLead.STATUS_CONTACTED,
        PublicContractorLead.STATUS_QUALIFIED,
    ]
    intake_open_statuses = ["draft", "submitted", "analyzed"]
    customer_request_open_statuses = [
        CustomerRequest.STATUS_DRAFT,
        CustomerRequest.STATUS_SUBMITTED,
        CustomerRequest.STATUS_ROUTED,
        CustomerRequest.STATUS_MARKETPLACE_READY,
        CustomerRequest.STATUS_MATCHED,
    ]
    opportunity_open_statuses = [
        ContractorOpportunity.STATUS_PENDING,
        ContractorOpportunity.STATUS_ACCEPTED,
    ]
    active_work_excluded_statuses = ["completed", "closed", "cancelled", "canceled", "archived", "void"]
    closed_work_statuses = ["completed", "closed"]
    open_invoice_statuses = [
        InvoiceStatus.INCOMPLETE,
        InvoiceStatus.SENT,
        InvoiceStatus.PENDING,
        InvoiceStatus.APPROVED,
        InvoiceStatus.DISPUTED,
    ]
    open_draw_statuses = [
        DrawRequestStatus.SUBMITTED,
        DrawRequestStatus.APPROVED,
        DrawRequestStatus.AWAITING_RELEASE,
        DrawRequestStatus.CHANGES_REQUESTED,
    ]
    paid_draw_statuses = [
        DrawRequestStatus.PAID,
        DrawRequestStatus.RELEASED,
    ]

    # Public profile / website / QR leads.
    lead_base = PublicContractorLead.objects.filter(contractor=contractor).filter(
        Q(converted_homeowner_id__in=customer_ids) | Q(email__in=email_keys)
    )
    for row in (
        lead_base.values("converted_homeowner_id")
        .annotate(open_count=Count("id", filter=Q(status__in=public_lead_open_statuses)), latest=Max("updated_at"))
    ):
        customer_id = row["converted_homeowner_id"]
        _attach_count(metrics, customer_id, "open_requests_count", row["open_count"])
        _attach_count(metrics, customer_id, "active_requests_count", row["open_count"])
        _attach_latest(metrics, customer_id, row["latest"], "Lead activity")
    for row in (
        lead_base.filter(converted_homeowner__isnull=True)
        .annotate(email_key=Lower("email"))
        .values("email_key")
        .annotate(open_count=Count("id", filter=Q(status__in=public_lead_open_statuses)), latest=Max("updated_at"))
    ):
        customer_id = email_to_customer_id.get(row["email_key"])
        _attach_count(metrics, customer_id, "open_requests_count", row["open_count"])
        _attach_count(metrics, customer_id, "active_requests_count", row["open_count"])
        _attach_latest(metrics, customer_id, row["latest"], "Lead activity")

    # Project intakes, including public-profile intakes that may not carry contractor directly.
    intake_base = ProjectIntake.objects.filter(
        Q(contractor=contractor) | Q(public_profile__contractor=contractor) | Q(contractor__isnull=True)
    ).filter(Q(homeowner_id__in=customer_ids) | Q(customer_email__in=email_keys))
    for row in (
        intake_base.values("homeowner_id")
        .annotate(open_count=Count("id", filter=Q(status__in=intake_open_statuses)), latest=Max("updated_at"))
    ):
        customer_id = row["homeowner_id"]
        _attach_count(metrics, customer_id, "open_requests_count", row["open_count"])
        _attach_count(metrics, customer_id, "active_requests_count", row["open_count"])
        _attach_latest(metrics, customer_id, row["latest"], "Project intake activity")
    for row in (
        intake_base.filter(homeowner__isnull=True)
        .annotate(email_key=Lower("customer_email"))
        .values("email_key")
        .annotate(open_count=Count("id", filter=Q(status__in=intake_open_statuses)), latest=Max("updated_at"))
    ):
        customer_id = email_to_customer_id.get(row["email_key"])
        _attach_count(metrics, customer_id, "open_requests_count", row["open_count"])
        _attach_count(metrics, customer_id, "active_requests_count", row["open_count"])
        _attach_latest(metrics, customer_id, row["latest"], "Project intake activity")

    # Customer portal project and maintenance/service requests.
    request_base = CustomerRequest.objects.filter(Q(homeowner_id__in=customer_ids) | Q(customer_email__in=email_keys))
    for row in (
        request_base.values("homeowner_id")
        .annotate(open_count=Count("id", filter=Q(status__in=customer_request_open_statuses)), latest=Max("updated_at"))
    ):
        customer_id = row["homeowner_id"]
        _attach_count(metrics, customer_id, "open_requests_count", row["open_count"])
        _attach_count(metrics, customer_id, "active_requests_count", row["open_count"])
        _attach_latest(metrics, customer_id, row["latest"], "Customer request activity")
    for row in (
        request_base.filter(homeowner__isnull=True)
        .annotate(email_key=Lower("customer_email"))
        .values("email_key")
        .annotate(open_count=Count("id", filter=Q(status__in=customer_request_open_statuses)), latest=Max("updated_at"))
    ):
        customer_id = email_to_customer_id.get(row["email_key"])
        _attach_count(metrics, customer_id, "open_requests_count", row["open_count"])
        _attach_count(metrics, customer_id, "active_requests_count", row["open_count"])
        _attach_latest(metrics, customer_id, row["latest"], "Customer request activity")

    # Contractor opportunities from selected contractors, public intake, manual, and PM work order sources.
    opportunity_base = ContractorOpportunity.objects.filter(
        Q(directory_entry__claimed_by_contractor=contractor) | Q(accepted_by_contractor=contractor)
    ).filter(
        Q(converted_customer_id__in=customer_ids)
        | Q(homeowner_email__in=email_keys)
        | Q(intake_request__homeowner_id__in=customer_ids)
        | Q(intake_request__customer_email__in=email_keys)
    )
    for row in (
        opportunity_base.values("converted_customer_id")
        .annotate(open_count=Count("id", filter=Q(status__in=opportunity_open_statuses)), latest=Max("updated_at"))
    ):
        customer_id = row["converted_customer_id"]
        _attach_count(metrics, customer_id, "open_requests_count", row["open_count"])
        _attach_count(metrics, customer_id, "active_requests_count", row["open_count"])
        _attach_latest(metrics, customer_id, row["latest"], "Opportunity activity")
    for row in (
        opportunity_base.filter(converted_customer__isnull=True)
        .annotate(email_key=Lower("homeowner_email"))
        .values("email_key")
        .annotate(open_count=Count("id", filter=Q(status__in=opportunity_open_statuses)), latest=Max("updated_at"))
    ):
        customer_id = email_to_customer_id.get(row["email_key"])
        _attach_count(metrics, customer_id, "open_requests_count", row["open_count"])
        _attach_count(metrics, customer_id, "active_requests_count", row["open_count"])
        _attach_latest(metrics, customer_id, row["latest"], "Opportunity activity")
    for row in (
        opportunity_base.filter(converted_customer__isnull=True)
        .exclude(homeowner_email__in=email_keys)
        .values("intake_request__homeowner_id")
        .annotate(open_count=Count("id", filter=Q(status__in=opportunity_open_statuses)), latest=Max("updated_at"))
    ):
        customer_id = row["intake_request__homeowner_id"]
        _attach_count(metrics, customer_id, "open_requests_count", row["open_count"])
        _attach_count(metrics, customer_id, "active_requests_count", row["open_count"])
        _attach_latest(metrics, customer_id, row["latest"], "Opportunity activity")
    for row in (
        opportunity_base.filter(converted_customer__isnull=True)
        .exclude(homeowner_email__in=email_keys)
        .filter(intake_request__homeowner__isnull=True)
        .annotate(email_key=Lower("intake_request__customer_email"))
        .values("email_key")
        .annotate(open_count=Count("id", filter=Q(status__in=opportunity_open_statuses)), latest=Max("updated_at"))
    ):
        customer_id = email_to_customer_id.get(row["email_key"])
        _attach_count(metrics, customer_id, "open_requests_count", row["open_count"])
        _attach_count(metrics, customer_id, "active_requests_count", row["open_count"])
        _attach_latest(metrics, customer_id, row["latest"], "Opportunity activity")

    agreement_base = Agreement.objects.filter(contractor=contractor, homeowner_id__in=customer_ids)
    for row in (
        agreement_base.values("homeowner_id")
        .annotate(
            active_count=Count("id", filter=Q(is_archived=False) & ~Q(status__in=active_work_excluded_statuses)),
            closed_count=Count("id", filter=Q(status__in=closed_work_statuses)),
            lifetime=Sum("total_cost", filter=Q(is_archived=False) & ~Q(status__in=["cancelled", "canceled", "void"])),
            latest=Max("updated_at"),
        )
    ):
        customer_id = row["homeowner_id"]
        _attach_count(metrics, customer_id, "active_agreements_count", row["active_count"])
        _attach_count(metrics, customer_id, "active_agreements_projects_count", row["active_count"])
        _attach_count(metrics, customer_id, "closed_work_count", row["closed_count"])
        _attach_money(metrics, customer_id, "lifetime_value", row["lifetime"])
        _attach_latest(metrics, customer_id, row["latest"], "Agreement activity")

    project_base = Project.objects.filter(contractor=contractor, homeowner_id__in=customer_ids)
    for row in (
        project_base.values("homeowner_id")
        .annotate(
            active_count=Count("id", filter=~Q(status__in=active_work_excluded_statuses)),
            closed_count=Count("id", filter=Q(status__in=closed_work_statuses)),
            latest=Max("updated_at"),
        )
    ):
        customer_id = row["homeowner_id"]
        _attach_count(metrics, customer_id, "active_projects_count", row["active_count"])
        _attach_count(metrics, customer_id, "active_agreements_projects_count", row["active_count"])
        _attach_count(metrics, customer_id, "closed_work_count", row["closed_count"])
        _attach_latest(metrics, customer_id, row["latest"], "Project activity")

    invoice_base = Invoice.objects.filter(agreement__contractor=contractor, agreement__homeowner_id__in=customer_ids)
    for row in (
        invoice_base.values("agreement__homeowner_id")
        .annotate(
            open_total=Sum("amount", filter=Q(status__in=open_invoice_statuses)),
            paid_total=Sum("amount", filter=Q(status=InvoiceStatus.PAID)),
            latest_created=Max("created_at"),
            latest_approved=Max("approved_at"),
        )
    ):
        customer_id = row["agreement__homeowner_id"]
        _attach_money(metrics, customer_id, "open_balance", row["open_total"])
        if not metrics[customer_id]["lifetime_value"]:
            _attach_money(metrics, customer_id, "lifetime_value", row["paid_total"])
        _attach_latest(metrics, customer_id, row["latest_created"], "Invoice activity")
        _attach_latest(metrics, customer_id, row["latest_approved"], "Invoice activity")

    draw_base = DrawRequest.objects.filter(agreement__contractor=contractor, agreement__homeowner_id__in=customer_ids)
    for row in (
        draw_base.values("agreement__homeowner_id")
        .annotate(
            open_total=Sum("current_requested_amount", filter=Q(status__in=open_draw_statuses)),
            paid_total=Sum("current_requested_amount", filter=Q(status__in=paid_draw_statuses)),
            latest=Max("updated_at"),
        )
    ):
        customer_id = row["agreement__homeowner_id"]
        _attach_money(metrics, customer_id, "open_balance", row["open_total"])
        if not metrics[customer_id]["lifetime_value"]:
            _attach_money(metrics, customer_id, "lifetime_value", row["paid_total"])
        _attach_latest(metrics, customer_id, row["latest"], "Draw request activity")

    external_payment_base = ExternalPaymentRecord.objects.filter(
        agreement__contractor=contractor,
        agreement__homeowner_id__in=customer_ids,
        status__in=[ExternalPaymentStatus.RECORDED, ExternalPaymentStatus.VERIFIED],
    )
    for row in (
        external_payment_base.values("agreement__homeowner_id")
        .annotate(total=Sum("net_amount"), latest=Max("updated_at"))
    ):
        customer_id = row["agreement__homeowner_id"]
        if not metrics[customer_id]["lifetime_value"]:
            _attach_money(metrics, customer_id, "lifetime_value", row["total"])
        _attach_latest(metrics, customer_id, row["latest"], "Payment activity")

    for row in (
        CustomerCommunicationLog.objects.filter(contractor=contractor, customer_id__in=customer_ids)
        .values("customer_id")
        .annotate(latest=Max("occurred_at"))
    ):
        _attach_latest(metrics, row["customer_id"], row["latest"], "Communication activity")

    for customer in customers:
        for key, value in metrics.get(customer.id, {}).items():
            setattr(customer, key, value)


def _record_timestamp(*values):
    for value in values:
        if value:
            return value
    return None


def _record_search_text(record):
    return " ".join(
        _safe_text(record.get(field)).lower()
        for field in ["customer_name", "customer_email", "title", "description", "status", "source"]
    )


def _parse_record_filter_datetime(value, *, end_of_day=False):
    if not value:
        return None
    parsed = parse_datetime(str(value))
    if parsed is None:
        parsed_date = parse_date(str(value))
        if parsed_date is None:
            return None
        parsed = datetime.combine(parsed_date, time.max if end_of_day else time.min)
    if timezone.is_naive(parsed):
        parsed = timezone.make_aware(parsed, timezone.get_current_timezone())
    return parsed


def _record_matches_filters(record, params):
    type_filter = _safe_text(params.get("type")).lower().rstrip("s")
    if type_filter:
        aliases = {
            "lead": "opportunity",
            "opportunities": "opportunity",
            "requests": "request",
            "agreements": "agreement",
            "payments": "payment",
            "communications": "communication",
        }
        expected = aliases.get(type_filter, type_filter)
        if record["type"] != expected:
            return False

    status_filter = _safe_text(params.get("status")).lower()
    if status_filter and _safe_text(record.get("status")).lower() != status_filter:
        return False

    source_filter = _safe_text(params.get("source")).lower()
    if source_filter and _safe_text(record.get("source")).lower() != source_filter:
        return False

    customer_filter = _safe_text(params.get("customer") or params.get("customer_id"))
    if customer_filter and str(record.get("customer_id") or "") != customer_filter:
        return False

    needs_attention = _safe_text(params.get("needs_attention")).lower()
    if needs_attention in {"1", "true", "yes"} and not record.get("needs_attention"):
        return False

    search = _safe_text(params.get("search") or params.get("q")).lower()
    if search and search not in _record_search_text(record):
        return False

    start = _parse_record_filter_datetime(params.get("date_from")) if params.get("date_from") else None
    end = _parse_record_filter_datetime(params.get("date_to"), end_of_day=True) if params.get("date_to") else None
    timestamp = record.get("_timestamp")
    if start and timestamp and timestamp < start:
        return False
    if end and timestamp and timestamp > end:
        return False
    return True


def _append_record(records, *, record_type, source, customer, title, description="", status="", amount=None, timestamp=None, url="", primary_action_label="", needs_attention=False, source_id=None):
    if not customer or not timestamp:
        return
    source_key = f"{source}-{source_id or len(records)}"
    records.append(
        {
            "id": source_key,
            "type": record_type,
            "source": source,
            "customer_id": customer.id,
            "customer_name": customer.company_name or customer.full_name,
            "customer_email": customer.email,
            "title": title or f"{record_type.title()} record",
            "description": description or "",
            "status": status or "",
            "amount": _money(amount) if amount is not None else None,
            "timestamp": _iso(timestamp),
            "_timestamp": timestamp,
            "url": url,
            "primary_action_label": primary_action_label or "Open record",
            "needs_attention": bool(needs_attention),
        }
    )


def build_customer_records_payload(contractor, params) -> dict:
    customers = list(Homeowner.objects.filter(created_by=contractor).order_by("full_name", "id"))
    customer_ids = [customer.id for customer in customers]
    customers_by_id = {customer.id: customer for customer in customers}
    email_to_customer = {
        _customer_email_key(customer.email): customer
        for customer in customers
        if _customer_email_key(customer.email)
    }
    email_keys = list(email_to_customer.keys())
    records = []

    public_lead_attention_statuses = {
        PublicContractorLead.STATUS_NEW,
        PublicContractorLead.STATUS_PENDING_CUSTOMER_RESPONSE,
        PublicContractorLead.STATUS_READY_FOR_REVIEW,
        PublicContractorLead.STATUS_FOLLOW_UP,
    }
    for lead in PublicContractorLead.objects.filter(contractor=contractor).filter(
        Q(converted_homeowner_id__in=customer_ids) | Q(email__in=email_keys)
    ).select_related("converted_homeowner"):
        customer = lead.converted_homeowner or email_to_customer.get(_customer_email_key(lead.email))
        _append_record(
            records,
            record_type="opportunity",
            source="public_lead",
            source_id=lead.id,
            customer=customer,
            title=lead.project_type or "Public lead",
            description=lead.project_description,
            status=lead.status,
            timestamp=_record_timestamp(lead.updated_at, lead.created_at),
            url=f"/app/opportunities?source={lead.source or 'website'}",
            primary_action_label="Open opportunity",
            needs_attention=lead.status in public_lead_attention_statuses,
        )

    intake_attention_statuses = {"draft", "submitted", "analyzed"}
    intakes = ProjectIntake.objects.filter(
        Q(contractor=contractor) | Q(public_profile__contractor=contractor) | Q(contractor__isnull=True)
    ).filter(Q(homeowner_id__in=customer_ids) | Q(customer_email__in=email_keys)).select_related("homeowner")
    for intake in intakes:
        customer = intake.homeowner or email_to_customer.get(_customer_email_key(intake.customer_email))
        _append_record(
            records,
            record_type="request",
            source="project_intake",
            source_id=intake.id,
            customer=customer,
            title=intake.ai_project_title or intake.ai_project_type or intake.accomplishment_text or "Project intake",
            description=intake.ai_description or intake.accomplishment_text,
            status=intake.status,
            timestamp=_record_timestamp(intake.submitted_at, intake.analyzed_at, intake.updated_at, intake.created_at),
            url=f"/app/intake/new?intakeId={intake.id}",
            primary_action_label="Open request",
            needs_attention=intake.status in intake_attention_statuses,
        )

    request_attention_statuses = {
        CustomerRequest.STATUS_SUBMITTED,
        CustomerRequest.STATUS_ROUTED,
        CustomerRequest.STATUS_MARKETPLACE_READY,
        CustomerRequest.STATUS_MATCHED,
    }
    for row in CustomerRequest.objects.filter(Q(homeowner_id__in=customer_ids) | Q(customer_email__in=email_keys)).select_related("homeowner"):
        customer = row.homeowner or email_to_customer.get(_customer_email_key(row.customer_email))
        _append_record(
            records,
            record_type="request",
            source="customer_request",
            source_id=row.id,
            customer=customer,
            title=row.title or "Customer request",
            description=row.description,
            status=row.status,
            timestamp=_record_timestamp(row.updated_at, row.created_at),
            url="/app/customers/records?type=request",
            primary_action_label="Open request",
            needs_attention=row.status in request_attention_statuses,
        )

    opportunity_attention_statuses = {ContractorOpportunity.STATUS_PENDING, ContractorOpportunity.STATUS_ACCEPTED}
    opportunities = ContractorOpportunity.objects.filter(
        Q(directory_entry__claimed_by_contractor=contractor) | Q(accepted_by_contractor=contractor)
    ).filter(
        Q(converted_customer_id__in=customer_ids)
        | Q(homeowner_email__in=email_keys)
        | Q(intake_request__homeowner_id__in=customer_ids)
        | Q(intake_request__customer_email__in=email_keys)
    ).select_related("converted_customer", "intake_request")
    for row in opportunities:
        customer = (
            row.converted_customer
            or email_to_customer.get(_customer_email_key(row.homeowner_email))
            or getattr(row.intake_request, "homeowner", None)
            or email_to_customer.get(_customer_email_key(getattr(row.intake_request, "customer_email", "")))
        )
        _append_record(
            records,
            record_type="opportunity",
            source="contractor_opportunity",
            source_id=row.id,
            customer=customer,
            title=row.project_title or row.project_type or "Contractor opportunity",
            description=row.project_description or row.refined_description or "",
            status=row.status,
            timestamp=_record_timestamp(row.updated_at, row.accepted_at, row.selected_at, row.created_at),
            url="/app/opportunities",
            primary_action_label="Open opportunity",
            needs_attention=row.status in opportunity_attention_statuses,
        )

    active_agreement_attention = {"draft", "sent", "pending", "awaiting_signature", "signature_requested"}
    for agreement in Agreement.objects.filter(contractor=contractor, homeowner_id__in=customer_ids).select_related("homeowner", "project"):
        project = getattr(agreement, "project", None)
        _append_record(
            records,
            record_type="agreement",
            source="agreement",
            source_id=agreement.id,
            customer=agreement.homeowner,
            title=getattr(project, "title", "") or f"Agreement #{agreement.id}",
            description=agreement.description or getattr(project, "description", "") or "",
            status=agreement.status,
            amount=agreement.total_cost,
            timestamp=_record_timestamp(agreement.updated_at, agreement.created_at),
            url=f"/app/agreements/{agreement.id}",
            primary_action_label="Open agreement",
            needs_attention=agreement.status in active_agreement_attention,
        )

    for project in Project.objects.filter(contractor=contractor, homeowner_id__in=customer_ids).select_related("homeowner"):
        try:
            agreement_id = project.agreement.id
        except Exception:
            agreement_id = None
        _append_record(
            records,
            record_type="agreement",
            source="project",
            source_id=project.id,
            customer=project.homeowner,
            title=project.title or f"Project #{project.id}",
            description=project.description,
            status=project.status,
            timestamp=_record_timestamp(project.updated_at, project.created_at),
            url=f"/app/agreements/{agreement_id}" if agreement_id else "/app/agreements",
            primary_action_label="Open project",
            needs_attention=False,
        )

    invoice_attention_statuses = {InvoiceStatus.INCOMPLETE, InvoiceStatus.SENT, InvoiceStatus.PENDING, InvoiceStatus.DISPUTED}
    for invoice in Invoice.objects.filter(agreement__contractor=contractor, agreement__homeowner_id__in=customer_ids).select_related("agreement__homeowner", "agreement__project"):
        agreement = invoice.agreement
        project = getattr(agreement, "project", None)
        _append_record(
            records,
            record_type="payment",
            source="invoice",
            source_id=invoice.id,
            customer=agreement.homeowner,
            title=invoice.invoice_number or f"Invoice #{invoice.id}",
            description=getattr(project, "title", "") or "Invoice activity",
            status=invoice.status,
            amount=invoice.amount,
            timestamp=_record_timestamp(invoice.approved_at, invoice.created_at),
            url=f"/app/invoices/{invoice.id}",
            primary_action_label="Open invoice",
            needs_attention=invoice.status in invoice_attention_statuses,
        )

    draw_attention_statuses = {DrawRequestStatus.SUBMITTED, DrawRequestStatus.APPROVED, DrawRequestStatus.AWAITING_RELEASE, DrawRequestStatus.CHANGES_REQUESTED}
    for draw in DrawRequest.objects.filter(agreement__contractor=contractor, agreement__homeowner_id__in=customer_ids).select_related("agreement__homeowner"):
        _append_record(
            records,
            record_type="payment",
            source="draw",
            source_id=draw.id,
            customer=draw.agreement.homeowner,
            title=draw.title or f"Draw #{draw.draw_number}",
            description=draw.notes,
            status=draw.status,
            amount=draw.current_requested_amount,
            timestamp=_record_timestamp(draw.updated_at, draw.submitted_at, draw.created_at),
            url=f"/app/agreements/{draw.agreement_id}",
            primary_action_label="Open draw",
            needs_attention=draw.status in draw_attention_statuses,
        )

    for payment in ExternalPaymentRecord.objects.filter(agreement__contractor=contractor, agreement__homeowner_id__in=customer_ids).select_related("agreement__homeowner"):
        _append_record(
            records,
            record_type="payment",
            source="external_payment",
            source_id=payment.id,
            customer=payment.agreement.homeowner,
            title=payment.reference_number or "External payment",
            description=payment.notes,
            status=payment.status,
            amount=payment.net_amount,
            timestamp=_record_timestamp(payment.updated_at, payment.recorded_at),
            url=f"/app/agreements/{payment.agreement_id}",
            primary_action_label="Open payment",
            needs_attention=payment.status == ExternalPaymentStatus.DISPUTED,
        )

    for log in CustomerCommunicationLog.objects.filter(contractor=contractor, customer_id__in=customer_ids).select_related("customer"):
        _append_record(
            records,
            record_type="communication",
            source="communication_log",
            source_id=log.id,
            customer=log.customer,
            title=log.subject or log.get_communication_type_display(),
            description=log.body,
            status=log.direction,
            timestamp=_record_timestamp(log.occurred_at, log.created_at),
            url=f"/app/customers/{log.customer_id}#communication",
            primary_action_label="Open communication",
            needs_attention=bool(log.follow_up_at and log.follow_up_at <= timezone.now()),
        )

    summary_records = records[:]
    summary = {
        "all": len(summary_records),
        "requests": sum(1 for record in summary_records if record["type"] == "request"),
        "opportunities": sum(1 for record in summary_records if record["type"] == "opportunity"),
        "agreements": sum(1 for record in summary_records if record["type"] == "agreement"),
        "payments": sum(1 for record in summary_records if record["type"] == "payment"),
        "communications": sum(1 for record in summary_records if record["type"] == "communication"),
        "needs_attention": sum(1 for record in summary_records if record.get("needs_attention")),
    }

    filtered = [record for record in records if _record_matches_filters(record, params)]
    filtered.sort(key=lambda record: record.get("_timestamp"), reverse=True)

    page_size = max(1, min(int(params.get("page_size") or 20), 100))
    page = max(1, int(params.get("page") or 1))
    count = len(filtered)
    start = (page - 1) * page_size
    end = start + page_size
    page_rows = filtered[start:end]

    for record in page_rows:
        record.pop("_timestamp", None)

    return {
        "results": page_rows,
        "count": count,
        "summary": summary,
        "facets": {
            "types": ["request", "opportunity", "agreement", "payment", "communication"],
            "sources": sorted({record["source"] for record in summary_records if record.get("source")}),
        },
        "next": page + 1 if end < count else None,
        "previous": page - 1 if page > 1 else None,
    }


@api_view(["GET"])
@permission_classes([IsContractorOnly])
def customer_records(request: Request):
    contractor = _get_contractor_for_user(request.user)
    if contractor is None:
        raise PermissionDenied(detail={
            "detail": "Your account must be linked to a Contractor profile to access customer records.",
            "code": "contractor_required",
        })
    return Response(build_customer_records_payload(contractor, request.query_params))


def _lead_payload(lead: PublicContractorLead) -> dict:
    return {
        "id": lead.id,
        "type": "public_lead",
        "title": lead.project_type or lead.project_description or f"Lead #{lead.id}",
        "description": lead.project_description or "",
        "status": lead.status,
        "source": lead.source,
        "created_at": _iso(lead.created_at),
        "updated_at": _iso(lead.updated_at),
        "url": f"/app/opportunities?source={lead.source or 'website'}",
    }


def _intake_payload(intake: ProjectIntake) -> dict:
    return {
        "id": intake.id,
        "type": "project_intake",
        "title": intake.ai_project_title or intake.ai_project_type or intake.accomplishment_text or f"Request #{intake.id}",
        "description": intake.ai_description or intake.accomplishment_text or "",
        "status": intake.status,
        "created_at": _iso(intake.created_at),
        "updated_at": _iso(intake.updated_at),
        "url": f"/app/intake/new?intakeId={intake.id}",
    }


def _customer_request_payload(row: CustomerRequest) -> dict:
    return {
        "id": row.id,
        "type": "customer_request",
        "title": row.title or f"Customer Request #{row.id}",
        "description": row.description or "",
        "status": row.status,
        "request_type": row.request_type,
        "created_at": _iso(row.created_at),
        "updated_at": _iso(row.updated_at),
        "url": f"/app/customers/requests",
    }


def _opportunity_payload(row: ContractorOpportunity) -> dict:
    return {
        "id": row.id,
        "type": "contractor_opportunity",
        "title": row.project_title or row.project_type or f"Opportunity #{row.id}",
        "description": row.project_description or row.refined_description or "",
        "status": row.status,
        "created_at": _iso(row.created_at),
        "updated_at": _iso(row.updated_at),
        "url": "/app/opportunities",
    }


def _agreement_payload(row: Agreement) -> dict:
    project = getattr(row, "project", None)
    return {
        "id": row.id,
        "type": "agreement",
        "title": getattr(project, "title", "") or f"Agreement #{row.id}",
        "description": row.description or getattr(project, "description", "") or "",
        "status": row.status,
        "project_id": getattr(project, "id", None),
        "total": _money(row.total_cost),
        "created_at": _iso(row.created_at),
        "updated_at": _iso(row.updated_at),
        "url": f"/app/agreements/{row.id}",
    }


def _project_payload(row: Project) -> dict:
    return {
        "id": row.id,
        "title": row.title,
        "description": row.description or "",
        "status": row.status,
        "created_at": _iso(row.created_at),
        "updated_at": _iso(row.updated_at),
        "agreement_id": getattr(getattr(row, "agreement", None), "id", None),
        "url": f"/app/agreements/{getattr(getattr(row, 'agreement', None), 'id', '')}" if getattr(row, "agreement", None) else "",
    }


def _invoice_payload(row: Invoice) -> dict:
    return {
        "id": row.id,
        "type": "invoice",
        "invoice_number": row.invoice_number,
        "title": row.invoice_number or f"Invoice #{row.id}",
        "status": row.status,
        "amount": _money(row.amount),
        "agreement_id": row.agreement_id,
        "created_at": _iso(row.created_at),
        "updated_at": _iso(row.approved_at or row.created_at),
        "url": f"/app/invoices/{row.id}",
    }


def _property_payload(row: PropertyProfile) -> dict:
    return {
        "id": row.id,
        "display_name": row.display_name or row.address_line1 or f"Property #{row.id}",
        "address_line1": row.address_line1,
        "city": row.city,
        "state": row.state,
        "postal_code": row.postal_code,
        "updated_at": _iso(row.updated_at),
    }


def _document_payload(row: PropertyDocument) -> dict:
    return {
        "id": row.id,
        "title": row.title or getattr(row.file, "name", "") or f"Document #{row.id}",
        "document_type": row.document_type,
        "property_profile_id": row.property_profile_id,
        "created_at": _iso(row.uploaded_at),
    }


def build_customer_workspace_payload(customer: Homeowner, contractor, *, request=None) -> dict:
    email = _customer_email(customer)

    leads_qs = PublicContractorLead.objects.filter(contractor=contractor).filter(
        Q(converted_homeowner=customer) | _matching_email_filter("email", email)
    )
    intakes_qs = ProjectIntake.objects.filter(Q(contractor=contractor) | Q(contractor__isnull=True)).filter(
        Q(homeowner=customer) | _matching_email_filter("customer_email", email)
    )
    requests_qs = CustomerRequest.objects.filter(Q(homeowner=customer) | _matching_email_filter("customer_email", email))
    opportunities_qs = ContractorOpportunity.objects.filter(
        Q(directory_entry__claimed_by_contractor=contractor) | Q(accepted_by_contractor=contractor)
    ).filter(Q(converted_customer=customer) | _matching_email_filter("homeowner_email", email) | Q(intake_request__homeowner=customer))
    agreements_qs = Agreement.objects.select_related("project").filter(contractor=contractor, homeowner=customer)
    projects_qs = Project.objects.filter(contractor=contractor, homeowner=customer)
    invoices_qs = Invoice.objects.select_related("agreement").filter(agreement__contractor=contractor, agreement__homeowner=customer)
    properties_qs = PropertyProfile.objects.filter(Q(homeowner=customer) | _matching_email_filter("customer_email", email))
    documents_qs = PropertyDocument.objects.filter(property_profile__in=properties_qs)
    communications_qs = CustomerCommunicationLog.objects.filter(contractor=contractor, customer=customer)

    active_request_statuses = [
        CustomerRequest.STATUS_DRAFT,
        CustomerRequest.STATUS_SUBMITTED,
        CustomerRequest.STATUS_ROUTED,
        CustomerRequest.STATUS_MARKETPLACE_READY,
        CustomerRequest.STATUS_MATCHED,
    ]
    active_agreement_statuses = ["draft", "sent", "signed", "funded", "in_progress"]
    open_invoice_statuses = [
        InvoiceStatus.INCOMPLETE,
        InvoiceStatus.SENT,
        InvoiceStatus.PENDING,
        InvoiceStatus.APPROVED,
        InvoiceStatus.DISPUTED,
    ]

    open_balance = invoices_qs.filter(status__in=open_invoice_statuses).aggregate(total=Sum("amount")).get("total") or Decimal("0.00")
    lifetime_value = agreements_qs.aggregate(total=Sum("total_cost")).get("total") or Decimal("0.00")

    timeline = []
    _event(
        timeline,
        event_type="customer_created",
        title="Customer created",
        description=f"{customer.full_name} was added to Customers.",
        timestamp=customer.created_at,
        source="homeowner",
        source_id=customer.id,
        status=customer.status,
    )
    if customer.updated_at and customer.updated_at != customer.created_at:
        _event(
            timeline,
            event_type="customer_updated",
            title="Customer updated",
            description="Customer profile details were updated.",
            timestamp=customer.updated_at,
            source="homeowner",
            source_id=customer.id,
            status=customer.status,
        )

    leads = [_lead_payload(row) for row in leads_qs.order_by("-created_at", "-id")[:25]]
    for row in leads_qs.order_by("-created_at", "-id")[:25]:
        _event(
            timeline,
            event_type="lead",
            title=row.project_type or "Lead received",
            description=row.project_description or f"Lead source: {row.source}",
            timestamp=row.created_at,
            source="public_lead",
            source_id=row.id,
            url=f"/app/opportunities?source={row.source or 'website'}",
            status=row.status,
        )

    intakes = [_intake_payload(row) for row in intakes_qs.order_by("-updated_at", "-id")[:25]]
    for row in intakes_qs.order_by("-updated_at", "-id")[:25]:
        _event(
            timeline,
            event_type="request",
            title=row.ai_project_title or row.ai_project_type or "Project request",
            description=row.ai_description or row.accomplishment_text or "",
            timestamp=row.submitted_at or row.updated_at or row.created_at,
            source="project_intake",
            source_id=row.id,
            url=f"/app/intake/new?intakeId={row.id}",
            status=row.status,
        )

    customer_requests = [_customer_request_payload(row) for row in requests_qs.order_by("-updated_at", "-id")[:25]]
    for row in requests_qs.order_by("-updated_at", "-id")[:25]:
        _event(
            timeline,
            event_type="customer_request",
            title=row.title or "Customer request",
            description=row.description or "",
            timestamp=row.updated_at or row.created_at,
            source="customer_request",
            source_id=row.id,
            url="/app/customers/requests",
            status=row.status,
        )

    opportunities = [_opportunity_payload(row) for row in opportunities_qs.order_by("-updated_at", "-id")[:25]]
    for row in opportunities_qs.order_by("-updated_at", "-id")[:25]:
        _event(
            timeline,
            event_type="opportunity",
            title=row.project_title or row.project_type or "Opportunity",
            description=row.project_description or row.refined_description or "",
            timestamp=row.updated_at or row.selected_at or row.created_at,
            source="contractor_opportunity",
            source_id=row.id,
            url="/app/opportunities",
            status=row.status,
        )

    agreements = [_agreement_payload(row) for row in agreements_qs.order_by("-updated_at", "-id")[:25]]
    for row in agreements_qs.order_by("-updated_at", "-id")[:25]:
        project = getattr(row, "project", None)
        _event(
            timeline,
            event_type="agreement",
            title=getattr(project, "title", "") or "Agreement",
            description=row.description or "",
            timestamp=row.updated_at or row.created_at,
            source="agreement",
            source_id=row.id,
            url=f"/app/agreements/{row.id}",
            amount=row.total_cost,
            status=row.status,
        )

    projects = [_project_payload(row) for row in projects_qs.order_by("-updated_at", "-id")[:25]]
    payments = [_invoice_payload(row) for row in invoices_qs.order_by("-created_at", "-id")[:25]]
    for row in invoices_qs.order_by("-created_at", "-id")[:25]:
        _event(
            timeline,
            event_type="invoice",
            title=row.invoice_number or "Invoice",
            description="Invoice activity",
            timestamp=row.approved_at or row.created_at,
            source="invoice",
            source_id=row.id,
            url=f"/app/invoices/{row.id}",
            amount=row.amount,
            status=row.status,
        )

    properties = [_property_payload(row) for row in properties_qs.order_by("-updated_at", "-id")[:25]]
    documents = [_document_payload(row) for row in documents_qs.order_by("-uploaded_at", "-id")[:25]]
    communications = [_communication_payload(row) for row in communications_qs.order_by("-occurred_at", "-id")[:50]]
    for row in communications_qs.order_by("-occurred_at", "-id")[:50]:
        _event(
            timeline,
            event_type=row.communication_type,
            title=row.subject or row.get_communication_type_display(),
            description=row.body or "",
            timestamp=row.occurred_at,
            source="communication_log",
            source_id=row.id,
            status=row.direction,
        )
    timeline = sorted(
        [event for event in timeline if event.get("timestamp")],
        key=lambda event: event["timestamp"],
        reverse=True,
    )[:50]

    last_activity = timeline[0]["timestamp"] if timeline else _iso(customer.updated_at or customer.created_at)
    active_requests_count = (
        requests_qs.filter(status__in=active_request_statuses).count()
        + intakes_qs.exclude(status__in=["converted"]).count()
        + leads_qs.exclude(status__in=["rejected", "closed", "archived"]).count()
        + opportunities_qs.filter(status__in=[ContractorOpportunity.STATUS_PENDING, ContractorOpportunity.STATUS_ACCEPTED]).count()
    )
    active_work_count = agreements_qs.filter(status__in=active_agreement_statuses).count() + projects_qs.exclude(status__in=["completed", "archived", "cancelled"]).count()

    return {
        "customer": HomeownerSerializer(customer, context={"request": request}).data,
        "contact": {
            "name": customer.full_name,
            "company_name": customer.company_name,
            "email": customer.email,
            "phone": customer.phone_number,
            "status": customer.status,
            "address": {
                "street_address": customer.street_address,
                "address_line_2": customer.address_line_2,
                "city": customer.city,
                "state": customer.state,
                "zip_code": customer.zip_code,
            },
        },
        "stats": {
            "active_requests": active_requests_count,
            "active_agreements_projects": active_work_count,
            "open_balance": _money(open_balance),
            "lifetime_value": _money(lifetime_value),
            "last_activity": last_activity,
            "customer_since": _iso(customer.created_at),
        },
        "related": {
            "leads": leads,
            "project_intakes": intakes,
            "customer_requests": customer_requests,
            "opportunities": opportunities,
            "agreements": agreements,
            "projects": projects,
            "payments": payments,
            "properties": properties,
            "documents": documents,
            "communication": communications,
        },
        "timeline": timeline,
        "gaps": {},
    }
