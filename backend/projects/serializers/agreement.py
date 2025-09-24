# projects/serializers/agreement.py

from rest_framework import serializers
from django.db.models import Sum, Count
from projects.models import Agreement, Milestone, Invoice


class AgreementSerializer(serializers.ModelSerializer):
    """
    READ: add keys that AgreementList.jsx expects:
      - project_title
      - homeowner_name, homeowner_email
      - display_total        (sum of milestone.amount)
      - start, end           (model values or computed from milestones if empty)
      - invoices_count

    WRITE: tolerate legacy aliases from older UIs:
      - job_description -> description
      - use_default_warranty/custom_warranty_text -> warranty_type/warranty_text_snapshot
    """

    # ---- READ convenience fields ----
    project_title   = serializers.SerializerMethodField()
    homeowner_name  = serializers.SerializerMethodField()
    homeowner_email = serializers.SerializerMethodField()
    display_total   = serializers.SerializerMethodField()
    start           = serializers.SerializerMethodField()
    end             = serializers.SerializerMethodField()
    invoices_count  = serializers.SerializerMethodField()

    # ---- WRITE compatibility aliases ----
    job_description      = serializers.CharField(write_only=True, required=False, allow_blank=True)
    use_default_warranty = serializers.BooleanField(write_only=True, required=False)
    custom_warranty_text = serializers.CharField(write_only=True, required=False, allow_blank=True)

    class Meta:
        model = Agreement
        fields = "__all__"

    # ---------------------- READ helpers ---------------------- #
    def get_project_title(self, obj: Agreement) -> str:
        """
        Prefer an actual project title if present.
        If there is a related project but it has no title, show 'Project #<id>'.
        If there's no related project and no explicit title snapshot, return '' (not 'Agreement #').
        This prevents the UI from showing 'Agreement #<id>' in the Project column.
        """
        try:
            p = getattr(obj, "project", None)
            if p:
                # common naming fields on Project
                for attr in ("title", "name"):
                    val = (getattr(p, attr, "") or "").strip()
                    if val:
                        return val
                # fallback if we at least know the project id
                pid = getattr(p, "id", None)
                if pid:
                    return f"Project #{pid}"
                return ""  # related project exists but no usable title/id
            # no related project; try any snapshot on Agreement that is NOT a placeholder
            snap = (getattr(obj, "project_title", "") or getattr(obj, "title", "") or "").strip()
            if snap and not snap.lower().startswith("agreement #"):
                return snap
            return ""
        except Exception:
            return ""

    def _resolve_homeowner(self, obj: Agreement):
        h = getattr(obj, "homeowner", None)
        if h:
            return h
        try:
            return getattr(getattr(obj, "project", None), "homeowner", None)
        except Exception:
            return None

    def get_homeowner_name(self, obj: Agreement) -> str:
        try:
            h = self._resolve_homeowner(obj)
            for attr in ("full_name", "name"):
                val = (getattr(h, attr, "") or "").strip() if h else ""
                if val:
                    return val
            return (getattr(obj, "homeowner_name", "") or getattr(obj, "homeowner_full_name", "") or "").strip()
        except Exception:
            return ""

    def get_homeowner_email(self, obj: Agreement) -> str:
        try:
            h = self._resolve_homeowner(obj)
            return (getattr(h, "email", "") or getattr(obj, "homeowner_email", "") or "").strip()
        except Exception:
            return ""

    def get_display_total(self, obj: Agreement):
        try:
            agg = Milestone.objects.filter(agreement=obj).aggregate(x=Sum("amount"))["x"]
            return float(agg or 0)
        except Exception:
            try:
                return float(getattr(obj, "total_cost", 0) or 0)
            except Exception:
                return 0.0

    def _computed_start_end(self, obj: Agreement):
        try:
            qs = Milestone.objects.filter(agreement=obj).only("start_date", "completion_date", "scheduled_date")
            earliest, latest = None, None
            for m in qs:
                s = m.start_date or getattr(m, "scheduled_date", None)
                if s and (earliest is None or s < earliest):
                    earliest = s
                e = m.completion_date or getattr(m, "scheduled_date", None) or m.start_date
                if e and (latest is None or e > latest):
                    latest = e
            return earliest, latest
        except Exception:
            return None, None

    def get_start(self, obj: Agreement):
        if getattr(obj, "start", None):
            return obj.start
        s, _ = self._computed_start_end(obj)
        return s

    def get_end(self, obj: Agreement):
        if getattr(obj, "end", None):
            return obj.end
        _, e = self._computed_start_end(obj)
        return e

    def get_invoices_count(self, obj: Agreement) -> int:
        try:
            return int(Invoice.objects.filter(agreement=obj).aggregate(c=Count("id"))["c"] or 0)
        except Exception:
            return 0

    # Always include the computed keys, even if a view/paginator messes with fields
    def to_representation(self, instance):
        data = super().to_representation(instance)
        data["project_title"]   = self.get_project_title(instance)
        data["homeowner_name"]  = self.get_homeowner_name(instance)
        data["homeowner_email"] = self.get_homeowner_email(instance)
        data["display_total"]   = self.get_display_total(instance)
        data["start"]           = self.get_start(instance)
        data["end"]             = self.get_end(instance)
        data["invoices_count"]  = self.get_invoices_count(instance)
        return data

    # --------------------- WRITE mapping ---------------------- #
    def validate(self, attrs):
        jd = attrs.pop("job_description", None)
        if jd not in (None, ""):
            attrs["description"] = jd

        if "use_default_warranty" in attrs:
            use_default = bool(attrs.pop("use_default_warranty"))
            if use_default:
                attrs["warranty_type"] = "default"
                attrs["warranty_text_snapshot"] = ""
            else:
                custom_txt = attrs.pop("custom_warranty_text", "")
                attrs["warranty_type"] = "custom"
                attrs["warranty_text_snapshot"] = custom_txt or attrs.get("warranty_text_snapshot", "")

        wt = attrs.get("warranty_type")
        if wt:
            attrs["warranty_type"] = str(wt).lower()
        return attrs
