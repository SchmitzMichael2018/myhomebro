from __future__ import annotations

from django.contrib.admin.views.decorators import staff_member_required
from django.http import JsonResponse

from core.async_readiness import readiness_report


@staff_member_required
def async_services_readiness(_request):
    report = readiness_report(connect_broker=True, check_worker=True, write_test=False)
    return JsonResponse(report, status=200 if report["ready"] else 503)
