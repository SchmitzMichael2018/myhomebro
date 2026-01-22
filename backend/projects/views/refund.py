# backend/projects/views/refund.py
#
# Compatibility shim:
#   POST /api/projects/agreements/<agreement_id>/refund/
#
# Delegates to canonical refund logic:
#   POST /api/payments/agreements/<agreement_id>/refund_escrow/
#
# IMPORTANT:
# - DRF APIView methods receive a DRF Request object.
# - The target .as_view() expects a Django HttpRequest.
# - So we pass request._request to avoid 500s.

from rest_framework.views import APIView
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework import status

from payments.views.escrow_refunds import AgreementEscrowRefundView


class AgreementRefundCompatView(APIView):
    permission_classes = [IsAuthenticated]

    def post(self, request, agreement_id: int):
        try:
            # Use the underlying Django HttpRequest for the delegated view
            django_request = getattr(request, "_request", request)

            delegated = AgreementEscrowRefundView.as_view()
            return delegated(django_request, agreement_id=agreement_id)

        except Exception as exc:
            # Return a real error payload instead of exploding to a blank 500
            return Response(
                {"detail": "Refund routing shim failed.", "error": str(exc)},
                status=status.HTTP_500_INTERNAL_SERVER_ERROR,
            )
