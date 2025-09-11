# backend/backend/projects/views/account.py
from django.contrib.auth.password_validation import validate_password
from django.core.exceptions import ValidationError
from django.contrib.auth import update_session_auth_hash
from rest_framework.views import APIView
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework import status

class ChangePasswordView(APIView):
    """
    POST /api/projects/account/change-password/
    { "old_password": "...", "new_password": "...", "new_password_confirm": "..." }
    """
    permission_classes = [IsAuthenticated]

    def post(self, request):
        old_pw = (request.data.get("old_password") or "").strip()
        new_pw = (request.data.get("new_password") or "").strip()
        new_pw2 = (request.data.get("new_password_confirm") or "").strip()

        if not request.user.check_password(old_pw):
            return Response({"detail": "Incorrect current password."}, status=status.HTTP_400_BAD_REQUEST)
        if new_pw != new_pw2:
            return Response({"detail": "New password confirmation does not match."}, status=status.HTTP_400_BAD_REQUEST)

        try:
            validate_password(new_pw, user=request.user)
        except ValidationError as ve:
            return Response({"errors": ve.messages}, status=status.HTTP_400_BAD_REQUEST)

        request.user.set_password(new_pw)
        request.user.save(update_fields=["password"])
        # keep the user logged in after password change
        update_session_auth_hash(request, request.user)

        return Response({"status": "ok"}, status=status.HTTP_200_OK)
