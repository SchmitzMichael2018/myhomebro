# backend/projects/serializers/agreement.py
from __future__ import annotations

from decimal import Decimal, InvalidOperation
from typing import Any, Dict, Optional

from rest_framework import serializers

from projects.models import (
    Agreement,
    ProjectStatus,
    Project,
    Contractor,
    Homeowner,
)

# Optional/guarded imports for rollups
try:
    from projects.models import Milestone, Invoice  # type: ignore
except Exception:  # pragma: no cover
    Milestone = None  # type: ignore
    Invoice = None    # type: ignore


# ---------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------

def _to_decimal(val) -> Optional[Decimal]:
    if val in ("", None):
        return None
    if isinstance(val, Decimal):
        return val
    try:
        return Decimal(str(val))
    except (InvalidOperation, ValueError, TypeError):
        return None


_NORMALIZE_PROJECT_TYPE = {
    "remodel": "Remodel",
    "repair": "Repair",
    "installation": "Installation",
    "painting": "Painting",
    "outdoor": "Outdoor",
    "inspection": "Inspection",
    "custom": "Custom",
    "diy help": "DIY Help",
    "diy_help": "DIY Help",
    "diy": "DIY Help",
}

def _normalize_project_type(value: Optional[str]) -> Optional[str]:
    if not value:
        return None
    key = str(value).strip().lower().replace("-", " ").replace("_", " ")
    return _NORMALIZE_PROJECT_TYPE.get(key, value)


def _empty_to_none(val):
    return None if (val == "" or val is None) else val


# ---------------------------------------------------------------------
# Serializer
# ---------------------------------------------------------------------

class AgreementSerializer(serializers.ModelSerializer):
    """
    Enriched Agreement serializer:
      - READ conveniences for UI (is_fully_signed, project_title, totals, rollup dates, etc.)
      - WRITE normalization (project_type mapping, empty->None, numeric coercions)
      - Warranty UI aliases -> model fields
      - Ignores client-provided 'status' to keep server as source of truth
    """

    # ---- READ conveniences ----
    is_fully_signed = serializers.SerializerMethodField(read_only=True)
    project_title   = serializers.SerializerMethodField(read_only=True)
    homeowner_name  = serializers.SerializerMethodField(read_only=True)
    homeowner_email = serializers.SerializerMethodField(read_only=True)
    display_total   = serializers.SerializerMethodField(read_only=True)
    total           = serializers.SerializerMethodField(read_only=True)   # alias
    amount          = serializers.SerializerMethodField(read_only=True)   # alias
    start           = serializers.SerializerMethodField(read_only=True)   # derived if empty
    end             = serializers.SerializerMethodField(read_only=True)
    invoices_count  = serializers.SerializerMethodField(read_only=True)
    is_editable     = serializers.SerializerMethodField(read_only=True)
    is_locked       = serializers.SerializerMethodField(read_only=True)

    # ---- WRITE aliases from UI ----
    use_default_warranty = serializers.BooleanField(write_only=True, required=False, default=True)
    custom_warranty_text = serializers.CharField(write_only=True, required=False, allow_blank=True, default="")

    # Accept a title from UI; optionally sync it to Project on update()
    title = serializers.CharField(required=False, allow_blank=True, default="")
    project_title_in = serializers.CharField(source="project_title", write_only=True, required=False, allow_blank=True, default="")

    class Meta:
        model = Agreement
        fields = [
            # canonical model fields
            "id",
            "project",
            "contractor",
            "homeowner",
            "description",
            "total_cost",
            "total_time_estimate",
            "milestone_count",
            "start",
            "end",
            "status",
            "project_type",
            "project_subtype",
            "standardized_category",
            "terms_text",
            "privacy_text",
            "warranty_type",
            "warranty_text_snapshot",
            "escrow_payment_intent_id",
            "escrow_funded",
            "reviewed",
            "reviewed_at",
            "reviewed_by",
            "signed_by_contractor",
            "signed_at_contractor",
            "signed_by_homeowner",
            "signed_at_homeowner",
            "pdf_file",
            "pdf_version",
            "pdf_archived",
            "signature_log",
            "created_at",
            "updated_at",
            "amendment_number",
            "addendum_file",
            "is_archived",

            # READ helpers
            "is_fully_signed",
            "project_title",
            "homeowner_name", "homeowner_email",
            "display_total", "total", "amount",
            "invoices_count",
            "is_editable", "is_locked",

            # UI write aliases
            "use_default_warranty",
            "custom_warranty_text",
            "title",
            "project_title_in",
        ]
        read_only_fields = [
            "status",
            "escrow_funded",
            "signed_by_contractor",
            "signed_at_contractor",
            "signed_by_homeowner",
            "signed_at_homeowner",
            "pdf_file",
            "pdf_version",
            "created_at",
            "updated_at",
            "amendment_number",
            # read conveniences
            "project_title",
            "homeowner_name",
            "homeowner_email",
            "display_total", "total", "amount",
            "invoices_count",
            "is_editable", "is_locked",
        ]

    # ----- READ helpers -----

    def get_is_fully_signed(self, obj: Agreement) -> bool:
        return bool(getattr(obj, "signed_by_contractor", False) and getattr(obj, "signed_by_homeowner", False))

    def get_is_editable(self, obj: Agreement) -> bool:
        # Editable until BOTH sign
        return not self.get_is_fully_signed(obj)

    def get_is_locked(self, obj: Agreement) -> bool:
        return not self.get_is_editable(obj)

    def get_project_title(self, obj: Agreement) -> Optional[str]:
        # Prefer Agreement.title if you mirror it there; fallback to Project.title
        if getattr(obj, "title", None):
            return obj.title
        proj = getattr(obj, "project", None)
        return getattr(proj, "title", None) if proj else None

    def _get_homeowner_obj(self, obj: Agreement) -> Optional[Homeowner]:
        ho = getattr(obj, "homeowner", None)
        if isinstance(ho, Homeowner):
            return ho
        try:
            return Homeowner.objects.get(pk=ho) if ho else None
        except Exception:
            return None

    def get_homeowner_name(self, obj: Agreement) -> Optional[str]:
        ho = self._get_homeowner_obj(obj)
        if not ho:
            return None
        return getattr(ho, "full_name", None) or getattr(ho, "name", None) or getattr(ho, "email", None)

    def get_homeowner_email(self, obj: Agreement) -> Optional[str]:
        ho = self._get_homeowner_obj(obj)
        return getattr(ho, "email", None) if ho else None

    # ---- Totals and date rollups from milestones ----
    def _milestone_qs(self, obj: Agreement):
        if not Milestone:
            return None
        # Prefer explicit related_name if set
        if hasattr(obj, "milestones"):
            return obj.milestones.all()
        if hasattr(obj, "milestone_set"):
            return obj.milestone_set.all()
        try:
            return Milestone.objects.filter(agreement=obj)
        except Exception:
            return None

    def _milestone_rollups(self, obj: Agreement):
        """
        Returns dict with keys:
          sum_amount (Decimal), min_start (date), max_end (date)
        Uses Milestone.start_date / completion_date if available.
        """
        if not Milestone:
            return {"sum_amount": Decimal("0"), "min_start": None, "max_end": None}
        qs = self._milestone_qs(obj)
        if qs is None:
            return {"sum_amount": Decimal("0"), "min_start": None, "max_end": None}
        try:
            from django.db.models import Sum, Min, Max
            agg = qs.aggregate(
                sum_amount=Sum("amount"),
                min_start=Min("start_date"),
                max_end=Max("completion_date"),
            )
            agg["sum_amount"] = agg.get("sum_amount") or Decimal("0")
            return agg
        except Exception:
            return {"sum_amount": Decimal("0"), "min_start": None, "max_end": None}

    def get_display_total(self, obj: Agreement):
        total = getattr(obj, "total_cost", None)
        if total not in (None, ""):
            return total
        return self._milestone_rollups(obj)["sum_amount"]

    def get_total(self, obj: Agreement):
        return self.get_display_total(obj)

    def get_amount(self, obj: Agreement):
        return self.get_display_total(obj)

    def get_start(self, obj: Agreement):
        # Use model.start if set, else min milestone start_date
        val = getattr(obj, "start", None)
        if val:
            return val
        return self._milestone_rollups(obj)["min_start"]

    def get_end(self, obj: Agreement):
        # Use model.end if set, else max milestone completion_date
        val = getattr(obj, "end", None)
        if val:
            return val
        return self._milestone_rollups(obj)["max_end"]

    def get_invoices_count(self, obj: Agreement) -> int:
        if not Invoice:
            return 0
        # Prefer explicit related_name if set
        if hasattr(obj, "invoices"):
            try:
                return obj.invoices.count()
            except Exception:
                pass
        if hasattr(obj, "invoice_set"):
            try:
                return obj.invoice_set.count()
            except Exception:
                pass
        try:
            return Invoice.objects.filter(agreement=obj).count()
        except Exception:
            return 0

    # ----- WRITE normalization -----

    def to_internal_value(self, data: Dict[str, Any]) -> Dict[str, Any]:
        """
        Normalize incoming UI payload:
         - Empty strings -> None
         - project_type normalization
         - numeric coercion for total_cost / milestone_count
         - map warranty aliases -> warranty_type / warranty_text_snapshot
         - ignore incoming 'status'
        """
        data = dict(data)

        # Never trust client status
        data.pop("status", None)

        # Normalize/clean basic fields
        for key in ("description", "terms_text", "privacy_text", "project_subtype", "standardized_category"):
            if key in data:
                data[key] = _empty_to_none(data.get(key))

        # Dates / duration: convert "" -> None for start/end/total_time_estimate
        for key in ("start", "end", "total_time_estimate"):
            if key in data and data.get(key) == "":
                data[key] = None

        # Numbers
        if "total_cost" in data:
            dec = _to_decimal(data.get("total_cost"))
            data["total_cost"] = dec if dec is not None else (None if data.get("total_cost") in ("", None) else data.get("total_cost"))

        if "milestone_count" in data:
            try:
                data["milestone_count"] = int(data.get("milestone_count"))
            except (ValueError, TypeError):
                if data.get("milestone_count") in ("", None):
                    data["milestone_count"] = None

        # Project type normalization
        if "project_type" in data:
            data["project_type"] = _normalize_project_type(data.get("project_type"))

        # Warranty mapping from UI aliases
        use_default = data.pop("use_default_warranty", None)
        custom_text = data.pop("custom_warranty_text", None)
        if use_default is not None:
            if use_default:
                data["warranty_type"] = "default"
                if custom_text is not None and custom_text == "":
                    data["warranty_text_snapshot"] = ""
            else:
                data["warranty_type"] = "custom"
                if custom_text is not None:
                    data["warranty_text_snapshot"] = custom_text

        return super().to_internal_value(data)

    def update(self, instance: Agreement, validated_data: Dict[str, Any]) -> Agreement:
        """
        Normal update; plus optional sync of UI-provided title -> Project.title.
        """
        project_title = (
            self.initial_data.get("project_title")
            or self.initial_data.get("project_title_in")
            or self.initial_data.get("title")
        )
        if project_title:
            try:
                proj = getattr(instance, "project", None)
                if isinstance(proj, Project) and getattr(proj, "title", None) != project_title:
                    proj.title = project_title
                    proj.save(update_fields=["title"])
            except Exception:
                pass

        # Strip blanks to None for any string fields in validated_data
        for k, v in list(validated_data.items()):
            if isinstance(v, str) and v.strip() == "":
                validated_data[k] = None

        return super().update(instance, validated_data)

    # Optional field-level validation
    def validate_project_type(self, value: Optional[str]) -> Optional[str]:
        if value is None:
            return value
        normalized = _normalize_project_type(value)
        return normalized or value
