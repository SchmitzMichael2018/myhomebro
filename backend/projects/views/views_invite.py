# backend/projects/views/views_invite.py
from django.db import transaction
from django.utils import timezone
from django.http import HttpResponse
from rest_framework import status, viewsets
from rest_framework.decorators import action
from rest_framework.permissions import AllowAny, IsAuthenticated
from rest_framework.response import Response

# ✅ FIX: import from the projects app root, not from the views package
from projects.models import Homeowner, HomeownerStatus
from projects.models_invite import ContractorInvite
from projects.serializers_invite import (
    ContractorInviteCreateSerializer,
    ContractorInviteReadSerializer,
)

from projects.services.invites_delivery import (
    deliver_invite_notifications,
    deliver_homeowner_confirmation,
)


def _get_contractor_for_user(user):
    return getattr(user, "contractor_profile", None)


def _too_soon(invite: ContractorInvite, seconds: int = 60) -> bool:
    """
    Basic resend rate limit: require `seconds` between successful sends.
    """
    if not invite.last_sent_at:
        return False
    delta = timezone.now() - invite.last_sent_at
    return delta.total_seconds() < seconds


class ContractorInviteViewSet(viewsets.GenericViewSet):
    """
    Mounted under /api/projects/ via core/urls.py

    Routes:
      POST /api/projects/invites/                          (public) create invite + send contractor email/SMS + homeowner confirmation email
      GET  /api/projects/invites/<token>/                  (public) read invite
      GET  /api/projects/invites/<token>/resend/<rtoken>/  (public) homeowner resend (secure token)
      POST /api/projects/invites/<token>/accept/           (auth)   contractor accepts + import homeowner
    """

    queryset = ContractorInvite.objects.all()
    lookup_field = "token"

    def get_permissions(self):
        if self.action in ["create", "retrieve", "resend"]:
            return [AllowAny()]
        if self.action in ["accept"]:
            return [IsAuthenticated()]
        return [IsAuthenticated()]

    def get_serializer_class(self):
        if self.action == "create":
            return ContractorInviteCreateSerializer
        return ContractorInviteReadSerializer

    def create(self, request, *args, **kwargs):
        ser = self.get_serializer(data=request.data)
        ser.is_valid(raise_exception=True)
        invite: ContractorInvite = ser.save()

        # Send contractor invite (best-effort)
        contractor_delivery = deliver_invite_notifications(request=request, invite=invite)

        # If contractor delivery succeeded (email or sms), track send time/count
        try:
            if contractor_delivery.get("email", {}).get("ok") or contractor_delivery.get("sms", {}).get("ok"):
                invite.mark_sent()
        except Exception:
            pass

        # Send homeowner confirmation (best-effort)
        homeowner_delivery = deliver_homeowner_confirmation(request=request, invite=invite)

        out = ContractorInviteReadSerializer(invite).data
        out["invite_url"] = contractor_delivery.get("invite_url")
        out["delivery"] = {
            "contractor": contractor_delivery,
            "homeowner": homeowner_delivery,
        }
        return Response(out, status=status.HTTP_201_CREATED)

    def retrieve(self, request, *args, **kwargs):
        invite = self.get_object()
        out = ContractorInviteReadSerializer(invite).data
        return Response(out, status=status.HTTP_200_OK)

    @action(detail=True, methods=["get"], url_path=r"resend/(?P<resend_token>[^/.]+)")
    def resend(self, request, token=None, resend_token=None):
        invite: ContractorInvite = self.get_object()

        # Validate resend token (homeowner proof)
        if str(invite.resend_token) != str(resend_token):
            return HttpResponse("Invalid resend link.", status=403, content_type="text/plain")

        # If already accepted, don't keep resending
        if invite.is_accepted:
            return HttpResponse("This invite has already been accepted. You can close this window.", status=200)

        # Rate limit
        if _too_soon(invite, seconds=60):
            return HttpResponse("Please wait a moment before resending again.", status=429)

        contractor_delivery = deliver_invite_notifications(request=request, invite=invite)

        # Track send if success
        try:
            if contractor_delivery.get("email", {}).get("ok") or contractor_delivery.get("sms", {}).get("ok"):
                invite.mark_sent()
        except Exception:
            pass

        return HttpResponse("Invite resent successfully. You can close this window.", status=200)

    @action(detail=True, methods=["post"], url_path="accept")
    def accept(self, request, token=None):
        contractor = _get_contractor_for_user(request.user)
        if not contractor:
            return Response({"detail": "Only contractors can accept invites."}, status=status.HTTP_403_FORBIDDEN)

        invite: ContractorInvite = self.get_object()
        source_intake = getattr(invite, "source_intake", None)
        # Idempotency: if already accepted, OK if same contractor
        if invite.is_accepted:
            if invite.accepted_by_contractor_id == contractor.id:
                return Response(
                    {
                        "ok": True,
                        "message": "Invite already accepted.",
                        "source_intake_id": getattr(source_intake, "id", None),
                        "source_intake_url": (
                            f"/app/intake/new?intakeId={source_intake.id}" if source_intake else ""
                        ),
                    },
                    status=status.HTTP_200_OK,
                )
            return Response({"detail": "Invite already accepted by another contractor."}, status=status.HTTP_409_CONFLICT)

        homeowner_email = (invite.homeowner_email or "").strip().lower()

        with transaction.atomic():
            if source_intake is not None:
                if source_intake.contractor_id and source_intake.contractor_id != contractor.id:
                    return Response(
                        {"detail": "This intake has already been assigned to another contractor."},
                        status=status.HTTP_409_CONFLICT,
                    )
                if source_intake.contractor_id != contractor.id:
                    source_intake.contractor = contractor
                    source_intake.save(update_fields=["contractor", "updated_at"])

            invite.accepted_by_contractor = contractor
            invite.accepted_at = timezone.now()
            invite.save(update_fields=["accepted_by_contractor", "accepted_at"])

            # Email can be reused across contractors (match by created_by + email)
            existing = Homeowner.objects.filter(created_by=contractor, email=homeowner_email).first()

            if existing:
                if not (existing.full_name or "").strip():
                    existing.full_name = (invite.homeowner_name or "").strip()
                if not (existing.phone_number or "").strip() and invite.homeowner_phone:
                    existing.phone_number = invite.homeowner_phone.strip()
                if not existing.status:
                    existing.status = HomeownerStatus.PROSPECT
                existing.save()
                homeowner = existing
            else:
                homeowner = Homeowner.objects.create(
                    created_by=contractor,
                    full_name=(invite.homeowner_name or "").strip(),
                    email=homeowner_email,
                    phone_number=(invite.homeowner_phone or "").strip(),
                    street_address="",
                    address_line_2="",
                    city="",
                    state="",
                    zip_code="",
                    status=HomeownerStatus.PROSPECT,
                )

            # ✅ tiny safety: persist accepted_by_contractor_id too if your model uses it
            try:
                if hasattr(invite, "accepted_by_contractor_id") and not invite.accepted_by_contractor_id:
                    invite.accepted_by_contractor_id = contractor.id
                    invite.save(update_fields=["accepted_by_contractor_id"])
            except Exception:
                pass

        return Response(
            {
                "ok": True,
                "client_id": homeowner.id,
                "client_name": homeowner.full_name,
                "source_intake_id": getattr(source_intake, "id", None),
                "source_intake_url": (
                    f"/app/intake/new?intakeId={source_intake.id}" if source_intake else ""
                ),
            },
            status=status.HTTP_200_OK,
        )
