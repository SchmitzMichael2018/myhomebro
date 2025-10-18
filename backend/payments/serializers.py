from rest_framework import serializers
from .models import ConnectedAccount

class ConnectedAccountSerializer(serializers.ModelSerializer):
    class Meta:
        model = ConnectedAccount
        fields = ["stripe_account_id", "charges_enabled", "payouts_enabled", "details_submitted"]
