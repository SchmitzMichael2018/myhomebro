# backend/projects/views/magic_invoice_pdf.py
# v2025-12-24 — PUBLIC homeowner invoice PDF (ReportLab)

import logging
from django.http import HttpResponse
from django.shortcuts import get_object_or_404

from rest_framework.permissions import AllowAny
from rest_framework.views import APIView

from projects.models import Invoice
from projects.services.invoice_pdf import generate_invoice_pdf_bytes

logger = logging.getLogger(__name__)


class MagicInvoicePDFView(APIView):
    """
    PUBLIC homeowner invoice PDF view.
    Token-in-path. No authentication required.

    GET /api/projects/invoices/magic/<uuid:token>/pdf/
    """
    permission_classes = [AllowAny]

    def get(self, request, token):
        invoice = get_object_or_404(Invoice, public_token=token)

        try:
            pdf_bytes = generate_invoice_pdf_bytes(invoice)
        except Exception:
            logger.exception("Magic invoice PDF generation failed for invoice %s", getattr(invoice, "id", None))
            return HttpResponse("Failed to generate PDF.", status=500, content_type="text/plain")

        filename = f'invoice_{getattr(invoice, "invoice_number", getattr(invoice, "id", "invoice"))}.pdf'
        resp = HttpResponse(pdf_bytes, content_type="application/pdf")
        resp["Content-Disposition"] = f'inline; filename="{filename}"'
        return resp
