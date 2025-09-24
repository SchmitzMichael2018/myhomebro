# backend/projects/views/milestone.py
from django.shortcuts import get_object_or_404
from django.db import transaction
from rest_framework import viewsets, status, permissions
from rest_framework.decorators import action
from rest_framework.response import Response
from rest_framework.exceptions import PermissionDenied, NotFound

from ..models import Milestone, MilestoneFile, MilestoneComment, Invoice, InvoiceStatus, Agreement
from ..serializers import MilestoneSerializer, MilestoneFileSerializer, MilestoneCommentSerializer
from ..tasks import task_send_invoice_notification

class MilestoneViewSet(viewsets.ModelViewSet):
    """
    Milestones are visible only to the contractor who owns the project.
    If ?agreement=<id> is provided, scope strictly to that agreement.
    """
    serializer_class = MilestoneSerializer
    permission_classes = [permissions.IsAuthenticated]

    def get_queryset(self):
        user = self.request.user
        qs = (
            Milestone.objects.filter(agreement__project__contractor__user=user)
            .select_related("agreement", "agreement__project")
            .order_by("order", "id")
            .distinct()
        )
        agreement_id = self.request.query_params.get("agreement")
        if agreement_id:
            try:
                agreement_id = int(agreement_id)
            except (TypeError, ValueError):
                return Milestone.objects.none()
            qs = qs.filter(agreement_id=agreement_id)
        return qs

    def _ensure_owns_agreement(self, agreement_id: int):
        ag = get_object_or_404(Agreement, pk=agreement_id)
        if ag.project.contractor.user != self.request.user:
            raise PermissionDenied("You do not have permission for this agreement.")
        return ag

    @transaction.atomic
    def perform_create(self, serializer):
        # enforce ownership on create
        agreement_obj = serializer.validated_data.get("agreement")
        agreement_id = getattr(agreement_obj, "id", None) if agreement_obj else self.request.data.get("agreement")
        if not agreement_id:
            raise PermissionDenied("An agreement is required for milestone creation.")
        ag = self._ensure_owns_agreement(int(agreement_id))
        serializer.save(agreement=ag)

    @transaction.atomic
    def perform_update(self, serializer):
        instance: Milestone = self.get_object()
        incoming_agreement = serializer.validated_data.get("agreement")
        if incoming_agreement and incoming_agreement.id != instance.agreement_id:
            raise PermissionDenied("Cannot change the agreement of an existing milestone.")
        self._ensure_owns_agreement(instance.agreement_id)
        serializer.save()

    @action(detail=True, methods=["post"])
    def mark_complete(self, request, pk=None):
        milestone = self.get_object()
        agreement = milestone.agreement
        if not agreement.is_fully_signed:
            raise PermissionDenied("Cannot complete milestones until the agreement is fully signed.")
        if not agreement.escrow_funded:
            raise PermissionDenied("Cannot complete milestones until the escrow is funded.")
        if request.user != agreement.project.contractor.user:
            raise PermissionDenied("Only the project contractor may mark a milestone as complete.")
        if milestone.completed:
            return Response({"detail": "This milestone has already been marked as complete."},
                            status=status.HTTP_400_BAD_REQUEST)
        milestone.completed = True
        milestone.save(update_fields=["completed"])
        return Response(self.get_serializer(milestone).data)

    @action(detail=True, methods=["post"], url_path="send-invoice")
    def send_invoice(self, request, pk=None):
        milestone = self.get_object()
        if request.user != milestone.agreement.project.contractor.user:
            raise PermissionDenied("Only the contractor may send invoices.")
        if not milestone.completed:
            return Response({"detail": "Cannot invoice for an incomplete milestone."},
                            status=status.HTTP_400_BAD_REQUEST)
        if milestone.is_invoiced:
            return Response({"detail": "An invoice has already been sent for this milestone."},
                            status=status.HTTP_400_BAD_REQUEST)
        invoice = Invoice.objects.create(
            agreement=milestone.agreement,
            amount=milestone.amount,
            status=InvoiceStatus.PENDING,
        )
        milestone.is_invoiced = True
        milestone.save(update_fields=["is_invoiced"])
        try:
            task_send_invoice_notification.delay(invoice.id)
        except Exception:
            pass
        return Response(
            {"status": "success", "message": "Invoice created and notification sent.", "invoice_id": invoice.id},
            status=status.HTTP_201_CREATED,
        )

class MilestoneFileViewSet(viewsets.ModelViewSet):
    serializer_class = MilestoneFileSerializer
    permission_classes = [permissions.IsAuthenticated]

    def get_queryset(self):
        user = self.request.user
        return (
            MilestoneFile.objects.filter(milestone__agreement__project__contractor__user=user)
            .select_related("uploaded_by")
            .order_by("-created_at", "id")
        )

    def perform_create(self, serializer):
        milestone_id = self.request.data.get("milestone")
        milestone = get_object_or_404(Milestone, pk=milestone_id)
        if milestone.agreement.project.contractor.user != self.request.user:
            raise PermissionDenied("You do not have permission to upload files to this milestone.")
        serializer.save(uploaded_by=self.request.user, milestone=milestone)

class MilestoneCommentViewSet(viewsets.ModelViewSet):
    serializer_class = MilestoneCommentSerializer
    permission_classes = [permissions.IsAuthenticated]

    def get_parent_milestone(self):
        milestone_pk = self.kwargs.get("milestone_pk")
        user = self.request.user
        try:
            return Milestone.objects.get(
                pk=milestone_pk,
                agreement__project__contractor__user=user,
            )
        except Milestone.DoesNotExist:
            raise NotFound("Milestone not found or you do not have permission.")

    def get_queryset(self):
        milestone = self.get_parent_milestone()
        return milestone.comments.select_related("author").order_by("created_at")

    def perform_create(self, serializer):
        milestone = self.get_parent_milestone()
        serializer.save(author=self.request.user, milestone=milestone)
