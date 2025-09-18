# ~/backend/backend/projects/views/agreements.py
from __future__ import annotations

from typing import Any, Iterable, Optional

from django.apps import apps
from django.http import HttpResponse, JsonResponse
from django.db import transaction
from django.db.models import QuerySet, Sum
from rest_framework import status, viewsets, permissions, serializers
from rest_framework.decorators import action
from rest_framework.request import Request
from rest_framework.response import Response

# ---- best-effort model import; recover lazily if needed ----------------------
def _get_model(app_label: str, model_name: str):
    try:
        return apps.get_model(app_label, model_name)
    except Exception:
        return None

try:
    from projects.models import Agreement as _Agreement, Invoice as _Invoice, Milestone as _Milestone, Attachment as _Attachment, AgreementAmendment as _AgreementAmendment
    Agreement, Invoice, Milestone, Attachment, AgreementAmendment = _Agreement, _Invoice, _Milestone, _Attachment, _AgreementAmendment
except Exception:
    Agreement = _get_model("projects", "Agreement")
    Invoice = _get_model("projects", "Invoice")
    Milestone = _get_model("projects", "Milestone")
    Attachment = _get_model("projects", "Attachment")
    AgreementAmendment = _get_model("projects", "AgreementAmendment")

# ---- serializers (rich first, then safe fallback) ---------------------------
AgreementSerializer = None
try:
    mod = __import__("projects.serializers.agreement", fromlist=["AgreementSerializer"])
    AgreementSerializer = getattr(mod, "AgreementSerializer", None)
except Exception:
    AgreementSerializer = None

MilestoneSerializer = None
InvoiceSerializer = None
AttachmentSerializer = None
for _path, _name in (
    ("projects.serializers.milestone", "MilestoneSerializer"),
    ("projects.serializers.invoice", "InvoiceSerializer"),
    ("projects.serializers.attachment", "AttachmentSerializer"),
    ("projects.serializers", "MilestoneSerializer"),
    ("projects.serializers", "InvoiceSerializer"),
    ("projects.serializers", "AttachmentSerializer"),
):
    try:
        m = __import__(_path, fromlist=[_name])
        obj = getattr(m, _name, None)
        if obj and _name == "MilestoneSerializer":
            MilestoneSerializer = obj
        if obj and _name == "InvoiceSerializer":
            InvoiceSerializer = obj
        if obj and _name == "AttachmentSerializer":
            AttachmentSerializer = obj
    except Exception:
        continue

# Fallback Agreement serializer (always works) with display_total
if Agreement is None or AgreementSerializer is None:
    # recover Agreement model if not resolved yet
    if Agreement is None:
        Agreement = _get_model("projects", "Agreement")

    class MinimalAgreementSerializer(serializers.ModelSerializer):
        display_total = serializers.SerializerMethodField()
        class Meta:
            model = Agreement  # type: ignore
            fields = "__all__"
        def get_display_total(self, obj):
            mdl = Milestone or _get_model("projects", "Milestone")
            if mdl is None:
                return str(getattr(obj, "total_cost", "0"))
            try:
                s = mdl.objects.filter(agreement=obj).aggregate(x=Sum("amount"))["x"] or 0
                return str(s)
            except Exception:
                return str(getattr(obj, "total_cost", "0"))

    AgreementSerializer = MinimalAgreementSerializer  # type: ignore

# Fallbacks for other serializers if needed
if (Milestone is None or MilestoneSerializer is None):
    if Milestone is None:
        Milestone = _get_model("projects", "Milestone")
    class MinimalMilestoneSerializer(serializers.ModelSerializer):
        class Meta:
            model = Milestone  # type: ignore
            fields = "__all__"
    MilestoneSerializer = MinimalMilestoneSerializer  # type: ignore

if (Invoice is None or InvoiceSerializer is None):
    if Invoice is None:
        Invoice = _get_model("projects", "Invoice")
    class MinimalInvoiceSerializer(serializers.ModelSerializer):
        class Meta:
            model = Invoice  # type: ignore
            fields = "__all__"
    InvoiceSerializer = MinimalInvoiceSerializer  # type: ignore

if (Attachment is None or AttachmentSerializer is None):
    if Attachment is None:
        Attachment = _get_model("projects", "Attachment")
    class MinimalAttachmentSerializer(serializers.ModelSerializer):
        class Meta:
            model = Attachment  # type: ignore
            fields = "__all__"
    AttachmentSerializer = MinimalAttachmentSerializer  # type: ignore


# ---- permissions -------------------------------------------------------------
class IsAuthenticatedOrReadOnly(permissions.BasePermission):
    def has_permission(self, request: Request, view: viewsets.ViewSet) -> bool:
        if request.method in ("GET", "HEAD", "OPTIONS"):
            return True
        return bool(request.user and request.user.is_authenticated)


# ---- viewset -----------------------------------------------------------------
class AgreementViewSet(viewsets.ModelViewSet):
    """
    Public GET; auth-required writes. Delete safe for drafts, with checks.
    """
    permission_classes = [IsAuthenticatedOrReadOnly]

    # Build queryset lazily so model import failures never freeze us at []
    @property
    def queryset(self) -> QuerySet | list:
        mdl = Agreement or _get_model("projects", "Agreement")
        if mdl is None:
            return []  # still unavailable: return empty but don't 500
        return mdl.objects.all().order_by("-updated_at", "-id")

    serializer_class = AgreementSerializer  # type: ignore

    def get_queryset(self) -> Iterable[Any]:
        qs = self.queryset
        # always readable (public GET)
        return qs

    # ----- delete with rails ---------------------------------------------------
    def destroy(self, request: Request, *args, **kwargs) -> Response:
        mdl = Agreement or _get_model("projects", "Agreement")
        inv_mdl = Invoice or _get_model("projects", "Invoice")
        amend_mdl = AgreementAmendment or _get_model("projects", "AgreementAmendment")
        if mdl is None:
            return Response({"detail": "Agreement model unavailable."}, status=503)

        try:
            with transaction.atomic():
                ag = self.get_object()

                force = str(request.query_params.get("force", "")).lower() in ("1", "true", "yes")
                if not force and str(getattr(ag, "status", "")).lower() != "draft":
                    return Response({"detail": "Only draft agreements can be deleted. Pass ?force=1 to override (dangerous)."}, status=400)
                if getattr(ag, "escrow_funded", False) and not force:
                    return Response({"detail": "Escrow funded agreements cannot be deleted."}, status=400)
                if inv_mdl is not None:
                    if inv_mdl.objects.filter(agreement=ag, status__iexact="paid").exists() and not force:
                        return Response({"detail": "Agreements with PAID invoices cannot be deleted."}, status=400)
                if amend_mdl is not None:
                    # parent with children?
                    if amend_mdl.objects.filter(parent=ag).exists() and not force:
                        return Response({"detail": "Agreement has amendments (children). Delete/reassign them first, or pass ?force=1."}, status=400)
                    # remove child link if it exists
                    amend_mdl.objects.filter(child=ag).delete()

                ag.delete()
                return Response(status=204)
        except Exception as e:
            return Response({"detail": f"Delete failed: {type(e).__name__}: {e}"}, status=400)

    # ----- subroutes -----------------------------------------------------------
    @action(detail=True, methods=["get"])
    def milestones(self, request: Request, pk: Optional[str] = None) -> Response:
        mdl = Milestone or _get_model("projects", "Milestone")
        ag_mdl = Agreement or _get_model("projects", "Agreement")
        if mdl is None or ag_mdl is None:
            return Response([], status=200)
        try:
            ag = ag_mdl.objects.get(pk=pk)
        except ag_mdl.DoesNotExist:
            return Response({"detail": "Not found."}, status=404)
        try:
            qs = mdl.objects.filter(agreement=ag).order_by("order", "id")
        except Exception:
            qs = mdl.objects.filter(agreement=ag).order_by("id")
        return Response(MilestoneSerializer(qs, many=True).data, status=200)  # type: ignore

    @action(detail=True, methods=["get"])
    def invoices(self, request: Request, pk: Optional[str] = None) -> Response:
        inv_mdl = Invoice or _get_model("projects", "Invoice")
        ag_mdl = Agreement or _get_model("projects", "Agreement")
        if inv_mdl is None or ag_mdl is None:
            return Response([], status=200)
        try:
            ag = ag_mdl.objects.get(pk=pk)
        except ag_mdl.DoesNotExist:
            return Response({"detail": "Not found."}, status=404)
        qs = inv_mdl.objects.filter(agreement=ag).order_by("id")
        return Response(InvoiceSerializer(qs, many=True).data, status=200)  # type: ignore

    @action(detail=True, methods=["get"])
    def attachments(self, request: Request, pk: Optional[str] = None) -> Response:
        att_mdl = Attachment or _get_model("projects", "Attachment")
        ag_mdl = Agreement or _get_model("projects", "Agreement")
        if att_mdl is None or ag_mdl is None:
            return Response([], status=200)
        try:
            ag = ag_mdl.objects.get(pk=pk)
        except ag_mdl.DoesNotExist:
            return Response({"detail": "Not found."}, status=404)
        qs = att_mdl.objects.filter(agreement=ag).order_by("-created_at", "id")
        return Response(AttachmentSerializer(qs, many=True).data, status=200)  # type: ignore

    @action(detail=True, methods=["post"])
    def fund_escrow(self, request: Request, pk: Optional[str] = None) -> Response:
        return Response({"detail": "Not implemented."}, status=501)

    @action(detail=True, methods=["post"])
    def sign(self, request: Request, pk: Optional[str] = None) -> Response:
        return Response({"detail": "Not implemented."}, status=501)


# ---- legacy preview/pdf stubs ------------------------------------------------
def signing_preview(request, pk: str) -> HttpResponse:
    return JsonResponse({"ok": True, "agreement_id": pk, "detail": "Preview generation not implemented."}, status=200)

def agreement_pdf(request, pk: str) -> HttpResponse:
    return HttpResponse("PDF generation not implemented.", status=501, content_type="text/plain")
