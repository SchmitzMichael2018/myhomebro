from __future__ import annotations

from django.http import HttpResponse, JsonResponse
from django.views.decorators.csrf import csrf_exempt
from rest_framework.permissions import IsAuthenticated, IsAdminUser
from rest_framework.response import Response
from rest_framework.views import APIView
from twilio.twiml.messaging_response import MessagingResponse

from projects.models import Agreement, Homeowner, Invoice, Milestone
from projects.services.sms_automation import evaluate_sms_automation
from projects.services.sms import validate_twilio_webhook_request
from projects.services.sms_service import (
    get_sms_status_payload,
    handle_inbound_sms,
    handle_sms_status_callback,
    set_sms_opt_in,
    set_sms_opt_out,
)


def _contractor_for_user(user):
    return getattr(user, "contractor", None) or getattr(user, "contractor_profile", None)


def _twiml(message: str) -> HttpResponse:
    response = MessagingResponse()
    response.message(message)
    return HttpResponse(str(response), content_type="text/xml", status=200)


def _resolve_homeowner_for_request(contractor, *, homeowner_id=None, agreement_id=None):
    if homeowner_id:
        return Homeowner.objects.filter(id=homeowner_id, created_by=contractor).first()
    if agreement_id:
        agreement = Agreement.objects.filter(id=agreement_id, contractor=contractor).select_related("homeowner").first()
        return getattr(agreement, "homeowner", None)
    return None


@csrf_exempt
def twilio_inbound_sms(request):
    if request.method != "POST":
        return _twiml("MyHomeBro: SMS endpoint is active.")
    validate_twilio_webhook_request(request)
    payload = handle_inbound_sms(
        from_phone=request.POST.get("From", ""),
        body=request.POST.get("Body", ""),
        message_sid=request.POST.get("MessageSid", ""),
    )
    return _twiml(payload["message"])


@csrf_exempt
def twilio_sms_status(request):
    if request.method != "POST":
        return HttpResponse("ok", content_type="text/plain", status=200)
    payload = handle_sms_status_callback(
        message_sid=request.POST.get("MessageSid", ""),
        message_status=request.POST.get("MessageStatus", ""),
        to_phone=request.POST.get("To", ""),
        error_code=request.POST.get("ErrorCode", ""),
    )
    return JsonResponse(payload, status=200)


class SMSOptInView(APIView):
    permission_classes = [IsAuthenticated]

    def post(self, request):
        contractor = _contractor_for_user(request.user)
        if contractor is None:
            return Response({"detail": "Contractor profile not found."}, status=404)
        homeowner = _resolve_homeowner_for_request(
            contractor,
            homeowner_id=request.data.get("homeowner_id"),
            agreement_id=request.data.get("agreement_id"),
        )
        phone = (
            request.data.get("phone_number")
            or getattr(homeowner, "phone_number", "")
            or getattr(contractor, "phone", "")
        )
        try:
            consent = set_sms_opt_in(
                phone_number=phone,
                contractor=contractor if homeowner is None else None,
                homeowner=homeowner,
                source=request.data.get("source") or "admin",
                consent_text_snapshot=request.data.get("consent_text_snapshot") or "",
                consent_source_page=request.data.get("consent_source_page") or "",
            )
        except ValueError as exc:
            return Response({"detail": str(exc)}, status=400)
        return Response(get_sms_status_payload(phone_number=consent.phone_number_e164, contractor=contractor, homeowner=homeowner), status=200)


class SMSOptOutView(APIView):
    permission_classes = [IsAuthenticated]

    def post(self, request):
        contractor = _contractor_for_user(request.user)
        if contractor is None:
            return Response({"detail": "Contractor profile not found."}, status=404)
        homeowner = _resolve_homeowner_for_request(
            contractor,
            homeowner_id=request.data.get("homeowner_id"),
            agreement_id=request.data.get("agreement_id"),
        )
        phone = (
            request.data.get("phone_number")
            or getattr(homeowner, "phone_number", "")
            or getattr(contractor, "phone", "")
        )
        try:
            consent = set_sms_opt_out(
                phone_number=phone,
                contractor=contractor if homeowner is None else None,
                homeowner=homeowner,
                source=request.data.get("source") or "api",
            )
        except ValueError as exc:
            return Response({"detail": str(exc)}, status=400)
        return Response(get_sms_status_payload(phone_number=consent.phone_number_e164, contractor=contractor, homeowner=homeowner), status=200)


class SMSStatusView(APIView):
    permission_classes = [IsAuthenticated]

    def get(self, request):
        contractor = _contractor_for_user(request.user)
        if contractor is None:
            return Response({"detail": "Contractor profile not found."}, status=404)
        homeowner = _resolve_homeowner_for_request(
            contractor,
            homeowner_id=request.query_params.get("homeowner_id"),
            agreement_id=request.query_params.get("agreement_id"),
        )
        phone = (
            request.query_params.get("phone_number")
            or getattr(homeowner, "phone_number", "")
            or getattr(contractor, "phone", "")
        )
        return Response(get_sms_status_payload(phone_number=phone, contractor=contractor, homeowner=homeowner), status=200)


class SMSAutomationPreviewView(APIView):
    permission_classes = [IsAuthenticated, IsAdminUser]

    def get(self, request):
        event_type = request.query_params.get("event_type") or ""
        agreement = None
        invoice = None
        milestone = None
        homeowner = None
        contractor = None

        agreement_id = request.query_params.get("agreement_id")
        invoice_id = request.query_params.get("invoice_id")
        milestone_id = request.query_params.get("milestone_id")
        homeowner_id = request.query_params.get("homeowner_id")
        contractor_id = request.query_params.get("contractor_id")

        if agreement_id:
            agreement = Agreement.objects.select_related("contractor", "homeowner").filter(id=agreement_id).first()
        if invoice_id:
            invoice = Invoice.objects.select_related("agreement", "agreement__contractor", "agreement__homeowner").filter(id=invoice_id).first()
        if milestone_id:
            milestone = Milestone.objects.select_related("agreement", "agreement__contractor", "agreement__homeowner").filter(id=milestone_id).first()
        if homeowner_id:
            homeowner = Homeowner.objects.filter(id=homeowner_id).first()
        if contractor_id:
            from projects.models import Contractor
            contractor = Contractor.objects.filter(id=contractor_id).first()

        if agreement is not None:
            contractor = contractor or agreement.contractor
            homeowner = homeowner or agreement.homeowner
        elif invoice is not None:
            contractor = contractor or invoice.agreement.contractor
            homeowner = homeowner or invoice.agreement.homeowner
            agreement = agreement or invoice.agreement
        elif milestone is not None:
            contractor = contractor or milestone.agreement.contractor
            homeowner = homeowner or milestone.agreement.homeowner
            agreement = agreement or milestone.agreement

        payload = evaluate_sms_automation(
            event_type,
            contractor=contractor,
            homeowner=homeowner,
            agreement=agreement,
            invoice=invoice,
            milestone=milestone,
            metadata={"preview_endpoint": True},
            simulate=True,
        )
        return Response(payload, status=200)
