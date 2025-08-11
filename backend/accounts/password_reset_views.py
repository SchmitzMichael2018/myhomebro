# accounts/password_reset_views.py
from rest_framework import status, serializers
from rest_framework.response import Response
from rest_framework.views import APIView
from django.utils.http import urlsafe_base64_encode, urlsafe_base64_decode
from django.contrib.auth.tokens import default_token_generator
from django.contrib.auth import get_user_model
from django.core.mail import send_mail
from django.conf import settings

User = get_user_model()

# --- Serializers for Validation ---

class PasswordResetRequestSerializer(serializers.Serializer):
    email = serializers.EmailField(required=True)

class PasswordResetConfirmSerializer(serializers.Serializer):
    new_password = serializers.CharField(required=True, write_only=True)

# --- Updated Views ---

class PasswordResetRequestView(APIView):
    def post(self, request):
        serializer = PasswordResetRequestSerializer(data=request.data)
        if not serializer.is_valid():
            return Response(serializer.errors, status=status.HTTP_400_BAD_REQUEST)
        
        email = serializer.validated_data['email']
        try:
            user = User.objects.get(email=email)
            uid = urlsafe_base64_encode(str(user.pk).encode()).decode()
            token = default_token_generator.make_token(user)
            # This URL should point to your frontend application's reset page
            reset_url = f"{settings.FRONTEND_URL}/password-reset/confirm/?uid={uid}&token={token}"
            
            send_mail(
                "Password Reset - MyHomeBro",
                f"Click here to reset your password: {reset_url}",
                settings.DEFAULT_FROM_EMAIL,
                [email],
                fail_silently=False,
            )
            return Response({"message": "Password reset link sent to your email."})
        except User.DoesNotExist:
            # Return a generic message to avoid confirming if an email exists or not
            return Response({"message": "If an account with that email exists, a password reset link has been sent."})

class PasswordResetConfirmView(APIView):
    def post(self, request, uidb64, token):
        serializer = PasswordResetConfirmSerializer(data=request.data)
        if not serializer.is_valid():
            return Response(serializer.errors, status=status.HTTP_400_BAD_REQUEST)
            
        try:
            uid = urlsafe_base64_decode(uidb64).decode()
            user = User.objects.get(pk=uid)
            if default_token_generator.check_token(user, token):
                user.set_password(serializer.validated_data["new_password"])
                user.save()
                return Response({"message": "Password has been reset successfully."})
            
            return Response({"error": "Invalid or expired token."}, status=status.HTTP_400_BAD_REQUEST)
        except (TypeError, ValueError, OverflowError, User.DoesNotExist):
            return Response({"error": "Invalid reset link."}, status=status.HTTP_400_BAD_REQUEST)

# This view is often not needed if the frontend handles the "complete" page
class PasswordResetCompleteView(APIView):
    def get(self, request):
        return Response({"message": "Password reset process is complete. You can now log in with your new password."})