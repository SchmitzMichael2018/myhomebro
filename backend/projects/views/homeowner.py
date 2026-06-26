# backend/projects/views/homeowner.py
from __future__ import annotations

from decimal import Decimal

from django.db.models import Count, Q, Sum
from rest_framework import viewsets, filters, permissions, status
from rest_framework.decorators import action
from rest_framework.response import Response
from rest_framework.exceptions import PermissionDenied, NotFound
from rest_framework.request import Request

from projects.models import Agreement, Homeowner, Invoice, InvoiceStatus, Project, PublicContractorLead
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
            "communication": [],
        },
        "timeline": timeline,
        "gaps": {
            "communication": "No contractor-side customer communication timeline is available yet.",
        },
    }
