from rest_framework.views import APIView
from rest_framework.response import Response
from rest_framework.permissions import IsAuthenticated

from projects.models import Notification
from projects.serializers.notifications import NotificationSerializer
from projects.utils.accounts import get_contractor_for_user


class NotificationListView(APIView):
    permission_classes = [IsAuthenticated]

    def get(self, request):
        contractor = get_contractor_for_user(request.user)
        if contractor is None:
            return Response([])

        rows = (
            Notification.objects.select_related(
                "agreement",
                "agreement__project",
                "milestone",
                "draw_request",
                "public_lead",
            )
            .filter(contractor=contractor)
            .order_by("-created_at", "-id")[:20]
        )
        return Response(NotificationSerializer(rows, many=True).data)
