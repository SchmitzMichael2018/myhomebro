import logging
from django.db import transaction
from django.utils import timezone
from django.shortcuts import get_object_or_404
from rest_framework import status
from rest_framework.views import APIView
from rest_framework.response import Response
from rest_framework.exceptions import PermissionDenied

from ..models import Invoice, InvoiceStatus
from ..serializers import InvoiceSerializer

logger = logging.getLogger(__name__)


class MagicInvoiceView(APIView):
    permission_classes = []  # AllowAny

    def get(self, request, pk=None):
        token = request.query_params.get("token")
        if not token:
            return Response({"detail": "An access token is required."}, status=status.HTTP_400_BAD_REQUEST)
        invoice = get_object_or_404(Invoice, pk=pk)
        if str(invoice.agreement.homeowner_access_token) != token:
            raise PermissionDenied("Invalid or expired access token.")
        return Response(InvoiceSerializer(invoice).data)


def _release_escrow(invoice: Invoice) -> None:
    """
    Minimal escrow release flagger. Stripe transfer logic can be added here:
      - create Transfer from platform to contractor connected account
      - set invoice.stripe_transfer_id
    """
    now = timezone.now()
    invoice.escrow_released = True
    invoice.escrow_released_at = now
    # e.g., invoice.stripe_transfer_id = transfer.id
    invoice.save(update_fields=["escrow_released", "escrow_released_at"])


class MagicInvoiceApproveView(APIView):
    permission_classes = []  # AllowAny

    def patch(self, request, pk=None):
        token = request.query_params.get("token")
        invoice = get_object_or_404(Invoice, pk=pk)

        if str(invoice.agreement.homeowner_access_token) != token:
            raise PermissionDenied("Invalid or expired access token.")

        if invoice.status != InvoiceStatus.PENDING:
            return Response({"detail": f"Only invoices with status '{InvoiceStatus.PENDING.label}' can be approved."}, status=status.HTTP_400_BAD_REQUEST)

        try:
            with transaction.atomic():
                # Mark approved
                invoice.status = InvoiceStatus.APPROVED
                invoice.approved_at = timezone.now()
                invoice.save(update_fields=["status", "approved_at"])

                # Guard: never release escrow if disputed (or later becomes disputed)
                if not invoice.disputed:
                    _release_escrow(invoice)
                    # Optionally flip to PAID once transfer settles
                    # invoice.status = InvoiceStatus.PAID
                    # invoice.save(update_fields=["status"])
        except Exception as e:
            logger.error(f"Error during magic link invoice approval for {invoice.id}: {e}")
            return Response({"detail": "An unexpected error occurred during the approval process."}, status=status.HTTP_500_INTERNAL_SERVER_ERROR)

        return Response(InvoiceSerializer(invoice).data)


class MagicInvoiceDisputeView(APIView):
    permission_classes = []  # AllowAny

    def patch(self, request, pk=None):
        token = request.query_params.get("token")
        invoice = get_object_or_404(Invoice, pk=pk)

        if str(invoice.agreement.homeowner_access_token) != token:
            raise PermissionDenied("Invalid or expired access token.")

        if invoice.status != InvoiceStatus.PENDING:
            return Response({"detail": f"Only invoices with status '{InvoiceStatus.PENDING.label}' can be disputed."}, status=status.HTTP_400_BAD_REQUEST)

        dispute_reason = request.data.get("reason", "No reason provided.")
        with transaction.atomic():
            invoice.status = InvoiceStatus.DISPUTED
            invoice.disputed_at = timezone.now()
            invoice.dispute_by = "homeowner"
            invoice.dispute_reason = dispute_reason
            invoice.save(update_fields=["status", "disputed_at", "dispute_by", "dispute_reason"])
            # NOTE: by policy, escrow remains unreleased; if already released (shouldn't be),
            # you'd initiate refund/adjustment here.

        return Response(InvoiceSerializer(invoice).data)
