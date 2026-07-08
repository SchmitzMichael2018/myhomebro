from __future__ import annotations

from datetime import timedelta

from django.shortcuts import get_object_or_404
from django.db.models import Count, Q
from django.utils import timezone

from rest_framework import permissions, status, viewsets
from rest_framework.decorators import action
from rest_framework.exceptions import PermissionDenied
from rest_framework.parsers import FormParser, JSONParser, MultiPartParser
from rest_framework.response import Response
from rest_framework.views import APIView

from projects.models import Agreement, AgreementWarranty
from projects.models_warranty import WarrantyRequest, WarrantyRequestEvidence
from projects.serializers.dispute import DisputeSerializer
from projects.serializers.warranty import (
    AgreementWarrantySerializer,
    WarrantyRequestEvidenceSerializer,
    WarrantyRequestSerializer,
    WarrantyRequestStatusHistorySerializer,
    WarrantyWorkOrderSerializer,
)
from projects.services.agreements.project_create import resolve_contractor_for_user
from projects.services.warranty_management import (
    acknowledge_warranty_completion,
    build_warranty_ai_review,
    complete_warranty_work_order,
    create_initial_status,
    create_warranty_work_order,
    ensure_warranties_for_completed_agreement,
    escalate_warranty_request_to_resolution,
    record_warranty_status,
)


class AgreementWarrantyViewSet(viewsets.ModelViewSet):
    permission_classes = [permissions.IsAuthenticated]
    serializer_class = AgreementWarrantySerializer
    queryset = AgreementWarranty.objects.select_related(
        "agreement",
        "agreement__project",
        "contractor",
    ).order_by("-start_date", "-created_at", "-id")

    def get_queryset(self):
        qs = super().get_queryset()

        user = getattr(self.request, "user", None)
        if not user or not user.is_authenticated:
            return qs.none()

        if not (user.is_staff or user.is_superuser):
            contractor = resolve_contractor_for_user(user)
            if contractor is None:
                return qs.none()
            qs = qs.filter(contractor=contractor)

        agreement_id = (self.request.query_params.get("agreement") or "").strip()
        if agreement_id:
            qs = qs.filter(agreement_id=agreement_id)

        status_value = (self.request.query_params.get("status") or "").strip().lower()
        if status_value:
            qs = qs.filter(status=status_value)

        return qs

    @action(detail=False, methods=["post"], url_path="generate-for-completed")
    def generate_for_completed(self, request):
        agreement_id = request.data.get("agreement") or request.data.get("agreement_id")
        if not agreement_id:
            return Response({"detail": "agreement is required."}, status=status.HTTP_400_BAD_REQUEST)
        try:
            agreement = Agreement.objects.select_related("contractor").get(pk=agreement_id)
        except Agreement.DoesNotExist:
            return Response({"detail": "Agreement not found."}, status=status.HTTP_404_NOT_FOUND)
        user = request.user
        if not (user.is_staff or user.is_superuser):
            contractor = resolve_contractor_for_user(user)
            if contractor is None or agreement.contractor_id != contractor.id:
                raise PermissionDenied("You can only generate warranties for your own agreements.")
        warranties = ensure_warranties_for_completed_agreement(agreement)
        return Response(AgreementWarrantySerializer(warranties, many=True, context={"request": request}).data, status=200)

    def perform_create(self, serializer):
        agreement = serializer.validated_data["agreement"]
        contractor = agreement.contractor
        user = getattr(self.request, "user", None)

        if not contractor:
            raise PermissionDenied("Agreement is missing a contractor.")

        if not (user and (user.is_staff or user.is_superuser)):
            resolved = resolve_contractor_for_user(user)
            if resolved is None or resolved.id != contractor.id:
                raise PermissionDenied(
                    "You can only manage warranty records for your own agreements."
                )

        serializer.save(contractor=contractor)

    def perform_update(self, serializer):
        agreement = serializer.instance.agreement
        contractor = agreement.contractor
        user = getattr(self.request, "user", None)

        if not contractor:
            raise PermissionDenied("Agreement is missing a contractor.")

        if not (user and (user.is_staff or user.is_superuser)):
            resolved = resolve_contractor_for_user(user)
            if resolved is None or resolved.id != contractor.id:
                raise PermissionDenied(
                    "You can only manage warranty records for your own agreements."
                )

        serializer.save(contractor=contractor, agreement=agreement)


class WarrantyDashboardView(APIView):
    permission_classes = [permissions.IsAuthenticated]

    def get(self, request):
        contractor = resolve_contractor_for_user(request.user)
        if contractor is None and not (request.user.is_staff or request.user.is_superuser):
            return Response({"detail": "Contractor account required."}, status=status.HTTP_403_FORBIDDEN)
        warranties = AgreementWarranty.objects.select_related("agreement", "agreement__project", "agreement__homeowner", "contractor")
        requests = WarrantyRequest.objects.select_related("warranty", "agreement", "project", "homeowner", "contractor")
        if contractor is not None and not request.user.is_staff:
            warranties = warranties.filter(contractor=contractor)
            requests = requests.filter(contractor=contractor)

        today = timezone.localdate()
        soon = today + timedelta(days=30)
        open_statuses = [
            WarrantyRequest.STATUS_SUBMITTED,
            WarrantyRequest.STATUS_UNDER_REVIEW,
            WarrantyRequest.STATUS_MORE_INFORMATION_REQUESTED,
            WarrantyRequest.STATUS_INSPECTION_SCHEDULED,
            WarrantyRequest.STATUS_INSPECTION_COMPLETE,
            WarrantyRequest.STATUS_COVERED,
            WarrantyRequest.STATUS_PARTIALLY_COVERED,
            WarrantyRequest.STATUS_REPAIR_SCHEDULED,
            WarrantyRequest.STATUS_REPAIR_IN_PROGRESS,
            WarrantyRequest.STATUS_WAITING_ON_CUSTOMER,
            WarrantyRequest.STATUS_WAITING_ON_MATERIALS,
        ]
        data = {
            "metrics": {
                "active_warranties": warranties.filter(status="active").count(),
                "open_warranty_requests": requests.filter(status__in=open_statuses).count(),
                "repairs_scheduled": requests.filter(status=WarrantyRequest.STATUS_REPAIR_SCHEDULED).count(),
                "repairs_in_progress": requests.filter(status=WarrantyRequest.STATUS_REPAIR_IN_PROGRESS).count(),
                "expiring_soon": warranties.filter(status="active", end_date__gte=today, end_date__lte=soon).count(),
                "expired": warranties.filter(Q(status="expired") | Q(end_date__lt=today)).count(),
                "warranty_risk": requests.filter(status__in=[WarrantyRequest.STATUS_NOT_COVERED, WarrantyRequest.STATUS_DENIED]).count(),
            },
            "assistant_summary": "",
            "warranties": AgreementWarrantySerializer(warranties[:50], many=True, context={"request": request}).data,
            "requests": WarrantyRequestSerializer(requests[:50], many=True, context={"request": request}).data,
        }
        data["assistant_summary"] = (
            f"You currently have {data['metrics']['active_warranties']} active warranties. "
            f"{data['metrics']['expiring_soon']} expire within the next 30 days. "
            f"{data['metrics']['open_warranty_requests']} warranty request"
            f"{'' if data['metrics']['open_warranty_requests'] == 1 else 's'} require attention."
        )
        return Response(data, status=200)


class WarrantyRequestViewSet(viewsets.ModelViewSet):
    permission_classes = [permissions.IsAuthenticated]
    serializer_class = WarrantyRequestSerializer
    queryset = WarrantyRequest.objects.select_related(
        "warranty",
        "agreement",
        "project",
        "contractor",
        "homeowner",
    ).prefetch_related("status_history", "evidence").order_by("-created_at", "-id")

    def get_queryset(self):
        qs = super().get_queryset()
        user = self.request.user
        if user.is_staff or user.is_superuser:
            return qs
        contractor = resolve_contractor_for_user(user)
        if contractor is not None:
            return qs.filter(contractor=contractor)
        return qs.none()

    def perform_create(self, serializer):
        warranty = serializer.validated_data["warranty"]
        agreement = warranty.agreement
        contractor = resolve_contractor_for_user(self.request.user)
        if not (self.request.user.is_staff or self.request.user.is_superuser):
            if contractor is None or warranty.contractor_id != contractor.id:
                raise PermissionDenied("You can only create warranty requests for your own warranties.")
        row = serializer.save(
            agreement=agreement,
            project=getattr(agreement, "project", None),
            contractor=warranty.contractor,
            homeowner=getattr(agreement, "homeowner", None),
            submitted_by=self.request.user,
            submitted_by_email=getattr(self.request.user, "email", "") or "",
            source_context={
                "agreement_id": agreement.id,
                "project_id": getattr(agreement, "project_id", None),
                "completion_date": warranty.completion_date.isoformat() if warranty.completion_date else "",
                "warranty_start_date": warranty.start_date.isoformat() if warranty.start_date else "",
                "warranty_end_date": warranty.end_date.isoformat() if warranty.end_date else "",
            },
        )
        create_initial_status(row, actor=self.request.user)

    @action(detail=True, methods=["post"], url_path="status")
    def set_status(self, request, pk=None):
        row = self.get_object()
        next_status = (request.data.get("status") or "").strip()
        allowed = {choice[0] for choice in WarrantyRequest.STATUS_CHOICES}
        if next_status not in allowed:
            return Response({"detail": "Valid status is required."}, status=status.HTTP_400_BAD_REQUEST)
        changed = []
        for field in ("coverage_decision", "contractor_response", "next_expected_action"):
            if field in request.data:
                setattr(row, field, (request.data.get(field) or "").strip())
                changed.append(field)
        if "response_due_at" in request.data:
            row.response_due_at = request.data.get("response_due_at") or None
            changed.append("response_due_at")
        if changed:
            row.save(update_fields=list(dict.fromkeys(changed + ["updated_at"])))
        event = record_warranty_status(row, next_status, actor=request.user, note=(request.data.get("note") or "").strip(), metadata={"coverage_decision": row.coverage_decision})
        return Response(WarrantyRequestStatusHistorySerializer(event, context={"request": request}).data, status=200)

    @action(detail=True, methods=["post"], parser_classes=[MultiPartParser, FormParser], url_path="evidence")
    def evidence(self, request, pk=None):
        row = self.get_object()
        file_obj = request.FILES.get("file")
        if not file_obj:
            return Response({"detail": "Missing file."}, status=status.HTTP_400_BAD_REQUEST)
        evidence = WarrantyRequestEvidence.objects.create(
            warranty_request=row,
            file=file_obj,
            evidence_type=(request.data.get("evidence_type") or "other").strip(),
            description=(request.data.get("description") or "").strip(),
            original_filename=getattr(file_obj, "name", "") or "",
            content_type=getattr(file_obj, "content_type", "") or "",
            size_bytes=getattr(file_obj, "size", 0) or 0,
            uploaded_by=request.user,
            uploaded_by_email=getattr(request.user, "email", "") or "",
        )
        record_warranty_status(row, row.status, actor=request.user, note="Warranty evidence uploaded.", metadata={"evidence_id": evidence.id})
        return Response(WarrantyRequestEvidenceSerializer(evidence, context={"request": request}).data, status=201)

    @action(detail=True, methods=["post"], url_path="ai-review")
    def ai_review(self, request, pk=None):
        row = self.get_object()
        row.ai_review = build_warranty_ai_review(row)
        row.save(update_fields=["ai_review", "updated_at"])
        record_warranty_status(row, row.status, actor=request.user, note="Warranty Assistant advisory review generated.")
        return Response({"ai_review": row.ai_review}, status=200)

    @action(detail=True, methods=["post"], url_path="work-order")
    def work_order(self, request, pk=None):
        row = self.get_object()
        work_order = create_warranty_work_order(row, actor=request.user, payload=request.data)
        return Response(WarrantyWorkOrderSerializer(work_order, context={"request": request}).data, status=201)

    @action(detail=True, methods=["post"], url_path="work-order/complete")
    def complete_work_order_action(self, request, pk=None):
        row = self.get_object()
        work_order = getattr(row, "work_order", None)
        if work_order is None:
            return Response({"detail": "Warranty work order not found."}, status=status.HTTP_404_NOT_FOUND)
        updated = complete_warranty_work_order(work_order, actor=request.user, notes=(request.data.get("notes") or "").strip())
        return Response(WarrantyWorkOrderSerializer(updated, context={"request": request}).data, status=200)

    @action(detail=True, methods=["post"], url_path="escalate")
    def escalate(self, request, pk=None):
        row = self.get_object()
        dispute = escalate_warranty_request_to_resolution(row, actor=request.user, note=(request.data.get("note") or "").strip())
        return Response(DisputeSerializer(dispute, context={"request": request}).data, status=201)


class CustomerWarrantyRequestView(APIView):
    permission_classes = [permissions.AllowAny]
    parser_classes = [JSONParser, MultiPartParser, FormParser]

    def post(self, request, token):
        agreement = get_object_or_404(
            Agreement.objects.select_related("contractor", "homeowner", "project"),
            homeowner_access_token=token,
        )
        warranty_id = request.data.get("warranty") or request.data.get("warranty_id")
        warranties = AgreementWarranty.objects.filter(agreement=agreement, status="active").order_by("-end_date", "-id")
        if warranty_id:
            warranties = warranties.filter(pk=warranty_id)
        warranty = warranties.first()
        if warranty is None:
            generated = ensure_warranties_for_completed_agreement(agreement)
            warranty = generated[0] if generated else None
        if warranty is None:
            return Response({"detail": "No active warranty is available for this agreement."}, status=status.HTTP_400_BAD_REQUEST)

        title = (request.data.get("title") or request.data.get("issue_title") or "").strip()
        description = (request.data.get("description") or request.data.get("issue_description") or "").strip()
        if not title:
            return Response({"title": ["Issue title is required."]}, status=status.HTTP_400_BAD_REQUEST)
        if not description:
            return Response({"description": ["Issue description is required."]}, status=status.HTTP_400_BAD_REQUEST)

        row = WarrantyRequest.objects.create(
            warranty=warranty,
            agreement=agreement,
            project=getattr(agreement, "project", None),
            contractor=agreement.contractor,
            homeowner=getattr(agreement, "homeowner", None),
            title=title,
            description=description,
            date_noticed=request.data.get("date_noticed") or None,
            area_affected=(request.data.get("area_affected") or "").strip(),
            severity=(request.data.get("severity") or WarrantyRequest.SEVERITY_NORMAL).strip(),
            urgency=(request.data.get("urgency") or "").strip(),
            other_contractor_worked=_truthy(request.data.get("other_contractor_worked")),
            preferred_scheduling=(request.data.get("preferred_scheduling") or "").strip(),
            customer_notes=(request.data.get("customer_notes") or "").strip(),
            submitted_by_email=(
                request.data.get("email")
                or getattr(getattr(agreement, "homeowner", None), "email", "")
                or ""
            ),
            source_context={
                "source": "customer_portal",
                "agreement_id": agreement.id,
                "project_id": getattr(agreement, "project_id", None),
                "warranty_id": warranty.id,
                "completion_date": warranty.completion_date.isoformat() if warranty.completion_date else "",
                "warranty_start_date": warranty.start_date.isoformat() if warranty.start_date else "",
                "warranty_end_date": warranty.end_date.isoformat() if warranty.end_date else "",
            },
        )
        create_initial_status(row)

        files = list(request.FILES.getlist("files")) + list(request.FILES.getlist("files[]"))
        if request.FILES.get("file"):
            files.append(request.FILES["file"])
        for file_obj in files:
            WarrantyRequestEvidence.objects.create(
                warranty_request=row,
                file=file_obj,
                evidence_type=(request.data.get("evidence_type") or "other").strip(),
                description=(request.data.get("evidence_description") or "").strip(),
                original_filename=getattr(file_obj, "name", "") or "",
                content_type=getattr(file_obj, "content_type", "") or "",
                size_bytes=getattr(file_obj, "size", 0) or 0,
                uploaded_by_email=row.submitted_by_email,
            )
        if files:
            record_warranty_status(
                row,
                row.status,
                note="Customer uploaded warranty evidence.",
                metadata={"evidence_count": len(files)},
            )

        return Response(WarrantyRequestSerializer(row, context={"request": request}).data, status=status.HTTP_201_CREATED)


class CustomerWarrantyEvidenceView(APIView):
    permission_classes = [permissions.AllowAny]
    parser_classes = [MultiPartParser, FormParser]

    def post(self, request, token, request_id):
        row = _customer_warranty_request_or_404(token, request_id)
        files = list(request.FILES.getlist("files")) + list(request.FILES.getlist("files[]"))
        if request.FILES.get("file"):
            files.append(request.FILES["file"])
        if not files:
            return Response({"detail": "Please attach at least one file."}, status=status.HTTP_400_BAD_REQUEST)
        created = []
        for file_obj in files:
            created.append(
                WarrantyRequestEvidence.objects.create(
                    warranty_request=row,
                    file=file_obj,
                    evidence_type=(request.data.get("evidence_type") or "other").strip(),
                    description=(request.data.get("description") or "").strip(),
                    original_filename=getattr(file_obj, "name", "") or "",
                    content_type=getattr(file_obj, "content_type", "") or "",
                    size_bytes=getattr(file_obj, "size", 0) or 0,
                    uploaded_by_email=row.submitted_by_email,
                )
            )
        record_warranty_status(
            row,
            row.status,
            note="Customer uploaded additional warranty evidence.",
            metadata={"evidence_count": len(created), "evidence_ids": [item.id for item in created]},
        )
        return Response(WarrantyRequestEvidenceSerializer(created, many=True, context={"request": request}).data, status=201)


class CustomerWarrantyAcknowledgmentView(APIView):
    permission_classes = [permissions.AllowAny]
    parser_classes = [JSONParser, FormParser, MultiPartParser]

    def post(self, request, token, request_id):
        row = _customer_warranty_request_or_404(token, request_id)
        action_value = (request.data.get("action") or request.data.get("response") or "").strip().lower()
        accepted = action_value in {"accept", "accepted", "accept_completion"}
        if not accepted and action_value not in {"issue_still_exists", "report_issue", "unresolved", "request_resolution_review"}:
            return Response({"detail": "Use action=accept_completion or action=issue_still_exists."}, status=status.HTTP_400_BAD_REQUEST)
        updated = acknowledge_warranty_completion(
            row,
            accepted=accepted,
            actor_email=row.submitted_by_email,
            note=(request.data.get("note") or request.data.get("unresolved_reason") or "").strip(),
        )
        return Response(WarrantyRequestSerializer(updated, context={"request": request}).data, status=200)


def _truthy(value) -> bool:
    if isinstance(value, bool):
        return value
    return str(value or "").strip().lower() in {"1", "true", "yes", "y", "on"}


def _customer_warranty_request_or_404(token, request_id):
    agreement = get_object_or_404(
        Agreement.objects.select_related("contractor", "homeowner", "project"),
        homeowner_access_token=token,
    )
    return get_object_or_404(
        WarrantyRequest.objects.select_related("warranty", "agreement", "project", "contractor", "homeowner"),
        pk=request_id,
        agreement=agreement,
    )
