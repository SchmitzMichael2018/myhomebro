from __future__ import annotations

import base64
import io
from datetime import timedelta
from typing import Set

from django.conf import settings
from django.core.files.base import ContentFile
from django.core.mail import send_mail
from django.http import FileResponse, Http404
from django.db import transaction
from django.shortcuts import get_object_or_404
from django.utils.timezone import now

from rest_framework import viewsets, status
from rest_framework.decorators import action, api_view, permission_classes
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.exceptions import ValidationError, PermissionDenied

from projects.models import Agreement, Milestone
from projects.serializers.agreement import AgreementSerializer

# Use the full PDF service (renders complete agreement; no ToS/Privacy embedded)
try:
    from projects.services.pdf import (
        build_agreement_pdf_bytes,          # preview (bytes only)
        generate_full_agreement_pdf,        # finalize (save/version)
    )
except Exception as _err:
    # If the PDF service isn't available, we surface a clear error on preview/finalize
    build_agreement_pdf_bytes = None   # type: ignore
    generate_full_agreement_pdf = None # type: ignore


# ---------------------------------------------------------------------
# Business policy constants
# ---------------------------------------------------------------------

# Contractor may sign/unsign and edit while draft.
# Agreement becomes locked ONLY after both parties have signed.
# Locked records cannot be edited or deleted until retention window passes.
RETENTION_YEARS = 3


# ---------------------------------------------------------------------
# Non-destructive flags that remain editable even when locked
# ---------------------------------------------------------------------
ALWAYS_OK_FIELDS: Set[str] = {
    "reviewed",
    "reviewed_at",
    "reviewed_by",
    "pdf_archived",
    "is_archived",
}

# “Content” fields that should require editable state (draft-ish)
DRAFT_ONLY_FIELDS: Set[str] = {
    "project_type",
    "project_subtype",
    "standardized_category",
    "description",
    "warranty_type",
    "warranty_text_snapshot",
    "total_cost",
    "total_time_estimate",
    "milestone_count",
    "start",
    "end",
    "terms_text",
    "privacy_text",
    "contractor",
    "homeowner",
}


# ---------------------------------------------------------------------
# Utility functions
# ---------------------------------------------------------------------

def _changed_fields(instance: Agreement, data: dict) -> Set[str]:
    changed: Set[str] = set()
    for k, v in data.items():
        if not hasattr(instance, k):
            continue
        try:
            cur = getattr(instance, k)
            if (cur is None and v not in (None, "")) or (cur is not None and str(cur) != str(v)):
                changed.add(k)
        except Exception:
            changed.add(k)
    return changed


def _is_fully_signed(ag: Agreement) -> bool:
    """
    Final lock criterion: ONLY when both parties have signed.
    (Escrow funding alone does NOT lock per your policy.)
    """
    return bool(getattr(ag, "signed_by_contractor", False) and getattr(ag, "signed_by_homeowner", False))


def _fully_signed_at(ag: Agreement):
    """
    Returns the later of contractor/homeowner signed timestamps (if both exist),
    else whichever exists, else None.
    """
    ch = getattr(ag, "contractor_signed_at", None)
    hh = getattr(ag, "homeowner_signed_at", None)
    if ch and hh:
        return ch if ch >= hh else hh
    return ch or hh


class AgreementViewSet(viewsets.ModelViewSet):
    """
    Agreement endpoints & wizard actions, aligned to policy:

      - Client can't set `status` directly (serializer already enforces).
      - Editable while NOT fully signed (contractor may sign/unsign and still edit).
      - Once fully signed, editing of content fields is blocked (allow-list still OK).
      - Delete rules:
          • Contractor (or staff) may delete while NOT fully signed (i.e., draft).
          • When fully signed, deletion is blocked for RETENTION_YEARS years.
      - Actions:
          GET  /agreements/<id>/preview_pdf/          (JSON envelope)
          GET  /agreements/<id>/preview_pdf/?stream=1 (inline full PDF stream)
          POST /agreements/<id>/finalize_pdf/
          POST /agreements/<id>/send_for_signature/
          POST /agreements/<id>/contractor_sign/
          POST /agreements/<id>/contractor_unsign/
    """
    permission_classes = [IsAuthenticated]
    serializer_class = AgreementSerializer
    queryset = Agreement.objects.select_related(
        "project", "contractor", "homeowner"
    ).all().order_by("-updated_at")

    # ---------------- Editability enforcement ----------------

    def _enforce_editability(self, instance: Agreement, data: dict):
        """
        Allow edits while NOT fully signed.
        When fully signed, allow only benign admin flags (ALWAYS_OK_FIELDS).
        Staff/superusers bypass.
        """
        if self.request.user.is_staff or self.request.user.is_superuser:
            return

        if not _is_fully_signed(instance):
            return  # editable

        changed = _changed_fields(instance, data)
        illegal = {f for f in changed if f not in ALWAYS_OK_FIELDS and f in (DRAFT_ONLY_FIELDS | changed)}
        if illegal:
            raise ValidationError({
                "detail": "Agreement is fully signed and locked. Create an amendment to change details.",
                "blocked_fields": sorted(illegal),
                "signed_by_contractor": instance.signed_by_contractor,
                "signed_by_homeowner": instance.signed_by_homeowner,
            })

    def _prepare_payload(self, request):
        data = request.data.copy() if hasattr(request.data, "copy") else dict(request.data)
        data.pop("status", None)  # never trust client status

        # normalize blanks to None on a few keys (serializer also sanitizes)
        for k in ("description", "terms_text", "privacy_text", "project_subtype", "standardized_category"):
            if k in data and data[k] == "":
                data[k] = None
        for k in ("start", "end", "total_time_estimate"):
            if k in data and data[k] == "":
                data[k] = None
        if "total_cost" in data and data["total_cost"] == "":
            data["total_cost"] = None
        if "milestone_count" in data and data["milestone_count"] == "":
            data["milestone_count"] = None
        return data

    # ---------------- REST overrides ----------------

    def update(self, request, *args, **kwargs):
        instance = self.get_object()
        data = self._prepare_payload(request)
        self._enforce_editability(instance, data)
        serializer = self.get_serializer(instance, data=data, partial=False)
        serializer.is_valid(raise_exception=True)
        with transaction.atomic():
            self.perform_update(serializer)
        return Response(serializer.data)

    def partial_update(self, request, *args, **kwargs):
        instance = self.get_object()
        data = self._prepare_payload(request)
        self._enforce_editability(instance, data)
        serializer = self.get_serializer(instance, data=data, partial=True)
        serializer.is_valid(raise_exception=True)
        with transaction.atomic():
            self.perform_update(serializer)
        return Response(serializer.data)

    def perform_update(self, serializer):
        serializer.save()

    # ---------------- Delete with “draft OK” + retention when fully signed ----------------

    def destroy(self, request, *args, **kwargs):
        """
        Contractor (or staff) may delete when NOT fully signed.
        When fully signed, deletion is blocked for RETENTION_YEARS after full signature.
        """
        instance: Agreement = self.get_object()

        # Permission: must be staff or assigned contractor user
        contractor_user = getattr(getattr(instance, "contractor", None), "user", None)
        if not (request.user.is_staff or request.user.is_superuser or request.user == contractor_user):
            raise PermissionDenied("Only the assigned contractor (or staff) can delete this agreement.")

        if _is_fully_signed(instance):
            signed_at = _fully_signed_at(instance)
            if signed_at is None:
                raise PermissionDenied(
                    f"Deletion blocked: fully signed agreement must be retained for {RETENTION_YEARS} years."
                )
            if (now() - signed_at) < timedelta(days=RETENTION_YEARS * 365):
                raise PermissionDenied(
                    f"Deletion blocked by retention policy ({RETENTION_YEARS} years after full signature)."
                )
        # If not fully signed, allow deletion (draft / in-progress)
        return super().destroy(request, *args, **kwargs)

    # ---------------- PREVIEW (GET): JSON envelope + inline FULL PDF stream ----------------

    @action(detail=True, methods=["get"], url_path="preview_pdf")
    def preview_pdf(self, request, pk=None):
        """
        GET  /agreements/<id>/preview_pdf/          -> { "url": "<absolute_url_with_stream=1>" }
        GET  /agreements/<id>/preview_pdf/?stream=1 -> inline full PDF preview (no DB write)
        """
        stream = request.query_params.get("stream")

        if not stream:
            # One-liner your front-end expects: a URL we can open in a new tab
            url = request.build_absolute_uri("?stream=1")
            return Response({"url": url}, status=status.HTTP_200_OK)

        # Stream mode
        ag: Agreement = self.get_object()

        if not build_agreement_pdf_bytes:
            return Response(
                {"detail": "PDF preview is not available (service missing)."},
                status=status.HTTP_503_SERVICE_UNAVAILABLE,
            )

        try:
            pdf_bytes = build_agreement_pdf_bytes(ag, is_preview=True)
        except Exception as e:
            return Response({"detail": f"Could not generate preview: {e}"}, status=status.HTTP_500_INTERNAL_SERVER_ERROR)

        buf = io.BytesIO(pdf_bytes)
        filename = f"agreement_{ag.pk}_preview.pdf"
        resp = FileResponse(buf, content_type="application/pdf")
        resp["Content-Disposition"] = f'inline; filename="{filename}"'
        return resp

    # ---------------- Wizard Step 4: (Re)build consolidated PDF ----------------

    @action(detail=True, methods=["post"])
    def finalize_pdf(self, request, pk=None):
        ag = self.get_object()

        if not generate_full_agreement_pdf:
            return Response(
                {"detail": "PDF finalization is not available (service missing)."},
                status=status.HTTP_503_SERVICE_UNAVAILABLE,
            )

        try:
            generate_full_agreement_pdf(ag)  # expected to update ag.pdf_file internally (versioned)
        except Exception as e:
            return Response({"detail": f"PDF generation failed: {e}"}, status=status.HTTP_500_INTERNAL_SERVER_ERROR)

        ag.refresh_from_db()
        pdf_url = getattr(getattr(ag, "pdf_file", None), "url", None)
        return Response({"ok": True, "pdf_url": pdf_url}, status=status.HTTP_200_OK)

    # ---------------- Wizard Step 4: email sign link to homeowner ----------------

    @action(detail=True, methods=["post"])
    def send_for_signature(self, request, pk=None):
        ag = self.get_object()
        homeowner = getattr(ag, "homeowner", None)
        homeowner_email = getattr(homeowner, "email", None)
        homeowner_name = getattr(homeowner, "full_name", "") or "Homeowner"
        if not homeowner_email:
            return Response({"detail": "Agreement has no homeowner email."}, status=status.HTTP_400_BAD_REQUEST)

        domain = (
            getattr(settings, "PUBLIC_APP_ORIGIN", None)
            or getattr(settings, "SITE_ORIGIN", None)
            or "https://www.myhomebro.com"
        )
        token = str(ag.homeowner_access_token)
        sign_url = f"{domain}/agreements/access/{token}/sign"
        pdf_url = f"{domain}/agreements/access/{token}/pdf"

        subject = f"Agreement for {getattr(ag.project, 'title', 'your project')} — Signature Requested"
        body = (
            f"Hello {homeowner_name},\n\n"
            "Please review and sign your agreement using the secure link below:\n\n"
            f"Sign: {sign_url}\n"
            f"PDF:  {pdf_url}\n\n"
            "If you did not request this, please ignore this message.\n\n"
            "— MyHomeBro"
        )
        try:
            from_email = getattr(settings, "DEFAULT_FROM_EMAIL", "no-reply@myhomebro.com")
            send_mail(subject, body, from_email, [homeowner_email], fail_silently=True)
        except Exception:
            pass

        return Response({"ok": True, "sign_url": sign_url, "pdf_url": pdf_url}, status=status.HTTP_200_OK)

    # ---------------- Contractor e-signature (sign/unsign) ----------------

    @action(detail=True, methods=["post"])
    def contractor_sign(self, request, pk=None):
        """
        Contractor signs. Still editable until BOTH parties sign.

        Signature image is OPTIONAL. We record the typed name and accept
        either a file upload (request.FILES["signature"]) or a data URL,
        but an image is not required to proceed.
        """
        ag: Agreement = self.get_object()

        contractor_user = getattr(getattr(ag, "contractor", None), "user", None)
        if not (request.user.is_staff or request.user.is_superuser or request.user == contractor_user):
            raise PermissionDenied("Only the assigned contractor (or staff) can sign as contractor.")

        name = (request.data.get("typed_name") or request.data.get("name") or "").strip()
        if not name:
            return Response({"detail": "Signature name is required."}, status=status.HTTP_400_BAD_REQUEST)

        signature_file = request.FILES.get("signature")
        data_url = request.data.get("signature_data_url")

        try:
            if signature_file:
                ag.contractor_signature.save(signature_file.name, signature_file, save=False)
            elif data_url:
                header, b64 = data_url.split(",", 1)
                if ";base64" not in header:
                    return Response({"detail": "Invalid signature data URL."}, status=status.HTTP_400_BAD_REQUEST)
                ext = "png"
                if "image/jpeg" in header or "image/jpg" in header:
                    ext = "jpg"
                content = ContentFile(base64.b64decode(b64), name=f"contractor_signature.{ext}")
                ag.contractor_signature.save(content.name, content, save=False)
            # else: no image provided — that's OK now (typed-only signature)
        except Exception:
            return Response({"detail": "Could not process signature image."}, status=status.HTTP_400_BAD_REQUEST)

        ag.contractor_signature_name = name
        ag.signed_by_contractor = True
        ag.contractor_signed_at = now()
        ip = request.META.get("HTTP_X_FORWARDED_FOR", "").split(",")[0].strip() or request.META.get("REMOTE_ADDR")
        ag.contractor_signed_ip = ip or None

        # Keep status 'draft' until BOTH parties have signed
        ag.status = "draft"
        ag.save(update_fields=[
            "contractor_signature", "contractor_signature_name",
            "signed_by_contractor", "contractor_signed_at", "contractor_signed_ip",
            "status", "updated_at"
        ])

        ser = self.get_serializer(ag)
        return Response({"ok": True, "agreement": ser.data}, status=status.HTTP_200_OK)

    @action(detail=True, methods=["post"])
    def contractor_unsign(self, request, pk=None):
        """
        Contractor can withdraw signature while NOT fully signed.
        """
        ag: Agreement = self.get_object()

        contractor_user = getattr(getattr(ag, "contractor", None), "user", None)
        if not (request.user.is_staff or request.user.is_superuser or request.user == contractor_user):
            raise PermissionDenied("Only the assigned contractor (or staff) can unsign as contractor.")

        if _is_fully_signed(ag):
            raise ValidationError("Cannot unsign after both parties have signed.")

        ag.signed_by_contractor = False
        ag.contractor_signed_at = None
        ag.contractor_signature_name = None
        # Optional: also clear signature file if you prefer:
        # if getattr(ag, "contractor_signature", None):
        #     ag.contractor_signature.delete(save=False)

        ag.status = "draft"
        ag.save(update_fields=[
            "signed_by_contractor", "contractor_signed_at", "contractor_signature_name",
            "status", "updated_at"
        ])

        ser = self.get_serializer(ag)
        return Response({"ok": True, "agreement": ser.data}, status=status.HTTP_200_OK)


# ---------- Function views expected by projects/urls.py ----------

@api_view(["GET"])
@permission_classes([IsAuthenticated])
def agreement_milestones(request, pk: int):
    """
    Returns the milestones for the given agreement ID.
    """
    ag = get_object_or_404(Agreement, pk=pk)
    qs = Milestone.objects.filter(agreement=ag).order_by("order")
    data = [
        {
            "id": m.id,
            "order": m.order,
            "title": m.title,
            "description": m.description,
            "amount": str(m.amount),
            "start_date": m.start_date,
            "completion_date": m.completion_date,
            "duration": m.duration.total_seconds() if m.duration else None,
            "is_invoiced": m.is_invoiced,
            "completed": m.completed,
        }
        for m in qs
    ]
    return Response(data, status=status.HTTP_200_OK)


@api_view(["GET"])
@permission_classes([IsAuthenticated])
def signing_preview(request, pk: int):
    """
    Lightweight signing preview endpoint kept for compatibility with your routes.
    Returns current agreement data; front-end can render a preview screen.
    """
    ag = get_object_or_404(Agreement, pk=pk)
    ser = AgreementSerializer(ag, context={"request": request})
    return Response({"ok": True, "agreement": ser.data, "generated_at": now().isoformat()})


@api_view(["GET"])
@permission_classes([IsAuthenticated])
def agreement_pdf(request, agreement_id: int):
    """
    Serve the current consolidated PDF for an agreement.
    If missing and a generator exists, attempt to (re)generate then serve.
    """
    ag = get_object_or_404(Agreement, pk=agreement_id)

    # Generate on the fly if possible and no file exists yet
    if (not getattr(ag, "pdf_file", None)) or (not getattr(ag.pdf_file, "name", "")):
        if generate_full_agreement_pdf:
            try:
                generate_full_agreement_pdf(ag)  # expected to attach to ag.pdf_file
                ag.refresh_from_db()
            except Exception:
                pass

    if getattr(ag, "pdf_file", None) and getattr(ag.pdf_file, "name", ""):
        try:
            return FileResponse(ag.pdf_file.open("rb"), content_type="application/pdf")
        except Exception:
            raise Http404("PDF not available")

    raise Http404("PDF not available")
