# backend/projects/views/invoice_direct_pay.py
# v2026-03-15 — add passive pricing observation hook for direct-pay path

from __future__ import annotations

from rest_framework.decorators import api_view, permission_classes
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework import status
from rest_framework.exceptions import PermissionDenied

from projects.models import Invoice
from projects.services.activity_feed import create_activity_event
from projects.services.contractor_onboarding import build_stripe_requirement_payload
from projects.services.direct_pay import create_direct_pay_checkout_for_invoice
from projects.services.agreement_completion import recompute_and_apply_agreement_completion
from projects.services.pricing_observations import record_pricing_observation_for_invoice


def _agreement_has_active_dispute(agreement) -> bool:
    if not agreement:
        return False
    try:
        return agreement.disputes.filter(status__in=("initiated", "open", "under_review")).exists()
    except Exception:
        return False


def _safe_post_payment_tasks(invoice: Invoice) -> None:
    """
    Safe passive-learning + completion hook.
    Never blocks direct pay link creation.
    """
    try:
        record_pricing_observation_for_invoice(invoice)
    except Exception:
        pass

    try:
        ag_id = getattr(invoice, "agreement_id", None)
        if ag_id:
            recompute_and_apply_agreement_completion(int(ag_id))
    except Exception:
        return


def _sync_project_customer_from_agreement(agreement) -> None:
    """
    Option A hardening:
    Keep agreement.project.homeowner aligned with agreement.homeowner so no legacy code
    (including some Stripe session builders) accidentally uses a stale project homeowner.
    """
    try:
        if not agreement:
            return
        customer = getattr(agreement, "homeowner", None)
        if not customer:
            return
        project = getattr(agreement, "project", None)
        if not project:
            return
        if getattr(project, "homeowner_id", None) == getattr(customer, "id", None):
            return
        project.homeowner = customer
        update_fields = ["homeowner"]
        if hasattr(project, "updated_at"):
            from django.utils import timezone
            project.updated_at = timezone.now()
            update_fields.append("updated_at")
        project.save(update_fields=update_fields)
    except Exception:
        return


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
            .select_related("agreement", "agreement__contractor", "agreement__project", "agreement__homeowner")
            .get(pk=pk)
        )
    except Invoice.DoesNotExist:
        return Response({"error": "Invoice not found."}, status=status.HTTP_404_NOT_FOUND)

    # Ownership guard: invoice must belong to logged-in contractor
    contractor = getattr(request.user, "contractor_profile", None)
    if not contractor or getattr(invoice.agreement, "contractor_id", None) != contractor.id:
        raise PermissionDenied("Not allowed.")

    if not bool(getattr(contractor, "stripe_connected", False)):
        return Response(
            build_stripe_requirement_payload(
                contractor,
                action_key="create_direct_pay_link",
                action_label="Create Direct Pay Link",
                source="invoice_direct_pay",
                return_path=f"/app/invoices/{invoice.id}",
            ),
            status=status.HTTP_409_CONFLICT,
        )

    agreement = getattr(invoice, "agreement", None)

    # Dispute guard
    if _agreement_has_active_dispute(agreement):
        return Response(
            {"error": "This agreement has an active dispute. Direct Pay link creation is paused."},
            status=status.HTTP_400_BAD_REQUEST,
        )

    # Must be direct pay agreement
    if getattr(agreement, "payment_mode", None) != "direct":
        return Response({"error": "This agreement is not in Direct Pay mode."}, status=status.HTTP_400_BAD_REQUEST)

    # ✅ Option A: require agreement.customer/homeowner
    customer = getattr(agreement, "homeowner", None)
    if not customer or not getattr(customer, "email", None):
        return Response(
            {"error": "Agreement customer is missing (name/email). Set the Customer on the Agreement first."},
            status=status.HTTP_400_BAD_REQUEST,
        )

    # ✅ keep project customer aligned (prevents stale project homeowner leaks)
    _sync_project_customer_from_agreement(agreement)

    # Paid invoices cannot get a new pay link
    if str(getattr(invoice, "status", "") or "").lower() == "paid" or getattr(invoice, "direct_pay_paid_at", None):
        return Response(
            {"error": "This invoice is already paid and cannot generate a new pay link."},
            status=status.HTTP_400_BAD_REQUEST,
        )

    # Idempotent: if a link already exists, return it
    existing_url = (getattr(invoice, "direct_pay_checkout_url", "") or "").strip()
    if existing_url:
        return Response({"checkout_url": existing_url}, status=status.HTTP_200_OK)

    try:
        checkout_url = create_direct_pay_checkout_for_invoice(invoice)
    except Exception as e:
        return Response({"error": str(e)}, status=status.HTTP_400_BAD_REQUEST)

    try:
        create_activity_event(
            contractor=contractor,
            agreement=agreement,
            event_type="direct_pay_link_ready",
            title="Direct pay link ready",
            summary="The customer can now review the direct pay link.",
            severity="success",
            related_label=getattr(invoice, "milestone_title_snapshot", "") or getattr(invoice, "invoice_number", "") or "Invoice",
            icon_hint="payment",
            navigation_target=f"/app/invoices/{invoice.id}",
            metadata={"invoice_id": invoice.id, "agreement_id": agreement.id},
            dedupe_key=f"direct_pay_link_ready:{invoice.id}",
        )
    except Exception:
        pass

    # Safety: if invoice became paid somehow, capture pricing + recompute completion
    try:
        invoice.refresh_from_db()
        if str(getattr(invoice, "status", "") or "").lower() == "paid" or getattr(invoice, "direct_pay_paid_at", None):
            _safe_post_payment_tasks(invoice)
    except Exception:
        pass

    return Response({"checkout_url": checkout_url}, status=status.HTTP_200_OK)
