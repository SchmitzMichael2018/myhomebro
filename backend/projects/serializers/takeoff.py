from rest_framework import serializers

from projects.models import MaterialLibraryItem, TakeoffEvent, TakeoffItem, TakeoffSession


class MaterialLibraryItemSerializer(serializers.ModelSerializer):
    price_entered_by_name = serializers.SerializerMethodField()
    price_is_stale = serializers.SerializerMethodField()

    class Meta:
        model = MaterialLibraryItem
        exclude = ("contractor",)
        read_only_fields = ("price_entered_by", "created_at", "updated_at")

    def get_price_entered_by_name(self, obj):
        return obj.price_entered_by.get_full_name() or obj.price_entered_by.email if obj.price_entered_by else ""

    def get_price_is_stale(self, obj):
        from django.conf import settings
        from django.utils import timezone
        return (timezone.localdate() - obj.price_effective_date).days > getattr(settings, "TAKEOFF_PRICE_STALE_DAYS", 90)

    def validate(self, attrs):
        coverage = attrs.get("coverage_quantity", getattr(self.instance, "coverage_quantity", None))
        price = attrs.get("unit_price", getattr(self.instance, "unit_price", None))
        if coverage is None or coverage <= 0:
            raise serializers.ValidationError({"coverage_quantity": "Coverage must be greater than zero."})
        if price is None or price < 0:
            raise serializers.ValidationError({"unit_price": "Price cannot be negative."})
        return attrs


class TakeoffItemSerializer(serializers.ModelSerializer):
    material_name = serializers.CharField(source="material.name", read_only=True)
    measurement_label = serializers.CharField(source="measurement_result.label", read_only=True)

    class Meta:
        model = TakeoffItem
        fields = "__all__"


class TakeoffEventSerializer(serializers.ModelSerializer):
    actor_name = serializers.SerializerMethodField()

    class Meta:
        model = TakeoffEvent
        fields = ("id", "event_type", "actor_name", "session_version", "metadata", "created_at")

    def get_actor_name(self, obj):
        return obj.actor.get_full_name() or obj.actor.email if obj.actor else "System"


class TakeoffSessionSerializer(serializers.ModelSerializer):
    items = serializers.SerializerMethodField()
    events = TakeoffEventSerializer(many=True, read_only=True)
    room_name = serializers.CharField(source="measurement_session.room_name", read_only=True)
    project_title = serializers.CharField(source="project.title", read_only=True)
    measurement_status = serializers.CharField(source="measurement_session.status", read_only=True)

    class Meta:
        model = TakeoffSession
        fields = "__all__"

    def get_items(self, obj):
        rows = obj.items.filter(revision=obj.version).select_related("material", "measurement_result")
        return TakeoffItemSerializer(rows, many=True).data
