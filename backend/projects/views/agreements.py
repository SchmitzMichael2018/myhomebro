from __future__ import annotations

import os
from typing import Any, Iterable, Optional, List, Dict, Tuple

from django.apps import apps
from django.http import HttpResponse, JsonResponse, FileResponse
from django.shortcuts import get_object_or_404
from django.db import transaction
from django.db.models import QuerySet, Sum, Model
from rest_framework import status, viewsets, permissions, serializers
from rest_framework.decorators import action
from rest_framework.request import Request
from rest_framework.response import Response
from rest_framework.parsers import JSONParser, MultiPartParser, FormParser

from projects.models_attachments import AgreementAttachment
from projects.serializers.attachment import AgreementAttachmentSerializer
from projects.services.pdf import generate_full_agreement_pdf


# ------------------------------- helpers ------------------------------------ #
def _get_model(app_label: str, model_name: str):
    try:
        return apps.get_model(app_label, model_name)
    except Exception:
        return None

def _field_names(model: Model) -> set[str]:
    try:
        return {f.name for f in model._meta.get_fields()}
    except Exception:
        return set()

def _safe_order_fields(model: Model, candidates: Iterable[str]) -> List[str]:
    names = _field_names(model)
    return [f for f in candidates if f in names]

def _compute_agreement_dates_for(ag, milestone_model) -> Tuple[Optional[Any], Optional[Any]]:
    """
    start := min(m.start_date or m.scheduled_date)
    end   := max(m.completion_date or m.scheduled_date or m.start_date)
    All lookups are guarded; missing attrs behave like None.
    """
    if milestone_model is None or ag is None:
        return None, None
    names = _field_names(milestone_model)
    only_fields: List[str] = []
    for cand in ("start_date", "completion_date", "scheduled_date"):
        if cand in names:
            only_fields.append(cand)
    qs = milestone_model.objects.filter(agreement=ag).only(*only_fields) if only_fields else milestone_model.objects.filter(agreement=ag)
    earliest, latest = None, None
    for m in qs:
        s = getattr(m, "start_date", None) or getattr(m, "scheduled_date", None)
        e = getattr(m, "completion_date", None) or getattr(m, "scheduled_date", None) or getattr(m, "start_date", None)
        if s and (earliest is None or s < earliest):
            earliest = s
        if e and (latest is None or e > latest):
            latest = e
    return earliest, latest


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

        if hasattr(ag, "project_title_snapshot"):
            cur = getattr(ag, "project_title_snapshot", "") or ""
            if not cur and proj_title:
                ag.project_title_snapshot = proj_title
        else:
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
                update_fields.append("title")
            try:
                if update_fields:
                    ag.save(update_fields=update_fields)
                else:
                    ag.save()
            except Exception:
                pass


# --------------------------------- ViewSet ---------------------------------- #


class AgreementViewSet(AgreementSnapshotMixin, viewsets.ModelViewSet):
    """
    Public GET; auth-required writes.
    """
    permission_classes = [IsAuthenticatedOrReadOnly]
    parser_classes = (JSONParser, MultiPartParser, FormParser)

    @property
    def queryset(self) -> QuerySet | list:
        mdl = Agreement or _get_model("projects", "Agreement")
        if mdl is None:
            return []
        # Always join the related project so the serializer sees fresh Project fields
        base_qs = mdl.objects.select_related("project")
        if "updated_at" in _field_names(mdl):
            return base_qs.order_by("-updated_at", "-id")
        return base_qs.order_by("-id")

    serializer_class = AgreementSerializer  # type: ignore

    def get_queryset(self) -> Iterable[Any]:
        return self.queryset


    # ---------- helper: update related Project from incoming data ----------
    def _update_related_project_from_payload(self, agreement, payload: Dict[str, Any]) -> None:
        proj = getattr(agreement, "project", None)
        if not proj:
            return
        names = _field_names(proj.__class__)
        touched = False

        # title / project_title / name
        for key in ("title", "project_title", "name"):
            if key in payload and "title" in names:
                val = (payload.get(key) or "").strip()
                if val != "" and getattr(proj, "title", None) != val:
                    proj.title = val
                    touched = True
                    break

        # project type (try both styles)
        incoming_type = payload.get("project_type", payload.get("type", None))
        if incoming_type is not None:
            val = (incoming_type or "").strip()
            if "type" in names and getattr(proj, "type", None) != val:
                proj.type = val
                touched = True
            if "project_type" in names and getattr(proj, "project_type", None) != val:
                proj.project_type = val
                touched = True

        # project subtype (both styles)
        incoming_subtype = payload.get("project_subtype", payload.get("subtype", None))
        if incoming_subtype is not None:
            val = (incoming_subtype or "").strip()
            if "subtype" in names and getattr(proj, "subtype", None) != val:
                proj.subtype = val
                touched = True
            if "project_subtype" in names and getattr(proj, "project_subtype", None) != val:
                proj.project_subtype = val
                touched = True

        if touched:
            try:
                proj.save()
            except Exception:
                # don't hard-fail the whole PATCH
                pass

    # ---- tolerant UPDATE/PATCH ----
    @transaction.atomic
    def update(self, request: Request, *args, **kwargs) -> Response:
        partial = kwargs.pop("partial", False)
        instance = self.get_object()
        mdl = Agreement or _get_model("projects", "Agreement")

        # 1) FIRST: map project fields (title/type/subtype) to the related Project
        raw = request.data.copy() if hasattr(request, "data") else {}
        self._update_related_project_from_payload(instance, raw)

        # 2) NOW: clean Agreement payload to known fields/aliases and PATCH Agreement
        def _clean_payload_for_model(model, data: Dict[str, Any]) -> Dict[str, Any]:
            names = _field_names(model)
            allowed_aliases = {"job_description", "use_default_warranty", "custom_warranty_text"}
            # Explicitly EXCLUDE any project fields from the serializer payload
            project_keys_to_strip = {"project_type", "project_subtype", "type", "subtype", "project_title", "title"}
            cleaned: Dict[str, Any] = {}
            for k, v in (data or {}).items():
                if k in project_keys_to_strip:
                    continue  # handled above for Project; do not send to Agreement serializer
                if k in names or k in allowed_aliases:
                    cleaned[k] = v
            return cleaned

        cleaned = _clean_payload_for_model(mdl, raw)
        serializer = self.get_serializer(instance, data=cleaned, partial=partial)
        serializer.is_valid(raise_exception=True)
        ag = serializer.save()
        self.hydrate_snapshots(ag, save=True)
        return Response(self.get_serializer(ag).data, status=200)

    @transaction.atomic
    def partial_update(self, request: Request, *args, **kwargs) -> Response:
        kwargs["partial"] = True
        return self.update(request, *args, **kwargs)

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

        order_fields = _safe_order_fields(
            mdl, ("start_date", "completion_date", "end_date", "scheduled_date", "order", "id")
        )
        qs = mdl.objects.filter(agreement=ag)
        if order_fields:
            qs = qs.order_by(*order_fields)
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

        m_names = _field_names(mdl)
        supports = {name: (name in m_names) for name in (
            "start_date", "completion_date", "scheduled_date", "completed", "is_invoiced", "order", "amount", "title", "description"
        )}

        def _nonempty(v: Any) -> bool:
            return v not in (None, "", "null", "None")

        try:
            with transaction.atomic():
                for item in items:
                    mid = item.get("id")
                    payload: Dict[str, Any] = {"agreement": ag.id}

                    if supports["title"]:
                        payload["title"] = item.get("title") or ""
                    if supports["description"]:
                        payload["description"] = item.get("description") or ""
                    if supports["start_date"]:
                        payload["start_date"] = item.get("start_date")
                    if supports["scheduled_date"] and _nonempty(item.get("scheduled_date")):
                        payload["scheduled_date"] = item.get("scheduled_date")
                    if supports["amount"]:
                        payload["amount"] = item.get("amount") or 0
                    if supports["order"]:
                        payload["order"] = item.get("order")

                    if supports["completion_date"]:
                        if _nonempty(item.get("completion_date")):
                            payload["completion_date"] = item.get("completion_date")
                        elif _nonempty(item.get("end_date")):
                            payload["completion_date"] = item.get("end_date")

                    if _nonempty(item.get("status")):
                        s = str(item.get("status")).strip().lower()
                        if supports["completed"]:
                            payload["completed"] = s in ("complete", "invoiced")
                        if supports["is_invoiced"]:
                            payload["is_invoiced"] = (s == "invoiced")

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

                # Recompute Agreement.start/end safely
                new_start, new_end = _compute_agreement_dates_for(ag, mdl)
                changed = False
                update_fields = []
                if hasattr(ag, "start") and (ag.start or None) != (new_start or None):
                    ag.start = new_start
                    update_fields.append("start")
                    changed = True
                if hasattr(ag, "end") and (ag.end or None) != (new_end or None):
                    ag.end = new_end
                    update_fields.append("end")
                    changed = True
                if changed:
                    try:
                        ag.save(update_fields=update_fields)
                    except Exception:
                        ag.save()

        except serializers.ValidationError as ve:
            return Response({"detail": "Invalid milestone payload.", "errors": ve.detail}, status=400)
        except Exception as e:
            return Response({"detail": f"Could not update milestones: {e.__class__.__name__}"}, status=400)

        order_fields = _safe_order_fields(
            mdl, ("start_date", "completion_date", "end_date", "scheduled_date", "order", "id")
        )
        fresh = mdl.objects.filter(agreement=ag)
        if order_fields:
            fresh = fresh.order_by(*order_fields)
        return Response(MilestoneSerializer(fresh, many=True).data, status=200)  # type: ignore

    # -------------------- Attachments subroutes ------------------ #
    @action(
        detail=True,
        methods=["get", "post"],
        parser_classes=[MultiPartParser, FormParser],
    )
    def attachments(self, request: Request, pk: Optional[str] = None) -> Response:
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
        data["agreement"] = ag.id
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
