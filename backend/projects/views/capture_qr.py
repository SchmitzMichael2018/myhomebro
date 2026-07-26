from __future__ import annotations

import hashlib
import json
import logging
import secrets
import time
from io import BytesIO

from PIL import Image, UnidentifiedImageError
from django.conf import settings
from django.core import signing
from django.core.files.base import ContentFile
from django.db import transaction
from django.db.models import Count
from django.http import HttpResponse
from django.utils import timezone
from rest_framework import status
from rest_framework.parsers import FormParser, JSONParser, MultiPartParser
from rest_framework.permissions import AllowAny, IsAuthenticated
from rest_framework.response import Response
from rest_framework.throttling import ScopedRateThrottle, SimpleRateThrottle
from rest_framework.views import APIView

from projects.models import (
    Capture, CaptureArtifact, CaptureEvent, CaptureQrAsset, CaptureQrEvent,
    CaptureQrSubmission, ContractorOpportunity, ContractorPublicProfile,
    Homeowner, Notification, PublicContractorLead,
)
from projects.serializers.capture_qr import CaptureQrAssetSerializer
from projects.services.capture_permissions import can_manage_qr_assets, can_view_qr_analytics
from projects.services.notification_center import create_notification
from projects.utils.accounts import get_contractor_for_user

logger = logging.getLogger(__name__)
FORM_SALT = "capture-qr-form-v1"


def _enabled(public=False):
    return bool(getattr(settings, "CAPTURE_QR_ENABLED", False)) and (
        not public or bool(getattr(settings, "CAPTURE_QR_PUBLIC_ENABLED", False))
    )


def _disabled(public=False):
    response = Response(
        {"detail": "This project form is unavailable." if public else "Capture QR is not enabled.",
         "code": "capture_qr_disabled"},
        status=status.HTTP_404_NOT_FOUND,
    )
    if public:
        response["Cache-Control"] = "no-store"
    return response


def _asset_for_user(request, asset_id):
    contractor = get_contractor_for_user(request.user)
    if not contractor:
        return None
    return CaptureQrAsset.objects.select_related("profile").filter(
        contractor=contractor, pk=asset_id
    ).first()


def _public_asset(token):
    token_hash = hashlib.sha256(str(token).encode()).hexdigest()
    asset = CaptureQrAsset.objects.select_related("contractor", "profile").filter(
        token_hash=token_hash
    ).first()
    return asset if asset and asset.available else None


def _branding(asset):
    profile = asset.profile
    return {
        "business_name": (
            getattr(profile, "business_name_public", "")
            or asset.contractor.business_name
            or "Your contractor"
        ),
        "tagline": getattr(profile, "tagline", "") or "",
        "logo_url": profile.logo.url if profile and profile.logo else "",
        "primary_color": getattr(profile, "brand_primary_color", "") or "#0f4c81",
    }


def _form_token(asset):
    return signing.dumps(
        {
            "asset": str(asset.id),
            "nonce": secrets.token_urlsafe(24),
            "started_at": time.time(),
        },
        salt=FORM_SALT,
        compress=True,
    )


def _validate_form_token(asset, token):
    try:
        payload = signing.loads(token, salt=FORM_SALT, max_age=3600)
        if payload.get("asset") != str(asset.id):
            return False, "invalid"
        minimum = int(getattr(settings, "CAPTURE_QR_MIN_COMPLETION_SECONDS", 2))
        if time.time() - float(payload.get("started_at") or 0) < minimum:
            return False, "too_fast"
        return True, ""
    except signing.BadSignature:
        return False, "invalid"


def _safe_image(upload):
    max_bytes = int(getattr(settings, "CAPTURE_QR_MAX_PHOTO_SIZE_MB", 8)) * 1024 * 1024
    if upload.size > max_bytes:
        raise ValueError("Each photo must be within the upload size limit.")
    try:
        image = Image.open(upload)
        image.verify()
        upload.seek(0)
        image = Image.open(upload)
        if image.format not in {"JPEG", "PNG", "WEBP"}:
            raise ValueError
        image = image.convert("RGB")
        output = BytesIO()
        image.save(output, format="JPEG", quality=88, optimize=True)
    except (UnidentifiedImageError, OSError, ValueError):
        raise ValueError("Choose a valid JPG, PNG, or WebP image.")
    data = output.getvalue()
    return ContentFile(data, name=f"{secrets.token_hex(8)}.jpg"), hashlib.sha256(data).hexdigest()


class CaptureQrAssetListView(APIView):
    permission_classes = [IsAuthenticated]

    def get(self, request):
        if not _enabled():
            return _disabled()
        if not can_manage_qr_assets(request.user):
            return Response({"detail": "Permission denied."}, status=403)
        contractor = get_contractor_for_user(request.user)
        rows = CaptureQrAsset.objects.filter(contractor=contractor).select_related("profile")
        return Response({"results": CaptureQrAssetSerializer(rows, many=True, context={"request": request}).data})

    def post(self, request):
        if not _enabled():
            return _disabled()
        if not can_manage_qr_assets(request.user):
            return Response({"detail": "Permission denied."}, status=403)
        contractor = get_contractor_for_user(request.user)
        profile, _ = ContractorPublicProfile.objects.get_or_create(
            contractor=contractor,
            defaults={"business_name_public": contractor.business_name or ""},
        )
        serializer = CaptureQrAssetSerializer(data=request.data, context={"request": request})
        serializer.is_valid(raise_exception=True)
        asset = serializer.save(
            contractor=contractor, created_by=request.user, profile=profile
        )
        return Response(CaptureQrAssetSerializer(asset, context={"request": request}).data, status=201)


class CaptureQrAssetDetailView(APIView):
    permission_classes = [IsAuthenticated]

    def get(self, request, asset_id):
        if not _enabled():
            return _disabled()
        asset = _asset_for_user(request, asset_id)
        if not asset or not can_manage_qr_assets(request.user):
            return Response({"detail": "QR asset not found."}, status=404)
        return Response(CaptureQrAssetSerializer(asset, context={"request": request}).data)

    def patch(self, request, asset_id):
        if not _enabled():
            return _disabled()
        asset = _asset_for_user(request, asset_id)
        if not asset or not can_manage_qr_assets(request.user):
            return Response({"detail": "QR asset not found."}, status=404)
        serializer = CaptureQrAssetSerializer(asset, data=request.data, partial=True, context={"request": request})
        serializer.is_valid(raise_exception=True)
        serializer.save()
        return Response(serializer.data)


class CaptureQrAssetActionView(APIView):
    permission_classes = [IsAuthenticated]

    def post(self, request, asset_id, action):
        if not _enabled():
            return _disabled()
        asset = _asset_for_user(request, asset_id)
        if not asset or not can_manage_qr_assets(request.user):
            return Response({"detail": "QR asset not found."}, status=404)
        if action == "revoke":
            asset.active = False
            asset.revoked_at = timezone.now()
        elif asset.revoked_at:
            return Response({"detail": "A revoked QR asset cannot be changed."}, status=400)
        elif action == "rotate":
            asset.rotate_key()
        elif action == "activate":
            asset.active = True
        elif action == "deactivate":
            asset.active = False
        else:
            return Response({"detail": "Unsupported action."}, status=400)
        asset.save()
        CaptureQrEvent.objects.create(asset=asset, event_type=action + "d" if action != "deactivate" else "deactivated", actor=request.user)
        return Response(CaptureQrAssetSerializer(asset, context={"request": request}).data)


class CaptureQrAssetQrView(APIView):
    permission_classes = [IsAuthenticated]

    def get(self, request, asset_id):
        import qrcode
        import qrcode.image.svg

        if not _enabled():
            return _disabled()
        asset = _asset_for_user(request, asset_id)
        if not asset or not can_manage_qr_assets(request.user):
            return Response({"detail": "QR asset not found."}, status=404)
        target = request.build_absolute_uri(f"/c/{asset.token_key}")
        image = qrcode.make(target, image_factory=qrcode.image.svg.SvgPathImage)
        stream = BytesIO()
        image.save(stream)
        response = HttpResponse(stream.getvalue(), content_type="image/svg+xml")
        response["Content-Disposition"] = f'attachment; filename="{asset.label[:60]}-qr.svg"'
        response["Cache-Control"] = "private, no-store"
        return response


class CaptureQrAssetAnalyticsView(APIView):
    permission_classes = [IsAuthenticated]

    def get(self, request, asset_id):
        if not _enabled():
            return _disabled()
        asset = _asset_for_user(request, asset_id)
        if not asset or not can_view_qr_analytics(request.user):
            return Response({"detail": "QR asset not found."}, status=404)
        counts = dict(asset.events.values_list("event_type").annotate(total=Count("id")))
        submissions = asset.captures.count()
        reviewed = asset.captures.exclude(status__in=[Capture.STATUS_SAVED, Capture.STATUS_PROCESSING]).count()
        applied = asset.captures.filter(status=Capture.STATUS_APPLIED).count()
        opportunities = ContractorOpportunity.objects.filter(origin_capture__qr_asset=asset).count()
        views = counts.get(CaptureQrEvent.EVENT_VIEWED, 0)
        return Response({
            "views": views, "submissions": submissions,
            "submission_rate": round((submissions / views * 100), 1) if views else 0,
            "reviewed": reviewed, "applied": applied, "opportunities_created": opportunities,
        })


class CaptureQrTokenThrottle(SimpleRateThrottle):
    scope = "capture_qr_token"

    def get_cache_key(self, request, view):
        token = str(view.kwargs.get("token") or "")
        if not token:
            return None
        token_hash = hashlib.sha256(token.encode()).hexdigest()
        return self.cache_format % {"scope": self.scope, "ident": token_hash}


class PublicCaptureQrView(APIView):
    permission_classes = [AllowAny]
    authentication_classes = []
    throttle_classes = [ScopedRateThrottle, CaptureQrTokenThrottle]
    throttle_scope = "capture_qr_public"
    parser_classes = [MultiPartParser, FormParser, JSONParser]

    def get(self, request, token):
        if not _enabled(public=True):
            return _disabled(public=True)
        asset = _public_asset(token)
        if not asset:
            return _disabled(public=True)
        CaptureQrEvent.objects.create(asset=asset, event_type=CaptureQrEvent.EVENT_VIEWED)
        response = Response({
            "branding": _branding(asset),
            "form_token": _form_token(asset),
            "asset_label": asset.label,
            "privacy_url": "/legal/privacy-policy/",
        })
        response["Cache-Control"] = "no-store"
        return response

    def post(self, request, token):
        if not _enabled(public=True):
            return _disabled(public=True)
        asset = _public_asset(token)
        if not asset:
            return _disabled(public=True)
        if str(request.data.get("website") or "").strip():
            logger.warning("capture_qr_honeypot_blocked asset=%s", asset.id)
            return Response({"detail": "Submission could not be accepted."}, status=400)
        form_token = str(request.data.get("form_token") or "")
        valid, _ = _validate_form_token(asset, form_token)
        if not valid:
            return Response({"detail": "Refresh the form and try again."}, status=400)
        name = str(request.data.get("name") or "").strip()[:255]
        email = str(request.data.get("email") or "").strip().lower()[:254]
        phone = str(request.data.get("phone") or "").strip()[:40]
        description = str(request.data.get("project_description") or "").strip()[:5000]
        zip_code = str(request.data.get("zip_code") or "").strip()[:20]
        preferred = str(request.data.get("preferred_contact_method") or "").strip()[:32]
        consent = str(request.data.get("contact_consent") or "").lower() in {"1", "true", "yes", "on"}
        if not name:
            return Response({"name": ["Name is required."]}, status=400)
        if not email and not phone:
            return Response({"contact": ["Add a phone number or email address."]}, status=400)
        if email and "@" not in email:
            return Response({"email": ["Enter a valid email address."]}, status=400)
        if len(description) < 10:
            return Response({"project_description": ["Tell us a little more about the project."]}, status=400)
        photos = request.FILES.getlist("photos")
        if len(photos) > int(getattr(settings, "CAPTURE_QR_MAX_PHOTOS", 3)):
            return Response({"photos": ["Too many photos were selected."]}, status=400)
        safe_photos = []
        try:
            for photo in photos:
                safe_photos.append(_safe_image(photo))
        except ValueError as exc:
            return Response({"photos": [str(exc)]}, status=400)
        canonical = {
            "name": name, "email": email, "phone": phone,
            "project_description": description, "zip_code": zip_code,
            "preferred_contact_method": preferred,
            "contact_consent": consent,
            "photo_checksums": [checksum for _, checksum in safe_photos],
        }
        payload_hash = hashlib.sha256(json.dumps(canonical, sort_keys=True).encode()).hexdigest()
        form_hash = hashlib.sha256(form_token.encode()).hexdigest()
        existing = CaptureQrSubmission.objects.filter(asset=asset, form_token_hash=form_hash).first()
        if existing:
            if existing.payload_hash != payload_hash:
                return Response({"detail": "This form was already submitted with different information."}, status=409)
            return Response({"ok": True, "message": "Your project information has been sent."})
        with transaction.atomic():
            capture = Capture.objects.create(
                contractor=asset.contractor,
                capture_type=Capture.TYPE_QUICK_LEAD,
                status=Capture.STATUS_SAVED,
                capture_method=Capture.METHOD_PUBLIC_FORM,
                source_category="qr",
                source_detail=asset.source_detail,
                qr_asset=asset,
                raw_text_payload={
                    "name": name, "email": email, "phone": phone,
                    "text": description,
                    "input_metadata": {
                        "zip_code": zip_code,
                        "preferred_contact_method": preferred,
                        "contact_consent": consent,
                    },
                },
                attribution_metadata={
                    "campaign": asset.campaign_key,
                    "utm_source": "qr",
                    "utm_medium": asset.asset_type,
                },
            )
            CaptureEvent.objects.create(
                capture=capture, event_type="created", to_status=Capture.STATUS_SAVED,
                metadata={"source_category": "qr", "qr_asset_label": asset.label},
            )
            lead = PublicContractorLead.objects.create(
                contractor=asset.contractor, public_profile=asset.profile,
                source=PublicContractorLead.SOURCE_QR, full_name=name,
                email=email, phone=phone, zip_code=zip_code,
                project_description=description, origin_capture=capture, qr_asset=asset,
            )
            for file_value, checksum in safe_photos:
                CaptureArtifact.objects.create(
                    capture=capture, artifact_type=CaptureArtifact.TYPE_PHOTO,
                    file=file_value, original_filename=file_value.name,
                    mime_type="image/jpeg", file_size=file_value.size,
                    file_sha256=checksum,
                    sanitization_metadata={"exif_stripped": True},
                )
            CaptureQrSubmission.objects.create(
                asset=asset, form_token_hash=form_hash, payload_hash=payload_hash,
                capture=capture, public_lead=lead,
            )
            CaptureQrEvent.objects.create(
                asset=asset, event_type=CaptureQrEvent.EVENT_SUBMITTED,
                capture=capture, metadata={"photo_count": len(safe_photos)},
            )
            transaction.on_commit(lambda: create_notification(
                contractor=asset.contractor,
                category=Notification.EVENT_QUOTE_REQUEST_RECEIVED,
                title="New QR project interest",
                body=f"{name} sent project information from {asset.label}: {description[:120]}",
                link=f"/app/capture/{capture.id}",
                public_lead=lead,
                actor_display_name=name,
            ))
        logger.info("capture_qr_submitted asset=%s capture=%s", asset.id, capture.id)
        response = Response(
            {"ok": True, "message": "Your project information has been sent."},
            status=201,
        )
        response["Cache-Control"] = "no-store"
        return response
