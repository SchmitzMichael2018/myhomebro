from __future__ import annotations

import base64
import hashlib
import json
import logging
import re
import time
from decimal import Decimal, InvalidOperation

from django.conf import settings
from django.core.files.base import ContentFile
from django.db import transaction
from django.utils import timezone
from django.utils.dateparse import parse_date, parse_time

from projects.models import (
    AIUsageLedger,
    ContractorAsset,
    ExpenseRequest,
    ExpenseRequestAttachment,
    ProjectAssistantSmartCaptureSession,
)

ALLOWED_MIME_TYPES = {"image/jpeg", "image/png", "image/webp", "application/pdf"}
MAX_UPLOAD_BYTES = 8 * 1024 * 1024
PROVIDER_DETERMINISTIC = "deterministic"
PROVIDER_OPENAI = "openai"
SMART_CAPTURE_PROMPT_VERSION = "smart_capture_v2_2026_07_11"
SMART_CAPTURE_NORMALIZER_VERSION = "smart_capture_normalizer_v2_2026_07_12"
CONFIDENCE_VALUES = {"confirmed", "high_confidence", "medium_confidence", "low_confidence", "needs_review", "not_detected"}
logger = logging.getLogger(__name__)
RECEIPT_CAPTURE_TYPES = {
    ProjectAssistantSmartCaptureSession.CAPTURE_RECEIPT,
    ProjectAssistantSmartCaptureSession.CAPTURE_PROPERTY_RECEIPT,
}
LABEL_CAPTURE_TYPES = {
    ProjectAssistantSmartCaptureSession.CAPTURE_EQUIPMENT_LABEL,
    ProjectAssistantSmartCaptureSession.CAPTURE_PRODUCT_LABEL,
    ProjectAssistantSmartCaptureSession.CAPTURE_HOME_SYSTEM_LABEL,
    ProjectAssistantSmartCaptureSession.CAPTURE_APPLIANCE_LABEL,
    ProjectAssistantSmartCaptureSession.CAPTURE_INSTALLED_PRODUCT_LABEL,
    ProjectAssistantSmartCaptureSession.CAPTURE_WARRANTY_DOCUMENT,
    ProjectAssistantSmartCaptureSession.CAPTURE_MANUAL_DOCUMENT,
    ProjectAssistantSmartCaptureSession.CAPTURE_PAINT_FINISH_LABEL,
    ProjectAssistantSmartCaptureSession.CAPTURE_FLOORING_MATERIAL_LABEL,
    ProjectAssistantSmartCaptureSession.CAPTURE_PROPERTY_PHOTO,
}
CUSTOMER_CAPTURE_TYPES = {
    ProjectAssistantSmartCaptureSession.CAPTURE_HOME_SYSTEM_LABEL,
    ProjectAssistantSmartCaptureSession.CAPTURE_APPLIANCE_LABEL,
    ProjectAssistantSmartCaptureSession.CAPTURE_INSTALLED_PRODUCT_LABEL,
    ProjectAssistantSmartCaptureSession.CAPTURE_PROPERTY_RECEIPT,
    ProjectAssistantSmartCaptureSession.CAPTURE_WARRANTY_DOCUMENT,
    ProjectAssistantSmartCaptureSession.CAPTURE_MANUAL_DOCUMENT,
    ProjectAssistantSmartCaptureSession.CAPTURE_PAINT_FINISH_LABEL,
    ProjectAssistantSmartCaptureSession.CAPTURE_FLOORING_MATERIAL_LABEL,
    ProjectAssistantSmartCaptureSession.CAPTURE_PROPERTY_PHOTO,
}


def clean_text(value) -> str:
    return " ".join(str(value or "").split()).strip()


def decimal_or_none(value):
    try:
        text = clean_text(value).replace("$", "").replace(",", "")
        if not text:
            return None
        return Decimal(text).quantize(Decimal("0.01"))
    except (InvalidOperation, ValueError):
        return None


def normalized_category(value: str) -> str:
    text = clean_text(value).lower()
    if "material" in text or "tile" in text or "lvp" in text or "lumber" in text:
        return ExpenseRequest.Category.MATERIALS
    if "permit" in text:
        return ExpenseRequest.Category.PERMIT
    if "rental" in text or "rent" in text:
        return ExpenseRequest.Category.RENTAL
    if "delivery" in text:
        return ExpenseRequest.Category.DELIVERY
    return ExpenseRequest.Category.OTHER


def field_confidence(fields: dict, required: set[str] | None = None) -> dict:
    required = required or set()
    confidence = {}
    for key in required | set(fields.keys()):
        if clean_text(fields.get(key)):
            confidence[key] = "high_confidence"
        else:
            confidence[key] = "not_detected"
    return confidence


def parse_key_values(text: str) -> dict:
    parsed = {}
    for line in str(text or "").splitlines():
        if ":" not in line:
            continue
        key, value = line.split(":", 1)
        key = re.sub(r"[^a-z0-9]+", "_", key.lower()).strip("_")
        parsed[key] = clean_text(value)
    return parsed


RECEIPT_FIELDS = {
    "merchant_name",
    "merchant_address",
    "purchase_date",
    "purchase_time",
    "receipt_number",
    "subtotal",
    "tax",
    "total",
    "currency",
    "payment_method",
    "payment_method_masked",
    "line_items",
    "suggested_category",
    "project_reference",
    "milestone_reference",
    "customer_reference",
    "notes",
    "warnings",
    "missing_fields",
    "field_confidence",
}
LABEL_FIELDS = {
    "asset_type",
    "product_name",
    "manufacturer",
    "brand",
    "model_number",
    "serial_number",
    "sku",
    "barcode",
    "manufacture_date",
    "purchase_date",
    "warranty_period",
    "warranty_expiration",
    "voltage",
    "capacity",
    "size",
    "color_or_finish",
    "lot_or_batch_number",
    "notes",
    "destination",
    "warnings",
    "missing_fields",
    "field_confidence",
}


class SmartCaptureProviderError(RuntimeError):
    def __init__(self, message: str, code: str = "provider_error", diagnostics: dict | None = None):
        super().__init__(message)
        self.code = code
        self.diagnostics = diagnostics or {}


def smart_capture_provider() -> str:
    provider = clean_text(getattr(settings, "SMART_CAPTURE_PROVIDER", PROVIDER_DETERMINISTIC)).lower()
    return provider if provider in {PROVIDER_DETERMINISTIC, PROVIDER_OPENAI} else PROVIDER_DETERMINISTIC


def smart_capture_model() -> str:
    return clean_text(getattr(settings, "OPENAI_SMART_CAPTURE_MODEL", "gpt-4.1-mini")) or "gpt-4.1-mini"


def smart_capture_price(capture_type: str) -> Decimal:
    if capture_type in {ProjectAssistantSmartCaptureSession.CAPTURE_RECEIPT, ProjectAssistantSmartCaptureSession.CAPTURE_PROPERTY_RECEIPT}:
        value = getattr(settings, "SMART_CAPTURE_RECEIPT_PRICE", "0.05")
    elif capture_type in {ProjectAssistantSmartCaptureSession.CAPTURE_EQUIPMENT_LABEL, ProjectAssistantSmartCaptureSession.CAPTURE_HOME_SYSTEM_LABEL, ProjectAssistantSmartCaptureSession.CAPTURE_APPLIANCE_LABEL}:
        value = getattr(settings, "SMART_CAPTURE_EQUIPMENT_PRICE", "0.05")
    else:
        value = getattr(settings, "SMART_CAPTURE_PRODUCT_LABEL_PRICE", "0.05")
    return decimal_or_none(value) or Decimal("0.00")


def smart_capture_feature(capture_type: str) -> str:
    if capture_type == ProjectAssistantSmartCaptureSession.CAPTURE_RECEIPT:
        return AIUsageLedger.FEATURE_SMART_CAPTURE_RECEIPT
    if capture_type == ProjectAssistantSmartCaptureSession.CAPTURE_PROPERTY_RECEIPT:
        return AIUsageLedger.FEATURE_SMART_CAPTURE_PROPERTY_RECEIPT
    if capture_type == ProjectAssistantSmartCaptureSession.CAPTURE_EQUIPMENT_LABEL:
        return AIUsageLedger.FEATURE_SMART_CAPTURE_EQUIPMENT
    if capture_type == ProjectAssistantSmartCaptureSession.CAPTURE_HOME_SYSTEM_LABEL:
        return AIUsageLedger.FEATURE_SMART_CAPTURE_HOME_SYSTEM
    if capture_type == ProjectAssistantSmartCaptureSession.CAPTURE_APPLIANCE_LABEL:
        return AIUsageLedger.FEATURE_SMART_CAPTURE_APPLIANCE
    if capture_type == ProjectAssistantSmartCaptureSession.CAPTURE_WARRANTY_DOCUMENT:
        return AIUsageLedger.FEATURE_SMART_CAPTURE_WARRANTY
    if capture_type == ProjectAssistantSmartCaptureSession.CAPTURE_MANUAL_DOCUMENT:
        return AIUsageLedger.FEATURE_SMART_CAPTURE_MANUAL
    if capture_type == ProjectAssistantSmartCaptureSession.CAPTURE_PAINT_FINISH_LABEL:
        return AIUsageLedger.FEATURE_SMART_CAPTURE_PAINT_FINISH
    if capture_type == ProjectAssistantSmartCaptureSession.CAPTURE_FLOORING_MATERIAL_LABEL:
        return AIUsageLedger.FEATURE_SMART_CAPTURE_FLOORING_MATERIAL
    if capture_type == ProjectAssistantSmartCaptureSession.CAPTURE_PROPERTY_PHOTO:
        return AIUsageLedger.FEATURE_SMART_CAPTURE_PROPERTY_PHOTO
    return AIUsageLedger.FEATURE_SMART_CAPTURE_PRODUCT_LABEL


def extraction_cache_key(*, provider: str, model: str, file_hash: str, capture_type: str) -> str:
    raw = "|".join([provider, model, SMART_CAPTURE_PROMPT_VERSION, SMART_CAPTURE_NORMALIZER_VERSION, file_hash, capture_type])
    return hashlib.sha256(raw.encode("utf-8")).hexdigest()


class SmartCaptureExtractor:
    provider_version = "phase_2"

    def __init__(self, *, session: ProjectAssistantSmartCaptureSession | None = None, actor=None, provider: str | None = None):
        self.session = session
        self.actor = actor
        self.configured_provider = provider or smart_capture_provider()
        self.provider_name = PROVIDER_OPENAI if self.configured_provider == PROVIDER_OPENAI else "deterministic_text_fixture"
        self.openai = OpenAISmartCaptureProvider(session=session, actor=actor) if self.configured_provider == PROVIDER_OPENAI else None

    def extract_receipt(self, file_bytes: bytes, filename: str = "") -> dict:
        if self.openai:
            return self.openai.extract_receipt(file_bytes, filename)
        text = self._decode_text(file_bytes)
        data = parse_key_values(text)
        total = data.get("total") or data.get("amount")
        payload = {
            "merchant_name": data.get("merchant") or data.get("merchant_name") or "",
            "merchant_address": data.get("merchant_address") or "",
            "purchase_date": data.get("date") or data.get("purchase_date") or "",
            "purchase_time": data.get("time") or data.get("purchase_time") or "",
            "receipt_number": data.get("receipt") or data.get("receipt_number") or "",
            "subtotal": data.get("subtotal") or "",
            "tax": data.get("tax") or "",
            "total": total or "",
            "currency": data.get("currency") or "USD",
            "payment_method": self._masked_payment(data.get("payment_method") or data.get("card") or ""),
            "line_items": self._line_items(text),
            "suggested_category": data.get("category") or normalized_category(text),
            "project_reference": data.get("project") or data.get("project_reference") or "",
            "milestone_reference": data.get("milestone") or "",
            "customer_reference": data.get("customer") or "",
            "notes": data.get("notes") or f"Smart Capture receipt from {filename}".strip(),
        }
        return self.normalize_result("receipt", text, payload)

    def extract_equipment_label(self, file_bytes: bytes, filename: str = "") -> dict:
        if self.openai:
            return self.openai.extract_label("equipment_label", file_bytes, filename)
        return self._extract_label("equipment_label", file_bytes, filename)

    def extract_product_label(self, file_bytes: bytes, filename: str = "") -> dict:
        if self.openai:
            return self.openai.extract_label("product_label", file_bytes, filename)
        return self._extract_label("product_label", file_bytes, filename)

    def _extract_label(self, capture_type: str, file_bytes: bytes, filename: str = "") -> dict:
        text = self._decode_text(file_bytes)
        data = parse_key_values(text)
        payload = {
            "asset_type": data.get("asset_type") or data.get("type") or ("equipment" if capture_type == "equipment_label" else "product"),
            "product_name": data.get("product") or data.get("product_name") or data.get("name") or "",
            "manufacturer": data.get("manufacturer") or data.get("brand") or "",
            "brand": data.get("brand") or data.get("manufacturer") or "",
            "model_number": data.get("model") or data.get("model_number") or "",
            "serial_number": data.get("serial") or data.get("serial_number") or "",
            "sku": data.get("sku") or "",
            "barcode": data.get("barcode") or "",
            "manufacture_date": data.get("manufacture_date") or "",
            "purchase_date": data.get("purchase_date") or "",
            "warranty_period": data.get("warranty_period") or "",
            "warranty_expiration": data.get("warranty_expiration") or "",
            "voltage": data.get("voltage") or "",
            "capacity": data.get("capacity") or "",
            "size": data.get("size") or "",
            "color_or_finish": data.get("color") or data.get("finish") or "",
            "lot_or_batch_number": data.get("lot") or data.get("batch") or "",
            "notes": data.get("notes") or f"Smart Capture label from {filename}".strip(),
            "destination": "contractor_equipment" if capture_type == "equipment_label" else "project_material",
        }
        return self.normalize_result(capture_type, text, payload)

    def normalize_result(self, capture_type: str, raw_text: str, payload: dict) -> dict:
        if capture_type == "receipt":
            required = {"merchant_name", "purchase_date", "total"}
            missing = [
                {"field": key, "label": key.replace("_", " ").title()}
                for key in sorted(required)
                if not clean_text(payload.get(key))
            ]
            warnings = self._receipt_warnings(payload)
        else:
            required = {"manufacturer", "model_number", "serial_number", "destination"}
            missing = [
                {"field": key, "label": key.replace("_", " ").title()}
                for key in sorted(required)
                if not clean_text(payload.get(key))
            ]
            warnings = []
            if not payload.get("warranty_expiration"):
                warnings.append("Warranty expiration was not detected. Do not infer it without a reliable start date and duration.")
        return {
            "raw_extracted_text": raw_text,
            "structured_payload": payload,
            "field_confidence": field_confidence(payload, required),
            "missing_fields": missing,
            "warnings": warnings,
        }

    def _decode_text(self, file_bytes: bytes) -> str:
        try:
            return file_bytes.decode("utf-8", errors="ignore")
        except Exception:
            return ""

    def _line_items(self, text: str) -> list[dict]:
        items = []
        for line in str(text or "").splitlines():
            if not line.lower().startswith("item:"):
                continue
            body = clean_text(line.split(":", 1)[1])
            parts = [clean_text(part) for part in body.split("|")]
            items.append({
                "description": parts[0] if len(parts) > 0 else body,
                "quantity": parts[1] if len(parts) > 1 else "",
                "unit_price": parts[2] if len(parts) > 2 else "",
                "total": parts[3] if len(parts) > 3 else "",
                "sku": parts[4] if len(parts) > 4 else "",
            })
        return items

    def _receipt_warnings(self, payload: dict) -> list[str]:
        warnings = []
        subtotal = decimal_or_none(payload.get("subtotal"))
        tax = decimal_or_none(payload.get("tax"))
        total = decimal_or_none(payload.get("total"))
        if total is None:
            warnings.append("Total could not be read.")
        if subtotal is not None and tax is not None and total is not None and (subtotal + tax) != total:
            warnings.append("Subtotal plus tax does not equal total.")
        purchase_date = parse_date(clean_text(payload.get("purchase_date")))
        if purchase_date and purchase_date > timezone.localdate():
            warnings.append("Receipt date is in the future.")
        return warnings

    def _masked_payment(self, value: str) -> str:
        digits = re.sub(r"\D+", "", value or "")
        if len(digits) >= 4:
            return f"Card ending {digits[-4:]}"
        return clean_text(value)


class OpenAISmartCaptureProvider:
    provider_name = PROVIDER_OPENAI

    def __init__(self, *, session: ProjectAssistantSmartCaptureSession | None = None, actor=None):
        self.session = session
        self.actor = actor
        self.model = smart_capture_model()

    def extract_receipt(self, file_bytes: bytes, filename: str = "") -> dict:
        payload, meta = self._call_openai(
            capture_type=ProjectAssistantSmartCaptureSession.CAPTURE_RECEIPT,
            file_bytes=file_bytes,
            filename=filename,
        )
        try:
            normalized = validate_openai_payload(ProjectAssistantSmartCaptureSession.CAPTURE_RECEIPT, payload)
        except Exception:
            self._log_validation_failure(meta)
            raise
        self._log_success(meta)
        return build_openai_extraction_result(
            capture_type=ProjectAssistantSmartCaptureSession.CAPTURE_RECEIPT,
            payload=payload,
            normalized=normalized,
            meta=meta,
        )

    def extract_label(self, capture_type: str, file_bytes: bytes, filename: str = "") -> dict:
        payload, meta = self._call_openai(capture_type=capture_type, file_bytes=file_bytes, filename=filename)
        try:
            normalized = validate_openai_payload(capture_type, payload)
        except Exception:
            self._log_validation_failure(meta)
            raise
        self._log_success(meta)
        # Destination is a human choice. Keep it blank for OpenAI extraction.
        normalized["destination"] = ""
        return build_openai_extraction_result(capture_type=capture_type, payload=payload, normalized=normalized, meta=meta)

    def _log_success(self, meta: dict):
        log_openai_usage(
            session=self.session,
            actor=self.actor,
            model=self.model,
            started_at=meta.get("started_at"),
            completed_at=meta.get("completed_at"),
            success=True,
            failure_code="",
            provider_request_id=meta.get("provider_request_id", ""),
            usage=meta.get("usage_obj"),
            cache_hit=False,
            provider_error_details={},
        )

    def _log_validation_failure(self, meta: dict):
        log_openai_usage(
            session=self.session,
            actor=self.actor,
            model=self.model,
            started_at=meta.get("started_at"),
            completed_at=meta.get("completed_at"),
            success=False,
            failure_code="schema_validation_failed",
            provider_request_id=meta.get("provider_request_id", ""),
            usage=meta.get("usage_obj"),
            cache_hit=False,
            provider_error_details={},
        )

    def _call_openai(self, *, capture_type: str, file_bytes: bytes, filename: str) -> tuple[dict, dict]:
        if not getattr(settings, "SMART_CAPTURE_OPENAI_ENABLED", True):
            raise SmartCaptureProviderError("OpenAI Smart Capture is disabled. Continue manually or switch providers.", "provider_disabled")
        api_key = clean_text(getattr(settings, "OPENAI_API_KEY", "")) or clean_text(getattr(settings, "AI_OPENAI_API_KEY", ""))
        if not api_key:
            raise SmartCaptureProviderError("OpenAI Smart Capture is not configured. Continue manually or switch providers.", "missing_api_key")
        if self.session and self.session.mime_type == "application/pdf":
            raise SmartCaptureProviderError("PDF Smart Capture with OpenAI is not enabled in this workflow. Continue manually or upload an image.", "unsupported_file")
        max_mb = int(getattr(settings, "SMART_CAPTURE_MAX_IMAGE_SIZE_MB", 10) or 10)
        if len(file_bytes) > max_mb * 1024 * 1024:
            raise SmartCaptureProviderError("Image is too large for OpenAI Smart Capture.", "file_too_large")

        client = require_openai_client(api_key=api_key)
        started = timezone.now()
        start_monotonic = time.monotonic()
        schema = openai_schema(capture_type)
        try:
            response = client.responses.create(
                model=self.model,
                input=[
                    {
                        "role": "system",
                        "content": openai_system_prompt(capture_type),
                    },
                    {
                        "role": "user",
                        "content": [
                            {"type": "input_text", "text": openai_user_prompt(capture_type, filename)},
                            {
                                "type": "input_image",
                                "image_url": image_data_url(file_bytes, self.session.mime_type if self.session else "image/jpeg"),
                                "detail": "high",
                            },
                        ],
                    },
                ],
                text={
                    "format": {
                        "type": "json_schema",
                        "name": schema["name"],
                        "schema": schema["schema"],
                        "strict": True,
                    }
                },
                timeout=int(getattr(settings, "SMART_CAPTURE_TIMEOUT_SECONDS", 30) or 30),
            )
        except Exception as exc:
            completed = timezone.now()
            diagnostics = sanitized_openai_error_details(exc)
            log_openai_usage(
                session=self.session,
                actor=self.actor,
                model=self.model,
                started_at=started,
                completed_at=completed,
                success=False,
                failure_code=classify_openai_error(exc),
                provider_request_id=diagnostics.get("provider_request_id", ""),
                usage=None,
                cache_hit=False,
                provider_error_details=diagnostics,
            )
            logger.warning(
                "Smart Capture OpenAI provider error",
                extra={"smart_capture_openai_error": diagnostics},
            )
            raise SmartCaptureProviderError(safe_openai_error(exc), classify_openai_error(exc), diagnostics=diagnostics) from exc

        raw = getattr(response, "output_text", "") or "{}"
        try:
            payload = json.loads(raw)
        except Exception as exc:
            completed = timezone.now()
            log_openai_usage(
                session=self.session,
                actor=self.actor,
                model=self.model,
                started_at=started,
                completed_at=completed,
                success=False,
                failure_code="malformed_json",
                provider_request_id=getattr(response, "id", "") or "",
                usage=getattr(response, "usage", None),
                cache_hit=False,
                provider_error_details={},
            )
            raise SmartCaptureProviderError("OpenAI returned malformed extraction data. Retry or continue manually.", "malformed_json") from exc

        completed = timezone.now()
        meta = {
            "provider": PROVIDER_OPENAI,
            "model": self.model,
            "prompt_version": SMART_CAPTURE_PROMPT_VERSION,
            "provider_request_id": getattr(response, "id", "") or "",
            "processing_time_ms": int((time.monotonic() - start_monotonic) * 1000),
            "usage": usage_payload(getattr(response, "usage", None)),
            "usage_obj": getattr(response, "usage", None),
            "started_at": started,
            "completed_at": completed,
        }
        return payload, meta


def require_openai_client(*, api_key: str):
    try:
        from openai import OpenAI  # type: ignore
    except Exception as exc:
        raise SmartCaptureProviderError("OpenAI SDK is not installed.", "sdk_missing") from exc
    return OpenAI(api_key=api_key)


def image_data_url(file_bytes: bytes, mime_type: str) -> str:
    mime = mime_type if mime_type in {"image/jpeg", "image/png", "image/webp"} else "image/jpeg"
    return f"data:{mime};base64,{base64.b64encode(file_bytes).decode('ascii')}"


def openai_system_prompt(capture_type: str) -> str:
    if capture_type in RECEIPT_CAPTURE_TYPES:
        return (
            "You extract receipt fields from an image for a contractor expense draft. "
            "Return JSON only through the provided schema. Use null for unknown values. "
            "Do not invent merchant names, dates, totals, line items, categories, projects, or milestones. "
            "Never return full payment card numbers or CVV. Mask visible card digits as 'Card ending 1234'. "
            "Do not create records or recommend payment/reimbursement actions."
        )
    return (
        "You extract equipment or product label fields from an image for a contractor asset draft. "
        "Return JSON only through the provided schema. Use null for unknown values. "
        "Do not fabricate serial numbers, ownership, destination, warranty expiration, or maintenance actions. "
        "If a warranty value is calculated from visible text, say so in warnings and mark the field needs_review."
    )


def openai_user_prompt(capture_type: str, filename: str) -> str:
    if capture_type in RECEIPT_CAPTURE_TYPES:
        return f"Extract only visible receipt data from {filename or 'this image'}."
    return f"Extract only visible equipment/product label data from {filename or 'this image'}."


def openai_schema(capture_type: str) -> dict:
    confidence_value_schema = {"type": ["string", "null"], "enum": sorted(CONFIDENCE_VALUES) + [None]}
    missing_schema = {
        "type": "array",
        "items": {
            "type": "object",
            "additionalProperties": False,
            "required": ["field", "label"],
            "properties": {"field": {"type": "string"}, "label": {"type": "string"}},
        },
    }
    if capture_type in RECEIPT_CAPTURE_TYPES:
        props = {
            key: {"type": ["string", "null"]}
            for key in [
                "merchant_name",
                "merchant_address",
                "purchase_date",
                "purchase_time",
                "receipt_number",
                "subtotal",
                "tax",
                "total",
                "currency",
                "payment_method_masked",
                "suggested_category",
                "project_reference",
                "milestone_reference",
                "customer_reference",
                "notes",
            ]
        }
        props["line_items"] = {
            "type": "array",
            "items": {
                "type": "object",
                "additionalProperties": False,
                "required": ["description", "quantity", "unit_price", "total", "sku"],
                "properties": {key: {"type": ["string", "null"]} for key in ["description", "quantity", "unit_price", "total", "sku"]},
            },
        }
        props["warnings"] = {"type": "array", "items": {"type": "string"}}
        props["missing_fields"] = missing_schema
        confidence_fields = [
            key
            for key in props.keys()
            if key not in {"line_items", "warnings", "missing_fields", "field_confidence"}
        ]
        confidence_schema = {
            "type": "object",
            "additionalProperties": False,
            "required": confidence_fields,
            "properties": {key: confidence_value_schema for key in confidence_fields},
        }
        props["field_confidence"] = confidence_schema
        required = list(props.keys())
        return {"name": "smart_capture_receipt", "schema": {"type": "object", "additionalProperties": False, "required": required, "properties": props}}

    props = {
        key: {"type": ["string", "null"]}
        for key in [
            "asset_type",
            "product_name",
            "manufacturer",
            "brand",
            "model_number",
            "serial_number",
            "sku",
            "barcode",
            "manufacture_date",
            "purchase_date",
            "warranty_period",
            "warranty_expiration",
            "voltage",
            "capacity",
            "size",
            "color_or_finish",
            "lot_or_batch_number",
            "notes",
        ]
    }
    props["warnings"] = {"type": "array", "items": {"type": "string"}}
    props["missing_fields"] = missing_schema
    confidence_fields = [
        key
        for key in props.keys()
        if key not in {"warnings", "missing_fields", "field_confidence"}
    ]
    confidence_schema = {
        "type": "object",
        "additionalProperties": False,
        "required": confidence_fields,
        "properties": {key: confidence_value_schema for key in confidence_fields},
    }
    props["field_confidence"] = confidence_schema
    required = list(props.keys())
    return {"name": "smart_capture_label", "schema": {"type": "object", "additionalProperties": False, "required": required, "properties": props}}


def sanitize_string(value, max_length=500) -> str:
    text = clean_text(value)
    return text[:max_length]


def normalize_blank_values(value):
    if isinstance(value, str):
        return None if value.strip() == "" else value
    if isinstance(value, list):
        return [normalize_blank_values(item) for item in value]
    if isinstance(value, dict):
        return {key: normalize_blank_values(item) for key, item in value.items()}
    return value


def is_structurally_empty(value) -> bool:
    if value is None:
        return True
    if isinstance(value, str):
        return value.strip() == ""
    if isinstance(value, (list, tuple, set)):
        return len(value) == 0 or all(is_structurally_empty(item) for item in value)
    if isinstance(value, dict):
        return len(value) == 0 or all(is_structurally_empty(item) for item in value.values())
    return False


def normalize_decimal_value(value, *, field: str, warnings: list[str], places: int = 2) -> str | None:
    if value is None:
        return None
    if isinstance(value, str) and value.strip() == "":
        return None
    amount = decimal_or_none(value)
    if amount is None:
        warnings.append(f"{field.replace('_', ' ').title()} was not a valid number and needs review.")
        return None
    quantizer = Decimal("1") if places <= 0 else Decimal("1").scaleb(-places)
    return str(amount.quantize(quantizer))


def validate_date_string(value, *, field: str = "date", warnings: list[str] | None = None) -> str | None:
    text = sanitize_string(value, 32)
    if not text:
        return None
    parsed = parse_date(text)
    if parsed:
        return parsed.isoformat()
    if warnings is not None:
        warnings.append(f"{field.replace('_', ' ').title()} was not a valid date and needs review.")
    return None


def validate_time_string(value, *, field: str = "time", warnings: list[str] | None = None) -> str | None:
    text = sanitize_string(value, 32)
    if not text:
        return None
    parsed = parse_time(text)
    if parsed:
        return parsed.isoformat()
    if warnings is not None:
        warnings.append(f"{field.replace('_', ' ').title()} was not a valid time and needs review.")
    return None


def mask_card_details(value) -> str:
    text = sanitize_string(value, 80)
    digits = re.sub(r"\D+", "", text)
    if len(digits) >= 4:
        return f"Card ending {digits[-4:]}"
    return text if "cvv" not in text.lower() else ""


def validate_openai_payload(capture_type: str, payload: dict) -> dict:
    if not isinstance(payload, dict):
        raise SmartCaptureProviderError("OpenAI extraction returned an invalid object.", "schema_validation_failed")
    allowed = RECEIPT_FIELDS if capture_type == ProjectAssistantSmartCaptureSession.CAPTURE_RECEIPT else LABEL_FIELDS
    unexpected = sorted(set(payload.keys()) - allowed)
    if unexpected:
        raise SmartCaptureProviderError("OpenAI extraction returned unsupported fields.", "unexpected_fields")
    payload = normalize_blank_values(payload)
    warnings = []
    if capture_type == ProjectAssistantSmartCaptureSession.CAPTURE_RECEIPT:
        result = {
            key: sanitize_string(payload.get(key), 255) if payload.get(key) is not None else None
            for key in RECEIPT_FIELDS
            if key not in {"line_items", "warnings", "missing_fields", "field_confidence", "payment_method_masked"}
        }
        result["payment_method"] = mask_card_details(payload.get("payment_method_masked") or payload.get("payment_method")) or None
        for money_key in ["subtotal", "tax", "total"]:
            result[money_key] = normalize_decimal_value(payload.get(money_key), field=money_key, warnings=warnings)
        result["purchase_date"] = validate_date_string(payload.get("purchase_date"), field="purchase_date", warnings=warnings)
        result["purchase_time"] = validate_time_string(payload.get("purchase_time"), field="purchase_time", warnings=warnings)
        result["line_items"] = validate_line_items(payload.get("line_items"), warnings=warnings)
        category_raw = payload.get("suggested_category")
        result["suggested_category"] = normalized_category(category_raw)
        if not clean_text(category_raw) or result["suggested_category"] == "other":
            warnings.append("Suggested category defaulted to other; review before approval.")
        if not clean_text(payload.get("currency")):
            warnings.append("Currency was not detected; review before approval.")
        result["_normalization_warnings"] = warnings
        return result
    result = {
        key: sanitize_string(payload.get(key), 255) if payload.get(key) is not None else None
        for key in LABEL_FIELDS
        if key not in {"warnings", "missing_fields", "field_confidence"}
    }
    for date_key in ["manufacture_date", "purchase_date", "warranty_expiration"]:
        result[date_key] = validate_date_string(payload.get(date_key), field=date_key, warnings=warnings)
    result["notes"] = sanitize_string(payload.get("notes"), 1000) if payload.get("notes") is not None else None
    result["_normalization_warnings"] = warnings
    return result


def build_openai_extraction_result(*, capture_type: str, payload: dict, normalized: dict | None = None, meta: dict | None = None) -> dict:
    normalized = normalized if normalized is not None else validate_openai_payload(capture_type, payload)
    result = SmartCaptureExtractor(provider=PROVIDER_DETERMINISTIC).normalize_result(capture_type, "", normalized)
    result["warnings"] = merge_warning_lists(result.get("warnings"), payload.get("warnings"))
    result = reconcile_openai_normalization(
        capture_type=capture_type,
        result=result,
        provider_confidence=payload.get("field_confidence"),
    )
    result["raw_provider_output"] = payload
    result["provider_meta"] = meta or {}
    return result


def validate_line_items(value, *, warnings: list[str] | None = None) -> list[dict]:
    if value is None:
        return []
    if not isinstance(value, list):
        raise SmartCaptureProviderError("Receipt line items were malformed.", "invalid_line_items")
    rows = []
    warnings_list = warnings if warnings is not None else []
    for item in value[:80]:
        if not isinstance(item, dict):
            raise SmartCaptureProviderError("Receipt line item was malformed.", "invalid_line_items")
        unexpected = set(item.keys()) - {"description", "quantity", "unit_price", "total", "sku"}
        if unexpected:
            raise SmartCaptureProviderError("Receipt line item included unsupported fields.", "unexpected_fields")
        row = {
            "description": sanitize_string(item.get("description"), 180) if item.get("description") is not None else None,
            "quantity": normalize_decimal_value(item.get("quantity"), field="line item quantity", warnings=warnings_list, places=4),
            "unit_price": normalize_decimal_value(item.get("unit_price"), field="line item unit price", warnings=warnings_list),
            "total": normalize_decimal_value(item.get("total"), field="line item total", warnings=warnings_list),
            "sku": sanitize_string(item.get("sku"), 180) if item.get("sku") is not None else None,
        }
        rows.append(row)
    return rows


def missing_fields_for_payload(capture_type: str, payload: dict) -> list[dict]:
    required = ["merchant_name", "purchase_date", "total"]
    if capture_type != ProjectAssistantSmartCaptureSession.CAPTURE_RECEIPT:
        required = ["manufacturer", "model_number", "serial_number", "destination"]
    rows = []
    seen = set()
    for key in required:
        if key in seen:
            continue
        if is_structurally_empty(payload.get(key)):
            rows.append({"field": key, "label": key.replace("_", " ").title()})
            seen.add(key)
    return rows


def normalize_confidence_value(value: str | None) -> str:
    aliases = {
        "high": "high_confidence",
        "medium": "medium_confidence",
        "low": "low_confidence",
        "missing": "not_detected",
        "none": "not_detected",
    }
    text = clean_text(value)
    text = aliases.get(text, text)
    return text if text in CONFIDENCE_VALUES else "needs_review"


def reconcile_openai_normalization(*, capture_type: str, result: dict, provider_confidence) -> dict:
    payload = normalize_blank_values(result.get("structured_payload") or {})
    normalization_warnings = payload.pop("_normalization_warnings", []) or []
    base_confidence = result.get("field_confidence") or {}
    provider_confidence = provider_confidence if isinstance(provider_confidence, dict) else {}
    confidence = {}
    warnings = merge_warning_lists(result.get("warnings"), normalization_warnings)
    for key in payload.keys():
        if key in {"warnings", "missing_fields", "field_confidence"}:
            continue
        source_confidence = normalize_confidence_value(provider_confidence.get(key) or base_confidence.get(key))
        if is_structurally_empty(payload.get(key)):
            if source_confidence in {"confirmed", "high_confidence"}:
                warnings = merge_warning_lists(warnings, [f"{key.replace('_', ' ').title()} was missing despite high provider confidence."])
            confidence[key] = "not_detected"
            continue
        if key in {"suggested_category", "currency"} and confidence_indicates_missing(source_confidence):
            confidence[key] = "not_detected"
            continue
        if key == "suggested_category" and payload.get(key) == "other" and source_confidence in {"confirmed", "high_confidence"}:
            confidence[key] = "needs_review"
            warnings = merge_warning_lists(warnings, ["Suggested category is generic and needs review."])
            continue
        confidence[key] = source_confidence
    result["structured_payload"] = payload
    result["field_confidence"] = confidence
    result["missing_fields"] = missing_fields_for_payload(capture_type, payload)
    result["warnings"] = warnings
    return result


def confidence_indicates_missing(value: str) -> bool:
    return value in {"not_detected", "needs_review", ""}


def normalize_confidence(value, fallback=None) -> dict:
    fallback = fallback or {}
    if not isinstance(value, dict):
        return fallback
    normalized = {}
    for key, confidence in value.items():
        if confidence in CONFIDENCE_VALUES:
            normalized[sanitize_string(key, 80)] = confidence
    return {**fallback, **normalized}


def normalize_missing_fields(value, fallback=None) -> list[dict]:
    fallback = fallback or []
    if not isinstance(value, list):
        return fallback
    rows = []
    for row in value[:80]:
        if isinstance(row, dict):
            field = sanitize_string(row.get("field"), 80)
            label = sanitize_string(row.get("label"), 120)
            if field and label:
                rows.append({"field": field, "label": label})
    existing = {row.get("field") for row in rows}
    for row in fallback:
        if row.get("field") not in existing:
            rows.append(row)
    return rows


def merge_warning_lists(*values) -> list[str]:
    warnings = []
    for value in values:
        if isinstance(value, list):
            warnings.extend(sanitize_string(item, 300) for item in value if sanitize_string(item, 300))
    seen = set()
    unique = []
    for item in warnings:
        if item not in seen:
            unique.append(item)
            seen.add(item)
    return unique


def usage_payload(usage) -> dict:
    if usage is None:
        return {}
    return {
        "input_tokens": int(getattr(usage, "input_tokens", 0) or getattr(usage, "prompt_tokens", 0) or 0),
        "output_tokens": int(getattr(usage, "output_tokens", 0) or getattr(usage, "completion_tokens", 0) or 0),
        "total_tokens": int(getattr(usage, "total_tokens", 0) or 0),
    }


def redact_openai_diagnostic_text(value, max_length=500) -> str:
    text = sanitize_string(value, max_length)
    if not text:
        return ""
    text = re.sub(r"sk-[A-Za-z0-9_\-]{8,}", "[redacted-api-key]", text)
    text = re.sub(r"Bearer\s+[A-Za-z0-9_\-\.]+", "Bearer [redacted]", text, flags=re.IGNORECASE)
    text = re.sub(r"data:image/[^;]+;base64,[A-Za-z0-9+/=]+", "[redacted-image-data]", text, flags=re.IGNORECASE)
    text = re.sub(r"base64,[A-Za-z0-9+/=]{24,}", "base64,[redacted]", text, flags=re.IGNORECASE)
    return text[:max_length]


def _openai_error_body(exc):
    body = getattr(exc, "body", None)
    if isinstance(body, dict):
        return body
    response = getattr(exc, "response", None)
    if response is not None:
        try:
            data = response.json()
            if isinstance(data, dict):
                return data
        except Exception:
            pass
    return {}


def sanitized_openai_error_details(exc) -> dict:
    body = _openai_error_body(exc)
    error = body.get("error") if isinstance(body.get("error"), dict) else body
    response = getattr(exc, "response", None)
    headers = getattr(response, "headers", None) if response is not None else None
    provider_request_id = (
        clean_text(getattr(exc, "request_id", ""))
        or clean_text(getattr(exc, "request_id_header", ""))
        or clean_text(getattr(exc, "x_request_id", ""))
        or clean_text(getattr(exc, "_request_id", ""))
    )
    if not provider_request_id and headers:
        try:
            provider_request_id = clean_text(headers.get("x-request-id") or headers.get("openai-request-id") or "")
        except Exception:
            provider_request_id = ""
    status_code = getattr(exc, "status_code", None) or getattr(response, "status_code", None)
    return {
        "http_status": int(status_code) if str(status_code or "").isdigit() else None,
        "message": redact_openai_diagnostic_text(error.get("message") or getattr(exc, "message", "") or str(exc), 700),
        "type": redact_openai_diagnostic_text(error.get("type") or getattr(exc, "type", ""), 120),
        "code": redact_openai_diagnostic_text(error.get("code") or getattr(exc, "code", ""), 120),
        "param": redact_openai_diagnostic_text(error.get("param") or getattr(exc, "param", ""), 180),
        "provider_request_id": redact_openai_diagnostic_text(provider_request_id, 180),
    }


def classify_openai_error(exc) -> str:
    name = exc.__class__.__name__.lower()
    text = str(exc).lower()
    if "authentication" in name or "invalid api key" in text:
        return "authentication_failed"
    if "rate" in name or "rate limit" in text:
        return "rate_limited"
    if "quota" in text or "insufficient_quota" in text:
        return "quota_exceeded"
    if "timeout" in name or "timed out" in text:
        return "timeout"
    if "model" in text:
        return "invalid_model"
    if "connection" in name or "network" in text:
        return "network_error"
    return "provider_unavailable"


def safe_openai_error(exc) -> str:
    code = classify_openai_error(exc)
    return {
        "authentication_failed": "OpenAI authentication failed. Continue manually or check backend configuration.",
        "rate_limited": "OpenAI rate limit reached. Retry later or continue manually.",
        "quota_exceeded": "OpenAI quota is unavailable. Continue manually or check provider billing.",
        "timeout": "OpenAI extraction timed out. Retry extraction or continue manually.",
        "invalid_model": "Configured OpenAI Smart Capture model is unavailable.",
        "network_error": "OpenAI Smart Capture could not reach the provider.",
    }.get(code, "OpenAI Smart Capture is temporarily unavailable. Retry or continue manually.")


def log_openai_usage(
    *,
    session: ProjectAssistantSmartCaptureSession | None,
    actor,
    model: str,
    started_at,
    completed_at,
    success: bool,
    failure_code: str,
    provider_request_id: str,
    usage,
    cache_hit: bool,
    provider_error_details: dict | None = None,
):
    if not session or not getattr(settings, "SMART_CAPTURE_LOG_USAGE", True):
        return None
    usage_data = usage_payload(usage)
    billable = smart_capture_price(session.capture_type) if success and not cache_hit else Decimal("0.00")
    return AIUsageLedger.objects.create(
        contractor=session.contractor,
        property_profile=session.property_profile,
        customer_email=session.customer_email or "",
        user=actor,
        feature=smart_capture_feature(session.capture_type),
        provider=PROVIDER_OPENAI,
        model=model,
        source_type="project_assistant_smart_capture",
        source_id=str(session.id),
        capture_session=session,
        input_units=usage_data.get("input_tokens", 0),
        output_units=usage_data.get("output_tokens", 0),
        internal_cost=Decimal("0.0000"),
        billable_amount=billable,
        currency="USD",
        billing_status=AIUsageLedger.BILLING_UNBILLED if billable > 0 else AIUsageLedger.BILLING_NOT_BILLABLE,
        provider_request_id=provider_request_id or "",
        success=success,
        failure_code=failure_code or "",
        cache_hit=cache_hit,
        metadata={
            "prompt_version": SMART_CAPTURE_PROMPT_VERSION,
            "normalizer_version": SMART_CAPTURE_NORMALIZER_VERSION,
            "request_started_at": started_at.isoformat() if started_at else "",
            "request_completed_at": completed_at.isoformat() if completed_at else "",
            "processing_time_ms": int((completed_at - started_at).total_seconds() * 1000) if started_at and completed_at else 0,
            "usage": usage_data,
            "provider_error_details": provider_error_details or {},
            "estimated_internal_cost": "not_configured",
        },
    )


def file_sha256(file_bytes: bytes) -> str:
    return hashlib.sha256(file_bytes).hexdigest()


def validate_upload(file_obj) -> None:
    mime_type = getattr(file_obj, "content_type", "") or ""
    if mime_type not in ALLOWED_MIME_TYPES:
        raise ValueError("Upload a JPEG, PNG, WebP, or PDF file.")
    if getattr(file_obj, "size", 0) <= 0:
        raise ValueError("Uploaded file is empty.")
    max_bytes = int(getattr(settings, "SMART_CAPTURE_MAX_IMAGE_SIZE_MB", 8) or 8) * 1024 * 1024
    if getattr(file_obj, "size", 0) > max_bytes:
        raise ValueError("File is too large for Smart Capture.")


def possible_matches_for_session(session: ProjectAssistantSmartCaptureSession) -> list[dict]:
    matches = []
    if session.property_profile_id:
        from projects.models_customer_portal import PropertyIntelligenceRecord

        payload = session.structured_payload or {}
        serial = clean_text(payload.get("serial_number"))
        model_number = clean_text(payload.get("model_number"))
        manufacturer = clean_text(payload.get("manufacturer") or payload.get("brand"))
        if serial:
            duplicate = (
                PropertyIntelligenceRecord.objects.filter(
                    property_profile=session.property_profile,
                    serial_number__iexact=serial,
                    status=PropertyIntelligenceRecord.STATUS_ACTIVE,
                )
                .exclude(source_capture=session)
                .first()
            )
            if duplicate:
                matches.append({
                    "type": "property_intelligence_record",
                    "id": duplicate.id,
                    "label": duplicate.name or duplicate.get_record_type_display(),
                    "reason": "Same serial number appears in an existing home record.",
                })
        if not matches and model_number and manufacturer:
            duplicate = (
                PropertyIntelligenceRecord.objects.filter(
                    property_profile=session.property_profile,
                    model_number__iexact=model_number,
                    manufacturer__iexact=manufacturer,
                    status=PropertyIntelligenceRecord.STATUS_ACTIVE,
                )
                .exclude(source_capture=session)
                .first()
            )
            if duplicate:
                matches.append({
                    "type": "property_intelligence_record",
                    "id": duplicate.id,
                    "label": duplicate.name or duplicate.get_record_type_display(),
                    "reason": "Same manufacturer and model appear in an existing home record.",
                })
        if session.file_sha256:
            duplicate = (
                ProjectAssistantSmartCaptureSession.objects.filter(
                    property_profile=session.property_profile,
                    file_sha256=session.file_sha256,
                    status=ProjectAssistantSmartCaptureSession.STATUS_COMPLETED,
                )
                .exclude(pk=session.pk)
                .first()
            )
            if duplicate:
                matches.append({
                    "type": "source_file",
                    "id": str(duplicate.id),
                    "label": "Possible existing home record",
                    "reason": "This source file hash has already been approved for this property.",
                })
        return matches

    if session.file_sha256:
        duplicate = (
            ProjectAssistantSmartCaptureSession.objects.filter(
                contractor=session.contractor,
                file_sha256=session.file_sha256,
                status=ProjectAssistantSmartCaptureSession.STATUS_COMPLETED,
            )
            .exclude(pk=session.pk)
            .first()
        )
        if duplicate:
            matches.append({
                "type": "source_file",
                "id": str(duplicate.id),
                "label": "Possible duplicate source image",
                "reason": "This file hash has already been approved in Smart Capture.",
            })
    payload = session.structured_payload or {}
    if session.capture_type == ProjectAssistantSmartCaptureSession.CAPTURE_RECEIPT:
        total = decimal_or_none(payload.get("total"))
        merchant = clean_text(payload.get("merchant_name"))
        if total is not None and merchant:
            duplicate_expense = ExpenseRequest.objects.filter(
                agreement__contractor=session.contractor,
                amount=total,
                description__icontains=merchant,
            ).first()
            if duplicate_expense:
                matches.append({
                    "type": "expense",
                    "id": duplicate_expense.id,
                    "label": duplicate_expense.description,
                    "reason": "Same merchant text and amount appear in an existing expense.",
                })
    else:
        serial = clean_text(payload.get("serial_number"))
        if serial:
            duplicate_asset = ContractorAsset.objects.filter(contractor=session.contractor, serial_number__iexact=serial).first()
            if duplicate_asset:
                matches.append({
                    "type": "asset",
                    "id": duplicate_asset.id,
                    "label": duplicate_asset.name,
                    "reason": "Same serial number appears in an existing asset.",
                })
    return matches


@transaction.atomic
def create_smart_capture_session(*, contractor, actor, capture_type: str, file_obj, force_refresh: bool = False) -> ProjectAssistantSmartCaptureSession:
    valid_types = {choice[0] for choice in ProjectAssistantSmartCaptureSession.CAPTURE_TYPE_CHOICES}
    if capture_type not in valid_types:
        raise ValueError("Choose a supported Smart Capture type.")
    validate_upload(file_obj)
    file_bytes = file_obj.read()
    file_obj.seek(0)
    session = ProjectAssistantSmartCaptureSession.objects.create(
        contractor=contractor,
        created_by=actor,
        capture_type=capture_type,
        original_file=file_obj,
        original_filename=getattr(file_obj, "name", "") or "upload",
        mime_type=getattr(file_obj, "content_type", "") or "",
        file_size=getattr(file_obj, "size", 0) or len(file_bytes),
        file_sha256=file_sha256(file_bytes),
        source_metadata={"upload_method": "project_assistant_smart_capture"},
        audit_metadata={
            "created_by": getattr(actor, "id", None),
            "created_at": timezone.now().isoformat(),
            "no_autonomous_record_creation": True,
        },
    )
    run_extraction(session, file_bytes=file_bytes, force_refresh=force_refresh)
    return session


@transaction.atomic
def create_customer_smart_capture_session(*, property_profile, customer_email: str, actor, capture_type: str, file_obj, force_refresh: bool = False) -> ProjectAssistantSmartCaptureSession:
    if capture_type not in CUSTOMER_CAPTURE_TYPES:
        raise ValueError("Choose a supported customer Smart Capture type.")
    validate_upload(file_obj)
    file_bytes = file_obj.read()
    file_obj.seek(0)
    session = ProjectAssistantSmartCaptureSession.objects.create(
        contractor=None,
        property_profile=property_profile,
        customer_email=clean_text(customer_email).lower(),
        created_by=actor if getattr(actor, "is_authenticated", False) else None,
        capture_type=capture_type,
        original_file=file_obj,
        original_filename=getattr(file_obj, "name", "") or "upload",
        mime_type=getattr(file_obj, "content_type", "") or "",
        file_size=getattr(file_obj, "size", 0) or len(file_bytes),
        file_sha256=file_sha256(file_bytes),
        source_metadata={"upload_method": "customer_portal_smart_capture"},
        structured_payload={"property_id": getattr(property_profile, "id", None)},
        audit_metadata={
            "created_by": getattr(actor, "id", None),
            "created_at": timezone.now().isoformat(),
            "customer_email": clean_text(customer_email).lower(),
            "property_profile_id": getattr(property_profile, "id", None),
            "no_autonomous_record_creation": True,
            "no_contractor_expense_or_asset_creation": True,
        },
    )
    run_extraction(session, file_bytes=file_bytes, force_refresh=force_refresh)
    session.structured_payload = {
        **(session.structured_payload or {}),
        "property_id": getattr(property_profile, "id", None),
    }
    session.possible_matches = possible_matches_for_session(session)
    session.save(update_fields=["structured_payload", "possible_matches", "updated_at"])
    return session


@transaction.atomic
def run_extraction(session: ProjectAssistantSmartCaptureSession, *, file_bytes: bytes | None = None, force_refresh: bool = False) -> ProjectAssistantSmartCaptureSession:
    provider = smart_capture_provider()
    model = smart_capture_model() if provider == PROVIDER_OPENAI else "deterministic"
    cache_key = extraction_cache_key(provider=provider, model=model, file_hash=session.file_sha256, capture_type=session.capture_type)
    if provider == PROVIDER_OPENAI and not force_refresh:
        cached_qs = (
            ProjectAssistantSmartCaptureSession.objects.filter(
                extraction_cache_key=cache_key,
                extraction_provider=PROVIDER_OPENAI,
            )
            .exclude(pk=session.pk)
            .filter(status__in=[
                ProjectAssistantSmartCaptureSession.STATUS_REVIEW_READY,
                ProjectAssistantSmartCaptureSession.STATUS_NEEDS_INFORMATION,
                ProjectAssistantSmartCaptureSession.STATUS_COMPLETED,
            ])
            .order_by("-updated_at")
        )
        if session.contractor_id:
            cached_qs = cached_qs.filter(contractor=session.contractor)
        elif session.property_profile_id:
            cached_qs = cached_qs.filter(property_profile=session.property_profile)
        else:
            cached_qs = cached_qs.none()
        cached = cached_qs.first()
        if cached:
            raw_provider_output = (cached.audit_metadata or {}).get("raw_provider_output") or {}
            cached_normalizer_version = (cached.audit_metadata or {}).get("normalizer_version", "")
            if raw_provider_output:
                result = build_openai_extraction_result(
                    capture_type=session.capture_type,
                    payload=raw_provider_output,
                    meta={
                        "provider": PROVIDER_OPENAI,
                        "model": model,
                        "prompt_version": SMART_CAPTURE_PROMPT_VERSION,
                        "normalizer_version": SMART_CAPTURE_NORMALIZER_VERSION,
                        "provider_request_id": (cached.audit_metadata or {}).get("provider_request_id", ""),
                        "usage": (cached.audit_metadata or {}).get("provider_usage", {}),
                    },
                )
                session.raw_extracted_text = result["raw_extracted_text"]
                session.structured_payload = result["structured_payload"]
                session.field_confidence = result["field_confidence"]
                session.missing_fields = result["missing_fields"]
                session.warnings = merge_warning_lists(result["warnings"], ["Reused a previous successful OpenAI extraction for this source image."])
                session.extraction_provider = PROVIDER_OPENAI
                session.extraction_model = model
                session.extraction_prompt_version = SMART_CAPTURE_PROMPT_VERSION
                session.extraction_cache_key = cache_key
                session.status = ProjectAssistantSmartCaptureSession.STATUS_NEEDS_INFORMATION if session.missing_fields else ProjectAssistantSmartCaptureSession.STATUS_REVIEW_READY
                session.audit_metadata = {
                    **(session.audit_metadata or {}),
                    "extractor": PROVIDER_OPENAI,
                    "extractor_version": SMART_CAPTURE_PROMPT_VERSION,
                    "prompt_version": SMART_CAPTURE_PROMPT_VERSION,
                    "normalizer_version": SMART_CAPTURE_NORMALIZER_VERSION,
                    "model": model,
                    "cache_hit": True,
                    "cached_from_session": str(cached.id),
                    "cached_normalizer_version": cached_normalizer_version,
                    "provider_request_id": (cached.audit_metadata or {}).get("provider_request_id", ""),
                    "provider_usage": (cached.audit_metadata or {}).get("provider_usage", {}),
                    "raw_provider_output": raw_provider_output,
                    "extracted_at": timezone.now().isoformat(),
                }
                session.possible_matches = possible_matches_for_session(session)
                session.save()
                return session

    extractor = SmartCaptureExtractor(session=session, actor=session.created_by, provider=provider)
    if file_bytes is None:
        with session.original_file.open("rb") as source:
            file_bytes = source.read()
    session.status = ProjectAssistantSmartCaptureSession.STATUS_PROCESSING
    session.save(update_fields=["status", "updated_at"])
    try:
        if session.capture_type in RECEIPT_CAPTURE_TYPES:
            result = extractor.extract_receipt(file_bytes, session.original_filename)
        elif session.capture_type in {
            ProjectAssistantSmartCaptureSession.CAPTURE_EQUIPMENT_LABEL,
            ProjectAssistantSmartCaptureSession.CAPTURE_HOME_SYSTEM_LABEL,
            ProjectAssistantSmartCaptureSession.CAPTURE_APPLIANCE_LABEL,
        }:
            result = extractor.extract_equipment_label(file_bytes, session.original_filename)
        else:
            result = extractor.extract_product_label(file_bytes, session.original_filename)
        session.raw_extracted_text = result["raw_extracted_text"]
        session.structured_payload = result["structured_payload"]
        session.field_confidence = result["field_confidence"]
        session.missing_fields = result["missing_fields"]
        session.warnings = result["warnings"]
        session.extraction_provider = provider
        session.extraction_model = model
        session.extraction_prompt_version = SMART_CAPTURE_PROMPT_VERSION
        session.extraction_cache_key = cache_key
        session.status = (
            ProjectAssistantSmartCaptureSession.STATUS_NEEDS_INFORMATION
            if session.missing_fields
            else ProjectAssistantSmartCaptureSession.STATUS_REVIEW_READY
        )
        session.audit_metadata = {
            **(session.audit_metadata or {}),
            "extractor": extractor.provider_name,
            "extractor_version": extractor.provider_version,
            "model": model,
            "prompt_version": SMART_CAPTURE_PROMPT_VERSION,
            "normalizer_version": SMART_CAPTURE_NORMALIZER_VERSION,
            "cache_hit": False,
            "force_refresh": bool(force_refresh),
            "provider_request_id": (result.get("provider_meta") or {}).get("provider_request_id", ""),
            "provider_usage": (result.get("provider_meta") or {}).get("usage", {}),
            "raw_provider_output": result.get("raw_provider_output") or {},
            "extracted_at": timezone.now().isoformat(),
        }
        session.possible_matches = possible_matches_for_session(session)
        session.save()
    except Exception as exc:
        diagnostics = getattr(exc, "diagnostics", {}) or {}
        session.status = ProjectAssistantSmartCaptureSession.STATUS_FAILED
        session.extraction_provider = provider
        session.extraction_model = model
        session.extraction_prompt_version = SMART_CAPTURE_PROMPT_VERSION
        session.extraction_cache_key = cache_key
        session.warnings = [str(exc)]
        session.audit_metadata = {
            **(session.audit_metadata or {}),
            "extractor": provider,
            "model": model,
            "prompt_version": SMART_CAPTURE_PROMPT_VERSION,
            "normalizer_version": SMART_CAPTURE_NORMALIZER_VERSION,
            "failure_code": getattr(exc, "code", "extraction_failed"),
            "provider_error_details": diagnostics,
            "provider_request_id": diagnostics.get("provider_request_id", ""),
            "failed_at": timezone.now().isoformat(),
        }
        session.save()
    return session


def update_smart_capture_draft(session: ProjectAssistantSmartCaptureSession, payload: dict) -> ProjectAssistantSmartCaptureSession:
    session.structured_payload = {**(session.structured_payload or {}), **(payload or {})}
    result = SmartCaptureExtractor(provider=PROVIDER_DETERMINISTIC).normalize_result(session.capture_type, session.raw_extracted_text, session.structured_payload)
    session.field_confidence = {
        **(result["field_confidence"] or {}),
        **{key: "confirmed" for key in (payload or {}).keys()},
    }
    session.missing_fields = result["missing_fields"]
    session.warnings = result["warnings"]
    session.status = (
        ProjectAssistantSmartCaptureSession.STATUS_NEEDS_INFORMATION
        if session.missing_fields
        else ProjectAssistantSmartCaptureSession.STATUS_REVIEW_READY
    )
    session.audit_metadata = {
        **(session.audit_metadata or {}),
        "last_edited_at": timezone.now().isoformat(),
    }
    session.possible_matches = possible_matches_for_session(session)
    session.save()
    return session


def customer_record_type_for_capture(capture_type: str) -> str:
    from projects.models_customer_portal import PropertyIntelligenceRecord

    return {
        ProjectAssistantSmartCaptureSession.CAPTURE_HOME_SYSTEM_LABEL: PropertyIntelligenceRecord.RECORD_HOME_SYSTEM,
        ProjectAssistantSmartCaptureSession.CAPTURE_APPLIANCE_LABEL: PropertyIntelligenceRecord.RECORD_APPLIANCE,
        ProjectAssistantSmartCaptureSession.CAPTURE_INSTALLED_PRODUCT_LABEL: PropertyIntelligenceRecord.RECORD_INSTALLED_PRODUCT,
        ProjectAssistantSmartCaptureSession.CAPTURE_PROPERTY_RECEIPT: PropertyIntelligenceRecord.RECORD_RECEIPT,
        ProjectAssistantSmartCaptureSession.CAPTURE_WARRANTY_DOCUMENT: PropertyIntelligenceRecord.RECORD_WARRANTY,
        ProjectAssistantSmartCaptureSession.CAPTURE_MANUAL_DOCUMENT: PropertyIntelligenceRecord.RECORD_MANUAL,
        ProjectAssistantSmartCaptureSession.CAPTURE_PAINT_FINISH_LABEL: PropertyIntelligenceRecord.RECORD_PAINT_FINISH,
        ProjectAssistantSmartCaptureSession.CAPTURE_FLOORING_MATERIAL_LABEL: PropertyIntelligenceRecord.RECORD_FLOORING_MATERIAL,
        ProjectAssistantSmartCaptureSession.CAPTURE_PROPERTY_PHOTO: PropertyIntelligenceRecord.RECORD_PHOTO,
    }.get(capture_type, PropertyIntelligenceRecord.RECORD_INSTALLED_PRODUCT)


def _payload_date(value):
    return parse_date(clean_text(value)) if value else None


def _source_title_for_property_record(session, payload):
    return (
        clean_text(payload.get("name"))
        or clean_text(payload.get("product_name"))
        or clean_text(payload.get("manufacturer"))
        or clean_text(payload.get("merchant_name"))
        or clean_text(session.original_filename)
        or "Smart Capture source"
    )[:200]


def _preserve_property_source_file(session, *, actor, payload):
    from projects.models_customer_portal import PropertyDocument, PropertyPhoto

    if not session.property_profile_id:
        return None, None
    session.original_file.open("rb")
    try:
        content = ContentFile(session.original_file.read())
    finally:
        session.original_file.close()
    title = _source_title_for_property_record(session, payload)
    if session.capture_type == ProjectAssistantSmartCaptureSession.CAPTURE_PROPERTY_PHOTO and not (session.mime_type or "").lower().endswith("pdf"):
        photo = PropertyPhoto(property_profile=session.property_profile, title=title)
        photo.photo.save(session.original_filename or "smart-capture-photo", content, save=True)
        return None, photo
    document_type = {
        ProjectAssistantSmartCaptureSession.CAPTURE_PROPERTY_RECEIPT: "Receipt",
        ProjectAssistantSmartCaptureSession.CAPTURE_WARRANTY_DOCUMENT: "Warranty",
        ProjectAssistantSmartCaptureSession.CAPTURE_MANUAL_DOCUMENT: "Manual",
        ProjectAssistantSmartCaptureSession.CAPTURE_PAINT_FINISH_LABEL: "Paint or Finish",
        ProjectAssistantSmartCaptureSession.CAPTURE_FLOORING_MATERIAL_LABEL: "Flooring or Material",
    }.get(session.capture_type, "Home Record")
    document = PropertyDocument(
        property_profile=session.property_profile,
        title=title,
        document_type=document_type,
        upload_source=PropertyDocument.UPLOAD_SOURCE_PORTAL_DESKTOP,
    )
    document.file.save(session.original_filename or "smart-capture-source", content, save=True)
    return document, None


def _create_property_intelligence_from_capture(session, *, actor, payload):
    from projects.models_customer_portal import PropertyIntelligenceRecord

    if not session.property_profile_id:
        raise ValueError("Choose a property before saving this home record.")
    if str(payload.get("property_id") or session.property_profile_id) != str(session.property_profile_id):
        raise ValueError("Choose a property you are authorized to update.")
    source_document, source_photo = _preserve_property_source_file(session, actor=actor, payload=payload)
    record_type = clean_text(payload.get("record_type")) or customer_record_type_for_capture(session.capture_type)
    valid_types = {choice[0] for choice in PropertyIntelligenceRecord.RECORD_TYPE_CHOICES}
    if record_type not in valid_types:
        record_type = customer_record_type_for_capture(session.capture_type)
    name = (
        clean_text(payload.get("name"))
        or clean_text(payload.get("product_name"))
        or clean_text(payload.get("merchant_name"))
        or clean_text(payload.get("manufacturer"))
        or PropertyIntelligenceRecord(record_type=record_type).get_record_type_display()
    )
    record = PropertyIntelligenceRecord.objects.create(
        property_profile=session.property_profile,
        customer_email=session.customer_email or getattr(session.property_profile, "customer_email", ""),
        created_by=actor if getattr(actor, "is_authenticated", False) else None,
        source_type="smart_capture",
        record_type=record_type,
        category=clean_text(payload.get("suggested_category") or payload.get("category")),
        name=name[:255],
        manufacturer=clean_text(payload.get("manufacturer")),
        brand=clean_text(payload.get("brand")),
        model_number=clean_text(payload.get("model_number")),
        serial_number=clean_text(payload.get("serial_number")),
        sku=clean_text(payload.get("sku")),
        barcode=clean_text(payload.get("barcode")),
        room_or_location=clean_text(payload.get("room_or_location") or payload.get("location")),
        system_type=clean_text(payload.get("system_type") or payload.get("asset_type")),
        product_type=clean_text(payload.get("product_type") or payload.get("asset_type")),
        color_name=clean_text(payload.get("color_name") or payload.get("color_or_finish")),
        color_code=clean_text(payload.get("color_code")),
        finish=clean_text(payload.get("finish") or payload.get("color_or_finish")),
        material=clean_text(payload.get("material")),
        lot_or_batch_number=clean_text(payload.get("lot_or_batch_number")),
        capacity=clean_text(payload.get("capacity")),
        voltage=clean_text(payload.get("voltage")),
        manufacture_date=_payload_date(payload.get("manufacture_date")),
        purchase_date=_payload_date(payload.get("purchase_date")),
        installation_date=_payload_date(payload.get("installation_date")),
        warranty_start=_payload_date(payload.get("warranty_start")),
        warranty_expiration=_payload_date(payload.get("warranty_expiration")),
        expected_service_interval=clean_text(payload.get("expected_service_interval")),
        notes=clean_text(payload.get("notes")),
        structured_payload=payload,
        source_capture=session,
        source_document=source_document,
        source_photo=source_photo,
        visible_to_associated_contractors=bool(payload.get("visible_to_associated_contractors")),
    )
    return record


@transaction.atomic
def approve_smart_capture(session: ProjectAssistantSmartCaptureSession, *, actor, approved_payload: dict | None = None):
    if session.status in {
        ProjectAssistantSmartCaptureSession.STATUS_COMPLETED,
        ProjectAssistantSmartCaptureSession.STATUS_CANCELLED,
    }:
        raise ValueError("This Smart Capture session is no longer editable.")
    if approved_payload:
        session = update_smart_capture_draft(session, approved_payload)
    payload = session.structured_payload or {}
    if session.property_profile_id:
        record = _create_property_intelligence_from_capture(session, actor=actor, payload=payload)
        session.created_property_intelligence_record = record
        result = {"created_property_intelligence_record": record.id}
        session.mark_completed(actor, payload)
        session.audit_metadata = {
            **(session.audit_metadata or {}),
            "approval_result": result,
            "source_file_preserved": True,
            "no_contractor_expense_or_asset_creation": True,
            "no_payment_reimbursement_warranty_claim_or_maintenance_action": True,
        }
        session.save()
        return session

    if session.capture_type == ProjectAssistantSmartCaptureSession.CAPTURE_RECEIPT:
        record = _create_expense_from_capture(session, actor=actor, payload=payload)
        session.created_expense = record
        result = {"created_expense": record.id}
    else:
        destination = clean_text(payload.get("destination")) or ContractorAsset.OWNER_CONTRACTOR
        if destination == ContractorAsset.OWNER_CUSTOMER_PROPERTY and payload.get("property_id"):
            record = _create_property_home_system_from_capture(session, actor=actor, payload=payload)
            session.created_property_record = record
            result = {"created_property_record": record.id}
        else:
            record = _create_asset_from_capture(session, actor=actor, payload=payload, destination=destination)
            session.created_asset = record
            result = {"created_asset": record.id}
    session.mark_completed(actor, payload)
    session.audit_metadata = {
        **(session.audit_metadata or {}),
        "approval_result": result,
        "source_file_preserved": True,
    }
    session.save()
    return session


def _create_expense_from_capture(session, *, actor, payload):
    amount = decimal_or_none(payload.get("amount") or payload.get("total"))
    if amount is None or amount <= 0:
        raise ValueError("Expense amount is required before approval.")
    incurred_date = parse_date(clean_text(payload.get("incurred_date") or payload.get("purchase_date"))) or timezone.localdate()
    description = clean_text(payload.get("description")) or clean_text(payload.get("merchant_name")) or "Smart Capture receipt"
    expense = ExpenseRequest.objects.create(
        agreement_id=payload.get("agreement_id") or None,
        milestone_id=payload.get("milestone_id") or None,
        description=description[:255],
        amount=amount,
        incurred_date=incurred_date,
        category=normalized_category(payload.get("category") or payload.get("suggested_category")),
        request_kind=ExpenseRequest.RequestKind.DIRECT_EXPENSE,
        funding_source=ExpenseRequest.FundingSource.REIMBURSEMENT,
        status=ExpenseRequest.Status.DRAFT,
        notes_to_homeowner=clean_text(payload.get("notes")),
        created_by=actor,
    )
    session.original_file.open("rb")
    try:
        content = ContentFile(session.original_file.read())
        expense.receipt.save(session.original_filename or "receipt", content, save=True)
    finally:
        session.original_file.close()
    session.original_file.open("rb")
    try:
        attachment = ExpenseRequestAttachment(expense_request=expense, original_name=session.original_filename, uploaded_by=actor)
        attachment.file.save(session.original_filename or "receipt", ContentFile(session.original_file.read()), save=True)
    finally:
        session.original_file.close()
    return expense


def _create_asset_from_capture(session, *, actor, payload, destination: str):
    name = clean_text(payload.get("name") or payload.get("product_name") or payload.get("model_number") or "Smart Capture asset")
    return ContractorAsset.objects.create(
        contractor=session.contractor,
        owner_type=destination if destination in dict(ContractorAsset.OWNER_TYPE_CHOICES) else ContractorAsset.OWNER_CONTRACTOR,
        asset_type=clean_text(payload.get("asset_type")),
        name=name[:255],
        manufacturer=clean_text(payload.get("manufacturer") or payload.get("brand")),
        model_number=clean_text(payload.get("model_number")),
        serial_number=clean_text(payload.get("serial_number")),
        sku=clean_text(payload.get("sku")),
        purchase_date=parse_date(clean_text(payload.get("purchase_date"))) if payload.get("purchase_date") else None,
        warranty_expiration=parse_date(clean_text(payload.get("warranty_expiration"))) if payload.get("warranty_expiration") else None,
        current_location=clean_text(payload.get("current_location")),
        notes=clean_text(payload.get("notes")),
        source_capture=session,
        created_by=actor,
    )


def _create_property_home_system_from_capture(session, *, actor, payload):
    from projects.models_customer_portal import PropertyHomeSystem, PropertyProfile

    profile = PropertyProfile.objects.filter(pk=payload.get("property_id")).first()
    if profile is None:
        raise ValueError("Choose a valid property before saving this property record.")
    system_type = clean_text(payload.get("asset_type")) or PropertyHomeSystem.SYSTEM_OTHER
    valid_types = {choice[0] for choice in PropertyHomeSystem.SYSTEM_TYPE_CHOICES}
    if system_type not in valid_types:
        system_type = PropertyHomeSystem.SYSTEM_OTHER
    return PropertyHomeSystem.objects.create(
        property_profile=profile,
        system_type=system_type,
        custom_name=clean_text(payload.get("product_name") or payload.get("name")),
        manufacturer=clean_text(payload.get("manufacturer") or payload.get("brand")),
        model_number=clean_text(payload.get("model_number")),
        serial_number=clean_text(payload.get("serial_number")),
        warranty_expiration_date=parse_date(clean_text(payload.get("warranty_expiration"))) if payload.get("warranty_expiration") else None,
        notes=clean_text(payload.get("notes")),
    )
