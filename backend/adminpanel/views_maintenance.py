from rest_framework import status
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

from .maintenance_operations import build_maintenance_operations_payload
from .permissions import IsAdminUserRole


class AdminMaintenanceOperations(APIView):
    permission_classes = [IsAuthenticated, IsAdminUserRole]

    def get(self, request):
        return Response(build_maintenance_operations_payload(request.query_params), status=status.HTTP_200_OK)

