from __future__ import annotations

from django.http import HttpResponse
from rest_framework.permissions import AllowAny, IsAuthenticated
from rest_framework.response import Response
from rest_framework.throttling import ScopedRateThrottle
from rest_framework.views import APIView

from projects.models_contractor_discovery import OpportunityEstimateAppointment
from projects.services.estimate_appointment_notifications import (
    PUBLIC_ERROR,
    appointment_ics,
    appointment_payload,
    confirmation_token,
    google_calendar_url,
    public_confirmation_url,
    public_customer_action,
    resolve_confirmation_token,
    send_confirmation_notice,
)
from projects.utils.accounts import get_contractor_for_user


def _ics_response(appointment):
    response = HttpResponse(appointment_ics(appointment), content_type="text/calendar; charset=utf-8")
    response["Content-Disposition"] = f'attachment; filename="myhomebro-estimate-appointment-{appointment.id}.ics"'
    response["Cache-Control"] = "private, no-store"
    response["X-Content-Type-Options"] = "nosniff"
    return response


class PublicEstimateAppointmentConfirmationView(APIView):
    permission_classes = [AllowAny]
    throttle_classes = [ScopedRateThrottle]
    throttle_scope = "public_estimate_appointment_confirmation"

    def get(self, request, token):
        appointment = resolve_confirmation_token(token)
        if appointment is None or appointment.status not in {appointment.STATUS_PROPOSED, appointment.STATUS_CONFIRMED}:
            return Response({"detail": PUBLIC_ERROR}, status=404)
        return Response({"appointment": appointment_payload(appointment, include_token=appointment.status == appointment.STATUS_CONFIRMED)})

    def post(self, request, token):
        action = str(request.data.get("action") or "").strip().lower()
        if action not in {"confirm", "request_another_time", "decline"}:
            return Response({"detail": PUBLIC_ERROR}, status=404)
        try:
            appointment = public_customer_action(token, action, reason=str(request.data.get("reason") or "").strip())
        except ValueError:
            return Response({"detail": PUBLIC_ERROR}, status=404)
        message = {
            "confirm": "Your appointment is confirmed.",
            "request_another_time": "Your request was sent to the contractor. The current time is not confirmed.",
            "decline": "The appointment was declined.",
        }[action]
        return Response({
            "message": message,
            "appointment": appointment_payload(appointment, include_token=appointment.status == appointment.STATUS_CONFIRMED),
        })


class PublicEstimateAppointmentIcsView(APIView):
    permission_classes = [AllowAny]
    throttle_classes = [ScopedRateThrottle]
    throttle_scope = "public_estimate_appointment_confirmation"

    def get(self, request, token):
        appointment = resolve_confirmation_token(token)
        if appointment is None or appointment.status != appointment.STATUS_CONFIRMED:
            return Response({"detail": PUBLIC_ERROR}, status=404)
        return _ics_response(appointment)


class ContractorEstimateAppointmentConfirmationView(APIView):
    permission_classes = [IsAuthenticated]

    def post(self, request, appointment_id):
        contractor = get_contractor_for_user(request.user)
        appointment = OpportunityEstimateAppointment.objects.filter(contractor=contractor, pk=appointment_id).first()
        if appointment is None:
            return Response({"detail": "Estimate appointment not found."}, status=404)
        try:
            results = send_confirmation_notice(appointment)
        except ValueError as exc:
            return Response({"detail": str(exc)}, status=429 if "recently" in str(exc) else 409)
        return Response({
            "confirmation_url": public_confirmation_url(appointment),
            "delivery_results": results,
            "last_confirmation_sent_at": appointment.deliveries.filter(kind="confirmation", sent_at__isnull=False).order_by("-sent_at").values_list("sent_at", flat=True).first(),
        })


class ContractorEstimateAppointmentIcsView(APIView):
    permission_classes = [IsAuthenticated]

    def get(self, request, appointment_id):
        contractor = get_contractor_for_user(request.user)
        appointment = OpportunityEstimateAppointment.objects.filter(contractor=contractor, pk=appointment_id).first()
        if appointment is None or appointment.status != appointment.STATUS_CONFIRMED:
            return Response({"detail": "Estimate appointment not found."}, status=404)
        return _ics_response(appointment)


def contractor_export_payload(appointment):
    if appointment.status != appointment.STATUS_CONFIRMED:
        return {}
    return {
        "google_calendar_url": google_calendar_url(appointment),
        "ics_url": f"/api/projects/estimate-appointments/{appointment.id}/calendar.ics",
        "calendar_export_note": "Calendar export is one-way. Future MyHomeBro changes do not update an event you already imported.",
    }
