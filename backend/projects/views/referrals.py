from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework import status
from rest_framework.views import APIView

from projects.services.referrals import referral_dashboard
from projects.models_referrals import ReferralInvitation
from projects.services.referrals import participant_for_user


class ReferralDashboardView(APIView):
    permission_classes = [IsAuthenticated]

    def get(self, request):
        return Response(referral_dashboard(request.user, request=request))

    def post(self, request):
        channel = str(request.data.get("channel") or "").strip().lower()
        valid_channels = {value for value, _label in ReferralInvitation.CHANNEL_CHOICES}
        if channel not in valid_channels:
            return Response({"channel": ["Choose a valid sharing channel."]}, status=status.HTTP_400_BAD_REQUEST)
        ReferralInvitation.objects.create(participant=participant_for_user(request.user), channel=channel)
        return Response({"recorded": True}, status=status.HTTP_201_CREATED)
