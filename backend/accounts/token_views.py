# accounts/token_views.py
from django.contrib.auth import authenticate
from rest_framework import serializers
from rest_framework_simplejwt.serializers import TokenObtainPairSerializer
from rest_framework_simplejwt.views import TokenObtainPairView

class EmailTokenObtainPairSerializer(TokenObtainPairSerializer):
    # tell JWT to look up by email, not username
    username_field = "email"

    def validate(self, attrs):
        # attrs now has {"email": …, "password": …}
        data = super().validate(attrs)

        # your extra “is_verified” check…
        if not self.user.is_verified:
            raise serializers.ValidationError(
                "Account not verified. Please check your email for a verification link."
            )

        # any additional fields you want in the response
        data["user_id"] = self.user.id
        data["email"]   = self.user.email
        return data

class EmailTokenObtainPairView(TokenObtainPairView):
    """
    Custom view for obtaining JWT, uses the custom serializer above.
    """
    serializer_class = EmailTokenObtainPairSerializer