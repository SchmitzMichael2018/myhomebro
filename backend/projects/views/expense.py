from django.db.models import Q

from rest_framework import viewsets
from rest_framework.permissions import IsAuthenticated
from rest_framework.exceptions import NotFound

from ..models import Agreement, Project
from ..serializers import ExpenseSerializer


class ExpenseViewSet(viewsets.ModelViewSet):
    """
    Manages Expenses nested under a parent Agreement.
    URL: /api/agreements/{agreement_pk}/expenses/
    """
    serializer_class = ExpenseSerializer
    permission_classes = [IsAuthenticated]

    def get_agreement(self):
        """
        Retrieves the parent Agreement based on URL kwarg and
        ensures the current user is a participant (contractor or homeowner).
        """
        agreement_pk = self.kwargs.get('agreement_pk')
        user = self.request.user
        try:
            agreement = Agreement.objects.select_related(
                'project__contractor', 'project__homeowner'
            ).get(
                pk=agreement_pk,
                project__in=Project.objects.filter(
                    Q(contractor=user) | Q(homeowner__email=user.email)
                )
            )
            return agreement
        except Agreement.DoesNotExist:
            raise NotFound("Agreement not found or you do not have permission to access it.")

    def get_queryset(self):
        """
        Returns only the expenses for the specific Agreement from the URL.
        """
        agreement = self.get_agreement()
        return agreement.misc_expenses.all().order_by('-incurred_date')

    def perform_create(self, serializer):
        """
        Creates an Expense tied to the Agreement from the URL,
        setting the creator to the current user.
        """
        agreement = self.get_agreement()
        serializer.save(created_by=self.request.user, agreement=agreement)
