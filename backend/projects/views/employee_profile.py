# backend/projects/views/employee_profile.py
from __future__ import annotations

from rest_framework.views import APIView
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.parsers import MultiPartParser, FormParser, JSONParser
from rest_framework.exceptions import PermissionDenied

from projects.models import EmployeeProfile
from projects.serializers.employee_profile import EmployeeProfileSerializer
from projects.utils.accounts import get_subaccount_for_user


def _require_subaccount(request):
    sub = get_subaccount_for_user(request.user)
    if sub is None:
        raise PermissionDenied("Employee subaccount required.")
    if not getattr(sub, "is_active", False):
        raise PermissionDenied("Employee account inactive.")
    return sub


class EmployeeMeProfileView(APIView):
    permission_classes = [IsAuthenticated]
    parser_classes = [MultiPartParser, FormParser, JSONParser]

    def get(self, request, *args, **kwargs):
        sub = _require_subaccount(request)
        obj, _ = EmployeeProfile.objects.get_or_create(subaccount=sub)
        ser = EmployeeProfileSerializer(obj, context={"request": request})
        return Response({"profile": ser.data})

    def patch(self, request, *args, **kwargs):
        sub = _require_subaccount(request)
        obj, _ = EmployeeProfile.objects.get_or_create(subaccount=sub)

        ser = EmployeeProfileSerializer(obj, data=request.data, partial=True, context={"request": request})
        ser.is_valid(raise_exception=True)
        ser.save()
        return Response({"profile": EmployeeProfileSerializer(obj, context={"request": request}).data})
