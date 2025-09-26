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
      - project_type, project_subtype  (pulled from related Project or Agreement fallbacks)

    WRITE: tolerate legacy aliases from older UIs:
      - job_description -> description
      - use_default_warranty/custom_warranty_text -> warranty_type/warranty_text_snapshot
    """

    # ---- READ convenience fields ----
    project_title     = serializers.SerializerMethodField()
    homeowner_name    = serializers.SerializerMethodField()
    homeowner_email   = serializers.SerializerMethodField()
    display_total     = serializers.SerializerMethodField()
    start             = serializers.SerializerMethodField()
    end               = serializers.SerializerMethodField()
    invoices_count    = serializers.SerializerMethodField()
    project_type      = serializers.SerializerMethodField()
    project_subtype   = serializers.SerializerMethodField()

    # ---- WRITE compatibility aliases ----
    job_description      = serializers.CharField(write_only=True, required=False, allow_blank=True)
    use_default_warranty = serializers.BooleanField(write_only=True, required=False)
    custom_warranty_text = serializers.CharField(write_only=True, required=False, allow_blank=True)

    class Meta:
        model = Agreement
        fields = "__all__"

    # ---------------------- READ helpers ---------------------- #
    def get_project_title(self, obj: Agreement) -> str:
        try:
            p = getattr(obj, "project", None)
            if p:
                for attr in ("title", "name"):
                    val = (getattr(p, attr, "") or "").strip()
                    if val:
                        return val
                pid = getattr(p, "id", None)
                if pid:
                    return f"Project #{pid}"
            # Snapshot / fallback
            snap = (getattr(obj, "project_title_snapshot", "") or "").strip()
            if snap:
                return snap
            title = (getattr(obj, "title", "") or "").strip()
            if title and not title.lower().startswith("agreement #"):
                return title
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
            # snapshots on Agreement
            for attr in ("homeowner_name_snapshot", "homeowner_full_name", "homeowner_name"):
                v = (getattr(obj, attr, "") or "").strip()
                if v:
                    return v
            return ""
        except Exception:
            return ""

    def get_homeowner_email(self, obj: Agreement) -> str:
        try:
            h = self._resolve_homeowner(obj)
            val = (getattr(h, "email", "") or "").strip() if h else ""
            if val:
                return val
            for attr in ("homeowner_email_snapshot", "homeowner_email"):
                v = (getattr(obj, attr, "") or "").strip()
                if v:
                    return v
            return ""
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

    def get_project_type(self, obj: Agreement) -> str:
        """Prefer related Project.type/project_type, fallback to Agreement.project_type."""
        try:
            p = getattr(obj, "project", None)
            for attr in ("type", "project_type"):
                v = (getattr(p, attr, "") or "").strip() if p else ""
                if v:
                    return v
            return (getattr(obj, "project_type", "") or "").strip()
        except Exception:
            return (getattr(obj, "project_type", "") or "").strip()

    def get_project_subtype(self, obj: Agreement) -> str:
        """Prefer related Project.subtype/project_subtype, fallback to Agreement.project_subtype."""
        try:
            p = getattr(obj, "project", None)
            for attr in ("subtype", "project_subtype"):
                v = (getattr(p, attr, "") or "").strip() if p else ""
                if v:
                    return v
            return (getattr(obj, "project_subtype", "") or "").strip()
        except Exception:
            return (getattr(obj, "project_subtype", "") or "").strip()

    # Always include computed keys
    def to_representation(self, instance):
        data = super().to_representation(instance)
        data["project_title"]     = self.get_project_title(instance)
        data["homeowner_name"]    = self.get_homeowner_name(instance)
        data["homeowner_email"]   = self.get_homeowner_email(instance)
        data["display_total"]     = self.get_display_total(instance)
        data["start"]             = self.get_start(instance)
        data["end"]               = self.get_end(instance)
        data["invoices_count"]    = self.get_invoices_count(instance)
        data["project_type"]      = self.get_project_type(instance)
        data["project_subtype"]   = self.get_project_subtype(instance)
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
