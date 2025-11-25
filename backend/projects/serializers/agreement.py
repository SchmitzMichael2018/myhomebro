# backend/projects/serializers/agreement.py
# v2025-11-24i — Project Address + Milestone-based Start/End/Total + display_total
# - Project Address is explicit-only (no "same as homeowner" toggle used).
# - Robust address aliasing on input (project_address_* <-> address_*).
# - Milestone rollups:
#       * sum_amount: sum of milestone.amount
#       * min_start: earliest milestone.start_date
#       * max_end:   latest of completion_date/end_date/due_date
# - TOTAL RULE:
#       * If total_cost is non-zero, use it.
#       * If total_cost is 0 / None / "", use sum of milestones.
# - OUTPUT FIELD:
#       * display_total = computed total (used by AgreementList.jsx).

from __future__ import annotations

from decimal import Decimal
from typing import Any, Dict, Optional, List

from rest_framework import serializers

from projects.models import Agreement, Homeowner

try:
    from projects.models import Milestone, Invoice  # type: ignore
except Exception:  # pragma: no cover
    Milestone = None  # type: ignore
    Invoice = None  # type: ignore


def _to_decimal(val) -> Optional[Decimal]:
    if val in ("", None):
        return None
    if isinstance(val, Decimal):
        return val
    try:
        return Decimal(str(val))
    except Exception:
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


class AgreementSerializer(serializers.ModelSerializer):
    """
    Agreement serializer with robust project address handling and
    milestone-based rollups for total, start, and end dates.
    """

    # ---- READ convenience fields ----
    is_fully_signed = serializers.SerializerMethodField()
    project_title = serializers.SerializerMethodField()
    homeowner_name = serializers.SerializerMethodField()
    homeowner_email = serializers.SerializerMethodField()
    homeowner_address = serializers.SerializerMethodField()
    display_milestone_total = serializers.SerializerMethodField()
    total = serializers.SerializerMethodField()
    amount = serializers.SerializerMethodField()
    start = serializers.SerializerMethodField()
    end = serializers.SerializerMethodField()
    invoices_count = serializers.SerializerMethodField()
    is_editable = serializers.SerializerMethodField()
    is_locked = serializers.SerializerMethodField()
    # NEW: value AgreementList uses for the Total column
    display_total = serializers.SerializerMethodField()

    # ---- WRITE aliases for warranty ----
    use_default_warranty = serializers.BooleanField(
        write_only=True, required=False, default=True
    )
    custom_warranty_text = serializers.CharField(
        write_only=True, required=False, allow_blank=True, default=""
    )

    # Accept nulls from frontend; normalize later
    warranty_text_snapshot = serializers.CharField(
        required=False,
        allow_blank=True,
        allow_null=True,
    )

    # Explicit project address fields (source of truth)
    project_address_line1 = serializers.CharField(
        required=False, allow_blank=True, allow_null=True
    )
    project_address_line2 = serializers.CharField(
        required=False, allow_blank=True, allow_null=True
    )
    project_address_city = serializers.CharField(
        required=False, allow_blank=True, allow_null=True
    )
    project_address_state = serializers.CharField(
        required=False, allow_blank=True, allow_null=True
    )
    project_postal_code = serializers.CharField(
        required=False, allow_blank=True, allow_null=True
    )

    # Generic alias fields (if model uses these instead)
    address_line1 = serializers.CharField(
        required=False, allow_blank=True, allow_null=True
    )
    address_line2 = serializers.CharField(
        required=False, allow_blank=True, allow_null=True
    )
    city = serializers.CharField(
        required=False, allow_blank=True, allow_null=True
    )
    state = serializers.CharField(
        required=False, allow_blank=True, allow_null=True
    )
    postal_code = serializers.CharField(
        required=False, allow_blank=True, allow_null=True
    )

    # NOTE: no project_address_same_as_homeowner field anymore.

    class Meta:
        model = Agreement
        fields = "__all__"

    # ------------------------------------------------------------------
    # READ helpers
    # ------------------------------------------------------------------

    def get_is_fully_signed(self, obj):
        return bool(obj.signed_by_contractor and obj.signed_by_homeowner)

    def get_is_editable(self, obj):
        return not self.get_is_fully_signed(obj)

    def get_is_locked(self, obj):
        return self.get_is_fully_signed(obj)

    def get_project_title(self, obj):
        if getattr(obj, "project", None):
            return getattr(obj.project, "title", None) or None
        return None

    def _homeowner_obj(self, obj):
        ho = getattr(obj, "homeowner", None)
        if isinstance(ho, Homeowner):
            return ho
        try:
            return Homeowner.objects.get(pk=ho)
        except Exception:
            return None

    def get_homeowner_name(self, obj):
        ho = self._homeowner_obj(obj)
        if not ho:
            return None
        return (
            getattr(ho, "full_name", None)
            or getattr(ho, "name", None)
            or getattr(ho, "email", None)
        )

    def get_homeowner_email(self, obj):
        ho = self._homeowner_obj(obj)
        return getattr(ho, "email", None) if ho else None

    def get_homeowner_address(self, obj) -> Optional[str]:
        """
        Single-line homeowner address for list views.
        Prefer Agreement snapshot; otherwise build from Homeowner fields.
        """
        snap = (
            getattr(obj, "homeowner_address_snapshot", None)
            or getattr(obj, "homeowner_address_text", None)
        )
        if snap and str(snap).strip():
            return str(snap).strip()

        ho = self._homeowner_obj(obj)
        if not ho:
            return None

        def _g(o, *names):
            for n in names:
                if hasattr(o, n):
                    v = getattr(o, n)
                    if v is not None and str(v).strip():
                        return str(v).strip()
            return ""

        line1 = _g(
            ho,
            "address_line1",
            "address1",
            "street_address",
            "street1",
            "address",
        )
        line2 = _g(
            ho,
            "address_line2",
            "address_line_2",
            "address2",
            "street2",
            "unit",
            "apt",
        )
        city = _g(ho, "city", "town", "city_name")
        state = _g(ho, "state", "region", "state_code", "province")
        postal = _g(ho, "postal_code", "zip_code", "zip", "zipcode")

        parts: List[str] = []
        if line1:
            parts.append(f"{line1}, {line2}" if line2 else line1)

        loc_bits = [b for b in [city, state] if b]
        loc_str = ", ".join(loc_bits)
        if postal:
            loc_str = f"{loc_str} {postal}" if loc_str else postal

        if loc_str:
            parts.append(f"— {loc_str}" if parts else loc_str)

        return " ".join(parts).strip() or None

    def _milestone_rollups(self, obj):
        """
        Roll up milestones:
          - sum_amount: total of milestone.amount
          - min_start: earliest milestone.start_date
          - max_end:   latest of completion_date/end_date/due_date
        """
        if Milestone is None:
            return {
                "sum_amount": Decimal("0"),
                "min_start": None,
                "max_end": None,
            }

        qs = list(Milestone.objects.filter(agreement=obj))

        # sum of amount
        total = Decimal("0")
        for m in qs:
            amt = getattr(m, "amount", None)
            if isinstance(amt, Decimal):
                total += amt
            elif amt not in (None, ""):
                try:
                    total += Decimal(str(amt))
                except Exception:
                    pass

        # earliest start_date
        start_dates = [
            m.start_date for m in qs if getattr(m, "start_date", None) is not None
        ]
        min_start = min(start_dates) if start_dates else None

        # latest of completion_date / end_date / due_date
        end_candidates = []
        for m in qs:
            for name in ("completion_date", "end_date", "due_date"):
                v = getattr(m, name, None)
                if v is not None:
                    end_candidates.append(v)
                    break
        max_end = max(end_candidates) if end_candidates else None

        return {
            "sum_amount": total,
            "min_start": min_start,
            "max_end": max_end,
        }

    def get_display_milestone_total(self, obj):
        return self._milestone_rollups(obj)["sum_amount"]

    def get_total(self, obj):
        """
        Agreement total:
          - If total_cost is non-zero, use it as an override.
          - If total_cost is 0 / None / "", use sum of milestone amounts.
        """
        total_cost = getattr(obj, "total_cost", None)

        # Normalize to Decimal or None
        if total_cost in ("", None):
            normalized = None
        elif isinstance(total_cost, Decimal):
            normalized = total_cost
        else:
            try:
                normalized = Decimal(str(total_cost))
            except Exception:
                normalized = None

        # If contractor explicitly set a non-zero total_cost, trust that.
        if normalized not in (None, Decimal("0"), Decimal("0.00")):
            return normalized

        # Otherwise, fall back to sum of milestones.
        return self._milestone_rollups(obj)["sum_amount"]

    def get_amount(self, obj):
        # Kept for backward compatibility; same as total.
        return self.get_total(obj)

    def get_start(self, obj):
        """
        Overall start date: earliest milestone.start_date.
        """
        return self._milestone_rollups(obj)["min_start"]

    def get_end(self, obj):
        """
        Overall end date: latest of completion_date / end_date / due_date
        across milestones.
        """
        return self._milestone_rollups(obj)["max_end"]

    def get_invoices_count(self, obj):
        if Invoice is None:
            return 0
        return Invoice.objects.filter(agreement=obj).count()

    def get_display_total(self, obj):
        """
        Value used by AgreementList.jsx's Total column
        (fmtMoney(r.display_total ?? r.total_cost)).
        """
        val = self.get_total(obj)
        if isinstance(val, Decimal):
            # Convert to a plain float/string so JS Number() works nicely
            return float(val)
        try:
            return float(val)
        except Exception:
            return val

    # ------------------------------------------------------------------
    # INPUT normalisation
    # ------------------------------------------------------------------

    def to_internal_value(self, data: Dict[str, Any]):
        """
        Normalize input to ensure addresses save regardless of model field names.
        Explicit project_address_* fields are the preferred source.
        """
        data = dict(data)

        # Normalize project type if present
        if "project_type" in data and data["project_type"]:
            data["project_type"] = _normalize_project_type(data["project_type"])

        # Map synonyms: Ensure both `project_address_X` and `address_X` keys exist
        # if one of them is provided, so we survive model aliasing.
        mappings = [
            ("project_address_line1", "address_line1"),
            ("project_address_line2", "address_line2"),
            ("project_address_city", "city"),
            ("project_address_state", "state"),
            ("project_postal_code", "postal_code"),
            ("project_postal_code", "zip_code"),
            ("project_postal_code", "zip"),
        ]

        for proj_key, model_key in mappings:
            if proj_key in data and data[proj_key] is not None:
                data[model_key] = data[proj_key]
            elif model_key in data and data[model_key] is not None:
                data[proj_key] = data[model_key]

        # Strip legacy toggle key if any old client sends it
        data.pop("project_address_same_as_homeowner", None)

        # Don't let inbound "status" override internal logic
        data.pop("status", None)

        # Clean empty strings to None, but keep address fields as-is
        address_keys = {
            "project_address_line1",
            "project_address_line2",
            "project_address_city",
            "project_address_state",
            "project_postal_code",
            "address_line1",
            "address_line2",
            "city",
            "state",
            "postal_code",
            "zip",
            "zip_code",
        }

        for key, value in list(data.items()):
            if key not in address_keys and isinstance(value, str):
                if value.strip() == "":
                    data[key] = None

        # Warranty mapping
        use_default = data.pop("use_default_warranty", None)
        custom_text = data.pop("custom_warranty_text", None)
        if use_default is not None:
            if use_default:
                data["warranty_type"] = "default"
                if custom_text == "":
                    data["warranty_text_snapshot"] = ""
            else:
                data["warranty_type"] = "custom"
                if custom_text is not None:
                    data["warranty_text_snapshot"] = custom_text

        if "total_cost" in data:
            data["total_cost"] = _to_decimal(data.get("total_cost"))

        return super().to_internal_value(data)

    def update(self, instance, validated_data):
        return super().update(instance, validated_data)

    # ------------------------------------------------------------------
    # OUTPUT normalisation
    # ------------------------------------------------------------------

    def to_representation(self, instance):
        rep = super().to_representation(instance)
        # We intentionally don't expose project_address_same_as_homeowner anymore.
        return rep
