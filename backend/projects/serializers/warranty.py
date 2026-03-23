from __future__ import annotations

from rest_framework import serializers

from projects.models import Agreement, AgreementWarranty


class AgreementWarrantySerializer(serializers.ModelSerializer):
    agreement = serializers.PrimaryKeyRelatedField(queryset=Agreement.objects.all())
    agreement_title = serializers.SerializerMethodField(read_only=True)

    class Meta:
        model = AgreementWarranty
        fields = [
            "id",
            "agreement",
            "agreement_title",
            "contractor",
            "title",
            "coverage_details",
            "exclusions",
            "start_date",
            "end_date",
            "status",
            "applies_to",
            "created_at",
            "updated_at",
        ]
        read_only_fields = [
            "contractor",
            "created_at",
            "updated_at",
            "agreement_title",
        ]

    def validate(self, attrs):
        start_date = attrs.get("start_date", getattr(self.instance, "start_date", None))
        end_date = attrs.get("end_date", getattr(self.instance, "end_date", None))
        if start_date and end_date and end_date < start_date:
            raise serializers.ValidationError(
                {"end_date": "End date cannot be before start date."}
            )
        return attrs

    def get_agreement_title(self, obj):
        try:
            return obj.agreement.project.title
        except Exception:
            return ""
