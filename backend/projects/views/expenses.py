# backend/backend/projects/views/expenses.py
from __future__ import annotations

from django.db.utils import OperationalError, ProgrammingError
from rest_framework import viewsets, permissions, status
from rest_framework.decorators import action
from rest_framework.response import Response

from projects.models import Expense, ExpenseStatus
from projects.serializers.expense import ExpenseSerializer


class IsAuthenticatedOrReadOnly(permissions.BasePermission):
    def has_permission(self, request, view):
        if request.method in ("GET", "HEAD", "OPTIONS"):
            return True
        return bool(request.user and request.user.is_authenticated)


class ExpenseViewSet(viewsets.ModelViewSet):
    """
    Expense API aligned with Expense model.

    Flow:
      - create() -> status = pending
      - send_to_homeowner -> still pending (placeholder for notification)
      - homeowner_accept -> approved
      - homeowner_reject -> disputed
      - mark_paid -> paid
    """
    queryset = Expense.objects.none()
    serializer_class = ExpenseSerializer
    permission_classes = [IsAuthenticatedOrReadOnly]

    def get_queryset(self):
        try:
            qs = (
                Expense.objects
                .select_related("agreement", "agreement__contractor")
                .all()
                .order_by("-created_at", "id")
            )
        except (OperationalError, ProgrammingError):
            return Expense.objects.none()

        user = getattr(self.request, "user", None)
        if user and getattr(user, "is_authenticated", False):
            contractor = getattr(user, "contractor_profile", None)
            if contractor:
                return qs.filter(agreement__contractor=contractor)
            return qs
        return qs.none()

    def perform_create(self, serializer):
        serializer.save(
            created_by=self.request.user if getattr(self.request.user, "is_authenticated", False) else None,
            status=ExpenseStatus.PENDING,
        )

    @action(detail=True, methods=["post"])
    def send_to_homeowner(self, request, pk=None):
        try:
            expense: Expense = self.get_object()
        except (OperationalError, ProgrammingError):
            return Response({"detail": "Expenses table unavailable."}, status=status.HTTP_503_SERVICE_UNAVAILABLE)

        if expense.status != ExpenseStatus.PENDING:
            return Response({"detail": "Only pending expenses can be sent to homeowner."},
                            status=status.HTTP_400_BAD_REQUEST)
        # TODO: trigger notification here
        return Response(self.get_serializer(expense).data)

    @action(detail=True, methods=["post"])
    def homeowner_accept(self, request, pk=None):
        try:
            expense: Expense = self.get_object()
        except (OperationalError, ProgrammingError):
            return Response({"detail": "Expenses table unavailable."}, status=status.HTTP_503_SERVICE_UNAVAILABLE)

        if expense.status != ExpenseStatus.PENDING:
            return Response({"detail": "Only pending expenses can be accepted."},
                            status=status.HTTP_400_BAD_REQUEST)

        expense.status = ExpenseStatus.APPROVED
        expense.save(update_fields=["status"])
        return Response(self.get_serializer(expense).data)

    @action(detail=True, methods=["post"])
    def homeowner_reject(self, request, pk=None):
        try:
            expense: Expense = self.get_object()
        except (OperationalError, ProgrammingError):
            return Response({"detail": "Expenses table unavailable."}, status=status.HTTP_503_SERVICE_UNAVAILABLE)

        if expense.status != ExpenseStatus.PENDING:
            return Response({"detail": "Only pending expenses can be rejected."},
                            status=status.HTTP_400_BAD_REQUEST)

        expense.status = ExpenseStatus.DISPUTED
        expense.save(update_fields=["status"])
        return Response(self.get_serializer(expense).data)

    @action(detail=True, methods=["post"])
    def mark_paid(self, request, pk=None):
        try:
            expense: Expense = self.get_object()
        except (OperationalError, ProgrammingError):
            return Response({"detail": "Expenses table unavailable."}, status=status.HTTP_503_SERVICE_UNAVAILABLE)

        if expense.status not in (ExpenseStatus.APPROVED, ExpenseStatus.PENDING):
            return Response({"detail": "Only approved or pending expenses can be marked paid."},
                            status=status.HTTP_400_BAD_REQUEST)

        expense.status = ExpenseStatus.PAID
        expense.save(update_fields=["status"])
        return Response(self.get_serializer(expense).data)
