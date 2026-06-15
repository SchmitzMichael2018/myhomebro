from __future__ import annotations

import re
from dataclasses import dataclass
from datetime import date

from django.utils import timezone

from projects.models_customer_portal import PropertyDocument, PropertyDocumentExtraction, PropertyHomeSystem


DATE_RE = re.compile(r"\b(20\d{2}|19\d{2})[-_/\. ]?(0?[1-9]|1[0-2])[-_/\. ]?([0-2]?\d|3[01])\b")
MODEL_RE = re.compile(r"\b(?:model|mdl|mod)[\s:#-]+([A-Z0-9][A-Z0-9._/-]{2,})\b", re.IGNORECASE)
SERIAL_RE = re.compile(r"\b(?:serial|ser|s/n|sn)[\s:#-]+([A-Z0-9][A-Z0-9._/-]{3,})\b", re.IGNORECASE)
PHONE_RE = re.compile(r"\b(?:\+?1[-.\s]?)?\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}\b")
EMAIL_RE = re.compile(r"\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b", re.IGNORECASE)

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
        return {
            "value": self.value,
            "confidence": self.confidence,
            "source_text": self.source_text,
            "apply_default": self.apply_default,
        }


def _safe_text(value) -> str:
    return str(value or "").strip()


def _document_text(document: PropertyDocument) -> str:
    parts = [
        _safe_text(document.title),
        _safe_text(document.document_type),
        _safe_text(getattr(getattr(document, "file", None), "name", "")),
    ]
    file_obj = getattr(document, "file", None)
    name = _safe_text(getattr(file_obj, "name", "")).lower()
    if name.endswith(".txt"):
        try:
            current = file_obj.tell()
        except Exception:
            current = None
        try:
            file_obj.seek(0)
            raw = file_obj.read(4096)
            if isinstance(raw, bytes):
                raw = raw.decode("utf-8", errors="ignore")
            parts.append(_safe_text(raw))
        except Exception:
            pass
        finally:
            if current is not None:
                try:
                    file_obj.seek(current)
                except Exception:
                    pass
    return " ".join(part for part in parts if part)


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


def _suggested_fields(document: PropertyDocument, home_system: PropertyHomeSystem | None, text: str) -> dict:
    suggestions: dict[str, dict] = {}

    manufacturer = _manufacturer(text)
    if manufacturer:
        suggestions["manufacturer"] = SuggestedField(
            value=manufacturer,
            confidence="medium",
            source_text=manufacturer,
            apply_default=not bool(_safe_text(getattr(home_system, "manufacturer", ""))),
        ).as_dict()

    model_match = MODEL_RE.search(text)
    if model_match:
        value = model_match.group(1).strip(".,;")
        suggestions["model_number"] = SuggestedField(
            value=value,
            confidence="high",
            source_text=model_match.group(0),
            apply_default=not bool(_safe_text(getattr(home_system, "model_number", ""))),
        ).as_dict()

    serial_match = SERIAL_RE.search(text)
    if serial_match:
        value = serial_match.group(1).strip(".,;")
        suggestions["serial_number"] = SuggestedField(
            value=value,
            confidence="high",
            source_text=serial_match.group(0),
            apply_default=False,
        ).as_dict()

    detected_date = _first_date(text)
    if detected_date:
        date_field = "warranty_expiration_date" if "warranty" in text.lower() else "install_date"
        suggestions[date_field] = SuggestedField(
            value=detected_date,
            confidence="low",
            source_text=detected_date,
            apply_default=False,
        ).as_dict()

    phone = PHONE_RE.search(text)
    if phone:
        suggestions["contractor_phone"] = SuggestedField(
            value=phone.group(0),
            confidence="low",
            source_text=phone.group(0),
            apply_default=False,
        ).as_dict()

    email = EMAIL_RE.search(text)
    if email:
        suggestions["contractor_email"] = SuggestedField(
            value=email.group(0),
            confidence="low",
            source_text=email.group(0),
            apply_default=False,
        ).as_dict()

    if home_system is not None and getattr(home_system, "system_type", ""):
        suggestions["equipment_type"] = SuggestedField(
            value=home_system.get_system_type_display(),
            confidence="medium",
            source_text=home_system.get_system_type_display(),
            apply_default=False,
        ).as_dict()

    return suggestions


def extract_home_system_document(document: PropertyDocument, home_system: PropertyHomeSystem | None = None) -> PropertyDocumentExtraction:
    extraction, _created = PropertyDocumentExtraction.objects.get_or_create(
        property_document=document,
        defaults={"home_system": home_system, "extraction_status": PropertyDocumentExtraction.STATUS_PENDING},
    )
    try:
        text = _document_text(document)
        extraction.home_system = home_system
        extraction.extracted_text = text[:8000]
        extraction.document_classification = _classification(document, text)
        extraction.suggested_fields = _suggested_fields(document, home_system, text)
        extraction.extraction_status = PropertyDocumentExtraction.STATUS_COMPLETED
        extraction.error_message = ""
    except Exception as exc:
        extraction.extraction_status = PropertyDocumentExtraction.STATUS_FAILED
        extraction.error_message = str(exc)[:1000]
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
