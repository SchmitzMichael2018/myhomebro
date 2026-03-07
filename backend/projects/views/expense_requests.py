# backend/projects/views/expense_requests.py
from __future__ import annotations

from django.conf import settings
from django.http import FileResponse, HttpResponseRedirect
from django.shortcuts import get_object_or_404
from django.utils import timezone

from rest_framework import permissions, viewsets
from rest_framework.decorators import action
from rest_framework.request import Request
from rest_framework.response import Response

from projects.models import ExpenseRequest, ExpenseRequestAttachment
from projects.serializers.expense_request import (
    ExpenseRequestAttachmentSerializer,
    ExpenseRequestSerializer,
)
from projects.services.expense_pay import create_expense_checkout_session
from projects.services.expense_public_links import make_expense_token, verify_expense_token
from projects.services.mailer import email_expense_request


class IsAuthenticatedOrReadOnly(permissions.BasePermission):
    def has_permission(self, request, view):
        if request.method in ("GET", "HEAD", "OPTIONS"):
            return True
        return bool(request.user and request.user.is_authenticated)


class ExpenseRequestViewSet(viewsets.ModelViewSet):
    """
    Unified Expense Requests:
      - create
      - contractor_sign
      - send_to_homeowner (supports resend)
      - homeowner_accept / homeowner_reject
      - mark_paid
      - attachments (multi receipts/photos)

    Archive behavior:
      - default list hides archived expenses
      - ?include_archived=1 includes archived

    Scoping behavior:
      - Staff/superusers see all
      - Contractors only see expenses for agreements that belong to them

    Public (customer) endpoints (signed token):
      - GET  /expense-requests/<id>/public/checkout/?t=...
      - GET  /expense-requests/<id>/public/reject/?t=...
      - GET  /expense-requests/<id>/public/attachments/<att_id>/?t=...
    """

    queryset = ExpenseRequest.objects.all().order_by("-created_at", "id")
    serializer_class = ExpenseRequestSerializer
    permission_classes = [IsAuthenticatedOrReadOnly]

    # ---------------------------------------------------------------------
    # Queryset scoping + archive filter
    # ---------------------------------------------------------------------
    def get_queryset(self):
        qs = super().get_queryset()
        user = getattr(self.request, "user", None)
        if not user or not getattr(user, "is_authenticated", False):
            return qs.none()

        # Scope: staff can see all; contractors see only their own agreement expenses
        if not (getattr(user, "is_staff", False) or getattr(user, "is_superuser", False)):
            contractor = getattr(user, "contractor_profile", None)
            if contractor is None:
                return qs.none()
            qs = qs.filter(agreement__contractor=contractor)

        # Archive filter: default hides archived
        include_archived = (self.request.query_params.get("include_archived") or "").strip() == "1"
        if not include_archived:
            qs = qs.filter(is_archived=False)

        return qs

    def perform_create(self, serializer):
        serializer.save(created_by=self.request.user if self.request.user.is_authenticated else None)

    # ---------------------------------------------------------------------
    # Helpers
    # ---------------------------------------------------------------------
    def _site_url(self) -> str:
        # Prefer MHB_SITE_URL, fallback to FRONTEND_URL, else empty.
        base = (getattr(settings, "MHB_SITE_URL", "") or "").strip()
        if not base:
            base = (getattr(settings, "FRONTEND_URL", "") or "").strip()
        return base.rstrip("/")

    def _require_public_token(self, request: Request, expense_id: int) -> Response | None:
        token = (request.query_params.get("t") or "").strip()
        ok, msg = verify_expense_token(expense_id, token)
        if not ok:
            return Response({"detail": msg}, status=401)
        return None

    def _resolve_customer(self, expense: ExpenseRequest) -> tuple[str, str]:
        """
        Returns (email, name) for the customer.
        Current schema: agreement.homeowner.<email/full_name>
        """
        ag = getattr(expense, "agreement", None)
        if not ag:
            return "", "Customer"

        homeowner = getattr(ag, "homeowner", None)
        email = getattr(homeowner, "email", "") if homeowner else ""
        name = (
            getattr(homeowner, "full_name", None)
            or getattr(ag, "homeowner_name", None)
            or "Customer"
        )
        return (email or ""), (name or "Customer")

    def _build_public_urls(self, expense: ExpenseRequest, token: str) -> dict:
        base = self._site_url()
        return {
            "checkout_url": f"{base}/api/projects/expense-requests/{expense.id}/public/checkout/?t={token}",
            "reject_url": f"{base}/api/projects/expense-requests/{expense.id}/public/reject/?t={token}",
        }

    def _build_attachment_links(self, expense: ExpenseRequest, token: str) -> list[dict]:
        base = self._site_url()
        links: list[dict] = []
        try:
            for att in expense.attachments.all().order_by("-uploaded_at", "-id"):
                name = getattr(att, "original_name", "") or f"Attachment #{att.id}"
                url = f"{base}/api/projects/expense-requests/{expense.id}/public/attachments/{att.id}/?t={token}"
                links.append({"name": name, "url": url})
        except Exception:
            pass
        return links

    # ---------------------------------------------------------------------
    # Attachments (contractor-authenticated)
    # ---------------------------------------------------------------------
    @action(detail=True, methods=["get", "post"])
    def attachments(self, request: Request, pk=None):
        exp = self.get_object()

        if request.method == "GET":
            qs = exp.attachments.all().order_by("-uploaded_at", "-id")
            ser = ExpenseRequestAttachmentSerializer(qs, many=True, context={"request": request})
            return Response(ser.data)

        files = request.FILES.getlist("files") or request.FILES.getlist("file")
        if not files:
            return Response({"detail": "No files provided."}, status=400)

        created = []
        for f in files:
            created.append(
                ExpenseRequestAttachment.objects.create(
                    expense_request=exp,
                    file=f,
                    original_name=getattr(f, "name", "") or "",
                    uploaded_by=request.user if request.user.is_authenticated else None,
                )
            )

        ser = ExpenseRequestAttachmentSerializer(created, many=True, context={"request": request})
        return Response(ser.data, status=201)

    @action(detail=True, methods=["delete"], url_path=r"attachments/(?P<att_id>\d+)")
    def delete_attachment(self, request: Request, pk=None, att_id=None):
        exp = self.get_object()
        att = exp.attachments.filter(id=att_id).first()
        if not att:
            return Response({"detail": "Attachment not found."}, status=404)
        att.delete()
        return Response(status=204)

    # ---------------------------------------------------------------------
    # Workflow (contractor-authenticated)
    # ---------------------------------------------------------------------
    @action(detail=True, methods=["post"])
    def contractor_sign(self, request: Request, pk=None):
        expense = self.get_object()
        if expense.status != ExpenseRequest.Status.DRAFT:
            return Response({"detail": "Only Draft expenses can be signed."}, status=400)

        expense.status = ExpenseRequest.Status.CONTRACTOR_SIGNED
        expense.contractor_signed_at = timezone.now()
        expense.save(update_fields=["status", "contractor_signed_at", "updated_at"])
        return Response(self.get_serializer(expense).data)

    @action(detail=True, methods=["post"])
    def send_to_homeowner(self, request: Request, pk=None):
        """
        Supports first-send + resend.

        Allowed states:
          - DRAFT: auto-sign then send
          - CONTRACTOR_SIGNED: send
          - SENT_TO_HOMEOWNER: RESEND (no status change)
        """
        expense = self.get_object()

        # Block if already acted on
        if expense.status in [
            ExpenseRequest.Status.HOMEOWNER_ACCEPTED,
            ExpenseRequest.Status.HOMEOWNER_REJECTED,
            ExpenseRequest.Status.PAID,
        ]:
            return Response(
                {"detail": "This expense can’t be sent because it has already been acted on."},
                status=400,
            )

        is_resend = (expense.status == ExpenseRequest.Status.SENT_TO_HOMEOWNER)

        # State transitions
        if expense.status == ExpenseRequest.Status.DRAFT:
            expense.status = ExpenseRequest.Status.CONTRACTOR_SIGNED
            expense.contractor_signed_at = timezone.now()

        if expense.status == ExpenseRequest.Status.CONTRACTOR_SIGNED:
            expense.status = ExpenseRequest.Status.SENT_TO_HOMEOWNER
            expense.save(update_fields=["status", "contractor_signed_at", "updated_at"])
        elif expense.status == ExpenseRequest.Status.SENT_TO_HOMEOWNER:
            expense.save(update_fields=["updated_at"])
        else:
            return Response({"detail": "Expense must be Draft, Signed, or Sent to resend."}, status=400)

        base = self._site_url()
        if not base:
            return Response({"detail": "Missing MHB_SITE_URL (or FRONTEND_URL) in settings."}, status=400)

        customer_email, customer_name = self._resolve_customer(expense)
        if not customer_email:
            # revert first-send if email missing
            if not is_resend and expense.status == ExpenseRequest.Status.SENT_TO_HOMEOWNER:
                expense.status = ExpenseRequest.Status.CONTRACTOR_SIGNED
                expense.save(update_fields=["status", "updated_at"])
            return Response({"detail": "Customer email missing on agreement."}, status=400)

        token = make_expense_token(expense.id)
        urls = self._build_public_urls(expense, token)
        attachment_links = self._build_attachment_links(expense, token)

        try:
            ok = email_expense_request(
                expense,
                customer_email=customer_email,
                customer_name=customer_name,
                approve_url=urls["checkout_url"],
                pay_url=urls["checkout_url"],
                reject_url=urls["reject_url"],
                attachment_links=attachment_links,
                is_resend=is_resend,
            )
            if not ok:
                if not is_resend and expense.status == ExpenseRequest.Status.SENT_TO_HOMEOWNER:
                    expense.status = ExpenseRequest.Status.CONTRACTOR_SIGNED
                    expense.save(update_fields=["status", "updated_at"])
                return Response({"detail": "Email could not be sent."}, status=400)
        except Exception as e:
            if not is_resend and expense.status == ExpenseRequest.Status.SENT_TO_HOMEOWNER:
                expense.status = ExpenseRequest.Status.CONTRACTOR_SIGNED
                expense.save(update_fields=["status", "updated_at"])
            return Response({"detail": f"Email send failed: {e.__class__.__name__}"}, status=500)

        return Response(self.get_serializer(expense).data)

    @action(detail=True, methods=["post"])
    def homeowner_accept(self, request: Request, pk=None):
        expense = self.get_object()
        if expense.status != ExpenseRequest.Status.SENT_TO_HOMEOWNER:
            return Response({"detail": "Only sent expenses can be accepted."}, status=400)

        expense.status = ExpenseRequest.Status.HOMEOWNER_ACCEPTED
        expense.homeowner_acted_at = timezone.now()
        expense.save(update_fields=["status", "homeowner_acted_at", "updated_at"])
        return Response(self.get_serializer(expense).data)

    @action(detail=True, methods=["post"])
    def homeowner_reject(self, request: Request, pk=None):
        expense = self.get_object()
        if expense.status != ExpenseRequest.Status.SENT_TO_HOMEOWNER:
            return Response({"detail": "Only sent expenses can be rejected."}, status=400)

        expense.status = ExpenseRequest.Status.HOMEOWNER_REJECTED
        expense.homeowner_acted_at = timezone.now()
        expense.save(update_fields=["status", "homeowner_acted_at", "updated_at"])
        return Response(self.get_serializer(expense).data)

    @action(detail=True, methods=["post"])
    def mark_paid(self, request: Request, pk=None):
        expense = self.get_object()
        if expense.status not in [
            ExpenseRequest.Status.HOMEOWNER_ACCEPTED,
            ExpenseRequest.Status.SENT_TO_HOMEOWNER,
        ]:
            return Response({"detail": "Only accepted or sent expenses can be marked paid."}, status=400)

        expense.status = ExpenseRequest.Status.PAID
        expense.paid_at = timezone.now()
        expense.save(update_fields=["status", "paid_at", "updated_at"])
        return Response(self.get_serializer(expense).data)

    # ---------------------------------------------------------------------
    # PUBLIC endpoints (customer email links)
    # ---------------------------------------------------------------------
    @action(
        detail=True,
        methods=["get"],
        permission_classes=[permissions.AllowAny],
        url_path=r"public/attachments/(?P<att_id>\d+)",
    )
    def public_attachment_download(self, request: Request, pk=None, att_id=None):
        expense = get_object_or_404(ExpenseRequest, pk=pk)
        deny = self._require_public_token(request, expense.id)
        if deny:
            return deny

        att = expense.attachments.filter(id=att_id).first()
        if not att:
            return Response({"detail": "Attachment not found."}, status=404)

        f = att.file
        return FileResponse(
            f.open("rb"),
            as_attachment=True,
            filename=(getattr(att, "original_name", "") or None),
        )

    @action(
        detail=True,
        methods=["get"],
        permission_classes=[permissions.AllowAny],
        url_path="public/reject",
    )
    def public_reject(self, request: Request, pk=None):
        expense = get_object_or_404(ExpenseRequest, pk=pk)
        deny = self._require_public_token(request, expense.id)
        if deny:
            return deny

        if expense.status != ExpenseRequest.Status.SENT_TO_HOMEOWNER:
            return Response({"detail": "This expense can’t be rejected now."}, status=400)

        expense.status = ExpenseRequest.Status.HOMEOWNER_REJECTED
        expense.homeowner_acted_at = timezone.now()
        expense.save(update_fields=["status", "homeowner_acted_at", "updated_at"])

        base = self._site_url() or ""
        return HttpResponseRedirect(f"{base}/?expense=rejected&expense_id={expense.id}")

    @action(
        detail=True,
        methods=["get"],
        permission_classes=[permissions.AllowAny],
        url_path="public/checkout",
    )
    def public_checkout(self, request: Request, pk=None):
        """
        Creates a Stripe Checkout Session and redirects the customer to pay.
        """
        expense = get_object_or_404(ExpenseRequest, pk=pk)
        deny = self._require_public_token(request, expense.id)
        if deny:
            return deny

        if expense.status in [
            ExpenseRequest.Status.HOMEOWNER_REJECTED,
            ExpenseRequest.Status.PAID,
        ]:
            return Response({"detail": "This expense is not eligible for payment."}, status=400)

        token = (request.query_params.get("t") or "").strip()

        try:
            checkout_url = create_expense_checkout_session(expense, token=token)
        except Exception as e:
            return Response({"detail": f"{e.__class__.__name__}: {str(e)}"}, status=400)

        return HttpResponseRedirect(checkout_url)