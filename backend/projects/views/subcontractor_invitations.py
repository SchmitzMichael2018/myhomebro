from __future__ import annotations

from django.shortcuts import get_object_or_404
from django.db import transaction
from rest_framework import status
from rest_framework.permissions import AllowAny, IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

from projects.models import Agreement
from projects.models_subcontractor import (
    SubcontractorInvitation,
    SubcontractorInvitationStatus,
)
from projects.serializers.subcontractor_invitations import (
    SubcontractorInvitationCreateSerializer,
)
from projects.services.agreements.project_create import resolve_contractor_for_user
from projects.services.subcontractor_invitations import (
    normalize_email,
    send_subcontractor_invitation_email,
    serialize_acceptance_payload,
    serialize_invitation_summary,
)


def _get_owned_agreement(*, user, agreement_id: int) -> tuple[Agreement, object]:
    contractor = resolve_contractor_for_user(user)
    if contractor is None:
        raise PermissionError("Only contractors can manage subcontractor invitations.")
    agreement = get_object_or_404(
        Agreement.objects.select_related("project", "contractor"),
        pk=agreement_id,
        project__contractor=contractor,
    )
    return agreement, contractor


class AgreementSubcontractorInvitationsView(APIView):
    permission_classes = [IsAuthenticated]

    def get(self, request, agreement_id: int):
        try:
            agreement, contractor = _get_owned_agreement(user=request.user, agreement_id=agreement_id)
        except PermissionError as exc:
            return Response({"detail": str(exc)}, status=status.HTTP_403_FORBIDDEN)

        invitations = list(
            SubcontractorInvitation.objects.filter(agreement=agreement, contractor=contractor)
            .select_related("accepted_by_user")
            .order_by("-invited_at", "-id")
        )
        pending = []
        accepted = []
        for invitation in invitations:
            invitation.refresh_expired_status()
            row = serialize_invitation_summary(invitation, request=request)
            if invitation.status == SubcontractorInvitationStatus.ACCEPTED:
                accepted.append(row)
            elif invitation.status == SubcontractorInvitationStatus.PENDING:
                pending.append(row)

        return Response(
            {
                "agreement_id": agreement.id,
                "pending_invitations": pending,
                "accepted_subcontractors": accepted,
            }
        )

    def post(self, request, agreement_id: int):
        try:
            agreement, contractor = _get_owned_agreement(user=request.user, agreement_id=agreement_id)
        except PermissionError as exc:
            return Response({"detail": str(exc)}, status=status.HTTP_403_FORBIDDEN)

        serializer = SubcontractorInvitationCreateSerializer(
            data=request.data,
            context={"agreement": agreement, "contractor": contractor},
        )
        serializer.is_valid(raise_exception=True)
        invitation = SubcontractorInvitation.objects.create(
            agreement=agreement,
            contractor=contractor,
            **serializer.validated_data,
        )
        delivery = send_subcontractor_invitation_email(request=request, invitation=invitation)
        payload = serialize_invitation_summary(invitation, request=request)
        payload["delivery"] = delivery
        return Response(payload, status=status.HTTP_201_CREATED)


class RevokeSubcontractorInvitationView(APIView):
    permission_classes = [IsAuthenticated]

    def post(self, request, agreement_id: int, invitation_id: int):
        try:
            agreement, contractor = _get_owned_agreement(user=request.user, agreement_id=agreement_id)
        except PermissionError as exc:
            return Response({"detail": str(exc)}, status=status.HTTP_403_FORBIDDEN)

        invitation = get_object_or_404(
            SubcontractorInvitation,
            pk=invitation_id,
            agreement=agreement,
            contractor=contractor,
        )
        invitation.refresh_expired_status()
        if invitation.status != SubcontractorInvitationStatus.PENDING:
            return Response(
                {"detail": "Only pending invitations can be revoked."},
                status=status.HTTP_400_BAD_REQUEST,
            )
        invitation.mark_revoked()
        return Response(serialize_invitation_summary(invitation, request=request))


class SubcontractorInvitationAcceptView(APIView):
    permission_classes = [AllowAny]

    def get_object(self, token: str) -> SubcontractorInvitation:
        invitation = get_object_or_404(
            SubcontractorInvitation.objects.select_related("agreement__project", "contractor", "accepted_by_user"),
            token=token,
        )
        invitation.refresh_expired_status()
        return invitation

    def get(self, request, token: str):
        invitation = self.get_object(token)
        return Response(
            serialize_acceptance_payload(
                invitation,
                request=request,
                user=request.user if getattr(request.user, "is_authenticated", False) else None,
            )
        )

    def post(self, request, token: str):
        invitation = self.get_object(token)
        if not getattr(request.user, "is_authenticated", False):
            return Response({"detail": "Authentication required."}, status=status.HTTP_401_UNAUTHORIZED)

        if invitation.status == SubcontractorInvitationStatus.REVOKED:
            return Response({"detail": "This invitation has been revoked."}, status=status.HTTP_400_BAD_REQUEST)
        if invitation.status == SubcontractorInvitationStatus.EXPIRED:
            return Response({"detail": "This invitation has expired."}, status=status.HTTP_400_BAD_REQUEST)
        if invitation.status == SubcontractorInvitationStatus.ACCEPTED:
            if invitation.accepted_by_user_id == request.user.id:
                return Response(
                    {
                        "ok": True,
                        "invitation": serialize_invitation_summary(invitation, request=request),
                    },
                    status=status.HTTP_200_OK,
                )
            return Response({"detail": "This invitation has already been accepted."}, status=status.HTTP_409_CONFLICT)

        invited_email = normalize_email(invitation.invite_email)
        current_email = normalize_email(getattr(request.user, "email", None))
        if invited_email and invited_email != current_email:
            return Response(
                {"detail": "Sign in with the invited email address to accept this invitation."},
                status=status.HTTP_403_FORBIDDEN,
            )

        with transaction.atomic():
            invitation.mark_accepted(user=request.user)

        return Response(
            {
                "ok": True,
                "invitation": serialize_invitation_summary(invitation, request=request),
            },
            status=status.HTTP_200_OK,
        )
