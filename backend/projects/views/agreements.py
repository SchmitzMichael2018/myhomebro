# backend/projects/views/agreements.py
# v2025-10-22-AMEND-FRESH — Consolidated signing + cache-proof previews + start_amendment
# - CRITICAL: Any sign/unsign now invalidates stored final PDF via _clear_final_pdf(ag),
#             so finalized files never show stale signature content baked into base pages.

from __future__ import annotations

import io
import os
import time
import logging
from typing import Set, Optional, Dict

from django.conf import settings
from django.core import signing
from django.core.mail import send_mail
from django.http import FileResponse, Http404
from django.db import transaction
from django.shortcuts import get_object_or_404
from django.utils.timezone import now
from django.core.files.base import ContentFile
from django.db.models import BooleanField, Field

from rest_framework import viewsets, status
from rest_framework.decorators import action, api_view, permission_classes
from rest_framework.permissions import IsAuthenticated, AllowAny
from rest_framework.response import Response
from rest_framework.exceptions import ValidationError, PermissionDenied
from rest_framework.parsers import MultiPartParser, FormParser

from projects.models import Agreement
from projects.serializers.agreement import AgreementSerializer

logger = logging.getLogger(__name__)

# ---------------- PDF services (primary + fallback) ----------------

build_agreement_pdf_bytes = None  # type: ignore
generate_full_agreement_pdf = None  # type: ignore

def _abs_media_path(rel_path: str) -> Optional[str]:
    if not rel_path:
        return None
    mr = getattr(settings, "MEDIA_ROOT", "") or ""
    return os.path.join(mr, rel_path)

try:
    from projects.services.pdf import (  # type: ignore
        build_agreement_pdf_bytes as _svc_build_bytes,
        generate_full_agreement_pdf as _svc_generate_full,
    )
    build_agreement_pdf_bytes = _svc_build_bytes  # type: ignore
    generate_full_agreement_pdf = _svc_generate_full  # type: ignore
except Exception:
    try:
        from projects.utils.pdf import (  # type: ignore
            generate_full_agreement_pdf as _utils_generate_full,
        )
        from django.core.files.base import ContentFile as _CF  # local alias

        def _fallback_build_bytes(ag: Agreement, is_preview: bool = True) -> bytes:
            rel_path = _utils_generate_full(ag.id, preview=True)
            abs_path = _abs_media_path(rel_path)
            if not abs_path or not os.path.exists(abs_path):
                return b"%PDF-1.4\n% Empty preview\n"
            with open(abs_path, "rb") as fh:
                return fh.read()

        def _fallback_generate_full(ag: Agreement):
            version = int(getattr(ag, "pdf_version", 0) or 0) + 1
            rel_path = _utils_generate_full(ag.id, preview=False)
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
        pass

# ---------------- Overlay helper ----------------

try:
    from projects.services.pdf_signature_overlay import add_signature_overlay  # type: ignore
except Exception:
    def add_signature_overlay(pdf_bytes, agreement):  # type: ignore
        return pdf_bytes

# ---------------- constants & helpers ----------------

RETENTION_YEARS = 3

ALWAYS_OK_FIELDS: Set[str] = {
    "reviewed", "reviewed_at", "reviewed_by",
    "pdf_archived", "is_archived",
}

DRAFT_ONLY_FIELDS: Set[str] = {
    "project_type", "project_subtype", "standardized_category",
    "description", "warranty_type", "warranty_text_snapshot",
    "total_cost", "total_time_estimate", "milestone_count",
    "start", "end", "terms_text", "privacy_text",
    "contractor", "homeowner",
}

_PREVIEW_SALT = "agreements.preview.link.v1"
_PUBLIC_SIGN_SALT = "agreements.public.sign.v1"
_PREVIEW_MAX_AGE = 10 * 60  # 10 minutes
_PUBLIC_SIGN_MAX_AGE = 30 * 24 * 3600  # 30 days

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
    if hasattr(ag, "signed_by_contractor") and hasattr(ag, "signed_by_homeowner"):
        return bool(getattr(ag, "signed_by_contractor") and getattr(ag, "signed_by_homeowner"))
    return bool(getattr(ag, "contractor_signed_at", None) and getattr(ag, "homeowner_signed_at", None))

def _fully_signed_at(ag: Agreement):
    ch = getattr(ag, "contractor_signed_at", None)
    hh = getattr(ag, "homeowner_signed_at", None)
    if ch and hh:
        return ch if ch >= hh else hh
    return ch or hh

def _concrete_field_names_and_map(instance: Agreement) -> Dict[str, Field]:
    out: Dict[str, Field] = {}
    try:
        for f in instance._meta.get_fields():
            if getattr(f, "concrete", False) and not getattr(f, "many_to_many", False) and not getattr(f, "auto_created", False):
                name = getattr(f, "attname", getattr(f, "name", ""))
                if name:
                    out[name] = f  # type: ignore
    except Exception:
        pass
    return out

def _get_client_ip(request):
    x_forwarded_for = request.META.get("HTTP_X_FORWARDED_FOR")
    if x_forwarded_for:
        return x_forwarded_for.split(",")[0]
    return request.META.get("REMOTE_ADDR")

def _overlay_and_persist(ag: Agreement) -> None:
    try:
        if not getattr(ag, "pdf_file", None) or not getattr(ag.pdf_file, "name", ""):
            return
        with ag.pdf_file.open("rb") as fh:
            content = fh.read()
        if not content:
            return
        stamped = add_signature_overlay(content, ag)
        if not stamped:
            return
        base_name = os.path.basename(ag.pdf_file.name)
        ag.pdf_file.save(base_name, ContentFile(stamped), save=True)
    except Exception:
        logger.exception("overlay_and_persist failed (agreement id=%s)", getattr(ag, "id", None))

def _clear_final_pdf(ag: Agreement) -> None:
    """
    Unset stored final PDF so next finalize regenerates clean pages.
    If you prefer to archive, adapt to move/copy rather than delete.
    """
    try:
        if getattr(ag, "pdf_file", None) and getattr(ag.pdf_file, "name", ""):
            ag.pdf_file.delete(save=False)
        if hasattr(ag, "pdf_version"):
            ag.pdf_version = int(getattr(ag, "pdf_version", 0) or 0) + 1
        fields = [f for f in ("pdf_file", "pdf_version") if hasattr(ag, f)]
        if fields:
            ag.save(update_fields=fields)
    except Exception:
        logger.exception("Failed to clear final PDF (agreement id=%s)", getattr(ag, "id", None))

# ====================================================================
#                          MAIN VIEWSET
# ====================================================================

class AgreementViewSet(viewsets.ModelViewSet):
    permission_classes = [IsAuthenticated]
    serializer_class = AgreementSerializer
    queryset = Agreement.objects.select_related("project", "contractor", "homeowner").all().order_by("-updated_at")
    parser_classes = (MultiPartParser, FormParser)

    # ---------- Debug helpers ----------
    @action(detail=True, methods=["get"])
    def version(self, request, pk=None):
        return Response({"version": "v2025-10-22-AMEND-FRESH", "agreement_id": int(pk)}, status=status.HTTP_200_OK)

    @action(detail=True, methods=["get"])
    def unsign_debug(self, request, pk=None):
        ag = self.get_object()
        fmap = _concrete_field_names_and_map(ag)
        return Response({
            "agreement_id": ag.id,
            "amendment_number": getattr(ag, "amendment_number", 0),
            "concrete_fields": sorted(fmap.keys()),
            "signed_by_contractor": getattr(ag, "signed_by_contractor", None),
            "contractor_signed_at": getattr(ag, "contractor_signed_at", None),
            "signed_at_contractor": getattr(ag, "signed_at_contractor", None),
            "signed_by_homeowner": getattr(ag, "signed_by_homeowner", None),
            "homeowner_signed_at": getattr(ag, "homeowner_signed_at", None),
        }, status=status.HTTP_200_OK)

    # ---------- Editability enforcement ----------
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
                "signed_by_contractor": getattr(instance, "signed_by_contractor", None),
                "signed_by_homeowner": getattr(instance, "signed_by_homeowner", None),
            })

    # ---------- Payload cleaner ----------
    def _prepare_payload(self, request):
        data = request.data.copy() if hasattr(request.data, "copy") else dict(request.data)
        data.pop("status", None)
        for k in ("description", "terms_text", "privacy_text", "project_subtype", "standardized_category"):
            if k in data and data[k] == "":
                data[k] = None
        for k in ("start", "end", "total_time_estimate"):
            if k in data and data[k] == "":
                data[k] = None
        if data.get("total_cost") == "":
            data["total_cost"] = None
        if data.get("milestone_count") == "":
            data["milestone_count"] = None
        return data

    # ---------- REST overrides ----------
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

    # ---------- Start Amendment ----------
    @action(detail=True, methods=["post"], permission_classes=[IsAuthenticated])
    def start_amendment(self, request, pk=None):
        ag = self.get_object()
        contractor_user = getattr(getattr(ag, "contractor", None), "user", None)
        if not (request.user.is_staff or request.user.is_superuser or request.user == contractor_user):
            return Response({"error": "Only the contractor or staff can start an amendment."}, status=status.HTTP_403_FORBIDDEN)
        if not _is_fully_signed(ag):
            return Response({"error": "Both parties must sign before starting an amendment."}, status=status.HTTP_400_BAD_REQUEST)

        fmap = _concrete_field_names_and_map(ag)

        wipe = {
            # Contractor
            "contractor_signed_at": None, "signed_at_contractor": None,
            "contractor_signature_ip": None, "contractor_signed_ip": None,
            "contractor_signature_useragent": None, "contractor_user_agent": None,
            "contractor_signature_name": None, "contractor_name": None,
            # Homeowner
            "homeowner_signed_at": None, "signed_at_homeowner": None,
            "homeowner_signature_ip": None, "homeowner_signed_ip": None,
            "homeowner_signature_useragent": None, "homeowner_user_agent": None,
            "homeowner_signature_name": None, "homeowner_name": None,
        }
        updates: Dict[str, object] = {}

        if "amendment_number" in fmap:
            try:
                updates["amendment_number"] = int(getattr(ag, "amendment_number", 0) or 0) + 1
            except Exception:
                updates["amendment_number"] = 1

        for name, val in wipe.items():
            if name in fmap:
                updates[name] = val
        if "signed_by_contractor" in fmap and isinstance(fmap["signed_by_contractor"], BooleanField):
            updates["signed_by_contractor"] = False
        if "signed_by_homeowner" in fmap and isinstance(fmap["signed_by_homeowner"], BooleanField):
            updates["signed_by_homeowner"] = False

        # Optional: log history row if model exists
        try:
            from projects.models_signatures import AgreementSignature  # type: ignore
            try:
                AgreementSignature.objects.create(
                    agreement=ag, role="system", signed_at=now(),
                    ip_address="", user_agent="",
                    note=f"Amendment started; new amendment_number={updates.get('amendment_number')}"
                )
            except Exception:
                pass
        except Exception:
            pass

        try:
            with transaction.atomic():
                if updates:
                    Agreement.objects.filter(pk=ag.pk).update(**updates)
                ag.refresh_from_db()
                _clear_final_pdf(ag)  # invalidate any stored final
        except Exception as e:
            logger.exception("start_amendment failed for Agreement id=%s", ag.id)
            return Response({"error": "Start amendment failed.", "detail": str(e)}, status=status.HTTP_500_INTERNAL_SERVER_ERROR)

        return Response({"ok": True, "amendment_number": getattr(ag, "amendment_number", 0)}, status=status.HTTP_200_OK)

    # ---------- Contractor SIGN ----------
    @action(detail=True, methods=["post"], permission_classes=[IsAuthenticated])
    def contractor_sign(self, request, pk=None):
        ag = self.get_object()
        contractor_user = getattr(getattr(ag, "contractor", None), "user", None)
        if request.user != contractor_user:
            return Response({"error": "Only the contractor can sign here."}, status=status.HTTP_403_FORBIDDEN)

        typed_name = (request.data.get("typed_name") or "").strip()
        if not typed_name:
            return Response({"error": "typed_name required."}, status=status.HTTP_400_BAD_REQUEST)

        fmap = _concrete_field_names_and_map(ag)
        ip = _get_client_ip(request)
        ua = request.META.get("HTTP_USER_AGENT", "")

        updates = {}
        for f in ("contractor_signed_at", "signed_at_contractor"):
            if f in fmap:
                updates[f] = now()
        for f in ("contractor_signature_name", "contractor_name"):
            if f in fmap:
                updates[f] = typed_name
        for f, val in (
            ("contractor_signature_ip", ip),
            ("contractor_signed_ip", ip),
            ("contractor_signature_useragent", ua),
            ("contractor_user_agent", ua),
        ):
            if f in fmap:
                updates[f] = val
        if "signed_by_contractor" in fmap and isinstance(fmap["signed_by_contractor"], BooleanField):
            updates["signed_by_contractor"] = True

        # Optional history
        try:
            from projects.models_signatures import AgreementSignature  # type: ignore
            AgreementSignature.objects.update_or_create(
                agreement=ag, role="contractor",
                defaults=dict(signed_at=now(), ip_address=ip, user_agent=ua, name=typed_name)
            )
        except Exception:
            pass

        try:
            if updates:
                Agreement.objects.filter(pk=ag.pk).update(**updates)
            ag.refresh_from_db()
            _clear_final_pdf(ag)     # <— invalidate any stored final first
            _overlay_and_persist(ag) # (no-op if final not present)
        except Exception as e:
            logger.exception("contractor_sign failed for Agreement id=%s", ag.id)
            return Response({"error": "Sign failed.", "detail": str(e)}, status=status.HTTP_500_INTERNAL_SERVER_ERROR)

        return Response({"ok": True}, status=status.HTTP_200_OK)

    # ---------- Contractor UNSIGN ----------
    @action(detail=True, methods=["post"], permission_classes=[IsAuthenticated])
    def unsign(self, request, pk=None):
        ag = self.get_object()
        contractor_user = getattr(getattr(ag, "contractor", None), "user", None)
        if request.user != contractor_user:
            return Response({"error": "Only the contractor can revoke this signature."}, status=status.HTTP_403_FORBIDDEN)
        if getattr(ag, "homeowner_signed_at", None):
            return Response({"error": "Cannot revoke after homeowner has signed."}, status=status.HTTP_400_BAD_REQUEST)

        fmap = _concrete_field_names_and_map(ag)

        maybe_none = {
            "contractor_signed_at": None, "signed_at_contractor": None,
            "contractor_signature_ip": None, "contractor_signed_ip": None,
            "contractor_signature_useragent": None, "contractor_user_agent": None,
            "contractor_signature_name": None, "contractor_name": None,
        }
        updates: Dict[str, object] = {}
        for name, val in maybe_none.items():
            if name in fmap:
                updates[name] = val
        if "signed_by_contractor" in fmap and isinstance(fmap["signed_by_contractor"], BooleanField):
            updates["signed_by_contractor"] = False

        # Optional history
        try:
            from projects.models_signatures import AgreementSignature  # type: ignore
            AgreementSignature.objects.update_or_create(
                agreement=ag, role="contractor",
                defaults=dict(signed_at=None, ip_address=None, user_agent=None, name=None)
            )
        except Exception:
            pass

        try:
            with transaction.atomic():
                if updates:
                    Agreement.objects.filter(pk=ag.pk).update(**updates)
                ag.refresh_from_db()
                _clear_final_pdf(ag)     # <— invalidate any stored final
                _overlay_and_persist(ag) # in case a file still exists (no-op if cleared)
        except Exception as e:
            logger.exception("UNSIGN failed for Agreement id=%s", getattr(ag, "id", None))
            return Response({"error": "Unsign failed.", "detail": str(e)}, status=status.HTTP_500_INTERNAL_SERVER_ERROR)

        return Response({
            "ok": True,
            "cleared": sorted(updates.keys()),
            "after": {
                "signed_by_contractor": getattr(ag, "signed_by_contractor", None),
                "contractor_signed_at": getattr(ag, "contractor_signed_at", None),
                "signed_at_contractor": getattr(ag, "signed_at_contractor", None),
            }
        }, status=status.HTTP_200_OK)

    # ---------- Homeowner SIGN ----------
    @action(detail=True, methods=["post"], permission_classes=[IsAuthenticated])
    def homeowner_sign(self, request, pk=None):
        ag = self.get_object()
        homeowner_user = getattr(getattr(ag, "homeowner", None), "user", None)
        if request.user != homeowner_user:
            return Response({"error": "Only the homeowner can sign here."}, status=status.HTTP_403_FORBIDDEN)

        typed_name = (request.data.get("typed_name") or "").strip()
        if not typed_name:
            return Response({"error": "typed_name required."}, status=status.HTTP_400_BAD_REQUEST)

        fmap = _concrete_field_names_and_map(ag)
        ip = _get_client_ip(request)
        ua = request.META.get("HTTP_USER_AGENT", "")

        updates = {}
        for f in ("homeowner_signed_at", "signed_at_homeowner"):
            if f in fmap:
                updates[f] = now()
        for f in ("homeowner_signature_name", "homeowner_name"):
            if f in fmap:
                updates[f] = typed_name
        for f, val in (
            ("homeowner_signature_ip", ip),
            ("homeowner_signed_ip", ip),
            ("homeowner_signature_useragent", ua),
            ("homeowner_user_agent", ua),
        ):
            if f in fmap:
                updates[f] = val
        if "signed_by_homeowner" in fmap and isinstance(fmap["signed_by_homeowner"], BooleanField):
            updates["signed_by_homeowner"] = True

        # Optional history
        try:
            from projects.models_signatures import AgreementSignature  # type: ignore
            AgreementSignature.objects.update_or_create(
                agreement=ag, role="homeowner",
                defaults=dict(signed_at=now(), ip_address=ip, user_agent=ua, name=typed_name)
            )
        except Exception:
            pass

        try:
            if updates:
                Agreement.objects.filter(pk=ag.pk).update(**updates)
            ag.refresh_from_db()
            _clear_final_pdf(ag)     # <— invalidate any stored final
            _overlay_and_persist(ag) # (no-op if none)
        except Exception as e:
            logger.exception("homeowner_sign failed for Agreement id=%s", ag.id)
            return Response({"error": "Sign failed.", "detail": str(e)}, status=status.HTTP_500_INTERNAL_SERVER_ERROR)

        return Response({"ok": True}, status=status.HTTP_200_OK)

    # ---------- Share / email ----------
    @action(detail=True, methods=["post"])
    def share_email(self, request, pk=None):
        ag = self.get_object()
        email = (request.data.get("email") or "").strip()
        if not email:
            return Response({"error": "email required."}, status=status.HTTP_400_BAD_REQUEST)

        domain = (
            getattr(settings, "PUBLIC_APP_ORIGIN", None)
            or getattr(settings, "SITE_ORIGIN", None)
            or "https://www.myhomebro.com"
        )
        signer = signing.TimestampSigner(salt=_PUBLIC_SIGN_SALT)
        token = signer.sign_object({"agreement_id": int(pk)})
        ts = int(time.time())
        sign_url = f"{domain}/agreements/access/{token}/sign?_ts={ts}"
        pdf_url  = f"{domain}/agreements/access/{token}/pdf?_ts={ts}"

        subject = "Agreement — Signature Requested"
        body = (
            "Hello,\n\nPlease review and sign your agreement using the secure link below:\n\n"
            f"Sign: {sign_url}\nPDF:  {pdf_url}\n\n— MyHomeBro\n"
        )
        try:
            from_email = getattr(settings, "DEFAULT_FROM_EMAIL", "no-reply@myhomebro.com")
            send_mail(subject, body, from_email, [email], fail_silently=True)
        except Exception:
            pass

        return Response({"ok": True}, status=status.HTTP_200_OK)

    # ---------- Share / sms (placeholder) ----------
    @action(detail=True, methods=["post"])
    def share_sms(self, request, pk=None):
        phone = (request.data.get("phone") or "").strip()
        if not phone:
            return Response({"error": "phone required."}, status=status.HTTP_400_BAD_REQUEST)
        return Response({"ok": True}, status=status.HTTP_200_OK)

    # ---------- AUTH preview ----------
    @action(detail=True, methods=["get"], url_path="preview_pdf")
    def preview_pdf(self, request, pk=None):
        stream = request.query_params.get("stream")
        if not stream:
            url = request.build_absolute_uri(f"?stream=1&_ts={int(time.time())}")
            return Response({"url": url}, status=status.HTTP_200_OK)

        if not build_agreement_pdf_bytes:
            return Response({"detail": "PDF preview not available."}, status=status.HTTP_503_SERVICE_UNAVAILABLE)

        ag: Agreement = self.get_object()
        ag.refresh_from_db()
        try:
            pdf_bytes = build_agreement_pdf_bytes(ag, is_preview=True)
            pdf_bytes = add_signature_overlay(pdf_bytes, ag)
        except Exception as e:
            return Response({"detail": f"Could not generate preview: {e}"}, status=status.HTTP_500_INTERNAL_SERVER_ERROR)

        buf = io.BytesIO(pdf_bytes)
        filename = f"agreement_{ag.pk}_preview.pdf"
        resp = FileResponse(buf, content_type="application/pdf")
        resp["Content-Disposition"] = f'inline; filename="{filename}"'
        resp["Cache-Control"] = "no-store, no-cache, must-revalidate, max-age=0"
        resp["Pragma"] = "no-cache"
        return resp

    # ---------- Public signed-link preview ----------
    @action(detail=True, methods=["post"])
    def preview_link(self, request, pk=None):
        signer = signing.TimestampSigner(salt=_PREVIEW_SALT)
        token = signer.sign_object({"agreement_id": int(pk), "uid": request.user.id})
        absolute = request.build_absolute_uri(f"/api/projects/agreements/preview_signed/?t={token}&_ts={int(time.time())}")
        return Response({"url": absolute}, status=status.HTTP_200_OK)

    @action(detail=False, methods=["get"], url_path="preview_signed", permission_classes=[AllowAny])
    def preview_signed(self, request):
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
        ag.refresh_from_db()
        try:
            pdf_bytes = build_agreement_pdf_bytes(ag, is_preview=True)
            pdf_bytes = add_signature_overlay(pdf_bytes, ag)
        except Exception as e:
            return Response({"detail": f"Could not generate preview: {e}"}, status=status.HTTP_500_INTERNAL_SERVER_ERROR)

        buf = io.BytesIO(pdf_bytes)
        filename = f"agreement_{ag.pk}_preview.pdf"
        resp = FileResponse(buf, content_type="application/pdf")
        resp["Content-Disposition"] = f'inline; filename="{filename}"'
        resp["Cache-Control"] = "no-store, no-cache, must-revalidate, max-age=0"
        resp["Pragma"] = "no-cache"
        return resp

    # ---------- Finalize ----------
    @action(detail=True, methods=["post"])
    def finalize_pdf(self, request, pk=None):
        ag = self.get_object()
        if not generate_full_agreement_pdf:
            return Response({"detail": "PDF finalization not available."}, status=status.HTTP_503_SERVICE_UNAVAILABLE)
        try:
            generate_full_agreement_pdf(ag)
            ag.refresh_from_db()
            _overlay_and_persist(ag)
        except Exception as e:
            logger.exception("Finalization failed for Agreement id=%s", getattr(ag, "id", None))
            return Response({"detail": f"PDF generation failed: {e}"}, status=status.HTTP_500_INTERNAL_SERVER_ERROR)

        ag.refresh_from_db()
        pdf_url = getattr(getattr(ag, "pdf_file", None), "url", None)
        return Response({"ok": True, "pdf_url": pdf_url}, status=status.HTTP_200_OK)

# ---------- Auxiliary endpoints ----------

@api_view(["GET"])
@permission_classes([IsAuthenticated])
def agreement_milestones(request, pk: int):
    try:
        from projects.models import Milestone  # type: ignore
    except Exception:
        return Response([], status=status.HTTP_200_OK)

    ag = get_object_or_404(Agreement, pk=pk)
    if hasattr(ag, "milestones"):
        qs = ag.milestones.all()
    elif hasattr(ag, "milestone_set"):
        qs = ag.milestone_set.all()
    else:
        qs = Milestone.objects.filter(agreement=ag)

    data = [
        {
            "id": getattr(m, "id", None),
            "order": getattr(m, "order", None),
            "title": getattr(m, "title", None),
            "description": getattr(m, "description", None),
            "amount": str(getattr(m, "amount", "")),
            "start_date": getattr(m, "start_date", None),
            "completion_date": getattr(m, "completion_date", None),
            "duration": (getattr(m, "duration", None).total_seconds() if getattr(m, "duration", None) else None),
            "is_invoiced": getattr(m, "is_invoiced", None),
            "completed": getattr(m, "completed", None),
        }
        for m in qs
    ]
    return Response(data, status=status.HTTP_200_OK)

# ---- Public homeowner sign via token ----

@api_view(["GET", "POST"])
@permission_classes([AllowAny])
def public_sign(request):
    token = request.query_params.get("t")
    if not token:
        return Response({"detail": "Missing token."}, status=status.HTTP_400_BAD_REQUEST)

    signer = signing.TimestampSigner(salt=_PUBLIC_SIGN_SALT)
    try:
        data = signer.unsign_object(token, max_age=_PUBLIC_SIGN_MAX_AGE)
        agreement_id = int(data.get("agreement_id"))
    except signing.SignatureExpired:
        return Response({"detail": "Link expired."}, status=status.HTTP_410_GONE)
    except Exception:
        return Response({"detail": "Invalid token."}, status=status.HTTP_400_BAD_REQUEST)

    ag = get_object_or_404(Agreement, pk=agreement_id)

    if request.method == "GET":
        return Response({
            "id": ag.id,
            "project_title": getattr(getattr(ag, "project", None), "title", None),
            "contractor": getattr(getattr(ag, "contractor", None), "full_name", None),
            "homeowner": getattr(getattr(ag, "homeowner", None), "full_name", None),
            "signed_by_homeowner": getattr(ag, "signed_by_homeowner", None) or bool(getattr(ag, "homeowner_signed_at", None)),
        }, status=status.HTTP_200_OK)

    typed_name = (request.data.get("typed_name") or "").strip()
    if not typed_name:
        return Response({"error": "typed_name required."}, status=status.HTTP_400_BAD_REQUEST)

    fmap = _concrete_field_names_and_map(ag)
    ip = request.META.get("REMOTE_ADDR", "")
    ua = request.META.get("HTTP_USER_AGENT", "")

    updates = {}
    for f in ("homeowner_signed_at", "signed_at_homeowner"):
        if f in fmap:
            updates[f] = now()
    for f in ("homeowner_signature_name", "homeowner_name"):
        if f in fmap:
            updates[f] = typed_name
    for f, val in (
        ("homeowner_signature_ip", ip),
        ("homeowner_signed_ip", ip),
        ("homeowner_signature_useragent", ua),
        ("homeowner_user_agent", ua),
    ):
        if f in fmap:
            updates[f] = val
    if "signed_by_homeowner" in fmap and isinstance(fmap["signed_by_homeowner"], BooleanField):
        updates["signed_by_homeowner"] = True

    try:
        if updates:
            Agreement.objects.filter(pk=ag.pk).update(**updates)
    except Exception as e:
        logger.exception("public homeowner_sign failed for Agreement id=%s", ag.id)
        return Response({"error": "Sign failed.", "detail": str(e)}, status=status.HTTP_500_INTERNAL_SERVER_ERROR)

    return Response({"ok": True}, status=status.HTTP_200_OK)
