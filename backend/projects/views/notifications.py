# projects/views/notifications.py

from rest_framework.views import APIView
from rest_framework.response import Response
from rest_framework.permissions import IsAuthenticated

class NotificationListView(APIView):
    permission_classes = [IsAuthenticated]

    def get(self, request):
        # For now, return an empty list or add logic to fetch real notifications.
        return Response([])
