from rest_framework import serializers
from projects.models import Homeowner


class HomeownerSerializer(serializers.ModelSerializer):
    """
    Read serializer for Homeowner. Exposes all model fields so the
    Admin/API list/detail views can render without crashing.
    """
    class Meta:
        model = Homeowner
        fields = "__all__"


class HomeownerWriteSerializer(HomeownerSerializer):
    """
    Write serializer for Homeowner. For now, it's identical to the read
    serializer, but keeping a separate class preserves import stability
    for views that expect two distinct names.
    """
    pass
