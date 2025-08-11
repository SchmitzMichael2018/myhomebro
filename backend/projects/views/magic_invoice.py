# backend/projects/views/magic_invoice.py

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
    """
    Handles public, token-based GET requests to view a single invoice.
    """
    permission_classes = [] # Allow public access

    def get(self, request, pk=None):
        token = request.query_params.get("token")
        if not token:
            return Response({"detail": "An access token is required."}, status=status.HTTP_400_BAD_REQUEST)
        
        invoice = get_object_or_404(Invoice, pk=pk)
        
        # Securely check the token against the parent agreement
        if str(invoice.agreement.homeowner_access_token) != token:
            raise PermissionDenied("Invalid or expired access token.")
            
        return Response(InvoiceSerializer(invoice).data)


class MagicInvoiceApproveView(APIView):
    """
    Handles public, token-based PATCH requests to approve an invoice.
    """
    permission_classes = []

    def patch(self, request, pk=None):
        token = request.query_params.get("token")
        invoice = get_object_or_404(Invoice, pk=pk)
        
        if str(invoice.agreement.homeowner_access_token) != token:
            raise PermissionDenied("Invalid or expired access token.")
            
        if invoice.status != InvoiceStatus.PENDING:
            return Response({"detail": f"Only invoices with status '{InvoiceStatus.PENDING.label}' can be approved."}, status=status.HTTP_400_BAD_REQUEST)

        try:
            # The logic to approve and trigger payment should be atomic
            with transaction.atomic():
                invoice.status = InvoiceStatus.APPROVED
                invoice.approved_at = timezone.now()
                # Additional logic for Stripe capture/transfer would go here
                # For now, we simulate the full flow by marking as paid
                # invoice.status = InvoiceStatus.PAID 
                invoice.save(update_fields=["status", "approved_at"])
        except Exception as e:
            logger.error(f"Error during magic link invoice approval for {invoice.id}: {e}")
            return Response({"detail": "An unexpected error occurred during the approval process."}, status=status.HTTP_500_INTERNAL_SERVER_ERROR)

        return Response(InvoiceSerializer(invoice).data)


class MagicInvoiceDisputeView(APIView):
    """
    Handles public, token-based PATCH requests to dispute an invoice.
    """
    permission_classes = []

    def patch(self, request, pk=None):
        token = request.query_params.get("token")
        invoice = get_object_or_404(Invoice, pk=pk)

        if str(invoice.agreement.homeowner_access_token) != token:
            raise PermissionDenied("Invalid or expired access token.")

        if invoice.status != InvoiceStatus.PENDING:
            return Response({"detail": f"Only invoices with status '{InvoiceStatus.PENDING.label}' can be disputed."}, status=status.HTTP_400_BAD_REQUEST)
        
        dispute_reason = request.data.get('reason', 'No reason provided.')
        
        with transaction.atomic():
            invoice.status = InvoiceStatus.DISPUTED
            invoice.disputed_at = timezone.now()
            invoice.dispute_by = 'homeowner'
            invoice.dispute_reason = dispute_reason
            invoice.save(update_fields=["status", "disputed_at", "dispute_by", "dispute_reason"])
            
        return Response(InvoiceSerializer(invoice).data)