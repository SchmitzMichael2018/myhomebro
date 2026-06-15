from __future__ import annotations

import base64
import json
import logging
import mimetypes
import re
import time
from dataclasses import dataclass, field
from datetime import date
from typing import Any

from django.conf import settings
from django.utils import timezone

from projects.models_customer_portal import PropertyDocument, PropertyDocumentExtraction, PropertyHomeSystem


logger = logging.getLogger(__name__)

DATE_RE = re.compile(r"\b(20\d{2}|19\d{2})[-_/\. ]?(0?[1-9]|1[0-2])[-_/\. ]?([0-2]?\d|3[01])\b")
MODEL_RE = re.compile(r"\b(?:model|mdl|mod)[\s:#-]+([A-Z0-9][A-Z0-9._/-]{2,})\b", re.IGNORECASE)
SERIAL_RE = re.compile(r"\b(?:serial|ser|s/n|sn)[\s:#-]+([A-Z0-9][A-Z0-9._/-]{3,})\b", re.IGNORECASE)
PHONE_RE = re.compile(r"\b(?:\+?1[-.\s]?)?\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}\b")
EMAIL_RE = re.compile(r"\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b", re.IGNORECASE)

PROVIDER_STUB = "stub"
PROVIDER_AI = "ai"
SUPPORTED_PROVIDERS = {PROVIDER_STUB, PROVIDER_AI}
CONFIDENCE_VALUES = {"high", "medium", "low"}
MAX_TEXT_CHARS = 12000
MAX_AI_IMAGE_BYTES = 8 * 1024 * 1024

EXTRACTABLE_FIELDS = {
    "manufacturer",
    "model_number",
    "serial_number",
    "equipment_type",
    "install_date",
    "purchase_date",
    "warranty_start_date",
    "warranty_expiration_date",
    "contractor_name",
    "contractor_phone",
    "contractor_email",
    "warranty_duration",
    "warranty_term",
    "coverage_notes",
    "maintenance_interval",
    "service_frequency",
    "maintenance_recommendations",
    "condition",
    "notes",
}

HOME_SYSTEM_MODEL_FIELDS = {
    "manufacturer": "manufacturer",
    "model_number": "model_number",
    "serial_number": "serial_number",
    "install_date": "install_date",
    "warranty_expiration_date": "warranty_expiration_date",
    "condition": "condition",
    "notes": "notes",
}

MANUFACTURER_HINTS = [
    "carrier",
    "trane",
    "lennox",
    "goodman",
    "rheem",
    "ruud",
    "a.o. smith",
    "ao smith",
    "bradford white",
    "bosch",
    "samsung",
    "lg",
    "whirlpool",
    "ge",
    "maytag",
    "kenmore",
    "gaf",
    "owens corning",
    "pentair",
    "hayward",
]


@dataclass
class SuggestedField:
    value: str
    confidence: str = "medium"
    source_text: str = ""
    apply_default: bool = True

    def as_dict(self) -> dict:
        confidence = _confidence(self.confidence)
        return {
            "value": _safe_text(self.value),
            "confidence": confidence,
            "source_text": _safe_text(self.source_text),
            "apply_default": bool(self.apply_default) and confidence != "low",
        }


@dataclass
class ExtractionProviderResult:
    document_classification: str = ""
    confidence: str = "low"
    suggested_fields: dict[str, dict] = field(default_factory=dict)
    extracted_text: str = ""
    provider: str = PROVIDER_STUB
    fallback_used: bool = False
    error_message: str = ""


def _safe_text(value) -> str:
    return str(value or "").strip()


def _confidence(value: str) -> str:
    normalized = _safe_text(value).lower()
    return normalized if normalized in CONFIDENCE_VALUES else "low"


def _configured_provider() -> str:
    provider = _safe_text(getattr(settings, "HOME_SYSTEM_EXTRACTION_PROVIDER", PROVIDER_STUB)).lower()
    return provider if provider in SUPPORTED_PROVIDERS else PROVIDER_STUB


def _model_name() -> str:
    return (
        _safe_text(getattr(settings, "HOME_SYSTEM_EXTRACTION_MODEL", ""))
        or _safe_text(getattr(settings, "AI_OPENAI_MODEL_HOME_SYSTEM_EXTRACTION", ""))
        or _safe_text(getattr(settings, "AI_OPENAI_MODEL", ""))
        or "gpt-4.1-mini"
    )


def _require_openai_client():
    try:
        from openai import OpenAI  # type: ignore
    except Exception as exc:
        raise RuntimeError("OpenAI SDK not installed. Run: pip install openai") from exc

    api_key = getattr(settings, "OPENAI_API_KEY", None) or getattr(settings, "AI_OPENAI_API_KEY", None)
    if not api_key:
        raise RuntimeError("OPENAI_API_KEY is not set.")
    return OpenAI(api_key=api_key)


def _file_name(document: PropertyDocument) -> str:
    return _safe_text(getattr(getattr(document, "file", None), "name", ""))


def _read_file_bytes(document: PropertyDocument, limit: int = MAX_AI_IMAGE_BYTES + 1) -> bytes:
    file_obj = getattr(document, "file", None)
    if not file_obj:
        return b""
    try:
        current = file_obj.tell()
    except Exception:
        current = None
    try:
        file_obj.seek(0)
        raw = file_obj.read(limit)
        return raw if isinstance(raw, bytes) else bytes(raw or b"")
    finally:
        if current is not None:
            try:
                file_obj.seek(current)
            except Exception:
                pass


def _extract_pdf_text(document: PropertyDocument) -> str:
    name = _file_name(document).lower()
    content_type = _safe_text(getattr(getattr(document, "file", None), "content_type", "")).lower()
    if not (name.endswith(".pdf") or content_type == "application/pdf"):
        return ""
    raw = _read_file_bytes(document, limit=MAX_AI_IMAGE_BYTES)
    if not raw:
        return ""
    try:
        from pypdf import PdfReader  # type: ignore
        from io import BytesIO

        reader = PdfReader(BytesIO(raw))
        return "\n".join((page.extract_text() or "") for page in reader.pages)[:MAX_TEXT_CHARS]
    except Exception as exc:
        logger.info(
            "Home system PDF text extraction unavailable; falling back. document_id=%s error=%s",
            getattr(document, "id", None),
            exc.__class__.__name__,
        )
        return ""


def _document_text(document: PropertyDocument) -> str:
    parts = [
        _safe_text(document.title),
        _safe_text(document.document_type),
        _file_name(document),
        _extract_pdf_text(document),
    ]
    name = _file_name(document).lower()
    if name.endswith(".txt"):
        try:
            raw = _read_file_bytes(document, limit=4096)
            parts.append(raw.decode("utf-8", errors="ignore"))
        except Exception:
            pass
    return " ".join(part for part in parts if _safe_text(part))[:MAX_TEXT_CHARS]


def _first_date(text: str) -> str:
    match = DATE_RE.search(text)
    if not match:
        return ""
    year, month, day = match.groups()
    try:
        return date(int(year), int(month), int(day)).isoformat()
    except Exception:
        return ""


def _manufacturer(text: str) -> str:
    normalized = text.lower()
    for hint in MANUFACTURER_HINTS:
        if hint in normalized:
            if hint == "ao smith":
                return "A.O. Smith"
            if hint == "ge":
                return "GE"
            if hint == "lg":
                return "LG"
            return " ".join(piece.capitalize() for piece in hint.split())
    return ""


def _classification(document: PropertyDocument, text: str) -> str:
    haystack = f"{document.document_type} {document.title} {text}".lower()
    if "warranty" in haystack:
        return "Warranty"
    if "manual" in haystack or "owner guide" in haystack:
        return "Manual"
    if "receipt" in haystack:
        return "Receipt"
    if "invoice" in haystack:
        return "Invoice"
    if "service" in haystack:
        return "Service Record"
    if "label" in haystack or "model" in haystack or "serial" in haystack:
        return "Equipment Label"
    return document.document_type or "Other"


def _existing_home_system_value(home_system: PropertyHomeSystem | None, field_name: str) -> bool:
    if home_system is None:
        return False
    model_field = HOME_SYSTEM_MODEL_FIELDS.get(field_name)
    if not model_field:
        return False
    return bool(_safe_text(getattr(home_system, model_field, "")))


def _field(value: str, confidence: str, source_text: str = "", *, home_system=None, field_name: str = "") -> dict:
    normalized_confidence = _confidence(confidence)
    return SuggestedField(
        value=value,
        confidence=normalized_confidence,
        source_text=source_text,
        apply_default=normalized_confidence != "low" and not _existing_home_system_value(home_system, field_name),
    ).as_dict()


def _stub_suggested_fields(document: PropertyDocument, home_system: PropertyHomeSystem | None, text: str) -> dict:
    suggestions: dict[str, dict] = {}

    manufacturer = _manufacturer(text)
    if manufacturer:
        suggestions["manufacturer"] = _field(
            manufacturer,
            "medium",
            manufacturer,
            home_system=home_system,
            field_name="manufacturer",
        )

    model_match = MODEL_RE.search(text)
    if model_match:
        value = model_match.group(1).strip(".,;")
        suggestions["model_number"] = _field(
            value,
            "high",
            model_match.group(0),
            home_system=home_system,
            field_name="model_number",
        )

    serial_match = SERIAL_RE.search(text)
    if serial_match:
        value = serial_match.group(1).strip(".,;")
        suggestions["serial_number"] = _field(
            value,
            "high",
            serial_match.group(0),
            home_system=home_system,
            field_name="serial_number",
        )
        suggestions["serial_number"]["apply_default"] = False

    detected_date = _first_date(text)
    if detected_date:
        date_field = "warranty_expiration_date" if "warranty" in text.lower() else "install_date"
        suggestions[date_field] = _field(
            detected_date,
            "low",
            detected_date,
            home_system=home_system,
            field_name=date_field,
        )

    phone = PHONE_RE.search(text)
    if phone:
        suggestions["contractor_phone"] = _field(phone.group(0), "low", phone.group(0), field_name="contractor_phone")

    email = EMAIL_RE.search(text)
    if email:
        suggestions["contractor_email"] = _field(email.group(0), "low", email.group(0), field_name="contractor_email")

    if home_system is not None and getattr(home_system, "system_type", ""):
        suggestions["equipment_type"] = _field(
            home_system.get_system_type_display(),
            "medium",
            home_system.get_system_type_display(),
            field_name="equipment_type",
        )
        suggestions["equipment_type"]["apply_default"] = False

    return suggestions


def _stub_extract(document: PropertyDocument, home_system: PropertyHomeSystem | None = None) -> ExtractionProviderResult:
    text = _document_text(document)
    suggestions = _stub_suggested_fields(document, home_system, text)
    confidence = "medium" if suggestions else "low"
    return ExtractionProviderResult(
        document_classification=_classification(document, text),
        confidence=confidence,
        suggested_fields=suggestions,
        extracted_text=text,
        provider=PROVIDER_STUB,
    )


def _is_image_document(document: PropertyDocument) -> bool:
    name = _file_name(document).lower()
    content_type = _safe_text(getattr(getattr(document, "file", None), "content_type", "")).lower()
    return content_type.startswith("image/") or name.endswith((".jpg", ".jpeg", ".png", ".webp", ".gif"))


def _image_data_url(document: PropertyDocument) -> str:
    raw = _read_file_bytes(document, limit=MAX_AI_IMAGE_BYTES + 1)
    if not raw or len(raw) > MAX_AI_IMAGE_BYTES:
        return ""
    content_type = _safe_text(getattr(getattr(document, "file", None), "content_type", ""))
    if not content_type:
        content_type = mimetypes.guess_type(_file_name(document))[0] or "image/jpeg"
    return f"data:{content_type};base64,{base64.b64encode(raw).decode('ascii')}"


def _home_system_context(home_system: PropertyHomeSystem | None) -> dict:
    if home_system is None:
        return {}
    return {
        "system_type": getattr(home_system, "system_type", "") or "",
        "system_type_display": home_system.get_system_type_display() if getattr(home_system, "system_type", "") else "",
        "custom_name": getattr(home_system, "custom_name", "") or "",
        "manufacturer": getattr(home_system, "manufacturer", "") or "",
        "model_number": getattr(home_system, "model_number", "") or "",
        "serial_number": getattr(home_system, "serial_number", "") or "",
        "condition": getattr(home_system, "condition", "") or "",
        "notes": getattr(home_system, "notes", "") or "",
    }


def _field_schema() -> dict:
    return {
        "type": "object",
        "additionalProperties": False,
        "properties": {
            "value": {"type": "string"},
            "confidence": {"type": "string", "enum": ["high", "medium", "low"]},
            "source_text": {"type": "string"},
            "apply_default": {"type": "boolean"},
        },
        "required": ["value", "confidence", "source_text", "apply_default"],
    }


def _ai_schema() -> dict:
    nullable_field = {"anyOf": [_field_schema(), {"type": "null"}]}
    return {
        "name": "home_system_document_extraction",
        "schema": {
            "type": "object",
            "additionalProperties": False,
            "properties": {
                "document_classification": {"type": "string"},
                "confidence": {"type": "string", "enum": ["high", "medium", "low"]},
                "suggested_fields": {
                    "type": "object",
                    "additionalProperties": False,
                    "properties": {field_name: nullable_field for field_name in sorted(EXTRACTABLE_FIELDS)},
                    "required": sorted(EXTRACTABLE_FIELDS),
                },
            },
            "required": ["document_classification", "confidence", "suggested_fields"],
        },
    }


def _normalize_suggested_fields(raw_fields: dict, home_system: PropertyHomeSystem | None) -> dict:
    normalized: dict[str, dict] = {}
    if not isinstance(raw_fields, dict):
        return normalized
    for field_name in sorted(EXTRACTABLE_FIELDS):
        payload = raw_fields.get(field_name)
        if not isinstance(payload, dict):
            continue
        value = _safe_text(payload.get("value"))
        if not value:
            continue
        confidence = _confidence(payload.get("confidence"))
        apply_default = bool(payload.get("apply_default")) and confidence != "low"
        if _existing_home_system_value(home_system, field_name):
            apply_default = False
        normalized[field_name] = SuggestedField(
            value=value,
            confidence=confidence,
            source_text=_safe_text(payload.get("source_text")),
            apply_default=apply_default,
        ).as_dict()
    return normalized


def _ai_extract(document: PropertyDocument, home_system: PropertyHomeSystem | None = None) -> ExtractionProviderResult:
    client = _require_openai_client()
    model = _model_name()
    text = _document_text(document)
    image_url = _image_data_url(document) if _is_image_document(document) else ""

    if not text and not image_url:
        raise RuntimeError("No readable text or supported image content was available for AI extraction.")

    system_prompt = (
        "You extract structured homeowner home-system information from equipment labels, warranty cards, "
        "receipts, invoices, manuals, and service records.\n"
        "Return suggestions only. Never claim that values are final. Never create contractors, warranties, "
        "maintenance events, or overwrite existing records.\n"
        "Prefer exact visible label values. Use low confidence for ambiguous or inferred values.\n"
        "Use apply_default=false for low-confidence fields, serial numbers, contractor contact details, and "
        "any value that may be sensitive or ambiguous.\n"
        "Do not include document contents outside the JSON schema."
    )
    user_context = {
        "document": {
            "title": document.title or "",
            "document_type": document.document_type or "",
            "filename": _file_name(document),
        },
        "home_system": _home_system_context(home_system),
        "available_text": text,
        "instructions": {
            "fields": sorted(EXTRACTABLE_FIELDS),
            "confidence_rules": {
                "high": "Clear label values or explicit manufacturer/model/serial/date text.",
                "medium": "Likely but partially inferred values.",
                "low": "Uncertain, ambiguous, or inferred from weak evidence.",
            },
        },
    }
    content: list[dict[str, Any]] = [{"type": "input_text", "text": json.dumps(user_context, ensure_ascii=False)}]
    if image_url:
        content.append({"type": "input_image", "image_url": image_url})

    schema = _ai_schema()
    response = client.responses.create(
        model=model,
        input=[
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": content},
        ],
        text={
            "format": {
                "type": "json_schema",
                "name": schema["name"],
                "schema": schema["schema"],
                "strict": True,
            }
        },
    )
    raw = getattr(response, "output_text", "") or "{}"
    payload = json.loads(raw)
    fields = _normalize_suggested_fields(payload.get("suggested_fields") or {}, home_system)
    return ExtractionProviderResult(
        document_classification=_safe_text(payload.get("document_classification")) or _classification(document, text),
        confidence=_confidence(payload.get("confidence")),
        suggested_fields=fields,
        extracted_text=text,
        provider=PROVIDER_AI,
    )


def _extract_with_provider(document: PropertyDocument, home_system: PropertyHomeSystem | None = None) -> ExtractionProviderResult:
    provider = _configured_provider()
    if provider == PROVIDER_STUB:
        return _stub_extract(document, home_system)

    if provider == PROVIDER_AI:
        try:
            return _ai_extract(document, home_system)
        except Exception as exc:
            fallback = _stub_extract(document, home_system)
            fallback.fallback_used = True
            fallback.error_message = f"AI extraction failed; stub fallback used: {exc.__class__.__name__}"
            logger.warning(
                "Home system AI extraction failed; stub fallback used. document_id=%s error=%s",
                getattr(document, "id", None),
                exc.__class__.__name__,
                exc_info=True,
            )
            return fallback

    return _stub_extract(document, home_system)


def _confidence_summary(fields: dict[str, dict]) -> dict[str, int]:
    summary = {"high": 0, "medium": 0, "low": 0}
    for payload in fields.values():
        confidence = _confidence(payload.get("confidence") if isinstance(payload, dict) else "")
        summary[confidence] += 1
    return summary


def extract_home_system_document(document: PropertyDocument, home_system: PropertyHomeSystem | None = None) -> PropertyDocumentExtraction:
    extraction, _created = PropertyDocumentExtraction.objects.get_or_create(
        property_document=document,
        defaults={"home_system": home_system, "extraction_status": PropertyDocumentExtraction.STATUS_PENDING},
    )
    provider = _configured_provider()
    started = time.monotonic()
    try:
        result = _extract_with_provider(document, home_system)
        extraction.home_system = home_system
        extraction.extracted_text = (result.extracted_text or "")[:8000]
        extraction.document_classification = result.document_classification or "Other"
        extraction.suggested_fields = result.suggested_fields or {}
        extraction.extraction_status = PropertyDocumentExtraction.STATUS_COMPLETED
        extraction.error_message = (result.error_message or "")[:1000]
        logger.info(
            "Home system document extraction completed. document_id=%s provider=%s requested_provider=%s duration_ms=%s confidence=%s fallback=%s fields=%s",
            getattr(document, "id", None),
            result.provider,
            provider,
            int((time.monotonic() - started) * 1000),
            _confidence_summary(result.suggested_fields),
            result.fallback_used,
            len(result.suggested_fields or {}),
        )
    except Exception as exc:
        extraction.extraction_status = PropertyDocumentExtraction.STATUS_FAILED
        extraction.error_message = str(exc)[:1000]
        logger.exception(
            "Home system document extraction failed. document_id=%s provider=%s duration_ms=%s",
            getattr(document, "id", None),
            provider,
            int((time.monotonic() - started) * 1000),
        )
    extraction.updated_at = timezone.now()
    extraction.save(
        update_fields=[
            "home_system",
            "extracted_text",
            "document_classification",
            "suggested_fields",
            "extraction_status",
            "error_message",
            "updated_at",
        ]
    )
    return extraction
