from django.views.decorators.cache import never_cache
from django.utils.decorators import method_decorator
from rest_framework import status
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

from projects.services.contractor_service_area_opportunities import (
    build_contractor_service_area_opportunities,
)
from projects.services.marketplace_permissions import (
    CONTRACTOR_PARTICIPATION_UNAVAILABLE_DETAIL,
    contractor_participation_block_reason,
)


@method_decorator(never_cache, name="dispatch")
class ContractorServiceAreaOpportunitiesView(APIView):
    permission_classes = [IsAuthenticated]

    def get(self, request):
        contractor = getattr(request.user, "contractor_profile", None)
        if contractor_participation_block_reason(contractor):
            return Response(
                {"detail": CONTRACTOR_PARTICIPATION_UNAVAILABLE_DETAIL},
                status=status.HTTP_403_FORBIDDEN,
            )
        return Response(
            build_contractor_service_area_opportunities(
                contractor,
                request.query_params,
            )
        )
