# backend/projects/views/signing.py

from __future__ import annotations

import base64
import re
from django.utils import timezone
from django.shortcuts import get_object_or_404
from django.conf import settings
from django.core.files.base import ContentFile
from rest_framework import viewsets, permissions, response, status, decorators

from projects.models import Agreement
from projects.serializers.signing import (
    AgreementReviewSerializer,
    AgreementSignSerializer,
    AgreementPreviewSerializer,
    AgreementReviewedSerializer,
)
from projects.services.activity_feed import create_activity_event
from projects.services.pdf import build_agreement_pdf_bytes, attach_pdf_to_agreement
from projects.services.mailer import email_signed_agreement
from projects.services.sms import sms_link_to_parties  # safe: no-op if not configured


DATA_URL_RE = re.compile(r"^data:(?P<mime>[-\w.\/]+);base64,(?P<b64>.+)$", re.IGNORECASE)


def _client_ip(request) -> str:
    ip = request.META.get("HTTP_X_FORWARDED_FOR")
    if ip:
        ip = ip.split(",")[0].strip()
    else:
        ip = request.META.get("REMOTE_ADDR", "")
    return ip or ""


def _user_agent(request) -> str:
    return request.META.get("HTTP_USER_AGENT", "") or ""


def _decode_base64_image(data: str) -> tuple[bytes | None, str | None]:
    """
    Accepts:
      - raw base64 string
      - data URL: data:image/png;base64,....
    Returns: (bytes, ext) where ext is 'png'/'jpg' etc, or (None, None)
    """
    if not data:
        return None, None

    s = str(data).strip()
    if not s:
        return None, None

    mime = None
    b64 = s

    m = DATA_URL_RE.match(s)
    if m:
        mime = (m.group("mime") or "").lower().strip()
        b64 = (m.group("b64") or "").strip()

    # Common padding issues
    b64 = b64.replace("\n", "").replace("\r", "").strip()
    if not b64:
        return None, None

    try:
        raw = base64.b64decode(b64, validate=False)
    except Exception:
        return None, None

    # Guess extension
    ext = "png"
    if mime:
        if "jpeg" in mime or "jpg" in mime:
            ext = "jpg"
        elif "png" in mime:
            ext = "png"
        elif "webp" in mime:
            ext = "webp"
    else:
        # Best-effort signature sniffing
        if raw[:2] == b"\xff\xd8":
            ext = "jpg"
        elif raw[:4] == b"RIFF" and b"WEBP" in raw[:16]:
            ext = "webp"
        else:
            ext = "png"

    return raw, ext


def _call_build_pdf_bytes(**kwargs) -> bytes:
    """
    Your codebase has multiple PDF service signatures (agreement_pdf.py vs service wrapper).
    This wrapper tries "rich kwargs" first, then falls back to the simplest signature.
    """
    ag = kwargs.get("ag")
    if ag is None:
        raise ValueError("Missing agreement for PDF build")

    # Try full kwargs first (your current calling style)
    try:
        return build_agreement_pdf_bytes(**kwargs)
    except TypeError:
        # Fall back to minimal signature: build_agreement_pdf_bytes(ag, is_preview=bool)
        is_preview = bool(kwargs.get("is_preview", False))
        return build_agreement_pdf_bytes(ag, is_preview=is_preview)


class IsAgreementParticipant(permissions.BasePermission):
    """
    Allow contractor assigned to the agreement or homeowner (email match);
    unauthenticated users get read-only review (public share link).
    """
    def has_object_permission(self, request, view, obj: Agreement):
        user = request.user
        if user and user.is_authenticated and user.is_staff:
            return True
        contractor = getattr(obj, "contractor", None)
        if contractor and getattr(contractor, "user", None) == user:
            return True
        if user and getattr(user, "email", None) and obj.homeowner_email:
            if user.email.lower() == obj.homeowner_email.lower():
                return True
        if view.action in ("review", "preview") and request.method in ("GET", "POST"):
            return True  # allow public preview/review
        return False


class AgreementSigningViewSet(viewsets.ViewSet):
    """
    /api/projects/signing/agreements/<id>/review/          [GET]
    /api/projects/signing/agreements/<id>/preview/         [POST] -> {pdf_base64}
    /api/projects/signing/agreements/<id>/mark-reviewed/   [POST]
    /api/projects/signing/agreements/<id>/sign/            [POST]
    /api/projects/signing/agreements/<id>/email/           [POST]
    /api/projects/signing/agreements/<id>/sms/             [POST]
    /api/projects/signing/agreements/<id>/regenerate-pdf/  [POST] (admin)
    """
    permission_classes = [permissions.AllowAny]

    def _get_agreement(self, pk: str) -> Agreement:
        return get_object_or_404(Agreement, pk=pk)

    @decorators.action(detail=True, methods=["get"], url_path="review")
    def review(self, request, pk=None):
        ag = self._get_agreement(pk)
        if not IsAgreementParticipant().has_object_permission(request, self, ag):
            return response.Response({"detail": "Forbidden"}, status=status.HTTP_403_FORBIDDEN)
        return response.Response(AgreementReviewSerializer(ag).data)

    @decorators.action(detail=True, methods=["post"], url_path="preview")
    def preview(self, request, pk=None):
        """
        Generate a PREVIEW (not signed) PDF with warranty included.
        Returns { pdf_base64 } for the client to open/download.
        Optionally persists warranty to model if fields exist.
        """
        ag = self._get_agreement(pk)
        if not IsAgreementParticipant().has_object_permission(request, self, ag):
            return response.Response({"detail": "Forbidden"}, status=status.HTTP_403_FORBIDDEN)

        ser = AgreementPreviewSerializer(data=request.data)
        ser.is_valid(raise_exception=True)
        warranty_type = ser.validated_data.get("warranty_type", "default")
        warranty_text = ser.validated_data.get("warranty_text", "")

        # Persist snapshot if model fields exist
        changed_fields = []
        if hasattr(ag, "warranty_text_snapshot"):
            text_final = (warranty_text or "").strip()
            if not text_final and warranty_type == "default":
                text_final = (
                    "Contractor warrants workmanship for one (1) year from substantial completion. "
                    "Materials are covered by manufacturer warranties where applicable. "
                    "Warranty excludes damage caused by misuse, neglect, unauthorized modifications, or normal wear. "
                    "Remedy is limited to repair or replacement at Contractor’s discretion."
                )
            ag.warranty_text_snapshot = text_final
            changed_fields.append("warranty_text_snapshot")
        if hasattr(ag, "warranty_type"):
            ag.warranty_type = warranty_type
            changed_fields.append("warranty_type")
        if changed_fields:
            ag.save(update_fields=changed_fields)

        # Build preview PDF (use wrapper for signature-compatibility)
        pdf_bytes = _call_build_pdf_bytes(
            ag=ag,
            version_label="preview",
            is_preview=True,
            warranty_type=warranty_type,
            warranty_text=warranty_text,
        )

        b64 = base64.b64encode(pdf_bytes).decode("ascii")
        return response.Response({"ok": True, "pdf_base64": b64})

    @decorators.action(detail=True, methods=["post"], url_path="mark-reviewed")
    def mark_reviewed(self, request, pk=None):
        """
        Records that the agreement PDF was reviewed (gates signature).
        """
        ag = self._get_agreement(pk)
        if not IsAgreementParticipant().has_object_permission(request, self, ag):
            return response.Response({"detail": "Forbidden"}, status=status.HTTP_403_FORBIDDEN)

        ser = AgreementReviewedSerializer(data=request.data)
        ser.is_valid(raise_exception=True)
        reviewer_role = ser.validated_data.get("reviewer_role")

        changed = False
        if hasattr(ag, "reviewed_at"):
            ag.reviewed_at = timezone.now()
            changed = True
        if hasattr(ag, "reviewed_by"):
            ag.reviewed_by = reviewer_role
            changed = True
        if changed:
            fields = []
            if hasattr(ag, "reviewed_at"):
                fields.append("reviewed_at")
            if hasattr(ag, "reviewed_by"):
                fields.append("reviewed_by")
            ag.save(update_fields=fields)

        return response.Response({"ok": True, "reviewed_at": getattr(ag, "reviewed_at", None)})

    @decorators.action(detail=True, methods=["post"], url_path="sign")
    def sign(self, request, pk=None):
        """
        Core signing endpoint used by the React SignatureModal.

        Accepts:
          - signer_name
          - signer_role ("contractor" | "homeowner")
          - signature_text
          - optional:
              - signature_image as multipart file (signature_image)
              - signature_image_base64 or signature_image (data URL/base64 string) in JSON

        Enforces "preview then review" gate if supported by the model.
        """
        ag = self._get_agreement(pk)
        if not IsAgreementParticipant().has_object_permission(request, self, ag):
            return response.Response({"detail": "Forbidden"}, status=status.HTTP_403_FORBIDDEN)

        # Enforce review gate if the model supports it
        if hasattr(ag, "reviewed_at") and not getattr(ag, "reviewed_at"):
            return response.Response(
                {"detail": "Please generate and review the preview PDF before signing."},
                status=status.HTTP_400_BAD_REQUEST,
            )

        ser = AgreementSignSerializer(data=request.data)
        ser.is_valid(raise_exception=True)
        payload = ser.validated_data

        signer_name = payload.get("signer_name")
        signer_role = (payload.get("signer_role") or "").lower()
        signature_text = payload.get("signature_text", "") or ""
        was_fully_signed = bool(getattr(ag, "signed_by_contractor", False) and getattr(ag, "signed_by_homeowner", False))

        # Capture IP and User-Agent for audit purposes
        ip = _client_ip(request)
        ua = _user_agent(request)
        now = timezone.now()

        # Optional file: finger-drawn or uploaded signature image
        signature_file = request.FILES.get("signature_image")

        # Optional base64 signature (common for SignaturePad)
        # Accept either signature_image_base64 OR signature_image if it is a string
        sig_b64 = None
        try:
            if isinstance(request.data.get("signature_image_base64"), str):
                sig_b64 = request.data.get("signature_image_base64")
            elif isinstance(request.data.get("signature_image"), str):
                sig_b64 = request.data.get("signature_image")
        except Exception:
            sig_b64 = None

        decoded_bytes = None
        decoded_ext = None
        if not signature_file and sig_b64:
            decoded_bytes, decoded_ext = _decode_base64_image(sig_b64)

        # Persist role-specific signature metadata if the fields exist
        if signer_role == "homeowner":
            if hasattr(ag, "homeowner_signature_name"):
                ag.homeowner_signature_name = signer_name
            if hasattr(ag, "homeowner_signature_text"):
                ag.homeowner_signature_text = signature_text
            if hasattr(ag, "homeowner_signed_at"):
                ag.homeowner_signed_at = now
            if hasattr(ag, "homeowner_signed_ip"):
                ag.homeowner_signed_ip = ip

            # Save signature image to ImageField if present
            if hasattr(ag, "homeowner_signature"):
                if signature_file:
                    ag.homeowner_signature.save(
                        f"homeowner_sig_{ag.id}.png",
                        signature_file,
                        save=False,
                    )
                elif decoded_bytes:
                    ext = decoded_ext or "png"
                    ag.homeowner_signature.save(
                        f"homeowner_sig_{ag.id}.{ext}",
                        ContentFile(decoded_bytes),
                        save=False,
                    )

        elif signer_role == "contractor":
            if hasattr(ag, "contractor_signature_name"):
                ag.contractor_signature_name = signer_name
            if hasattr(ag, "contractor_signature_text"):
                ag.contractor_signature_text = signature_text
            if hasattr(ag, "contractor_signed_at"):
                ag.contractor_signed_at = now
            if hasattr(ag, "contractor_signed_ip"):
                ag.contractor_signed_ip = ip

            if hasattr(ag, "contractor_signature"):
                if signature_file:
                    ag.contractor_signature.save(
                        f"contractor_sig_{ag.id}.png",
                        signature_file,
                        save=False,
                    )
                elif decoded_bytes:
                    ext = decoded_ext or "png"
                    ag.contractor_signature.save(
                        f"contractor_sig_{ag.id}.{ext}",
                        ContentFile(decoded_bytes),
                        save=False,
                    )
        else:
            return response.Response(
                {"detail": "Invalid signer_role. Must be 'contractor' or 'homeowner'."},
                status=status.HTTP_400_BAD_REQUEST,
            )

        # Generic audit fields & PDF version bump
        new_version = (ag.pdf_version or 0) + 1 if hasattr(ag, "pdf_version") else 1
        if hasattr(ag, "pdf_version"):
            ag.pdf_version = new_version

        if hasattr(ag, "last_signed_at"):
            ag.last_signed_at = now
        if hasattr(ag, "last_signed_by"):
            ag.last_signed_by = signer_role
        if hasattr(ag, "signature_note"):
            ag.signature_note = f"{signer_role} {signer_name} accepted ToS/Privacy; text: {signature_text[:60]}"

        ag.save()

        # Build the signed PDF version
        version_label = f"v{new_version}"
        pdf_bytes = _call_build_pdf_bytes(
            ag=ag,
            version_label=version_label,
            signer_name=signer_name,
            signer_role=signer_role,
            signer_ip=ip,
            user_agent=ua,
            is_preview=False,
            warranty_type=getattr(ag, "warranty_type", "default"),
            warranty_text=getattr(ag, "warranty_text_snapshot", ""),
        )
        attach_pdf_to_agreement(ag, pdf_bytes, version=new_version)

        # Email the freshly signed agreement (best-effort)
        try:
            email_signed_agreement(ag)
        except Exception:
            pass

        # SMS link (best-effort)
        try:
            base = getattr(settings, "FRONTEND_URL", None) or getattr(settings, "SITE_URL", None) or ""
            link = f"{base.rstrip('/')}/agreements/{ag.id}" if base else f"/agreements/{ag.id}"
            sms_link_to_parties(ag, link_url=link, note="Signed. View your PDF:", dedupe_key=f"agreement_signed_link:{ag.id}:{new_version}")
        except Exception:
            pass

        is_fully_signed = bool(getattr(ag, "signed_by_contractor", False) and getattr(ag, "signed_by_homeowner", False))
        if not was_fully_signed and is_fully_signed:
            try:
                create_activity_event(
                    contractor=getattr(ag, "contractor", None),
                    actor_user=request.user,
                    agreement=ag,
                    event_type="agreement_fully_signed",
                    title="Agreement fully signed",
                    summary="Both parties signed the agreement.",
                    severity="success",
                    related_label=getattr(ag, "title", "") or "Agreement",
                    icon_hint="check",
                    navigation_target=f"/app/agreements/{ag.id}",
                    metadata={"agreement_id": ag.id, "version": new_version},
                    dedupe_key=f"agreement_fully_signed:{ag.id}",
                )
            except Exception:
                pass

        # Return updated agreement so frontend can immediately show "Signed ✅"
        return response.Response(
            {
                "ok": True,
                "version": new_version,
                "agreement": AgreementReviewSerializer(ag).data,
            }
        )

    @decorators.action(detail=True, methods=["post"], url_path="email")
    def email(self, request, pk=None):
        ag = self._get_agreement(pk)
        if not IsAgreementParticipant().has_object_permission(request, self, ag):
            return response.Response({"detail": "Forbidden"}, status=status.HTTP_403_FORBIDDEN)
        ok = email_signed_agreement(ag)
        return response.Response({"ok": bool(ok)})

    @decorators.action(detail=True, methods=["post"], url_path="sms")
    def sms(self, request, pk=None):
        ag = self._get_agreement(pk)
        if not IsAgreementParticipant().has_object_permission(request, self, ag):
            return response.Response({"detail": "Forbidden"}, status=status.HTTP_403_FORBIDDEN)
        base = getattr(settings, "FRONTEND_URL", None) or getattr(settings, "SITE_URL", None) or ""
        link = f"{base.rstrip('/')}/agreements/{ag.id}" if base else f"/agreements/{ag.id}"
        count = sms_link_to_parties(ag, link_url=link, note="Agreement link:")
        return response.Response({"ok": count > 0, "sent": count})

    @decorators.action(detail=True, methods=["post"], url_path="regenerate-pdf")
    def regenerate_pdf(self, request, pk=None):
        ag = self._get_agreement(pk)
        if not (request.user and request.user.is_authenticated and request.user.is_staff):
            return response.Response({"detail": "Admin only"}, status=status.HTTP_403_FORBIDDEN)

        new_version = (ag.pdf_version or 0) + 1 if hasattr(ag, "pdf_version") else 1
        if hasattr(ag, "pdf_version"):
            ag.pdf_version = new_version
            ag.save(update_fields=["pdf_version"])
        else:
            ag.save()

        pdf_bytes = _call_build_pdf_bytes(ag=ag, version_label=f"v{new_version}", is_preview=False)
        attach_pdf_to_agreement(ag, pdf_bytes, version=new_version)
        return response.Response({"ok": True, "version": new_version})
