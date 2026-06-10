from __future__ import annotations

from decimal import Decimal

from django.shortcuts import get_object_or_404
from rest_framework import serializers, status
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

from projects.models import Agreement, Milestone
from projects.models_amendment_request import AmendmentRequest, apply_descoped_milestone_hold
from projects.services.project_activity import create_project_activity_event
from projects.utils.accounts import get_contractor_for_user


class ContractorAgreementAmendmentRequestSerializer(serializers.Serializer):
    change_type = serializers.ChoiceField(choices=[choice[0] for choice in AmendmentRequest.ChangeType.choices])
    requested_change = serializers.CharField()
    reason = serializers.CharField()
    affected_milestone_ids = serializers.ListField(child=serializers.IntegerField(), required=False, allow_empty=True)
    proposed_value_change = serializers.DecimalField(max_digits=12, decimal_places=2, required=False)
    revised_project_value = serializers.DecimalField(max_digits=12, decimal_places=2, required=False)
    attachment_note = serializers.CharField(required=False, allow_blank=True)


class AmendmentRequestResponseSerializer(serializers.Serializer):
    response_state = serializers.ChoiceField(
        choices=[
            AmendmentRequest.ResponseState.ACCEPTED,
            AmendmentRequest.ResponseState.REJECTED,
            AmendmentRequest.ResponseState.COUNTERED,
        ]
    )
    response_note = serializers.CharField(required=False, allow_blank=True)
    counter_proposal = serializers.JSONField(required=False)


def _contractor_agreement_for_user(user, agreement_id: int) -> Agreement | None:
    contractor = get_contractor_for_user(user)
    if contractor is None:
        return None
    return Agreement.objects.select_related("contractor", "homeowner", "project").filter(id=agreement_id, contractor=contractor).first()


class ContractorAgreementAmendmentRequestView(APIView):
    permission_classes = [IsAuthenticated]

    def post(self, request, agreement_id: int):
        agreement = _contractor_agreement_for_user(request.user, agreement_id)
        if agreement is None:
            return Response({"detail": "Agreement not found."}, status=status.HTTP_404_NOT_FOUND)

        serializer = ContractorAgreementAmendmentRequestSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        existing = (
            AmendmentRequest.objects.filter(agreement=agreement)
            .exclude(status=AmendmentRequest.Status.CLOSED)
            .order_by("-created_at", "-id")
            .first()
        )
        if existing:
            return Response({"detail": "An amendment request is already open.", "amendment_request_id": existing.id}, status=status.HTTP_200_OK)

        change_type = serializer.validated_data["change_type"]
        original_project_value = Decimal(str(getattr(agreement, "total_cost", 0) or 0)).quantize(Decimal("0.01"))
        escrow_funded_amount = Decimal(str(getattr(agreement, "escrow_funded_amount", 0) or 0)).quantize(Decimal("0.01"))
        revised_project_value = serializer.validated_data.get("revised_project_value")
        estimated_surplus = Decimal("0.00")
        eligibility = AmendmentRequest.RefundEligibilityStatus.NOT_APPLICABLE
        if change_type == AmendmentRequest.ChangeType.DESCOPE_REMOVE_WORK:
            eligibility = AmendmentRequest.RefundEligibilityStatus.ELIGIBLE_AFTER_SIGNED
            if revised_project_value is not None:
                revised_project_value = Decimal(str(revised_project_value)).quantize(Decimal("0.01"))
                estimated_surplus = max(escrow_funded_amount - revised_project_value, Decimal("0.00"))
            else:
                eligibility = AmendmentRequest.RefundEligibilityStatus.ESTIMATE_ONLY

        amendment = AmendmentRequest.objects.create(
            agreement=agreement,
            requested_by=request.user,
            initiated_by_role="contractor",
            change_type=change_type,
            requested_changes={
                "requested_change": serializer.validated_data["requested_change"],
                "attachment_note": serializer.validated_data.get("attachment_note", ""),
                "proposed_value_change": str(serializer.validated_data.get("proposed_value_change") or ""),
                "requested_on_amendment_number": int(getattr(agreement, "amendment_number", 0) or 0),
            },
            justification=serializer.validated_data["reason"],
            original_project_value=original_project_value if change_type == AmendmentRequest.ChangeType.DESCOPE_REMOVE_WORK else None,
            revised_project_value=revised_project_value if change_type == AmendmentRequest.ChangeType.DESCOPE_REMOVE_WORK else None,
            escrow_funded_amount=escrow_funded_amount if change_type == AmendmentRequest.ChangeType.DESCOPE_REMOVE_WORK else None,
            estimated_refundable_escrow_surplus=estimated_surplus,
            refund_eligibility_status=eligibility,
        )
        if change_type == AmendmentRequest.ChangeType.DESCOPE_REMOVE_WORK:
            ids = set()
            for value in serializer.validated_data.get("affected_milestone_ids") or []:
                try:
                    ids.add(int(value))
                except Exception:
                    pass
            affected = Milestone.objects.filter(agreement=agreement, id__in=ids)
            amendment.affected_milestones.set(affected)
            apply_descoped_milestone_hold(amendment)

        create_project_activity_event(
            agreement=agreement,
            event_type="amendment_created",
            object_type="amendment_request",
            object_id=amendment.id,
            title="Contractor submitted amendment request",
            body=amendment.justification,
            actor=request.user,
            actor_role="contractor",
            recipient_role="homeowner",
            delivered=True,
            metadata={"change_type": change_type},
        )
        return Response(
            {
                "ok": True,
                "amendment_request": {
                    "id": amendment.id,
                    "status": amendment.status,
                    "status_label": amendment.get_status_display(),
                    "response_state": amendment.response_state,
                },
            },
            status=status.HTTP_201_CREATED,
        )


class AmendmentRequestResponseView(APIView):
    permission_classes = [IsAuthenticated]

    def post(self, request, request_id: int):
        amendment = get_object_or_404(
            AmendmentRequest.objects.select_related("agreement", "agreement__contractor"),
            id=request_id,
        )
        agreement = amendment.agreement
        contractor = get_contractor_for_user(request.user)
        is_contractor = bool(contractor and getattr(agreement, "contractor_id", None) == contractor.id)
        homeowner_email = (getattr(getattr(agreement, "homeowner", None), "email", "") or "").lower()
        is_homeowner = bool(getattr(request.user, "email", "").lower() == homeowner_email)
        if not (is_contractor or is_homeowner or request.user.is_staff):
            return Response({"detail": "Forbidden"}, status=status.HTTP_403_FORBIDDEN)

        serializer = AmendmentRequestResponseSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        amendment.mark_responded(
            response_state=serializer.validated_data["response_state"],
            actor=request.user,
            note=serializer.validated_data.get("response_note", ""),
            counter_proposal=serializer.validated_data.get("counter_proposal"),
        )
        create_project_activity_event(
            agreement=agreement,
            event_type="amendment_responded",
            object_type="amendment_request",
            object_id=amendment.id,
            title=f"Amendment {amendment.get_response_state_display().lower()}",
            body=amendment.response_note,
            actor=request.user,
            actor_role="contractor" if is_contractor else "homeowner",
            recipient_role="homeowner" if is_contractor else "contractor",
            delivered=True,
            responded=True,
            resolved=amendment.response_state in {AmendmentRequest.ResponseState.ACCEPTED, AmendmentRequest.ResponseState.REJECTED},
            metadata={"response_state": amendment.response_state},
        )
        return Response(
            {
                "ok": True,
                "amendment_request": {
                    "id": amendment.id,
                    "status": amendment.status,
                    "status_label": amendment.get_status_display(),
                    "response_state": amendment.response_state,
                    "response_label": amendment.get_response_state_display(),
                },
            },
            status=status.HTTP_200_OK,
        )
