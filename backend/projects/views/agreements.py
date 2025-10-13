from __future__ import annotations

import base64
import io
import os
from datetime import timedelta
from typing import Set, Optional

from django.conf import settings
from django.core import signing
from django.core.files.base import ContentFile
from django.core.mail import send_mail
from django.http import FileResponse, Http404
from django.db import transaction
from django.shortcuts import get_object_or_404
from django.utils.timezone import now

from rest_framework import viewsets, status
from rest_framework.decorators import action, api_view, permission_classes
from rest_framework.permissions import IsAuthenticated, AllowAny
from rest_framework.response import Response
from rest_framework.exceptions import ValidationError, PermissionDenied

from projects.models import Agreement, Milestone
from projects.serializers.agreement import AgreementSerializer

# ---------------------------------------------------------------------------------------
# Resilient PDF loader:
#  - Prefer projects.services.pdf (build_agreement_pdf_bytes + generate_full_agreement_pdf)
#  - Fallback to projects.utils.pdf.generate_full_agreement_pdf(...) with adapters:
#       build_agreement_pdf_bytes(agreement, is_preview=True) -> bytes
#       generate_full_agreement_pdf(agreement) -> saves FileField + bumps pdf_version
# ---------------------------------------------------------------------------------------
build_agreement_pdf_bytes = None  # type: ignore
generate_full_agreement_pdf = None  # type: ignore

def _abs_media_path(rel_path: str) -> Optional[str]:
    if not rel_path:
        return None
    mr = getattr(settings, "MEDIA_ROOT", "") or ""
    return os.path.join(mr, rel_path)

# Try preferred service first
try:
    from projects.services.pdf import (  # type: ignore
        build_agreement_pdf_bytes as _svc_build_bytes,
        generate_full_agreement_pdf as _svc_generate_full,
    )
    build_agreement_pdf_bytes = _svc_build_bytes  # type: ignore
    generate_full_agreement_pdf = _svc_generate_full  # type: ignore
except Exception:
    # Fallback: adapt the utils generator
    try:
        from projects.utils.pdf import (  # type: ignore
            generate_full_agreement_pdf as _utils_generate_full,
        )
        from django.core.files.base import ContentFile as _CF  # local alias

        def _fallback_build_bytes(ag: Agreement, is_preview: bool = True) -> bytes:
            """
            Call the utils generator in 'preview' mode, which returns a relative path,
            then read the bytes and return them.
            """
            rel_path = _utils_generate_full(ag.id, preview=True)  # returns RELATIVE media path
            abs_path = _abs_media_path(rel_path)
            if not abs_path or not os.path.exists(abs_path):
                # Defensive fallback: tiny valid PDF header if something goes wrong
                return b"%PDF-1.4\n% Empty preview\n"
            with open(abs_path, "rb") as fh:
                return fh.read()

        def _fallback_generate_full(ag: Agreement):
            """
            Use utils generator in final mode, then attach to FileField and bump version.
            """
            version = int(getattr(ag, "pdf_version", 0) or 0) + 1
            rel_path = _utils_generate_full(ag.id, preview=False)  # RELATIVE
            abs_path = _abs_media_path(rel_path)
            if not abs_path or not os.path.exists(abs_path):
                raise RuntimeError("PDF generator returned a path that does not exist.")
            with open(abs_path, "rb") as fh:
                content = _CF(fh.read(), name=os.path.basename(abs_path))
                ag.pdf_file.save(content.name, content, save=True)
            if hasattr(ag, "pdf_version"):
                ag.pdf_version = version
                ag.save(update_fields=["pdf_version", "pdf_file"])

        build_agreement_pdf_bytes = _fallback_build_bytes  # type: ignore
        generate_full_agreement_pdf = _fallback_generate_full  # type: ignore
    except Exception:
        # Leave both as None -> guarded by 503 checks.
        pass


# ---------------------------------------------------------------------
# Business policy constants
# ---------------------------------------------------------------------

RETENTION_YEARS = 3

ALWAYS_OK_FIELDS: Set[str] = {
    "reviewed",
    "reviewed_at",
    "reviewed_by",
    "pdf_archived",
    "is_archived",
}

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

# Signed preview link config
_PREVIEW_SALT = "agreements.preview.link.v1"
_PREVIEW_MAX_AGE = 10 * 60  # 10 minutes


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
    return bool(getattr(ag, "signed_by_contractor", False) and getattr(ag, "signed_by_homeowner", False))


def _fully_signed_at(ag: Agreement):
    ch = getattr(ag, "contractor_signed_at", None)
    hh = getattr(ag, "homeowner_signed_at", None)
    if ch and hh:
        return ch if ch >= hh else hh
    return ch or hh


class AgreementViewSet(viewsets.ModelViewSet):
    """
    Agreement endpoints & wizard actions.

    Adds:
      POST /agreements/<id>/preview_link/     -> {"url": "<signed public URL>"}
      GET  /agreements/preview_signed/?t=...  -> inline PDF (public, HMAC-validated)
      POST /agreements/<id>/mark_previewed/   -> 204 (no-op hook for UI)
    """
    permission_classes = [IsAuthenticated]
    serializer_class = AgreementSerializer
    queryset = Agreement.objects.select_related(
        "project", "contractor", "homeowner"
    ).all().order_by("-updated_at")

    # ---------------- Editability enforcement ----------------

    def _enforce_editability(self, instance: Agreement, data: dict):
        if self.request.user.is_staff or self.request.user.is_superuser:
            return
        if not _is_fully_signed(instance):
            return
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
        data.pop("status", None)
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
        instance: Agreement = self.get_object()
        contractor_user = getattr(getattr(instance, "contractor", None), "user", None)
        if not (request.user.is_staff or request.user.is_superuser or request.user == contractor_user):
            raise PermissionDenied("Only the assigned contractor (or staff) can delete this agreement.")
        if _is_fully_signed(instance):
            signed_at = _fully_signed_at(instance)
            if not signed_at or (now() - signed_at).days < (RETENTION_YEARS * 365):
                raise PermissionDenied(f"Deletion blocked by retention policy ({RETENTION_YEARS} years).")
        return super().destroy(request, *args, **kwargs)

    # ---------------- AUTH preview (XHR Blob) — legacy callers ----------------

    @action(detail=True, methods=["get"], url_path="preview_pdf")
    def preview_pdf(self, request, pk=None):
        """
        GET  /agreements/<id>/preview_pdf/          -> { "url": "<absolute_url_with_stream=1>" }
        GET  /agreements/<id>/preview_pdf/?stream=1 -> inline full PDF (AUTH required)
        Kept for legacy XHR callers that include Authorization and open a Blob.
        """
        stream = request.query_params.get("stream")
        if not stream:
            url = request.build_absolute_uri("?stream=1")
            return Response({"url": url}, status=status.HTTP_200_OK)

        if not build_agreement_pdf_bytes:
            return Response({"detail": "PDF preview not available."}, status=status.HTTP_503_SERVICE_UNAVAILABLE)

        ag: Agreement = self.get_object()
        try:
            pdf_bytes = build_agreement_pdf_bytes(ag, is_preview=True)
        except Exception as e:
            return Response({"detail": f"Could not generate preview: {e}"}, status=status.HTTP_500_INTERNAL_SERVER_ERROR)

        buf = io.BytesIO(pdf_bytes)
        filename = f"agreement_{ag.pk}_preview.pdf"
        resp = FileResponse(buf, content_type="application/pdf")
        resp["Content-Disposition"] = f'inline; filename="{filename}"'
        return resp

    # ---------------- NEW: signed-link preview for new-tab UX (no Authorization header) ----------------

    @action(detail=True, methods=["post"])
    def preview_link(self, request, pk=None):
        """
        Returns a short-lived signed URL (10 min) that streams the preview publicly.
        POST /agreements/<id>/preview_link/ -> {url}
        """
        signer = signing.TimestampSigner(salt=_PREVIEW_SALT)
        token = signer.sign_object({"agreement_id": int(pk), "uid": request.user.id})
        absolute = request.build_absolute_uri(f"/api/projects/agreements/preview_signed/?t={token}")
        return Response({"url": absolute}, status=status.HTTP_200_OK)

    @action(
        detail=False,
        methods=["get"],
        url_path="preview_signed",
        permission_classes=[AllowAny],  # public: guarded by HMAC + ttl
    )
    def preview_signed(self, request):
        """
        GET /agreements/preview_signed/?t=<token>
        Validates HMAC+timestamp and streams the preview PDF.
        """
        if not build_agreement_pdf_bytes:
            return Response({"detail": "PDF preview not available."}, status=status.HTTP_503_SERVICE_UNAVAILABLE)

        token = request.query_params.get("t")
        if not token:
            return Response({"detail": "Missing token."}, status=status.HTTP_400_BAD_REQUEST)

        signer = signing.TimestampSigner(salt=_PREVIEW_SALT)
        try:
            data = signer.unsign_object(token, max_age=_PREVIEW_MAX_AGE)
            agreement_id = int(data.get("agreement_id"))
        except signing.SignatureExpired:
            return Response({"detail": "Preview link expired."}, status=status.HTTP_410_GONE)
        except Exception:
            return Response({"detail": "Invalid preview token."}, status=status.HTTP_400_BAD_REQUEST)

        ag = get_object_or_404(Agreement, pk=agreement_id)
        try:
            pdf_bytes = build_agreement_pdf_bytes(ag, is_preview=True)
        except Exception as e:
            return Response({"detail": f"Could not generate preview: {e}"}, status=status.HTTP_500_INTERNAL_SERVER_ERROR)

        buf = io.BytesIO(pdf_bytes)
        filename = f"agreement_{ag.pk}_preview.pdf"
        resp = FileResponse(buf, content_type="application/pdf")
        resp["Content-Disposition"] = f'inline; filename="{filename}"'
        return resp

    # ---------------- Finalize (save/version) ----------------

    @action(detail=True, methods=["post"])
    def finalize_pdf(self, request, pk=None):
        ag = self.get_object()
        if not generate_full_agreement_pdf:
            return Response({"detail": "PDF finalization not available."}, status=status.HTTP_503_SERVICE_UNAVAILABLE)
        try:
            generate_full_agreement_pdf(ag)
        except Exception as e:
            return Response({"detail": f"PDF generation failed: {e}"}, status=status.HTTP_500_INTERNAL_SERVER_ERROR)
        ag.refresh_from_db()
        pdf_url = getattr(getattr(ag, "pdf_file", None), "url", None)
        return Response({"ok": True, "pdf_url": pdf_url}, status=status.HTTP_200_OK)

    # ---------------- Send for signature (email link) ----------------

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
        token = str(getattr(ag, "homeowner_access_token", ""))
        sign_url = f"{domain}/agreements/access/{token}/sign"
        pdf_url = f"{domain}/agreements/access/{token}/pdf"

        subject = f"Agreement for {getattr(getattr(ag, 'project', None), 'title', 'your project')} — Signature Requested"
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

    # ---------------- Contractor e-signature ----------------

    @action(detail=True, methods=["post"])
    def contractor_sign(self, request, pk=None):
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
        except Exception:
            return Response({"detail": "Could not process signature image."}, status=status.HTTP_400_BAD_REQUEST)

        ag.contractor_signature_name = name
        ag.signed_by_contractor = True
        ag.contractor_signed_at = now()
        ip = request.META.get("HTTP_X_FORWARDED_FOR", "").split(",")[0].strip() or request.META.get("REMOTE_ADDR")
        ag.contractor_signed_ip = ip or None
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
        ag: Agreement = self.get_object()
        contractor_user = getattr(getattr(ag, "contractor", None), "user", None)
        if not (request.user.is_staff or request.user.is_superuser or request.user == contractor_user):
            raise PermissionDenied("Only the assigned contractor (or staff) can unsign as contractor.")
        if _is_fully_signed(ag):
            raise ValidationError("Cannot unsign after both parties have signed.")

        ag.signed_by_contractor = False
        ag.contractor_signed_at = None
        ag.contractor_signature_name = None
        ag.status = "draft"
        ag.save(update_fields=[
            "signed_by_contractor", "contractor_signed_at", "contractor_signature_name",
            "status", "updated_at"
        ])

        ser = self.get_serializer(ag)
        return Response({"ok": True, "agreement": ser.data}, status=status.HTTP_200_OK)


# ---------- Auxiliary endpoints used by UI ----------

@api_view(["GET"])
@permission_classes([IsAuthenticated])
def agreement_milestones(request, pk: int):
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
def agreement_pdf(request, agreement_id: int):
    ag = get_object_or_404(Agreement, pk=agreement_id)
    if (not getattr(ag, "pdf_file", None)) or (not getattr(ag.pdf_file, "name", "")):
        if generate_full_agreement_pdf:
            try:
                generate_full_agreement_pdf(ag)
                ag.refresh_from_db()
            except Exception:
                pass
    if getattr(ag, "pdf_file", None) and getattr(ag.pdf_file, "name", ""):
        try:
            return FileResponse(ag.pdf_file.open("rb"), content_type="application/pdf")
        except Exception:
            raise Http404("PDF not available")
    raise Http404("PDF not available")
