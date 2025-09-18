# backend/projects/views/signing.py
from django.utils import timezone
from django.shortcuts import get_object_or_404
from django.conf import settings
from rest_framework import viewsets, permissions, response, status, decorators

from projects.models import Agreement
from projects.serializers.signing import (
    AgreementReviewSerializer,
    AgreementSignSerializer,
    AgreementPreviewSerializer,
    AgreementReviewedSerializer,
)
from projects.services.pdf import build_agreement_pdf_bytes, attach_pdf_to_agreement
from projects.services.mailer import email_signed_agreement
from projects.services.sms import sms_link_to_parties  # safe: no-op if not configured
import base64

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

        pdf_bytes = build_agreement_pdf_bytes(
            ag,
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
            ag.save(update_fields=["reviewed_at", "reviewed_by"] if hasattr(ag, "reviewed_by") else ["reviewed_at"])

        return response.Response({"ok": True, "reviewed_at": getattr(ag, "reviewed_at", None)})

    @decorators.action(detail=True, methods=["post"], url_path="sign")
    def sign(self, request, pk=None):
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
        signer_role = payload.get("signer_role")
        signature_text = payload.get("signature_text", "")

        new_version = (ag.pdf_version or 0) + 1 if hasattr(ag, "pdf_version") else 1
        if hasattr(ag, "pdf_version"):
            ag.pdf_version = new_version

        if hasattr(ag, "last_signed_at"):
            ag.last_signed_at = timezone.now()
        if hasattr(ag, "last_signed_by"):
            ag.last_signed_by = signer_role
        if hasattr(ag, "signature_note"):
            ag.signature_note = f"{signer_role} {signer_name} accepted ToS/Privacy; text: {signature_text[:60]}"

        ag.save()

        ip = request.META.get("REMOTE_ADDR", "")
        ua = request.META.get("HTTP_USER_AGENT", "")
        version_label = f"v{new_version}"
        pdf_bytes = build_agreement_pdf_bytes(
            ag,
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

        email_signed_agreement(ag)

        try:
            base = getattr(settings, "FRONTEND_URL", None) or getattr(settings, "SITE_URL", None) or ""
            link = f"{base.rstrip('/')}/agreements/{ag.id}" if base else f"/agreements/{ag.id}"
            sms_link_to_parties(ag, link_url=link, note="Signed. View your PDF:")
        except Exception:
            pass

        return response.Response({"ok": True, "version": new_version})

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
        pdf_bytes = build_agreement_pdf_bytes(ag, version_label=f"v{new_version}")
        attach_pdf_to_agreement(ag, pdf_bytes, version=new_version)
        return response.Response({"ok": True, "version": new_version})
