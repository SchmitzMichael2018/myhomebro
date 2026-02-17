# backend/projects/views/invoice_direct_pay.py

from __future__ import annotations

from rest_framework.decorators import api_view, permission_classes
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework import status

from projects.models import Invoice
from projects.services.direct_pay import create_direct_pay_checkout_for_invoice


@api_view(["POST"])
@permission_classes([IsAuthenticated])
def invoice_create_direct_pay_link(request, pk: int):
    """
    POST /api/projects/invoices/<pk>/direct_pay_link/
    Returns: {"checkout_url": "..."}
    """

    try:
        invoice = (
            Invoice.objects
            .select_related("agreement", "agreement__contractor", "agreement__project")
            .get(pk=pk)
        )
    except Invoice.DoesNotExist:
        return Response({"error": "Invoice not found."}, status=status.HTTP_404_NOT_FOUND)

    # Ownership guard: invoice must belong to logged-in contractor
    contractor = getattr(request.user, "contractor_profile", None)
    if not contractor or invoice.agreement.contractor_id != contractor.id:
        return Response({"error": "Not allowed."}, status=status.HTTP_403_FORBIDDEN)

    try:
        checkout_url = create_direct_pay_checkout_for_invoice(invoice)
    except Exception as e:
        return Response({"error": str(e)}, status=status.HTTP_400_BAD_REQUEST)

    return Response({"checkout_url": checkout_url}, status=status.HTTP_200_OK)
