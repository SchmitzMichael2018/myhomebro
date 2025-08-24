# accounts/token_views.py
from django.contrib.auth import authenticate
from rest_framework import serializers
from rest_framework_simplejwt.serializers import TokenObtainPairSerializer
from rest_framework_simplejwt.views import TokenObtainPairView

class EmailTokenObtainPairSerializer(TokenObtainPairSerializer):
    username_field = "email"

    def validate(self, attrs):
        # Accept fallback "username" key too
        if "email" not in attrs and "username" in attrs:
            attrs["email"] = attrs["username"]

        data = super().validate(attrs)

        if not self.user.is_verified:
            raise serializers.ValidationError(
                "Account not verified. Please check your email for a verification link."
            )

        data["user_id"] = self.user.id
        data["email"]   = self.user.email
        return data


class EmailTokenObtainPairView(TokenObtainPairView):
    """
    Custom view for obtaining JWT, uses the custom serializer above.
    """
    serializer_class = EmailTokenObtainPairSerializer