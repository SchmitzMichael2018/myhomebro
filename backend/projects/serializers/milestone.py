from rest_framework import serializers
from projects.models import Milestone


class MilestoneSerializer(serializers.ModelSerializer):
    """
    Milestone serializer with compatibility aliases:
      • write 'end_date' -> stored as 'completion_date'
      • write 'status'   -> sets completed/is_invoiced booleans
    """

    end_date = serializers.DateField(write_only=True, required=False, allow_null=True)
    status = serializers.CharField(write_only=True, required=False, allow_blank=True)

    class Meta:
        model = Milestone
        fields = "__all__"

    def validate(self, attrs):
        # accept 'end_date' from UI and persist as completion_date
        if "end_date" in attrs:
            attrs["completion_date"] = attrs.pop("end_date")

        # accept 'status' from UI and map to booleans
        if "status" in attrs:
            s = (attrs.pop("status") or "").strip().lower()
            if s == "invoiced":
                attrs["completed"] = True
                attrs["is_invoiced"] = True
            elif s == "complete":
                attrs["completed"] = True
                attrs["is_invoiced"] = False
            else:
                attrs["completed"] = False
                attrs["is_invoiced"] = False

        return attrs
