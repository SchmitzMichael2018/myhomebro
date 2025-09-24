from __future__ import annotations

import os
from typing import Any, Iterable, Optional, List, Dict

from django.apps import apps
from django.http import HttpResponse, JsonResponse, FileResponse
from django.shortcuts import get_object_or_404
from django.db import transaction
from django.db.models import QuerySet, Sum
from rest_framework import status, viewsets, permissions, serializers
from rest_framework.decorators import action
from rest_framework.request import Request
from rest_framework.response import Response
from rest_framework.parsers import JSONParser, MultiPartParser, FormParser

# Use the explicit attachment serializer to avoid dynamic import surprises
from projects.models_attachments import AgreementAttachment
from projects.serializers.attachment import AgreementAttachmentSerializer
from projects.services.pdf import generate_full_agreement_pdf


# ------------------------------- helpers ------------------------------------ #
def _get_model(app_label: str, model_name: str):
    try:
        return apps.get_model(app_label, model_name)
    except Exception:
        return None


# Models (best-effort import with guarded fallback)
try:
    from projects.models import (
        Agreement as _Agreement,
        Invoice as _Invoice,
        Milestone as _Milestone,
        AgreementAmendment as _AgreementAmendment,
    )
    Agreement, Invoice, Milestone, AgreementAmendment = (
        _Agreement, _Invoice, _Milestone, _AgreementAmendment
    )
except Exception:
    Agreement = _get_model("projects", "Agreement")
    Invoice = _get_model("projects", "Invoice")
    Milestone = _get_model("projects", "Milestone")
    AgreementAmendment = _get_model("projects", "AgreementAmendment")


# Serializers (prefer project's, fall back to minimal)
AgreementSerializer = None
try:
    mod = __import__("projects.serializers.agreement", fromlist=["AgreementSerializer"])
    AgreementSerializer = getattr(mod, "AgreementSerializer", None)
except Exception:
    AgreementSerializer = None

MilestoneSerializer = None
InvoiceSerializer = None
for _path, _name in (
    ("projects.serializers.milestone", "MilestoneSerializer"),
    ("projects.serializers.invoice", "InvoiceSerializer"),
    ("projects.serializers", "MilestoneSerializer"),
    ("projects.serializers", "InvoiceSerializer"),
):
    try:
        m = __import__(_path, fromlist=[_name])
        obj = getattr(m, _name, None)
        if obj and _name == "MilestoneSerializer":
            MilestoneSerializer = obj
        if obj and _name == "InvoiceSerializer":
            InvoiceSerializer = obj
    except Exception:
        continue

if Agreement is None or AgreementSerializer is None:
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


# ------------------------------ permissions --------------------------------- #
class IsAuthenticatedOrReadOnly(permissions.BasePermission):
    def has_permission(self, request: Request, view: viewsets.ViewSet) -> bool:
        if request.method in ("GET", "HEAD", "OPTIONS"):
            return True
        return bool(request.user and request.user.is_authenticated)


# ------------------------- Snapshot hydration mixin ------------------------- #
class AgreementSnapshotMixin:
    """
    Ensures Agreement has *display snapshots* for project/homeowner so the
    serializer can always surface user-friendly strings even if relations
    are absent or their labels are empty.

    Call hydrate_snapshots(agreement, save=True) after create/update.
    """

    SNAPSHOT_TITLE_FIELDS = ("title", "name")

    def _first_nonempty_attr(self, obj, fields):
        if not obj:
            return ""
        for f in fields:
            v = getattr(obj, f, "") or ""
            v = v.strip() if isinstance(v, str) else v
            if v:
                return v
        return ""

    def hydrate_snapshots(self, ag, save=True):
        # ---- Project snapshot ----
        proj = getattr(ag, "project", None)
        proj_title = self._first_nonempty_attr(proj, self.SNAPSHOT_TITLE_FIELDS)
        if not proj_title:
            pid = getattr(proj, "id", None)
            if pid:
                proj_title = f"Project #{pid}"

        # Some schemas have project_title_snapshot; otherwise keep Agreement.title friendly
        if hasattr(ag, "project_title_snapshot"):
            cur = getattr(ag, "project_title_snapshot", "") or ""
            if not cur and proj_title:
                ag.project_title_snapshot = proj_title
        else:
            # If there's no dedicated snapshot, ensure 'title' isn't an "Agreement #"
            if not (getattr(ag, "title", "") or "").strip() and proj_title:
                ag.title = proj_title

        # ---- Homeowner snapshot ----
        homeowner = getattr(ag, "homeowner", None) or getattr(proj, "homeowner", None)
        ho_name = self._first_nonempty_attr(homeowner, ("full_name", "name"))
        ho_email = self._first_nonempty_attr(homeowner, ("email",))

        if hasattr(ag, "homeowner_name_snapshot"):
            if not (getattr(ag, "homeowner_name_snapshot", "") or "") and ho_name:
                ag.homeowner_name_snapshot = ho_name
        if hasattr(ag, "homeowner_email_snapshot"):
            if not (getattr(ag, "homeowner_email_snapshot", "") or "") and ho_email:
                ag.homeowner_email_snapshot = ho_email

        if save:
            update_fields = []
            if hasattr(ag, "project_title_snapshot"):
                update_fields.append("project_title_snapshot")
            if hasattr(ag, "homeowner_name_snapshot"):
                update_fields.append("homeowner_name_snapshot")
            if hasattr(ag, "homeowner_email_snapshot"):
                update_fields.append("homeowner_email_snapshot")
            if not hasattr(ag, "project_title_snapshot") and hasattr(ag, "title"):
                # we might have set title as a fallback
                update_fields.append("title")
            try:
                if update_fields:
                    ag.save(update_fields=update_fields)
                else:
                    ag.save()
            except Exception:
                # don't let hydration failure break the request
                pass


# --------------------------------- ViewSet ---------------------------------- #
class AgreementViewSet(AgreementSnapshotMixin, viewsets.ModelViewSet):
    """
    Public GET; auth-required writes.

    Design:
      • Standard CRUD accepts JSON **and** multipart (tolerant).
      • /agreements/:id/attachments/ is multipart-only and returns the refreshed list.
      • /agreements/:id/milestones_bulk_update/ upserts milestones in one call.
      • Snapshots are hydrated on create/update so list/detail always have
        displayable Project/Homeowner text.
    """
    permission_classes = [IsAuthenticatedOrReadOnly]
    parser_classes = (JSONParser, MultiPartParser, FormParser)

    @property
    def queryset(self) -> QuerySet | list:
        mdl = Agreement or _get_model("projects", "Agreement")
        if mdl is None:
            return []
        # Prefer newest edits first
        order_fields = []
        for f in ("updated_at", "modified_at", "id"):
            if hasattr(mdl, f):
                order_fields.append(f if f == "id" else f"-{f}")
        if not order_fields:
            order_fields = ["-id"]
        return mdl.objects.all().order_by("-id")

    serializer_class = AgreementSerializer  # type: ignore

    def get_queryset(self) -> Iterable[Any]:
        return self.queryset

    # ---- ensure snapshots on create/update ----
    @transaction.atomic
    def perform_create(self, serializer):
        ag = serializer.save()
        self.hydrate_snapshots(ag, save=True)

    @transaction.atomic
    def perform_update(self, serializer):
        ag = serializer.save()
        self.hydrate_snapshots(ag, save=True)

    # Optional admin/test hook to re-hydrate a single record
    @action(detail=True, methods=["post"])
    def hydrate(self, request: Request, pk: Optional[str] = None) -> Response:
        mdl = Agreement or _get_model("projects", "Agreement")
        if mdl is None:
            return Response({"detail": "Agreement model unavailable."}, status=503)
        try:
            ag = mdl.objects.get(pk=pk)
        except mdl.DoesNotExist:
            return Response({"detail": "Not found."}, status=404)
        self.hydrate_snapshots(ag, save=True)
        return Response({"status": "ok"})

    # --------------------- Milestones (list) --------------------- #
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

        order_candidates = ("start_date", "completion_date", "end_date", "scheduled_date", "order", "id")
        order_fields = [f for f in order_candidates if hasattr(mdl, f)]
        qs = mdl.objects.filter(agreement=ag).order_by(*order_fields)
        return Response(MilestoneSerializer(qs, many=True).data, status=200)  # type: ignore

    # ---------------- Milestones bulk upsert --------------------- #
    @action(detail=True, methods=["post"])
    def milestones_bulk_update(self, request: Request, pk: Optional[str] = None) -> Response:
        mdl = Milestone or _get_model("projects", "Milestone")
        ag_mdl = Agreement or _get_model("projects", "Agreement")
        if mdl is None or ag_mdl is None:
            return Response({"detail": "Models unavailable."}, status=503)
        try:
            ag = ag_mdl.objects.get(pk=pk)
        except ag_mdl.DoesNotExist:
            return Response({"detail": "Not found."}, status=404)

        items: List[Dict[str, Any]] = request.data.get("items", []) or []
        prune_missing = bool(request.data.get("prune_missing", False))
        seen_ids: List[int] = []

        def _nonempty(v: Any) -> bool:
            return v not in (None, "", "null", "None")

        with transaction.atomic():
            for item in items:
                mid = item.get("id")
                payload: Dict[str, Any] = {
                    "agreement": ag.id,
                    "title": item.get("title") or "",
                    "description": item.get("description") or "",
                    "start_date": item.get("start_date"),
                    "scheduled_date": item.get("scheduled_date"),
                    "amount": item.get("amount") or 0,
                    "order": item.get("order"),
                }

                # Accept either completion_date or end_date from the client
                if _nonempty(item.get("completion_date")):
                    payload["completion_date"] = item.get("completion_date")
                elif _nonempty(item.get("end_date")):
                    payload["completion_date"] = item.get("end_date")

                # Map a friendly "status" (complete/invoiced/incomplete) to booleans, if present
                if _nonempty(item.get("status")):
                    s = str(item.get("status")).strip().lower()
                    if s == "invoiced":
                        payload["completed"] = True
                        payload["is_invoiced"] = True
                    elif s == "complete":
                        payload["completed"] = True
                        payload["is_invoiced"] = False
                    else:
                        payload["completed"] = False
                        payload["is_invoiced"] = False

                if mid:
                    try:
                        obj = mdl.objects.get(id=mid, agreement=ag)
                    except mdl.DoesNotExist:
                        return Response({"detail": f"Milestone {mid} not found."}, status=404)
                    ser = MilestoneSerializer(obj, data=payload, partial=True)  # type: ignore
                else:
                    ser = MilestoneSerializer(data=payload)  # type: ignore
                ser.is_valid(raise_exception=True)
                obj = ser.save()
                seen_ids.append(obj.id)

            if prune_missing:
                mdl.objects.filter(agreement=ag).exclude(id__in=seen_ids).delete()

        order_candidates = ("start_date", "completion_date", "end_date", "scheduled_date", "order", "id")
        order_fields = [f for f in order_candidates if hasattr(mdl, f)]
        fresh = mdl.objects.filter(agreement=ag).order_by(*order_fields)
        return Response(MilestoneSerializer(fresh, many=True).data, status=200)  # type: ignore

    # -------------------- Attachments subroutes ------------------ #
    @action(
        detail=True,
        methods=["get", "post"],
        parser_classes=[MultiPartParser, FormParser],  # multipart here
    )
    def attachments(self, request: Request, pk: Optional[str] = None) -> Response:
        """
        GET  /agreements/:id/attachments/ -> list
        POST /agreements/:id/attachments/ -> upload (multipart)
        Returns the REFRESHED list on POST so the UI can render immediately.
        """
        ag_mdl = Agreement or _get_model("projects", "Agreement")
        if ag_mdl is None:
            return Response([], status=200)
        try:
            ag = ag_mdl.objects.select_related("project__contractor__user").get(pk=pk)
        except ag_mdl.DoesNotExist:
            return Response({"detail": "Not found."}, status=404)

        if request.method.lower() == "get":
            qs = AgreementAttachment.objects.filter(agreement=ag).order_by("-uploaded_at", "-id")
            data = AgreementAttachmentSerializer(qs, many=True, context={"request": request}).data
            return Response(data, status=200)

        # POST requires auth & ownership
        if not request.user or not request.user.is_authenticated:
            return Response({"detail": "Authentication required."}, status=401)
        try:
            owner_ok = (
                request.user.is_staff
                or request.user.is_superuser
                or ag.project.contractor.user_id == request.user.id
            )
        except Exception:
            owner_ok = False
        if not owner_ok:
            return Response({"detail": "Not your agreement."}, status=403)

        data = request.data.copy()
        data["agreement"] = ag.id  # force bind
        ser = AgreementAttachmentSerializer(data=data, context={"request": request})
        if ser.is_valid():
            ser.save(uploaded_by=request.user)
            qs = AgreementAttachment.objects.filter(agreement=ag).order_by("-uploaded_at", "-id")
            data = AgreementAttachmentSerializer(qs, many=True, context={"request": request}).data
            return Response(data, status=201)
        return Response(ser.errors, status=400)

    @attachments.mapping.delete
    def attachments_not_allowed(self, request: Request, pk: Optional[str] = None) -> Response:
        return Response({"detail": "Method 'DELETE' not allowed."}, status=405)

    @action(detail=True, methods=["delete"], url_path=r"attachments/(?P<att_id>\d+)")
    def delete_attachment(self, request: Request, pk: Optional[str] = None, att_id: Optional[str] = None) -> Response:
        """
        DELETE /agreements/:id/attachments/:att_id/
        """
        ag_mdl = Agreement or _get_model("projects", "Agreement")
        if ag_mdl is None:
            return Response({"detail": "Agreement model unavailable."}, status=503)

        try:
            ag = ag_mdl.objects.select_related("project__contractor__user").get(pk=pk)
        except ag_mdl.DoesNotExist:
            return Response({"detail": "Agreement not found."}, status=404)

        try:
            att = AgreementAttachment.objects.get(pk=int(att_id), agreement=ag)
        except AgreementAttachment.DoesNotExist:
            return Response({"detail": "Attachment not found."}, status=404)

        if not request.user or not request.user.is_authenticated:
            return Response({"detail": "Authentication required."}, status=401)
        if not (
            getattr(request.user, "is_staff", False)
            or getattr(request.user, "is_superuser", False)
            or ag.project.contractor.user_id == request.user.id
        ):
            return Response({"detail": "Not your agreement."}, status=403)

        f = getattr(att, "file", None)
        try:
            if f and hasattr(f, "delete"):
                f.delete(save=False)
        except Exception:
            pass
        att.delete()
        return Response(status=204)


# ---------------------------- PDF endpoints --------------------------------- #
def signing_preview(request, pk: str) -> HttpResponse:
    return JsonResponse({"ok": True, "agreement_id": pk, "detail": "Preview generation not implemented."}, status=200)


def agreement_pdf(request, agreement_id: int) -> HttpResponse:
    """
    Authenticated contractor/staff download of the merged Agreement PDF.
    - If pdf_file doesn't exist, generate + merge attachments, then return.
    """
    Agreement = apps.get_model("projects", "Agreement")
    ag = get_object_or_404(Agreement, pk=agreement_id)

    user = getattr(request, "user", None)
    if not user or not user.is_authenticated:
        return JsonResponse({"detail": "Authentication required."}, status=401)
    if not (
        getattr(user, "is_staff", False)
        or getattr(user, "is_superuser", False)
        or ag.project.contractor.user_id == user.id
    ):
        return JsonResponse({"detail": "Forbidden"}, status=403)

    # Ensure PDF exists (with attachment merge)
    if not getattr(ag, "pdf_file", None) or not getattr(ag.pdf_file, "name", ""):
        try:
            generate_full_agreement_pdf(ag, merge_attachments=True)
            ag.refresh_from_db()
        except Exception as e:
            return JsonResponse({"detail": f"Could not generate Agreement PDF: {e}"}, status=500)

    file_path = ag.pdf_file.path
    if not os.path.exists(file_path):
        try:
            generate_full_agreement_pdf(ag, merge_attachments=True)
            ag.refresh_from_db()
        except Exception as e:
            return JsonResponse({"detail": f"Could not generate Agreement PDF: {e}"}, status=500)

    return FileResponse(open(ag.pdf_file.path, "rb"), as_attachment=True, filename=os.path.basename(ag.pdf_file.name))
