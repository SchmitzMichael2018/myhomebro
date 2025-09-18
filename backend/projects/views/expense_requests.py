# backend/projects/views/expense_requests.py
from __future__ import annotations

from django.utils import timezone
from rest_framework import viewsets, permissions, status
from rest_framework.decorators import action
from rest_framework.response import Response
from rest_framework.request import Request

from projects.models import ExpenseRequest
from projects.serializers.expense_request import ExpenseRequestSerializer


class IsAuthenticatedOrReadOnly(permissions.BasePermission):
    def has_permission(self, request, view):
        if request.method in ("GET", "HEAD", "OPTIONS"):
            return True
        return bool(request.user and request.user.is_authenticated)


class ExpenseRequestViewSet(viewsets.ModelViewSet):
    """
    Stand-alone expenses flow:
      - create with description/amount/receipt
      - contractor_sign (locks content)
      - send_to_homeowner (notifies/marks SENT)
      - homeowner_accept / homeowner_reject
      - mark_paid
    """
    queryset = ExpenseRequest.objects.all().order_by("-created_at", "id")
    serializer_class = ExpenseRequestSerializer
    permission_classes = [IsAuthenticatedOrReadOnly]

    def get_queryset(self):
        qs = super().get_queryset()
        user = getattr(self.request, "user", None)
        if user and getattr(user, "is_authenticated", False):
            # TODO: scope by contractor if your model links Agreement to contractor
            return qs
        return qs.none()

    def perform_create(self, serializer):
        serializer.save(created_by=self.request.user if self.request.user.is_authenticated else None)

    @action(detail=True, methods=["post"])
    def contractor_sign(self, request: Request, pk=None):
        expense = self.get_object()
        if expense.status != ExpenseRequest.Status.DRAFT:
            return Response({"detail": "Only Draft expenses can be signed."}, status=400)
        expense.status = ExpenseRequest.Status.CONTRACTOR_SIGNED
        expense.contractor_signed_at = timezone.now()
        expense.save(update_fields=["status", "contractor_signed_at", "updated_at"])
        return Response(self.get_serializer(expense).data)

    @action(detail=True, methods=["post"])
    def send_to_homeowner(self, request: Request, pk=None):
        expense = self.get_object()
        if expense.status not in [ExpenseRequest.Status.CONTRACTOR_SIGNED, ExpenseRequest.Status.DRAFT]:
            return Response({"detail": "Expense must be Draft or Contractor Signed to send."}, status=400)
        if expense.status == ExpenseRequest.Status.DRAFT:
            # auto-sign if they forgot
            expense.status = ExpenseRequest.Status.CONTRACTOR_SIGNED
            expense.contractor_signed_at = timezone.now()
        expense.status = ExpenseRequest.Status.SENT_TO_HOMEOWNER
        expense.save(update_fields=["status", "contractor_signed_at", "updated_at"])
        # TODO: enqueue email notification to homeowner
        return Response(self.get_serializer(expense).data)

    @action(detail=True, methods=["post"])
    def homeowner_accept(self, request: Request, pk=None):
        expense = self.get_object()
        if expense.status != ExpenseRequest.Status.SENT_TO_HOMEOWNER:
            return Response({"detail": "Only sent expenses can be accepted."}, status=400)
        expense.status = ExpenseRequest.Status.HOMEOWNER_ACCEPTED
        expense.homeowner_acted_at = timezone.now()
        expense.save(update_fields=["status", "homeowner_acted_at", "updated_at"])
        # TODO: create/trigger payment invoice or charge flow
        return Response(self.get_serializer(expense).data)

    @action(detail=True, methods=["post"])
    def homeowner_reject(self, request: Request, pk=None):
        expense = self.get_object()
        if expense.status != ExpenseRequest.Status.SENT_TO_HOMEOWNER:
            return Response({"detail": "Only sent expenses can be rejected."}, status=400)
        expense.status = ExpenseRequest.Status.HOMEOWNER_REJECTED
        expense.homeowner_acted_at = timezone.now()
        expense.save(update_fields=["status", "homeowner_acted_at", "updated_at"])
        return Response(self.get_serializer(expense).data)

    @action(detail=True, methods=["post"])
    def mark_paid(self, request: Request, pk=None):
        expense = self.get_object()
        if expense.status not in [
            ExpenseRequest.Status.HOMEOWNER_ACCEPTED,
            ExpenseRequest.Status.SENT_TO_HOMEOWNER,
        ]:
            return Response({"detail": "Only accepted or sent expenses can be marked paid."}, status=400)
        expense.status = ExpenseRequest.Status.PAID
        expense.paid_at = timezone.now()
        expense.save(update_fields=["status", "paid_at", "updated_at"])
        return Response(self.get_serializer(expense).data)
