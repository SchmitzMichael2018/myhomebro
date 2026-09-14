from __future__ import annotations

from decimal import Decimal

from django.shortcuts import get_object_or_404
from rest_framework import serializers, status
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

from projects.models import (
    Agreement,
    CustomerRefundRequest,
    DrawRequest,
    ExternalPaymentRecord,
    Invoice,
    Milestone,
)
from projects.services.refund_workflow import (
    create_refund_request,
    refund_source_options,
    respond_to_refund_request,
    serialize_refund_request,
)
from projects.utils.accounts import get_contractor_for_user


def _agreement_for_contractor(user, agreement_id: int):
    contractor = get_contractor_for_user(user)
    if contractor is None:
        return None
    return Agreement.objects.select_related("contractor", "contractor__user", "homeowner", "project").filter(
        pk=agreement_id,
        contractor=contractor,
    ).first()


def _source_objects(agreement, data):
    invoice = Invoice.objects.filter(pk=data.get("invoice_id"), agreement=agreement).first() if data.get("invoice_id") else None
    draw = DrawRequest.objects.filter(pk=data.get("draw_request_id"), agreement=agreement).first() if data.get("draw_request_id") else None
    milestone = Milestone.objects.filter(pk=data.get("milestone_id"), agreement=agreement).first() if data.get("milestone_id") else None
    external = ExternalPaymentRecord.objects.filter(pk=data.get("external_payment_id"), agreement=agreement).first() if data.get("external_payment_id") else None
    return invoice, draw, milestone, external


class RefundRequestCreateSerializer(serializers.Serializer):
    source_type = serializers.ChoiceField(choices=CustomerRefundRequest.SourceType.choices)
    invoice_id = serializers.IntegerField(required=False, allow_null=True)
    draw_request_id = serializers.IntegerField(required=False, allow_null=True)
    milestone_id = serializers.IntegerField(required=False, allow_null=True)
    external_payment_id = serializers.IntegerField(required=False, allow_null=True)
    requested_amount = serializers.DecimalField(max_digits=12, decimal_places=2, required=False, allow_null=True, min_value=Decimal("0.01"))
    reason = serializers.CharField(max_length=4000)
    evidence_note = serializers.CharField(max_length=8000, required=False, allow_blank=True)
    execute_now = serializers.BooleanField(required=False, default=False)
    confirm = serializers.CharField(required=False, allow_blank=True)


class RefundRequestResponseSerializer(serializers.Serializer):
    action = serializers.ChoiceField(choices=["approve", "counter", "deny", "cancel", "retry"])
    approved_amount = serializers.DecimalField(max_digits=12, decimal_places=2, required=False, allow_null=True, min_value=Decimal("0.01"))
    note = serializers.CharField(max_length=8000, required=False, allow_blank=True)
    confirm = serializers.CharField(required=False, allow_blank=True)


class ContractorAgreementRefundRequestView(APIView):
    permission_classes = [IsAuthenticated]

    def get(self, request, agreement_id: int):
        agreement = _agreement_for_contractor(request.user, agreement_id)
        if agreement is None:
            return Response({"detail": "Agreement not found."}, status=status.HTTP_404_NOT_FOUND)
        rows = agreement.customer_refund_requests.select_related(
            "invoice", "draw_request", "milestone", "external_payment"
        ).prefetch_related("events", "transactions").all()
        return Response({
            "agreement_id": agreement.id,
            "source_options": refund_source_options(agreement),
            "refund_requests": [serialize_refund_request(row) for row in rows],
        })

    def post(self, request, agreement_id: int):
        agreement = _agreement_for_contractor(request.user, agreement_id)
        if agreement is None:
            return Response({"detail": "Agreement not found."}, status=status.HTTP_404_NOT_FOUND)
        serializer = RefundRequestCreateSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        data = serializer.validated_data
        if data.get("execute_now"):
            if str(data.get("confirm") or "").strip().upper() != "REFUND":
                return Response({"detail": "Type REFUND to authorize this transaction."}, status=status.HTTP_400_BAD_REQUEST)
            if data.get("requested_amount") in (None, ""):
                return Response({"detail": "Enter the refund amount."}, status=status.HTTP_400_BAD_REQUEST)
        invoice, draw, milestone, external = _source_objects(agreement, data)
        try:
            row = create_refund_request(
                agreement=agreement,
                actor=request.user,
                initiated_by_role=CustomerRefundRequest.InitiatorRole.CONTRACTOR,
                source_type=data["source_type"],
                reason=data["reason"],
                requested_amount=data.get("requested_amount"),
                evidence_note=data.get("evidence_note", ""),
                invoice=invoice,
                draw_request=draw,
                milestone=milestone,
                external_payment=external,
            )
            if data.get("execute_now"):
                row = respond_to_refund_request(
                    row,
                    actor=request.user,
                    action="approve",
                    approved_amount=data.get("requested_amount"),
                    note="Contractor initiated and authorized the refund.",
                )
        except ValueError as exc:
            return Response({"detail": str(exc)}, status=status.HTTP_400_BAD_REQUEST)
        row = CustomerRefundRequest.objects.select_related(
            "invoice", "draw_request", "milestone", "external_payment"
        ).prefetch_related("events", "transactions").get(pk=row.pk)
        return Response({"refund_request": serialize_refund_request(row)}, status=status.HTTP_201_CREATED)


class ContractorRefundRequestResponseView(APIView):
    permission_classes = [IsAuthenticated]

    def post(self, request, request_id: int):
        contractor = get_contractor_for_user(request.user)
        if contractor is None:
            return Response({"detail": "Contractor account not found."}, status=status.HTTP_404_NOT_FOUND)
        row = get_object_or_404(
            CustomerRefundRequest.objects.select_related(
                "agreement__contractor", "agreement__homeowner", "agreement__project", "invoice", "draw_request", "milestone", "external_payment"
            ).prefetch_related("events", "transactions"),
            pk=request_id,
            agreement__contractor=contractor,
        )
        serializer = RefundRequestResponseSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        data = serializer.validated_data
        if data["action"] in {"approve", "retry"} and str(data.get("confirm") or "").strip().upper() != "REFUND":
            return Response({"detail": "Type REFUND to authorize this transaction."}, status=status.HTTP_400_BAD_REQUEST)
        try:
            row = respond_to_refund_request(
                row,
                actor=request.user,
                action=data["action"],
                approved_amount=data.get("approved_amount"),
                note=data.get("note", ""),
            )
        except ValueError as exc:
            return Response({"detail": str(exc)}, status=status.HTTP_400_BAD_REQUEST)
        row = CustomerRefundRequest.objects.select_related(
            "invoice", "draw_request", "milestone", "external_payment"
        ).prefetch_related("events", "transactions").get(pk=row.pk)
        return Response({"refund_request": serialize_refund_request(row)})
