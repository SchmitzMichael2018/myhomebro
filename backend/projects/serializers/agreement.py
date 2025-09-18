# ~/backend/backend/projects/serializers/agreement.py
from __future__ import annotations

from django.db.models import Sum
from rest_framework import serializers
from projects.models import Agreement

try:
    from projects.models import Invoice, Milestone
except Exception:
    Invoice = None  # type: ignore
    Milestone = None  # type: ignore


class AgreementSerializer(serializers.ModelSerializer):
    project_title = serializers.SerializerMethodField()
    homeowner_name = serializers.SerializerMethodField()
    contractor_name = serializers.SerializerMethodField()
    title = serializers.SerializerMethodField()
    invoices_count = serializers.SerializerMethodField()
    parent_agreement_id = serializers.SerializerMethodField()
    display_total = serializers.SerializerMethodField()  # live sum of milestones

    class Meta:
        model = Agreement
        fields = [
            "id", "project_uid", "status", "is_archived",
            "start", "end", "total_cost", "display_total",
            "milestone_count", "escrow_funded",
            "signed_by_contractor", "signed_by_homeowner", "pdf_version",
            "created_at", "updated_at",
            "project", "contractor", "homeowner",
            "amendment_number", "parent_agreement_id",
            "project_title", "homeowner_name", "contractor_name", "title",
            "invoices_count",
        ]

    def get_project_title(self, obj):
        try:
            return getattr(obj.project, "title", None)
        except Exception:
            return None

    def get_title(self, obj):
        return self.get_project_title(obj)

    def get_homeowner_name(self, obj):
        try:
            ho = getattr(obj, "homeowner", None)
            return getattr(ho, "full_name", None) if ho else None
        except Exception:
            return None

    def get_contractor_name(self, obj):
        try:
            c = getattr(obj, "contractor", None)
            return getattr(c, "name", None) or getattr(c, "business_name", None)
        except Exception:
            return None

    def get_invoices_count(self, obj):
        if not Invoice:
            return 0
        try:
            return int(Invoice.objects.filter(agreement=obj).count())
        except Exception:
            return 0

    def get_parent_agreement_id(self, obj):
        try:
            amend = getattr(obj, "as_amendment", None)
            return getattr(amend, "parent_id", None) if amend else None
        except Exception:
            return None

    def get_display_total(self, obj):
        """Live sum of milestone amounts (excludes archived children)."""
        if not Milestone:
            return str(obj.total_cost or "0")
        try:
            s = Milestone.objects.filter(agreement=obj).aggregate(x=Sum("amount"))["x"] or 0
            return str(s)
        except Exception:
            return str(obj.total_cost or "0")
