from __future__ import annotations

from decimal import Decimal, InvalidOperation

from django.db import transaction
from django.db.models import Max, Sum
from django.shortcuts import get_object_or_404
from django.utils import timezone
from rest_framework import serializers, status
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

from projects.models import (
    Agreement,
    AgreementPaymentStructure,
    DrawLineItem,
    DrawRequest,
    DrawRequestStatus,
    ExternalPaymentRecord,
    ExternalPaymentStatus,
    Milestone,
)
from projects.services.draw_requests import (
    build_public_draw_link,
    create_draw_activity_notification,
    release_escrow_draw,
    send_draw_request_review_email,
)
from projects.services.draw_state import serialize_draw_workflow


def _contractor_for_request(request):
    return getattr(request.user, "contractor_profile", None)


def _decimal(value, default="0.00"):
    try:
        if value in (None, ""):
            return Decimal(default)
        return Decimal(str(value))
    except (InvalidOperation, TypeError, ValueError):
        return Decimal(default)


def _money(value):
    return str(_decimal(value).quantize(Decimal("0.01")))


def _percent(value):
    return str(_decimal(value).quantize(Decimal("0.01")))


def _require_progress_agreement(agreement: Agreement):
    if str(getattr(agreement, "payment_structure", "simple") or "simple").lower() != "progress":
        raise serializers.ValidationError("Draw requests are only available for progress-payment agreements.")


def _agreement_is_executed(agreement: Agreement) -> bool:
    signature_satisfied = getattr(agreement, "signature_is_satisfied", None)
    if callable(signature_satisfied):
        try:
            signature_satisfied = signature_satisfied()
        except Exception:
            signature_satisfied = None
    if signature_satisfied is not None:
        return bool(signature_satisfied)
    return bool(getattr(agreement, "is_fully_signed", False))


def _require_executed_agreement(agreement: Agreement):
    if not _agreement_is_executed(agreement):
        raise serializers.ValidationError("Draw requests are only available after the agreement is signed.")


def _agreement_for_contractor(contractor, agreement_id: int) -> Agreement:
    return get_object_or_404(
        Agreement.objects.select_related("project", "contractor", "homeowner"),
        pk=agreement_id,
        contractor=contractor,
    )


def _draw_for_contractor(contractor, draw_id: int) -> DrawRequest:
    return get_object_or_404(
        DrawRequest.objects.select_related("agreement", "agreement__project", "agreement__contractor"),
        pk=draw_id,
        agreement__contractor=contractor,
    )


def _previous_billed_amount(agreement: Agreement, milestone: Milestone | None, exclude_draw_id: int | None = None):
    if milestone is None:
        return Decimal("0.00")
    qs = DrawLineItem.objects.filter(
        draw_request__agreement=agreement,
        draw_request__status__in=[
            DrawRequestStatus.APPROVED,
            DrawRequestStatus.AWAITING_RELEASE,
            DrawRequestStatus.RELEASED,
            DrawRequestStatus.PAID,
        ],
        milestone=milestone,
    )
    if exclude_draw_id:
        qs = qs.exclude(draw_request_id=exclude_draw_id)
    total = qs.aggregate(total=Sum("this_draw_amount")).get("total") or Decimal("0.00")
    return _decimal(total)


def _serialize_draw_line_item(line: DrawLineItem):
    return {
        "id": line.id,
        "milestone_id": getattr(line, "milestone_id", None),
        "milestone_title": getattr(getattr(line, "milestone", None), "title", "") or "",
        "description": line.description,
        "scheduled_value": _money(line.scheduled_value),
        "percent_complete": _percent(line.percent_complete),
        "earned_to_date": _money(line.earned_to_date),
        "previous_billed": _money(line.previous_billed),
        "this_draw_amount": _money(line.this_draw_amount),
        "retainage_amount": _money(line.retainage_amount),
        "remaining_balance": _money(line.remaining_balance),
    }


def _serialize_draw(draw: DrawRequest):
    agreement = getattr(draw, "agreement", None)
    project = getattr(agreement, "project", None)
    payload = {
        "id": draw.id,
        "agreement_id": draw.agreement_id,
        "agreement_title": getattr(project, "title", "") or f"Agreement #{draw.agreement_id}",
        "draw_number": draw.draw_number,
        "status": draw.status,
        "title": draw.title,
        "notes": draw.notes,
        "submitted_at": draw.submitted_at.isoformat() if draw.submitted_at else None,
        "reviewed_at": draw.reviewed_at.isoformat() if draw.reviewed_at else None,
        "homeowner_viewed_at": draw.homeowner_viewed_at.isoformat() if getattr(draw, "homeowner_viewed_at", None) else None,
        "homeowner_acted_at": draw.homeowner_acted_at.isoformat() if getattr(draw, "homeowner_acted_at", None) else None,
        "homeowner_review_notes": getattr(draw, "homeowner_review_notes", "") or "",
        "review_email_sent_at": draw.review_email_sent_at.isoformat() if getattr(draw, "review_email_sent_at", None) else None,
        "gross_amount": _money(draw.gross_amount),
        "retainage_amount": _money(draw.retainage_amount),
        "net_amount": _money(draw.net_amount),
        "previous_payments_amount": _money(draw.previous_payments_amount),
        "current_requested_amount": _money(draw.current_requested_amount),
        "public_review_url": build_public_draw_link(draw),
        "stripe_checkout_url": getattr(draw, "stripe_checkout_url", "") or "",
        "paid_at": draw.paid_at.isoformat() if getattr(draw, "paid_at", None) else None,
        "paid_via": getattr(draw, "paid_via", "") or "",
        "released_at": draw.released_at.isoformat() if getattr(draw, "released_at", None) else None,
        "payment_mode": str(getattr(agreement, "payment_mode", "") or "").strip().lower(),
        "line_items": [_serialize_draw_line_item(item) for item in draw.line_items.select_related("milestone").all()],
    }
    payload.update(serialize_draw_workflow(draw))
    return payload


def _serialize_external_payment(record: ExternalPaymentRecord):
    agreement = getattr(record, "agreement", None)
    project = getattr(agreement, "project", None)
    draw = getattr(record, "draw_request", None)
    return {
        "id": record.id,
        "agreement_id": record.agreement_id,
        "agreement_title": getattr(project, "title", "") or f"Agreement #{record.agreement_id}",
        "draw_request_id": record.draw_request_id,
        "draw_title": getattr(draw, "title", "") or "",
        "status": record.status,
        "payer_name": record.payer_name,
        "payee_name": record.payee_name,
        "gross_amount": _money(record.gross_amount),
        "retainage_withheld_amount": _money(record.retainage_withheld_amount),
        "net_amount": _money(record.net_amount),
        "payment_method": record.payment_method,
        "payment_date": record.payment_date.isoformat() if record.payment_date else None,
        "reference_number": record.reference_number,
        "notes": record.notes,
        "proof_file_url": record.proof_file.url if getattr(record, "proof_file", None) else "",
        "recorded_at": record.recorded_at.isoformat() if record.recorded_at else None,
    }


class DrawLineItemInputSerializer(serializers.Serializer):
    milestone_id = serializers.IntegerField(required=False, allow_null=True)
    description = serializers.CharField(required=False, allow_blank=True, default="")
    scheduled_value = serializers.DecimalField(max_digits=12, decimal_places=2, required=False)
    percent_complete = serializers.DecimalField(max_digits=5, decimal_places=2)

    def validate_percent_complete(self, value):
        if value < 0 or value > 100:
            raise serializers.ValidationError("Percent complete must be between 0 and 100.")
        return value


class DrawCreateSerializer(serializers.Serializer):
    title = serializers.CharField(required=False, allow_blank=True, default="")
    notes = serializers.CharField(required=False, allow_blank=True, default="")
    line_items = DrawLineItemInputSerializer(many=True)

    def validate_line_items(self, value):
        if not value:
            raise serializers.ValidationError("At least one draw line item is required.")
        return value


class ExternalPaymentRecordSerializer(serializers.Serializer):
    payer_name = serializers.CharField(required=False, allow_blank=True, default="")
    payee_name = serializers.CharField(required=False, allow_blank=True, default="")
    gross_amount = serializers.DecimalField(max_digits=12, decimal_places=2)
    retainage_withheld_amount = serializers.DecimalField(
        max_digits=12,
        decimal_places=2,
        required=False,
        default=Decimal("0.00"),
    )
    net_amount = serializers.DecimalField(max_digits=12, decimal_places=2, required=False)
    payment_method = serializers.ChoiceField(choices=["ach", "wire", "check", "cash", "other"])
    payment_date = serializers.DateField()
    reference_number = serializers.CharField(required=False, allow_blank=True, default="")
    notes = serializers.CharField(required=False, allow_blank=True, default="")
    proof_file = serializers.FileField(required=False, allow_null=True)

    def validate(self, attrs):
        gross_amount = _decimal(attrs.get("gross_amount"))
        retainage = _decimal(attrs.get("retainage_withheld_amount"))
        net_amount = attrs.get("net_amount", None)
        if gross_amount < 0 or retainage < 0:
            raise serializers.ValidationError("Payment amounts must be non-negative.")
        if retainage > gross_amount:
            raise serializers.ValidationError(
                {"retainage_withheld_amount": "Retainage withheld cannot exceed the gross payment amount."}
            )
        computed_net = (gross_amount - retainage).quantize(Decimal("0.01"))
        if computed_net < 0:
            raise serializers.ValidationError({"net_amount": "Net amount cannot be negative."})
        if net_amount is None:
            attrs["net_amount"] = computed_net
        else:
            normalized_net = _decimal(net_amount).quantize(Decimal("0.01"))
            if normalized_net != computed_net:
                raise serializers.ValidationError(
                    {"net_amount": "Net amount must equal gross amount minus retainage withheld."}
                )
            attrs["net_amount"] = normalized_net

        draw = self.context.get("draw")
        if draw is not None:
            expected_gross = _decimal(getattr(draw, "gross_amount", 0)).quantize(Decimal("0.01"))
            expected_retainage = _decimal(getattr(draw, "retainage_amount", 0)).quantize(Decimal("0.01"))
            expected_net = _decimal(getattr(draw, "net_amount", 0)).quantize(Decimal("0.01"))
            errors = {}
            if gross_amount.quantize(Decimal("0.01")) != expected_gross:
                errors["gross_amount"] = "Gross payment amount must match the approved draw gross amount."
            if retainage.quantize(Decimal("0.01")) != expected_retainage:
                errors["retainage_withheld_amount"] = (
                    "Retainage withheld must match the approved draw retainage amount."
                )
            if attrs["net_amount"] != expected_net:
                errors["net_amount"] = "Net payment amount must match the approved draw net amount."
            if errors:
                raise serializers.ValidationError(errors)
        return attrs


class AgreementDrawListCreateView(APIView):
    permission_classes = [IsAuthenticated]

    def get(self, request, agreement_id: int):
        contractor = _contractor_for_request(request)
        if contractor is None:
            return Response({"detail": "Contractor profile not found."}, status=400)

        agreement = _agreement_for_contractor(contractor, agreement_id)
        _require_progress_agreement(agreement)
        _require_executed_agreement(agreement)

        draws = (
            agreement.draw_requests.all()
            .prefetch_related("line_items__milestone", "external_payment_records")
            .order_by("-draw_number", "-id")
        )
        return Response(
            {
                "agreement_id": agreement.id,
                "payment_structure": agreement.payment_structure,
                "retainage_percent": _percent(agreement.retainage_percent),
                "results": [_serialize_draw(draw) for draw in draws],
            }
        )

    @transaction.atomic
    def post(self, request, agreement_id: int):
        contractor = _contractor_for_request(request)
        if contractor is None:
            return Response({"detail": "Contractor profile not found."}, status=400)

        agreement = _agreement_for_contractor(contractor, agreement_id)
        _require_progress_agreement(agreement)
        _require_executed_agreement(agreement)

        serializer = DrawCreateSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)

        next_draw_number = (
            agreement.draw_requests.aggregate(max_num=Max("draw_number")).get("max_num") or 0
        ) + 1
        title = serializer.validated_data.get("title") or f"Draw {next_draw_number}"
        notes = serializer.validated_data.get("notes", "")
        retainage_percent = _decimal(getattr(agreement, "retainage_percent", 0))

        draw = DrawRequest.objects.create(
            agreement=agreement,
            draw_number=next_draw_number,
            title=title,
            notes=notes,
            status=DrawRequestStatus.DRAFT,
        )

        gross_amount = Decimal("0.00")
        retainage_amount = Decimal("0.00")
        previous_payments_amount = Decimal("0.00")

        for item in serializer.validated_data["line_items"]:
            milestone = None
            milestone_id = item.get("milestone_id")
            if milestone_id:
                milestone = get_object_or_404(Milestone, pk=milestone_id, agreement=agreement)
                description = item.get("description") or milestone.title
                scheduled_value = _decimal(milestone.amount)
            else:
                description = item.get("description") or "Draw line item"
                scheduled_value = _decimal(item.get("scheduled_value"))

            percent_complete = _decimal(item.get("percent_complete"))
            earned_to_date = (scheduled_value * percent_complete / Decimal("100")).quantize(Decimal("0.01"))
            previous_billed = _previous_billed_amount(agreement, milestone)
            this_draw_amount = max(earned_to_date - previous_billed, Decimal("0.00")).quantize(Decimal("0.01"))
            line_retainage = (this_draw_amount * retainage_percent / Decimal("100")).quantize(Decimal("0.01"))
            remaining_balance = max(scheduled_value - earned_to_date, Decimal("0.00")).quantize(Decimal("0.01"))

            DrawLineItem.objects.create(
                draw_request=draw,
                milestone=milestone,
                description=description,
                scheduled_value=scheduled_value,
                percent_complete=percent_complete,
                earned_to_date=earned_to_date,
                previous_billed=previous_billed,
                this_draw_amount=this_draw_amount,
                retainage_amount=line_retainage,
                remaining_balance=remaining_balance,
            )

            gross_amount += this_draw_amount
            retainage_amount += line_retainage
            previous_payments_amount += previous_billed

        draw.gross_amount = gross_amount.quantize(Decimal("0.01"))
        draw.retainage_amount = retainage_amount.quantize(Decimal("0.01"))
        draw.net_amount = (draw.gross_amount - draw.retainage_amount).quantize(Decimal("0.01"))
        draw.previous_payments_amount = previous_payments_amount.quantize(Decimal("0.01"))
        draw.current_requested_amount = draw.gross_amount
        draw.save(
            update_fields=[
                "gross_amount",
                "retainage_amount",
                "net_amount",
                "previous_payments_amount",
                "current_requested_amount",
                "updated_at",
            ]
        )

        draw = DrawRequest.objects.prefetch_related("line_items__milestone").get(pk=draw.pk)
        return Response(_serialize_draw(draw), status=status.HTTP_201_CREATED)


class ContractorDrawRequestListView(APIView):
    permission_classes = [IsAuthenticated]

    def get(self, request):
        contractor = _contractor_for_request(request)
        if contractor is None:
            return Response({"detail": "Contractor profile not found."}, status=400)

        draws = (
            DrawRequest.objects.select_related("agreement", "agreement__project")
            .filter(
                agreement__contractor=contractor,
                agreement__payment_structure=AgreementPaymentStructure.PROGRESS,
            )
            .prefetch_related("line_items__milestone", "external_payment_records")
            .order_by("-updated_at", "-draw_number", "-id")
        )
        return Response({"results": [_serialize_draw(draw) for draw in draws]})


class DrawStatusActionView(APIView):
    permission_classes = [IsAuthenticated]
    target_status = None
    allowed_current_statuses: tuple[str, ...] = ()

    def post(self, request, draw_id: int):
        contractor = _contractor_for_request(request)
        if contractor is None:
            return Response({"detail": "Contractor profile not found."}, status=400)

        draw = _draw_for_contractor(contractor, draw_id)
        _require_progress_agreement(draw.agreement)
        _require_executed_agreement(draw.agreement)

        if draw.status not in self.allowed_current_statuses:
            return Response(
                {"detail": f"Draw cannot transition from {draw.status} to {self.target_status}."},
                status=400,
            )

        draw.status = self.target_status
        if self.target_status == DrawRequestStatus.SUBMITTED:
            draw.submitted_by = request.user
            draw.submitted_at = timezone.now()
            update_fields = ["status", "submitted_by", "submitted_at", "updated_at"]
        else:
            draw.reviewed_by = request.user
            draw.reviewed_at = timezone.now()
            update_fields = ["status", "reviewed_by", "reviewed_at", "updated_at"]
        draw.save(update_fields=update_fields)

        email_delivery = None
        if self.target_status == DrawRequestStatus.SUBMITTED:
            ok, message = send_draw_request_review_email(draw)
            email_delivery = {"ok": ok, "message": message}

        draw = DrawRequest.objects.prefetch_related("line_items__milestone", "external_payment_records").get(pk=draw.pk)
        payload = _serialize_draw(draw)
        if email_delivery is not None:
            payload["email_delivery"] = email_delivery
        return Response(payload)


class DrawSubmitView(DrawStatusActionView):
    target_status = DrawRequestStatus.SUBMITTED
    allowed_current_statuses = (DrawRequestStatus.DRAFT, DrawRequestStatus.CHANGES_REQUESTED)


class DrawApproveView(DrawStatusActionView):
    target_status = DrawRequestStatus.APPROVED
    allowed_current_statuses = (DrawRequestStatus.SUBMITTED,)


class DrawRejectView(DrawStatusActionView):
    target_status = DrawRequestStatus.REJECTED
    allowed_current_statuses = (DrawRequestStatus.SUBMITTED,)


class DrawRequestChangesView(DrawStatusActionView):
    target_status = DrawRequestStatus.CHANGES_REQUESTED
    allowed_current_statuses = (DrawRequestStatus.SUBMITTED,)


class DrawResendReviewEmailView(APIView):
    permission_classes = [IsAuthenticated]

    def post(self, request, draw_id: int):
        contractor = _contractor_for_request(request)
        if contractor is None:
            return Response({"detail": "Contractor profile not found."}, status=400)

        draw = _draw_for_contractor(contractor, draw_id)
        _require_progress_agreement(draw.agreement)
        _require_executed_agreement(draw.agreement)

        if draw.status not in {DrawRequestStatus.SUBMITTED, DrawRequestStatus.APPROVED}:
            return Response(
                {"detail": "Review links can only be resent for submitted or approved draws."},
                status=400,
            )

        ok, message = send_draw_request_review_email(draw, is_resend=True)
        draw = DrawRequest.objects.prefetch_related("line_items__milestone", "external_payment_records").get(pk=draw.pk)
        payload = _serialize_draw(draw)
        payload["email_delivery"] = {"ok": ok, "message": message}
        return Response(payload)


class DrawRecordExternalPaymentView(APIView):
    permission_classes = [IsAuthenticated]

    @transaction.atomic
    def post(self, request, draw_id: int):
        contractor = _contractor_for_request(request)
        if contractor is None:
            return Response({"detail": "Contractor profile not found."}, status=400)

        draw = _draw_for_contractor(contractor, draw_id)
        agreement = draw.agreement
        _require_progress_agreement(agreement)
        _require_executed_agreement(agreement)

        if draw.status != DrawRequestStatus.APPROVED:
            return Response(
                {"detail": "External payments can only be recorded for approved draws."},
                status=400,
            )
        if draw.external_payment_records.exclude(status=ExternalPaymentStatus.VOIDED).exists():
            return Response(
                {"detail": "An external payment has already been recorded for this draw."},
                status=400,
            )

        serializer = ExternalPaymentRecordSerializer(data=request.data, context={"draw": draw})
        serializer.is_valid(raise_exception=True)
        data = serializer.validated_data

        payment = ExternalPaymentRecord.objects.create(
            agreement=agreement,
            draw_request=draw,
            payer_name=data.get("payer_name", ""),
            payee_name=data.get("payee_name", ""),
            gross_amount=data["gross_amount"],
            retainage_withheld_amount=data.get("retainage_withheld_amount", Decimal("0.00")),
            net_amount=data["net_amount"],
            payment_method=data["payment_method"],
            payment_date=data["payment_date"],
            reference_number=data.get("reference_number", ""),
            notes=data.get("notes", ""),
            proof_file=data.get("proof_file"),
            recorded_by=request.user,
        )

        draw.status = DrawRequestStatus.PAID
        draw.paid_at = timezone.now()
        draw.paid_via = data["payment_method"]
        draw.save(update_fields=["status", "paid_at", "paid_via", "updated_at"])
        create_draw_activity_notification(
            draw,
            event_type="draw_paid",
            title=f"Draw {draw.draw_number} paid",
            summary="An offline payment was recorded for this draw in MyHomeBro.",
            severity="success",
            dedupe_key=f"draw_paid:{draw.id}",
        )

        return Response(_serialize_external_payment(payment), status=status.HTTP_201_CREATED)


class DrawReleaseView(APIView):
    permission_classes = [IsAuthenticated]

    def post(self, request, draw_id: int):
        contractor = _contractor_for_request(request)
        if contractor is None:
            return Response({"detail": "Contractor profile not found."}, status=400)

        draw = _draw_for_contractor(contractor, draw_id)
        agreement = draw.agreement
        _require_progress_agreement(agreement)
        _require_executed_agreement(agreement)

        try:
            draw = release_escrow_draw(draw_request_id=draw.id)
        except ValueError as exc:
            return Response({"detail": str(exc)}, status=400)

        draw = DrawRequest.objects.prefetch_related("line_items__milestone", "external_payment_records").select_related(
            "agreement", "agreement__project", "agreement__contractor", "agreement__homeowner"
        ).get(pk=draw.pk)
        return Response(_serialize_draw(draw))


class AgreementExternalPaymentListView(APIView):
    permission_classes = [IsAuthenticated]

    def get(self, request, agreement_id: int):
        contractor = _contractor_for_request(request)
        if contractor is None:
            return Response({"detail": "Contractor profile not found."}, status=400)

        agreement = _agreement_for_contractor(contractor, agreement_id)
        _require_progress_agreement(agreement)
        _require_executed_agreement(agreement)

        rows = (
            agreement.external_payment_records.select_related("draw_request", "agreement__project")
            .all()
            .order_by("-payment_date", "-id")
        )
        return Response(
            {
                "agreement_id": agreement.id,
                "results": [_serialize_external_payment(row) for row in rows],
            }
        )
