from rest_framework import serializers
from projects.models import Homeowner
from projects.services.sms_service import get_sms_status_payload


class HomeownerSerializer(serializers.ModelSerializer):
    """
    Read serializer for Homeowner. Exposes all model fields so the
    Admin/API list/detail views can render without crashing.
    """
    class Meta:
        model = Homeowner
        fields = "__all__"

    def to_representation(self, instance):
        data = super().to_representation(instance)
        sms_status = get_sms_status_payload(homeowner=instance)
        data["sms_status"] = sms_status
        data["sms_enabled"] = sms_status.get("sms_enabled", False)
        data["sms_opted_out"] = sms_status.get("sms_opted_out", False)
        data["last_sms_event"] = sms_status.get("last_sms_event")
        return data


class HomeownerWriteSerializer(HomeownerSerializer):
    """
    Write serializer for Homeowner. For now, it's identical to the read
    serializer, but keeping a separate class preserves import stability
    for views that expect two distinct names.
    """
    pass
