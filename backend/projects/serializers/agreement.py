# backend/projects/serializers/agreement.py
from __future__ import annotations

import re
from decimal import Decimal
from typing import Any, Dict, Optional, List

from django.utils import timezone
from rest_framework import serializers

from projects.models import Agreement, Homeowner
from projects.models_project_taxonomy import ProjectType, ProjectSubtype

try:
    from projects.models import AgreementPDFVersion  # type: ignore
except Exception:  # pragma: no cover
    AgreementPDFVersion = None  # type: ignore

from projects.models_ai_scope import AgreementAIScope

try:
    from projects.models import Milestone, Invoice  # type: ignore
except Exception:  # pragma: no cover
    Milestone = None  # type: ignore
    Invoice = None  # type: ignore

try:
    from projects.models_templates import ProjectTemplate  # type: ignore
except Exception:  # pragma: no cover
    ProjectTemplate = None  # type: ignore


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
    if value in (None, ""):
        return None
    s = str(value).strip().lower()

    if s in ("direct", "direct_pay", "direct pay", "subcontractor", "no_escrow", "no escrow"):
        return "direct"
    if s in ("escrow", "protected", "stripe", "funding"):
        return "escrow"
    return value


def _normalize_signature_policy(value: Optional[str]) -> Optional[str]:
    if value in (None, ""):
        return None
    s = str(value).strip().lower().replace("-", "_").replace(" ", "_")

    if s in (
        "both",
        "both_required",
        "both_parties",
        "both_parties_required",
        "both_sign",
        "both_sign_required",
    ):
        return "both_required"
    if s in ("contractor", "contractor_only", "internal", "work_order", "workorder", "internal_only"):
        return "contractor_only"
    if s in (
        "external",
        "external_signed",
        "signed_outside",
        "outside",
        "outside_signed",
        "signed_outside_myhomebro",
    ):
        return "external_signed"

    return value


class AgreementAIScopeWriteSerializer(serializers.Serializer):
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


def _boolish(v: Any, default: bool = True) -> bool:
    if v is True:
        return True
    if v is False:
        return False
    if v in (1, "1", "true", "True", "yes", "Yes"):
        return True
    if v in (0, "0", "false", "False", "no", "No"):
        return False
    return default


def _safe_file_url(f) -> Optional[str]:
    try:
        if f and getattr(f, "name", ""):
            return f.url
    except Exception:
        return None
    return None


def _norm_keyish(value: Any) -> str:
    s = str(value or "").strip().lower()
    s = s.replace("&", " and ")
    s = re.sub(r"[()/,:.-]+", " ", s)
    s = re.sub(r"\s+", "_", s).strip("_")
    return s


def _norm_labelish(value: Any) -> str:
    s = str(value or "").strip().lower()
    s = s.replace("&", " and ")
    s = re.sub(r"\(e\.g\.[^)]+\)", " ", s)
    s = re.sub(r"[()/,:.-]+", " ", s)
    s = re.sub(r"\s+", " ", s).strip()
    return s


def _question_group(question: dict) -> str:
    raw_key = _norm_keyish(question.get("key"))
    raw_label = _norm_labelish(question.get("label") or question.get("question"))

    text = f"{raw_key} {raw_label}"

    if "materials" in text and (
        "purchase" in text or
        "purchasing" in text or
        "purchases" in text or
        "responsible" in text
    ):
        return "materials_responsibility"

    if "permit" in text:
        return "permits_responsibility"

    if "measurement" in text or "measurements" in text:
        return "measurements_provided"

    if "floor" in text and "later" in text:
        return "flooring_finishes_later"

    if "access" in text or "working hours" in text:
        return "site_access_working_hours"

    if "debris" in text or "waste" in text:
        return "waste_removal_responsibility"

    if "delivery" in text:
        return "material_delivery_coordination"

    if "change order" in text or "unforeseen" in text:
        return "unforeseen_conditions_change_orders"

    return raw_key or _norm_keyish(raw_label)


def _question_input_type(question: dict, key: str) -> str:
    qtype = str(
        question.get("inputType")
        or question.get("response_type")
        or question.get("type")
        or ""
    ).strip().lower()

    if qtype in ("radio", "boolean", "select"):
        return "radio"

    if key in {
        "materials_responsibility",
        "permits_responsibility",
        "measurements_provided",
        "flooring_finishes_later",
    }:
        return "radio"

    return "textarea"


def _question_options(key: str, question: dict) -> list:
    opts = question.get("options")
    if isinstance(opts, list) and opts:
        return opts

    if key == "materials_responsibility":
        return ["Contractor", "Homeowner", "Split"]

    if key == "permits_responsibility":
        return ["Contractor", "Homeowner", "Split / depends"]

    if key == "measurements_provided":
        return ["Yes", "No", "Pending"]

    if key == "flooring_finishes_later":
        return ["Yes", "No", "Unsure"]

    qtype = str(question.get("type") or "").strip().lower()
    if qtype == "boolean":
        return ["Yes", "No"]

    return []


def _question_score(question: dict) -> int:
    score = 0
    if question.get("required"):
        score += 5
    if question.get("help"):
        score += 2
    if question.get("placeholder"):
        score += 1
    if question.get("options"):
        score += 3
    if question.get("inputType") == "radio":
        score += 2
    if question.get("label"):
        score += 1
    return score


def _canonicalize_questions(questions: list) -> list:
    out: dict[str, dict[str, Any]] = {}

    for raw in _safe_list(questions):
        if not isinstance(raw, dict):
            continue

        key = _question_group(raw)
        if not key:
            continue

        label = raw.get("label") or raw.get("question") or key.replace("_", " ").title()
        input_type = _question_input_type(raw, key)
        options = _question_options(key, raw)

        normalized = {
            "key": key,
            "label": label,
            "question": raw.get("question") or label,
            "help": raw.get("help") or "",
            "placeholder": raw.get("placeholder") or "",
            "required": bool(raw.get("required", False)),
            "inputType": input_type,
            "type": raw.get("type") or ("boolean" if input_type == "radio" and options == ["Yes", "No"] else "text"),
            "options": options,
            "source": raw.get("source") or "unknown",
        }

        if key not in out:
            out[key] = normalized
            continue

        prev = out[key]
        prev_score = _question_score(prev)
        next_score = _question_score(normalized)
        winner = normalized if next_score > prev_score else prev

        out[key] = {
            **winner,
            "key": key,
            "required": bool(prev.get("required")) or bool(normalized.get("required")),
            "help": winner.get("help") or prev.get("help") or normalized.get("help") or "",
            "placeholder": winner.get("placeholder") or prev.get("placeholder") or normalized.get("placeholder") or "",
            "options": winner.get("options") or prev.get("options") or normalized.get("options") or [],
        }

    return list(out.values())


def _legacy_alias_keys_for_group(group_key: str) -> list[str]:
    aliases = {
        "materials_responsibility": [
            "who_purchases_materials",
            "materials_responsibility",
            "materials_purchasing",
            "who_is_responsible_for_purchasing_major_materials",
            "who_will_purchase_materials",
        ],
        "permits_responsibility": [
            "permits_responsibility",
            "permit_acquisition",
            "who_obtains_permits",
            "who_obtains_necessary_building_permits",
            "who_is_responsible_for_obtaining_all_required_building_permits",
            "permit_notes",
            "permits",
            "permits_inspections",
        ],
        "measurements_provided": [
            "measurements_provided",
            "measurements_needed",
            "detailed_measurements_provided",
        ],
        "flooring_finishes_later": [
            "flooring_finishes_later",
            "will_any_flooring_finishes_beyond_subfloor_installation_be_requested_later",
        ],
    }
    return aliases.get(group_key, [])


def _canonicalize_answers_for_questions(existing_answers: dict, canonical_questions: list) -> dict:
    src = _safe_dict(existing_answers)
    normalized = _normalize_answers_for_questions(src, canonical_questions)

    canonical_keys = {
        str(q.get("key") or "").strip()
        for q in _safe_list(canonical_questions)
        if str(q.get("key") or "").strip()
    }

    alias_keys = set()
    for key in canonical_keys:
        alias_keys.update(_legacy_alias_keys_for_group(key))

    out: dict[str, Any] = {}

    for key, value in normalized.items():
        if key in alias_keys and key not in canonical_keys:
            continue
        out[key] = value

    return out


def _normalize_answers_for_questions(existing_answers: dict, canonical_questions: list) -> dict:
    src = _safe_dict(existing_answers)
    out: dict[str, Any] = {}

    for q in canonical_questions:
        key = str(q.get("key") or "").strip()
        if not key:
            continue

        if key in src:
            out[key] = src[key]
            continue

        for alias in _legacy_alias_keys_for_group(key):
            if alias in src:
                out[key] = src[alias]
                break

    for raw_key, raw_val in src.items():
        if raw_key not in out:
            out[raw_key] = raw_val

    return out


def _clean_stored_questions(questions: Any) -> list[dict]:
    cleaned: list[dict] = []

    for raw in _safe_list(questions):
        if not isinstance(raw, dict):
            continue

        key = str(_question_group(raw) or raw.get("key") or "").strip()
        if not key:
            continue

        label = str(raw.get("label") or raw.get("question") or key.replace("_", " ").title()).strip()
        qtype = str(raw.get("type") or "").strip() or "text"
        help_text = "" if raw.get("help") is None else str(raw.get("help")).strip()
        placeholder = "" if raw.get("placeholder") is None else str(raw.get("placeholder")).strip()
        required = bool(raw.get("required", False))
        options = raw.get("options", []) if isinstance(raw.get("options", []), list) else []
        input_type = str(raw.get("inputType") or "").strip()

        if not input_type:
            input_type = _question_input_type(raw, key)

        cleaned.append(
            {
                "key": key,
                "label": label,
                "question": str(raw.get("question") or label).strip(),
                "help": help_text,
                "placeholder": placeholder,
                "required": required,
                "inputType": input_type,
                "type": qtype,
                "options": options,
                "source": raw.get("source") or "stored",
            }
        )

    return cleaned


class SelectedTemplateMiniSerializer(serializers.ModelSerializer):
    class Meta:
        model = ProjectTemplate  # type: ignore
        fields = [
            "id",
            "name",
            "project_type",
            "project_subtype",
            "estimated_days",
            "is_system",
        ]


class AgreementPDFVersionSerializer(serializers.ModelSerializer):
    file_url = serializers.SerializerMethodField()

    class Meta:
        model = AgreementPDFVersion  # type: ignore
        fields = [
            "id",
            "version_number",
            "kind",
            "file_url",
            "sha256",
            "created_at",
            "signed_by_contractor",
            "signed_by_homeowner",
            "contractor_signature_name",
            "homeowner_signature_name",
            "contractor_signed_at",
            "homeowner_signed_at",
        ]

    def get_file_url(self, obj):
        return _safe_file_url(getattr(obj, "file", None))


class AgreementSerializer(serializers.ModelSerializer):
    is_fully_signed = serializers.SerializerMethodField()
    signature_is_satisfied = serializers.SerializerMethodField()

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

    display_total = serializers.SerializerMethodField()
    escrow_total_required = serializers.SerializerMethodField()
    remaining_to_fund = serializers.SerializerMethodField()

    ai_scope = serializers.SerializerMethodField()
    ai_scope_input = AgreementAIScopeWriteSerializer(write_only=True, required=False)
    scope_clarifications = serializers.JSONField(write_only=True, required=False)

    use_default_warranty = serializers.BooleanField(write_only=True, required=False, default=True)
    custom_warranty_text = serializers.CharField(write_only=True, required=False, allow_blank=True, default="")
    warranty_text_snapshot = serializers.CharField(required=False, allow_blank=True, allow_null=True)

    project_type_ref = serializers.PrimaryKeyRelatedField(
        queryset=ProjectType.objects.all(),
        required=False,
        allow_null=True,
    )
    project_subtype_ref = serializers.PrimaryKeyRelatedField(
        queryset=ProjectSubtype.objects.all(),
        required=False,
        allow_null=True,
    )
    project_subtype = serializers.CharField(required=False, allow_blank=True, allow_null=True)

    project_address_line1 = serializers.CharField(required=False, allow_blank=True, allow_null=True)
    project_address_line2 = serializers.CharField(required=False, allow_blank=True, allow_null=True)
    project_address_city = serializers.CharField(required=False, allow_blank=True, allow_null=True)
    project_address_state = serializers.CharField(required=False, allow_blank=True, allow_null=True)
    project_postal_code = serializers.CharField(required=False, allow_blank=True, allow_null=True)

    address_line1 = serializers.CharField(required=False, allow_blank=True, allow_null=True)
    address_line2 = serializers.CharField(required=False, allow_blank=True, allow_null=True)
    city = serializers.CharField(required=False, allow_blank=True, allow_null=True)
    state = serializers.CharField(required=False, allow_blank=True, allow_null=True)
    postal_code = serializers.CharField(required=False, allow_blank=True, allow_null=True)

    external_contract_attested_by = serializers.PrimaryKeyRelatedField(read_only=True)

    contractor_ack_reviewed = serializers.BooleanField(read_only=True)
    contractor_ack_tos = serializers.BooleanField(read_only=True)
    contractor_ack_esign = serializers.BooleanField(read_only=True)
    contractor_ack_at = serializers.DateTimeField(read_only=True)

    current_pdf_url = serializers.SerializerMethodField()
    pdf_versions = serializers.SerializerMethodField()

    selected_template = serializers.SerializerMethodField()
    selected_template_id = serializers.SerializerMethodField()
    selected_template_name_snapshot = serializers.CharField(read_only=True)

    class Meta:
        model = Agreement
        fields = "__all__"
        extra_kwargs = {
            "description": {"required": False, "allow_blank": True, "allow_null": False},
        }

    def get_current_pdf_url(self, obj):
        return _safe_file_url(getattr(obj, "pdf_file", None))

    def get_pdf_versions(self, obj):
        if AgreementPDFVersion is None:
            return []
        try:
            qs = getattr(obj, "pdf_versions", None)
            if qs is None:
                return []
            return AgreementPDFVersionSerializer(qs.all(), many=True, context=self.context).data
        except Exception:
            return []

    def get_selected_template(self, obj):
        tpl = getattr(obj, "selected_template", None)
        if not tpl or ProjectTemplate is None:
            return None
        try:
            return SelectedTemplateMiniSerializer(tpl, context=self.context).data
        except Exception:
            return None

    def get_selected_template_id(self, obj):
        try:
            return getattr(obj, "selected_template_id", None)
        except Exception:
            return None

    def _req_flags(self, obj) -> tuple[bool, bool]:
        req_contr = _boolish(getattr(obj, "require_contractor_signature", None), True)
        req_cust = _boolish(getattr(obj, "require_customer_signature", None), True)
        return req_contr, req_cust

    def _contractor_signed(self, obj) -> bool:
        if bool(getattr(obj, "signed_by_contractor", False)):
            return True
        if bool(getattr(obj, "contractor_signed", False)):
            return True
        if getattr(obj, "contractor_signature_name", None):
            return True
        if getattr(obj, "contractor_signed_at", None) or getattr(obj, "signed_at_contractor", None):
            return True
        return False

    def _homeowner_signed(self, obj) -> bool:
        if bool(getattr(obj, "signed_by_homeowner", False)):
            return True
        if bool(getattr(obj, "homeowner_signed", False)):
            return True
        if getattr(obj, "homeowner_signature_name", None):
            return True
        if getattr(obj, "homeowner_signed_at", None) or getattr(obj, "signed_at_homeowner", None):
            return True
        return False

    def get_is_fully_signed(self, obj):
        req_contr, req_cust = self._req_flags(obj)
        contr_ok = (not req_contr) or self._contractor_signed(obj)
        cust_ok = (not req_cust) or self._homeowner_signed(obj)
        return bool(contr_ok and cust_ok)

    def get_signature_is_satisfied(self, obj):
        try:
            v = getattr(obj, "signature_is_satisfied")
            if isinstance(v, bool):
                return v
        except Exception:
            pass
        return self.get_is_fully_signed(obj)

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
        return getattr(ho, "full_name", None) or getattr(ho, "name", None) or getattr(ho, "email", None)

    def get_homeowner_email(self, obj):
        ho = self._homeowner_obj(obj)
        return getattr(ho, "email", None) if ho else None

    def get_homeowner_address(self, obj) -> Optional[str]:
        snap = getattr(obj, "homeowner_address_snapshot", None) or getattr(obj, "homeowner_address_text", None)
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

        line1 = _g(ho, "address_line1", "address1", "street_address", "street1", "address")
        line2 = _g(ho, "address_line2", "address_line_2", "address2", "street2", "unit", "apt")
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
            return {"sum_amount": Decimal("0"), "min_start": None, "max_end": None, "count": 0}

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

        start_dates = [m.start_date for m in qs if getattr(m, "start_date", None) is not None]
        min_start = min(start_dates) if start_dates else None

        end_candidates = []
        for m in qs:
            for name in ("completion_date", "end_date", "due_date"):
                v = getattr(m, name, None)
                if v is not None:
                    end_candidates.append(v)
                    break
        max_end = max(end_candidates) if end_candidates else None

        return {"sum_amount": total_amt, "min_start": min_start, "max_end": max_end, "count": len(qs)}

    def get_display_milestone_total(self, obj):
        return self._milestone_rollups(obj)["sum_amount"]

    def get_total(self, obj):
        rollups = self._milestone_rollups(obj)
        if rollups["count"] > 0:
            return rollups["sum_amount"]

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

        return rollups["sum_amount"]

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
            total_required = total_required if isinstance(total_required, Decimal) else Decimal(str(total_required))
            funded = funded if isinstance(funded, Decimal) else Decimal(str(funded))
        except Exception:
            return None

        remaining = total_required - funded
        if remaining < Decimal("0.00"):
            remaining = Decimal("0.00")

        return float(remaining)

    def get_ai_scope(self, obj):
        try:
            scope = getattr(obj, "ai_scope", None)
            if not scope:
                return None

            stored_questions = _clean_stored_questions(getattr(scope, "questions", []) or [])
            answers = _normalize_answers_for_questions(scope.answers or {}, stored_questions)

            return {
                "questions": stored_questions,
                "answers": answers,
                "scope_text": getattr(scope, "scope_text", "") or "",
                "updated_at": scope.updated_at.isoformat() if scope.updated_at else None,
            }
        except Exception:
            return None

    def to_internal_value(self, data: Dict[str, Any]):
        data = dict(data)

        if "agreement_payment_mode" in data and "payment_mode" not in data:
            data["payment_mode"] = data.pop("agreement_payment_mode")

        if "agreement_escrow_funded" in data and "escrow_funded" not in data:
            data["escrow_funded"] = data.pop("agreement_escrow_funded")

        if "project_type" in data and data["project_type"]:
            data["project_type"] = _normalize_project_type(data["project_type"])

        if "payment_mode" in data and data["payment_mode"] is not None:
            data["payment_mode"] = _normalize_payment_mode(data["payment_mode"])

        if "signature_policy" in data and data["signature_policy"] is not None:
            data["signature_policy"] = _normalize_signature_policy(data["signature_policy"])

        mappings = [
            ("project_address_line1", "address_line1"),
            ("project_address_line2", "address_line2"),
            ("project_address_city", "city"),
            ("project_address_state", "state"),
            ("project_postal_code", "postal_code"),
            ("project_postal_code", "zip_code"),
            ("project_postal_code", "zip"),
            ("project_address_city", "address_city"),
            ("project_address_state", "address_state"),
            ("project_postal_code", "address_postal_code"),
        ]

        for proj_key, alias_key in mappings:
            if proj_key in data and data[proj_key] is not None:
                data[alias_key] = data[proj_key]

        if "address_line1" in data and data["address_line1"] is not None:
            data["project_address_line1"] = data["address_line1"]
        if "address_line2" in data and data["address_line2"] is not None:
            data["project_address_line2"] = data["address_line2"]

        city_val = data.get("address_city", data.get("city"))
        state_val = data.get("address_state", data.get("state"))
        postal_val = data.get("address_postal_code", data.get("postal_code"))

        if city_val is not None:
            data["project_address_city"] = city_val
        if state_val is not None:
            data["project_address_state"] = state_val
        if postal_val is not None:
            data["project_postal_code"] = postal_val

        data.pop("project_address_same_as_homeowner", None)
        data.pop("status", None)

        if "ai_scope" in data and data["ai_scope"] is not None and "ai_scope_input" not in data:
            data["ai_scope_input"] = data.pop("ai_scope")

        raw_project_type_ref = data.get("project_type_ref")
        raw_project_subtype_ref = data.get("project_subtype_ref")

        try:
            if raw_project_subtype_ref not in (None, "", "null"):
                pst_obj = (
                    raw_project_subtype_ref
                    if isinstance(raw_project_subtype_ref, ProjectSubtype)
                    else ProjectSubtype.objects.select_related("project_type").filter(pk=raw_project_subtype_ref).first()
                )
                if pst_obj:
                    data["project_subtype"] = pst_obj.name
                    data["project_type"] = pst_obj.project_type.name
                    data["project_type_ref"] = pst_obj.project_type.pk
                    data["project_subtype_ref"] = pst_obj.pk
        except Exception:
            pass

        try:
            if raw_project_type_ref not in (None, "", "null") and not data.get("project_type"):
                pt_obj = (
                    raw_project_type_ref
                    if isinstance(raw_project_type_ref, ProjectType)
                    else ProjectType.objects.filter(pk=raw_project_type_ref).first()
                )
                if pt_obj:
                    data["project_type"] = pt_obj.name
                    data["project_type_ref"] = pt_obj.pk
        except Exception:
            pass

        # Force early draft-friendly behavior here too.
        if "description" in data and data["description"] is None:
            data["description"] = ""

        if "project_title" in data and data["project_title"] is None:
            data["project_title"] = ""
        if "title" in data and data["title"] is None:
            data["title"] = ""

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
            "address_city",
            "address_state",
            "address_postal_code",
        }

        keep_empty_string_keys = set(address_keys) | {
            "project_subtype",
            "external_contract_reference",
            "project_type",
            "description",
            "project_title",
            "title",
        }

        for key, value in list(data.items()):
            if key not in keep_empty_string_keys and isinstance(value, str) and value.strip() == "":
                data[key] = None

        if data.get("project_subtype", None) is None and "project_subtype" in data:
            data["project_subtype"] = ""

        if data.get("project_type", None) is None and "project_type" in data:
            data["project_type"] = ""

        if data.get("description", None) is None and "description" in data:
            data["description"] = ""

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

    def _pop_non_model_fields(self, data: dict) -> dict:
        non_model_fields = {
            "address_line1",
            "address_line2",
            "city",
            "state",
            "postal_code",
            "zip",
            "zip_code",
            "address_city",
            "address_state",
            "address_postal_code",
            "use_default_warranty",
            "custom_warranty_text",
        }
        for key in non_model_fields:
            data.pop(key, None)
        return data

    def _sync_taxonomy_snapshot_fields(self, validated_data: dict) -> dict:
        validated_data = dict(validated_data)

        subtype_obj = validated_data.get("project_subtype_ref")
        type_obj = validated_data.get("project_type_ref")

        if subtype_obj:
            validated_data["project_subtype"] = subtype_obj.name
            validated_data["project_type"] = subtype_obj.project_type.name
            validated_data["project_type_ref"] = subtype_obj.project_type

        elif type_obj:
            validated_data["project_type"] = type_obj.name
            if "project_subtype_ref" in validated_data and not validated_data.get("project_subtype_ref"):
                validated_data["project_subtype"] = validated_data.get("project_subtype", "") or ""

        elif "project_type" in validated_data and validated_data.get("project_type"):
            try:
                match = ProjectType.objects.filter(name__iexact=validated_data["project_type"]).first()
                if match:
                    validated_data["project_type_ref"] = match
                    validated_data["project_type"] = match.name
            except Exception:
                pass

        if "project_subtype" in validated_data and validated_data.get("project_subtype"):
            try:
                subtype_match = ProjectSubtype.objects.select_related("project_type").filter(
                    name__iexact=validated_data["project_subtype"]
                )
                if validated_data.get("project_type_ref"):
                    subtype_match = subtype_match.filter(project_type=validated_data["project_type_ref"])
                subtype_match = subtype_match.first()
                if subtype_match:
                    validated_data["project_subtype_ref"] = subtype_match
                    validated_data["project_subtype"] = subtype_match.name
                    validated_data["project_type_ref"] = subtype_match.project_type
                    validated_data["project_type"] = subtype_match.project_type.name
            except Exception:
                pass

        return validated_data

    def _persist_ai_scope(
        self,
        agreement: Agreement,
        ai_scope_payload: Optional[dict],
        scope_clarifications_payload: Optional[dict],
    ) -> None:
        if ai_scope_payload is None and not isinstance(scope_clarifications_payload, dict):
            return

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

        incoming_questions_raw = _safe_list(ai_scope_payload.get("questions"))
        incoming_questions = (
            _clean_stored_questions(_canonicalize_questions(incoming_questions_raw))
            if incoming_questions_raw
            else []
        )
        incoming_answers = _safe_dict(ai_scope_payload.get("answers"))
        incoming_scope_text = ai_scope_payload.get("scope_text", None)

        scope_obj = getattr(agreement, "ai_scope", None)
        if not scope_obj:
            scope_obj = AgreementAIScope.objects.create(agreement=agreement)

        effective_questions = incoming_questions or _clean_stored_questions(_safe_list(scope_obj.questions))

        if incoming_questions:
            scope_obj.questions = incoming_questions

        if incoming_answers:
            merged_existing_answers = _canonicalize_answers_for_questions(
                _safe_dict(scope_obj.answers),
                effective_questions,
            )
            merged_incoming_answers = _canonicalize_answers_for_questions(
                incoming_answers,
                effective_questions,
            )
            scope_obj.answers = _merge_dict(merged_existing_answers, merged_incoming_answers)

        if incoming_scope_text is not None:
            scope_obj.scope_text = str(incoming_scope_text or "")

        scope_obj.save()

    def _stamp_external_attestation_if_needed(self, instance: Agreement, validated_data: dict) -> None:
        try:
            policy = validated_data.get("signature_policy", None) or getattr(instance, "signature_policy", None) or ""
            policy = str(policy).strip().lower()
        except Exception:
            policy = ""

        if policy != "external_signed":
            return

        incoming_attested = validated_data.get("external_contract_attested", None)
        if incoming_attested is not True:
            return

        already_at = getattr(instance, "external_contract_attested_at", None)
        if already_at:
            return

        req = self.context.get("request", None)
        user = getattr(req, "user", None) if req else None

        instance.external_contract_attested_at = timezone.now()
        instance.external_contract_attested_by = user if user and getattr(user, "is_authenticated", False) else None

    def validate(self, attrs):
        attrs = dict(attrs)

        if attrs.get("description", None) is None:
            attrs["description"] = ""

        return attrs

    def create(self, validated_data):
        ai_scope_payload = validated_data.pop("ai_scope_input", None)
        scope_clarifications_payload = validated_data.pop("scope_clarifications", None)

        validated_data = self._pop_non_model_fields(validated_data)
        validated_data = self._sync_taxonomy_snapshot_fields(validated_data)

        if validated_data.get("description", None) is None:
            validated_data["description"] = ""

        agreement = Agreement.objects.create(**validated_data)

        self._stamp_external_attestation_if_needed(agreement, validated_data)
        if agreement.external_contract_attested_at:
            agreement.save(update_fields=["external_contract_attested_at", "external_contract_attested_by"])

        self._persist_ai_scope(agreement, ai_scope_payload, scope_clarifications_payload)
        return agreement

    def update(self, instance, validated_data):
        ai_scope_payload = validated_data.pop("ai_scope_input", None)
        scope_clarifications_payload = validated_data.pop("scope_clarifications", None)

        validated_data = self._pop_non_model_fields(validated_data)
        validated_data = self._sync_taxonomy_snapshot_fields(validated_data)

        if validated_data.get("description", None) is None and "description" in validated_data:
            validated_data["description"] = ""

        instance = super().update(instance, validated_data)

        self._stamp_external_attestation_if_needed(instance, validated_data)
        if instance.external_contract_attested_at:
            instance.save(update_fields=["external_contract_attested_at", "external_contract_attested_by"])

        self._persist_ai_scope(instance, ai_scope_payload, scope_clarifications_payload)
        return instance
