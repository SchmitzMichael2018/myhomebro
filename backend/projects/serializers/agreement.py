# backend/projects/serializers/agreement.py
from __future__ import annotations

from decimal import Decimal
from typing import Any, Dict, Optional, List

from rest_framework import serializers

from projects.models import Agreement, Homeowner
from projects.models_ai_scope import AgreementAIScope  # ✅ persisted AI scope Q/A

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


def _normalize_payment_mode(value: Optional[str]) -> Optional[str]:
    """
    Make serializer tolerant to UI variants:
      "direct", "DIRECT", "Direct Pay", etc. -> "direct"
      "escrow", "ESCROW", "protected" -> "escrow"
    If unknown, return original (let model/validation handle).
    """
    if value in (None, ""):
        return None
    s = str(value).strip().lower()

    # common synonyms
    if s in ("direct", "direct_pay", "direct pay", "subcontractor", "no_escrow", "no escrow"):
        return "direct"
    if s in ("escrow", "protected", "stripe", "funding"):
        return "escrow"

    # tolerate "DIRECT" / "ESCROW"
    if s == "direct":
        return "direct"
    if s == "escrow":
        return "escrow"

    return value  # fall through


# ------------------------------------------------------------
# ✅ NEW: Writable nested serializer for ai_scope PATCH support
# ------------------------------------------------------------
class AgreementAIScopeWriteSerializer(serializers.Serializer):
    """
    Allows PATCH payloads like:
      {
        "ai_scope": {
          "questions": [...],
          "answers": {...},
          "scope_text": "..."
        }
      }

    This DOES NOT replace your existing read-only get_ai_scope output.
    It's only used to accept input and persist into AgreementAIScope.
    """
    questions = serializers.ListField(required=False)
    answers = serializers.JSONField(required=False)
    scope_text = serializers.CharField(required=False, allow_blank=True, allow_null=True)


def _safe_dict(v: Any) -> Dict[str, Any]:
    return v if isinstance(v, dict) else {}


def _safe_list(v: Any) -> list:
    return v if isinstance(v, list) else []


def _merge_dict(a: Dict[str, Any], b: Dict[str, Any]) -> Dict[str, Any]:
    out = dict(a or {})
    out.update(b or {})
    return out


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

    # AgreementList Total column
    display_total = serializers.SerializerMethodField()

    # ✅ NEW: escrow rollups
    escrow_total_required = serializers.SerializerMethodField()
    remaining_to_fund = serializers.SerializerMethodField()

    # ✅ AI scope clarifications
    ai_scope = serializers.SerializerMethodField()
    ai_scope_input = AgreementAIScopeWriteSerializer(write_only=True, required=False)

    scope_clarifications = serializers.JSONField(write_only=True, required=False)

    # ---- WRITE aliases for warranty ----
    use_default_warranty = serializers.BooleanField(
        write_only=True, required=False, default=True
    )
    custom_warranty_text = serializers.CharField(
        write_only=True, required=False, allow_blank=True, default=""
    )

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
        if Milestone is None:
            return {"sum_amount": Decimal("0"), "min_start": None, "max_end": None}

        qs = list(Milestone.objects.filter(agreement=obj))

        total_amt = Decimal("0")
        for m in qs:
            amt = getattr(m, "amount", None)
            if isinstance(amt, Decimal):
                total_amt += amt
            elif amt not in (None, ""):
                try:
                    total_amt += Decimal(str(amt))
                except Exception:
                    pass

        start_dates = [
            m.start_date for m in qs if getattr(m, "start_date", None) is not None
        ]
        min_start = min(start_dates) if start_dates else None

        end_candidates = []
        for m in qs:
            for name in ("completion_date", "end_date", "due_date"):
                v = getattr(m, name, None)
                if v is not None:
                    end_candidates.append(v)
                    break
        max_end = max(end_candidates) if end_candidates else None

        return {"sum_amount": total_amt, "min_start": min_start, "max_end": max_end}

    def get_display_milestone_total(self, obj):
        return self._milestone_rollups(obj)["sum_amount"]

    def get_total(self, obj):
        total_cost = getattr(obj, "total_cost", None)

        if total_cost in ("", None):
            normalized = None
        elif isinstance(total_cost, Decimal):
            normalized = total_cost
        else:
            try:
                normalized = Decimal(str(total_cost))
            except Exception:
                normalized = None

        if normalized not in (None, Decimal("0"), Decimal("0.00")):
            return normalized

        return self._milestone_rollups(obj)["sum_amount"]

    def get_amount(self, obj):
        return self.get_total(obj)

    def get_start(self, obj):
        return self._milestone_rollups(obj)["min_start"]

    def get_end(self, obj):
        return self._milestone_rollups(obj)["max_end"]

    def get_invoices_count(self, obj):
        if Invoice is None:
            return 0
        return Invoice.objects.filter(agreement=obj).count()

    def get_display_total(self, obj):
        val = self.get_total(obj)
        if isinstance(val, Decimal):
            return float(val)
        try:
            return float(val)
        except Exception:
            return val

    # ✅ escrow rollups
    def get_escrow_total_required(self, obj):
        val = self.get_total(obj)
        try:
            return float(val) if isinstance(val, Decimal) else float(Decimal(str(val)))
        except Exception:
            return None

    def get_remaining_to_fund(self, obj):
        total_required = self.get_total(obj)
        funded = getattr(obj, "escrow_funded_amount", None) or Decimal("0.00")

        try:
            total_required = (
                total_required
                if isinstance(total_required, Decimal)
                else Decimal(str(total_required))
            )
            funded = funded if isinstance(funded, Decimal) else Decimal(str(funded))
        except Exception:
            return None

        remaining = total_required - funded
        if remaining < Decimal("0.00"):
            remaining = Decimal("0.00")

        return float(remaining)

    # ✅ AI scope clarifications (READ)
    def get_ai_scope(self, obj):
        try:
            scope = getattr(obj, "ai_scope", None)
            if not scope:
                return None
            return {
                "questions": scope.questions or [],
                "answers": scope.answers or {},
                "scope_text": getattr(scope, "scope_text", "") or "",
                "updated_at": scope.updated_at.isoformat() if scope.updated_at else None,
            }
        except Exception:
            return None

    # ------------------------------------------------------------------
    # INPUT normalisation
    # ------------------------------------------------------------------

    def to_internal_value(self, data: Dict[str, Any]):
        data = dict(data)

        if "project_type" in data and data["project_type"]:
            data["project_type"] = _normalize_project_type(data["project_type"])

        # ✅ NEW: Normalize payment_mode
        if "payment_mode" in data and data["payment_mode"] is not None:
            data["payment_mode"] = _normalize_payment_mode(data["payment_mode"])

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

        data.pop("project_address_same_as_homeowner", None)

        # If frontend sends status, ignore it (server authoritative)
        data.pop("status", None)

        # ✅ accept frontend "ai_scope" key by remapping it into our writable ai_scope_input
        if "ai_scope" in data and data["ai_scope"] is not None and "ai_scope_input" not in data:
            data["ai_scope_input"] = data.pop("ai_scope")

        address_keys = {
            "project_address_line1",
            "project_address_line2",
            "project_address_city",
            "project_address_state",
            "project_address_line1",
            "project_postal_code",
            "address_line1",
            "address_line2",
            "city",
            "state",
            "postal_code",
            "zip",
            "zip_code",
        }

        # Normalize empty strings -> None, but keep empty strings for address keys
        for key, value in list(data.items()):
            if key not in address_keys and isinstance(value, str) and value.strip() == "":
                data[key] = None

        # Warranty write-alias behavior
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

    # ------------------------------------------------------------------
    # SAVE overrides (CRITICAL FIX)
    # ------------------------------------------------------------------

    def _pop_non_model_fields(self, data: dict) -> dict:
        NON_MODEL_FIELDS = {
            "address_line1",
            "address_line2",
            "city",
            "state",
            "postal_code",
            "zip",
            "zip_code",
            "use_default_warranty",
            "custom_warranty_text",
        }
        for key in NON_MODEL_FIELDS:
            data.pop(key, None)
        return data

    def _persist_ai_scope(self, agreement: Agreement, ai_scope_payload: Optional[dict], scope_clarifications_payload: Optional[dict]) -> None:
        """
        Persist ai_scope updates into AgreementAIScope (OneToOne).
        Merge answers; replace questions only when provided.
        """
        if ai_scope_payload is None and not isinstance(scope_clarifications_payload, dict):
            return

        # Treat scope_clarifications as answers alias if provided
        if ai_scope_payload is None:
            ai_scope_payload = {}
        if isinstance(scope_clarifications_payload, dict) and scope_clarifications_payload:
            ai_scope_payload = dict(ai_scope_payload)
            ai_scope_payload["answers"] = _merge_dict(
                _safe_dict(ai_scope_payload.get("answers")),
                scope_clarifications_payload,
            )

        if not isinstance(ai_scope_payload, dict):
            return

        incoming_questions = _safe_list(ai_scope_payload.get("questions"))
        incoming_answers = _safe_dict(ai_scope_payload.get("answers"))
        incoming_scope_text = ai_scope_payload.get("scope_text", None)

        scope_obj = getattr(agreement, "ai_scope", None)
        if not scope_obj:
            scope_obj = AgreementAIScope.objects.create(agreement=agreement)

        if incoming_questions:
            scope_obj.questions = incoming_questions

        if incoming_answers:
            scope_obj.answers = _merge_dict(_safe_dict(scope_obj.answers), incoming_answers)

        if incoming_scope_text is not None:
            scope_obj.scope_text = str(incoming_scope_text or "")

        scope_obj.save()

    def create(self, validated_data):
        ai_scope_payload = validated_data.pop("ai_scope_input", None)
        scope_clarifications_payload = validated_data.pop("scope_clarifications", None)

        validated_data = self._pop_non_model_fields(validated_data)
        agreement = Agreement.objects.create(**validated_data)

        self._persist_ai_scope(agreement, ai_scope_payload, scope_clarifications_payload)

        return agreement

    def update(self, instance, validated_data):
        ai_scope_payload = validated_data.pop("ai_scope_input", None)
        scope_clarifications_payload = validated_data.pop("scope_clarifications", None)

        validated_data = self._pop_non_model_fields(validated_data)
        instance = super().update(instance, validated_data)

        self._persist_ai_scope(instance, ai_scope_payload, scope_clarifications_payload)

        return instance

    def to_representation(self, instance):
        return super().to_representation(instance)
