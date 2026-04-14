from __future__ import annotations

import logging

from django.db import transaction
from django.shortcuts import get_object_or_404
from django.utils import timezone
from rest_framework.response import Response
from rest_framework.views import APIView

from projects.models import DrawRequest, DrawRequestStatus
from projects.services.draw_notifications import create_draw_lifecycle_notification
from projects.services.draw_requests import create_direct_checkout_for_draw, create_draw_activity_notification
from projects.views.draw_requests import _serialize_draw

logger = logging.getLogger(__name__)


class MagicDrawRequestView(APIView):
    permission_classes = []

    def get(self, request, token=None):
        draw = get_object_or_404(
            DrawRequest.objects.select_related(
                "agreement",
                "agreement__project",
                "agreement__contractor",
                "agreement__homeowner",
            ).prefetch_related("line_items__milestone", "external_payment_records"),
            public_token=token,
        )
        if not getattr(draw, "homeowner_viewed_at", None):
            try:
                draw.homeowner_viewed_at = timezone.now()
                draw.save(update_fields=["homeowner_viewed_at", "updated_at"])
            except Exception:
                logger.warning("Unable to stamp homeowner_viewed_at for draw %s", getattr(draw, "id", None))
        payload = _serialize_draw(draw)
        payload["project_class"] = getattr(draw.agreement, "project_class", "")
        payload["contractor_name"] = (
            getattr(draw.agreement.contractor, "business_name", "")
            or getattr(draw.agreement.contractor, "name", "")
            or "Contractor"
        )
        payload["customer_name"] = getattr(draw.agreement.homeowner, "full_name", "") or "Customer"
        return Response(payload)


class MagicDrawRequestApproveView(APIView):
    permission_classes = []

    def patch(self, request, token=None):
        with transaction.atomic():
            draw = get_object_or_404(
                DrawRequest.objects.select_for_update().select_related(
                    "agreement",
                    "agreement__project",
                    "agreement__contractor",
                    "agreement__homeowner",
                ),
                public_token=token,
            )

            if draw.status == DrawRequestStatus.PAID or getattr(draw, "paid_at", None):
                payload = _serialize_draw(draw)
                payload["mode"] = "paid"
                return Response(payload)

            if draw.status not in {DrawRequestStatus.SUBMITTED, DrawRequestStatus.APPROVED}:
                return Response(
                    {"detail": f"Draw cannot be approved from status {draw.status}."},
                    status=400,
                )

            draw.status = DrawRequestStatus.APPROVED
            draw.reviewed_at = draw.reviewed_at or timezone.now()
            draw.homeowner_acted_at = timezone.now()
            draw.save(update_fields=["status", "reviewed_at", "homeowner_acted_at", "updated_at"])

        agreement = draw.agreement
        if str(getattr(agreement, "payment_mode", "") or "").lower() == "direct":
            try:
                checkout_url = create_direct_checkout_for_draw(draw)
            except Exception as exc:
                return Response({"detail": str(exc)}, status=400)
            draw.refresh_from_db()
            create_draw_activity_notification(
                draw,
                event_type="draw_payment_pending",
                title=f"Draw {draw.draw_number} approved",
                summary="The owner approved this draw. Payment is now pending through MyHomeBro.",
                severity="success",
                dedupe_key=f"draw_payment_pending:{draw.id}",
            )
            create_draw_lifecycle_notification(draw, event_type="draw_approved")
            payload = _serialize_draw(draw)
            payload["mode"] = "direct_checkout"
            payload["checkout_url"] = checkout_url
            return Response(payload)

        draw.refresh_from_db()
        create_draw_activity_notification(
            draw,
            event_type="draw_approved",
            title=f"Draw {draw.draw_number} approved",
            summary="The owner approved this draw. Release and payment handling can continue from here.",
            severity="success",
            dedupe_key=f"draw_approved:{draw.id}",
        )
        create_draw_lifecycle_notification(draw, event_type="draw_approved")
        payload = _serialize_draw(draw)
        payload["mode"] = "escrow_review"
        payload["detail"] = "Draw approved. Escrow release stays separate and can be handled later."
        return Response(payload)


class MagicDrawRequestChangesView(APIView):
    permission_classes = []

    def patch(self, request, token=None):
        note = str((request.data or {}).get("note") or (request.data or {}).get("reason") or "").strip()
        with transaction.atomic():
            draw = get_object_or_404(
                DrawRequest.objects.select_for_update().select_related("agreement"),
                public_token=token,
            )
            if draw.status not in {DrawRequestStatus.SUBMITTED, DrawRequestStatus.APPROVED}:
                return Response(
                    {"detail": f"Draw cannot request changes from status {draw.status}."},
                    status=400,
                )
            draw.status = DrawRequestStatus.CHANGES_REQUESTED
            draw.reviewed_at = timezone.now()
            draw.homeowner_acted_at = timezone.now()
            draw.homeowner_review_notes = note
            draw.save(
                update_fields=[
                    "status",
                    "reviewed_at",
                    "homeowner_acted_at",
                    "homeowner_review_notes",
                    "updated_at",
                ]
            )
        draw = DrawRequest.objects.prefetch_related("line_items__milestone", "external_payment_records").select_related(
            "agreement", "agreement__project", "agreement__contractor", "agreement__homeowner"
        ).get(pk=draw.pk)
        create_draw_activity_notification(
            draw,
            event_type="draw_changes_requested",
            title=f"Changes requested for Draw {draw.draw_number}",
            summary="The owner asked for updates before this draw moves forward.",
            severity="warning",
            dedupe_key=f"draw_changes_requested:{draw.id}:{draw.reviewed_at.isoformat() if draw.reviewed_at else ''}",
        )
        create_draw_lifecycle_notification(draw, event_type="draw_changes_requested")
        payload = _serialize_draw(draw)
        payload["mode"] = "changes_requested"
        return Response(payload)
