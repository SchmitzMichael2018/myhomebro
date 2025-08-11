# projects/views/invoice.py

import logging
import os
from django.db import transaction
from django.shortcuts import get_object_or_404
from django.http import FileResponse
import stripe

from rest_framework import viewsets, status
from rest_framework.decorators import action
from rest_framework.permissions import IsAuthenticated, AllowAny
from rest_framework.response import Response
from rest_framework.views import APIView
from rest_framework.exceptions import PermissionDenied

from django.db.models import Q
from django.utils import timezone

from ..models import Invoice, Agreement, InvoiceStatus
from ..serializers import InvoiceSerializer
from ..utils import generate_invoice_pdf
from ..stripe_config import stripe

class InvoiceViewSet(viewsets.ModelViewSet):
    serializer_class = InvoiceSerializer
    permission_classes = [IsAuthenticated]

    def get_queryset(self):
        user = self.request.user
        return (
            Invoice.objects
            .filter(agreement__project__contractor__user=user)
            .select_related(
                'agreement__project__contractor__user',
                'agreement__project__homeowner'
            )
            .distinct()
        )

    def get_object(self):
        queryset = self.get_queryset()
        lookup_url_kwarg = self.lookup_url_kwarg or self.lookup_field
        assert lookup_url_kwarg in self.kwargs, (
            f'Expected view {self.__class__.__name__} to be called with a URL keyword argument named "{lookup_url_kwarg}".'
        )
        filter_kwargs = {self.lookup_field: self.kwargs[lookup_url_kwarg]}
        obj = get_object_or_404(queryset, **filter_kwargs)
        self.check_object_permissions(self.request, obj)
        return obj

    @action(detail=True, methods=["get"], url_path="pdf")
    def pdf(self, request, pk=None):
        invoice = self.get_object()

        if invoice.pdf_file:
            file_path = invoice.pdf_file.path
            if os.path.exists(file_path):
                return FileResponse(open(file_path, 'rb'), as_attachment=True, filename=os.path.basename(file_path))

        try:
            pdf_buffer = generate_invoice_pdf(invoice)
            return FileResponse(
                pdf_buffer,
                as_attachment=True,
                filename=f"invoice_{invoice.invoice_number}.pdf"
            )
        except Exception as e:
            logging.error(f"PDF generation for Invoice {pk} failed: {e}")
            return Response(
                {"detail": "An error occurred while generating the PDF."},
                status=status.HTTP_500_INTERNAL_SERVER_ERROR
            )

    @action(detail=True, methods=["patch"])
    def approve(self, request, pk=None):
        raise PermissionDenied("This action can only be performed by the homeowner via their access link.")

    @action(detail=True, methods=["patch"])
    def dispute(self, request, pk=None):
        raise PermissionDenied("This action can only be performed by the homeowner via their access link.")

    @action(detail=True, methods=["patch"])
    def mark_paid(self, request, pk=None):
        invoice = self.get_object()
        if request.user != invoice.agreement.project.contractor.user:
            raise PermissionDenied("Only the project contractor can mark an invoice as paid.")
        invoice.status = InvoiceStatus.PAID
        invoice.save(update_fields=["status"])
        return Response(self.get_serializer(invoice).data)

    @action(detail=True, methods=["post"])
    def resend(self, request, pk=None):
        invoice = self.get_object()
        if request.user != invoice.agreement.project.contractor.user:
            raise PermissionDenied("Only the contractor can resend invoice notifications.")
        # TODO: task_send_invoice_notification.delay(invoice.id)
        return Response({"detail": "Invoice notification queued for sending."})


class InvoicePDFView(APIView):
    permission_classes = [IsAuthenticated]

    def get(self, request, pk):
        invoice = get_object_or_404(Invoice, pk=pk)
        user = request.user

        if (
            user != invoice.agreement.project.contractor.user and
            user != invoice.agreement.project.homeowner.created_by.user
        ):
            return Response({"detail": "Unauthorized access."}, status=status.HTTP_403_FORBIDDEN)

        if not invoice.pdf_file:
            return Response({"detail": "No PDF file found for this invoice."}, status=status.HTTP_404_NOT_FOUND)

        file_path = invoice.pdf_file.path
        if not os.path.exists(file_path):
            return Response({"detail": "File not found."}, status=status.HTTP_404_NOT_FOUND)

        return FileResponse(open(file_path, 'rb'), as_attachment=True, filename=os.path.basename(file_path))


class MagicInvoiceView(APIView):
    permission_classes = [AllowAny]

    def get(self, request, pk):
        token = request.query_params.get("token")
        if not token:
            return Response({"detail": "An access token is required."}, status=status.HTTP_400_BAD_REQUEST)
        invoice = get_object_or_404(Invoice, pk=pk)
        if str(invoice.agreement.homeowner_access_token) != token:
            raise PermissionDenied("Invalid access token for this invoice.")
        return Response(InvoiceSerializer(invoice).data)


class MagicInvoiceApproveView(APIView):
    permission_classes = [AllowAny]

    def patch(self, request, pk):
        token = request.query_params.get("token")
        invoice = get_object_or_404(Invoice, pk=pk)
        agreement = invoice.agreement

        if str(agreement.homeowner_access_token) != token:
            raise PermissionDenied("Invalid access token.")

        if invoice.status != InvoiceStatus.PENDING:
            return Response({"detail": f"Only invoices with status '{InvoiceStatus.PENDING.label}' can be approved."}, status=status.HTTP_400_BAD_REQUEST)

        try:
            with transaction.atomic():
                invoice.status = InvoiceStatus.APPROVED
                invoice.save(update_fields=["status"])
        except Exception:
            return Response({"detail": "An error occurred during approval."}, status=status.HTTP_500_INTERNAL_SERVER_ERROR)

        return Response(InvoiceSerializer(invoice).data)


class MagicInvoiceDisputeView(APIView):
    authentication_classes = []
    permission_classes = []

    def patch(self, request, pk=None):
        token = request.query_params.get("token")
        if not token:
            return Response({"detail": "An access token is required in the query parameters."}, status=status.HTTP_400_BAD_REQUEST)
        invoice = get_object_or_404(Invoice, pk=pk)
        agreement = invoice.agreement

        if str(agreement.homeowner_access_token) != token:
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
