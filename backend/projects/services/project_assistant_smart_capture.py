from __future__ import annotations

import hashlib
import re
from decimal import Decimal, InvalidOperation

from django.core.files.base import ContentFile
from django.db import transaction
from django.utils import timezone
from django.utils.dateparse import parse_date

from projects.models import (
    ContractorAsset,
    ExpenseRequest,
    ExpenseRequestAttachment,
    ProjectAssistantSmartCaptureSession,
)

ALLOWED_MIME_TYPES = {"image/jpeg", "image/png", "image/webp", "application/pdf"}
MAX_UPLOAD_BYTES = 8 * 1024 * 1024


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


class SmartCaptureExtractor:
    provider_name = "deterministic_text_fixture"
    provider_version = "phase_1"

    def extract_receipt(self, file_bytes: bytes, filename: str = "") -> dict:
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
        return self._extract_label("equipment_label", file_bytes, filename)

    def extract_product_label(self, file_bytes: bytes, filename: str = "") -> dict:
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


def file_sha256(file_bytes: bytes) -> str:
    return hashlib.sha256(file_bytes).hexdigest()


def validate_upload(file_obj) -> None:
    mime_type = getattr(file_obj, "content_type", "") or ""
    if mime_type not in ALLOWED_MIME_TYPES:
        raise ValueError("Upload a JPEG, PNG, WebP, or PDF file.")
    if getattr(file_obj, "size", 0) <= 0:
        raise ValueError("Uploaded file is empty.")
    if getattr(file_obj, "size", 0) > MAX_UPLOAD_BYTES:
        raise ValueError("File is too large for Smart Capture.")


def possible_matches_for_session(session: ProjectAssistantSmartCaptureSession) -> list[dict]:
    matches = []
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
def create_smart_capture_session(*, contractor, actor, capture_type: str, file_obj) -> ProjectAssistantSmartCaptureSession:
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
    run_extraction(session, file_bytes=file_bytes)
    return session


@transaction.atomic
def run_extraction(session: ProjectAssistantSmartCaptureSession, *, file_bytes: bytes | None = None) -> ProjectAssistantSmartCaptureSession:
    extractor = SmartCaptureExtractor()
    if file_bytes is None:
        with session.original_file.open("rb") as source:
            file_bytes = source.read()
    session.status = ProjectAssistantSmartCaptureSession.STATUS_PROCESSING
    session.save(update_fields=["status", "updated_at"])
    try:
        if session.capture_type == ProjectAssistantSmartCaptureSession.CAPTURE_RECEIPT:
            result = extractor.extract_receipt(file_bytes, session.original_filename)
        elif session.capture_type == ProjectAssistantSmartCaptureSession.CAPTURE_EQUIPMENT_LABEL:
            result = extractor.extract_equipment_label(file_bytes, session.original_filename)
        else:
            result = extractor.extract_product_label(file_bytes, session.original_filename)
        session.raw_extracted_text = result["raw_extracted_text"]
        session.structured_payload = result["structured_payload"]
        session.field_confidence = result["field_confidence"]
        session.missing_fields = result["missing_fields"]
        session.warnings = result["warnings"]
        session.status = (
            ProjectAssistantSmartCaptureSession.STATUS_NEEDS_INFORMATION
            if session.missing_fields
            else ProjectAssistantSmartCaptureSession.STATUS_REVIEW_READY
        )
        session.audit_metadata = {
            **(session.audit_metadata or {}),
            "extractor": extractor.provider_name,
            "extractor_version": extractor.provider_version,
            "extracted_at": timezone.now().isoformat(),
        }
        session.possible_matches = possible_matches_for_session(session)
        session.save()
    except Exception as exc:
        session.status = ProjectAssistantSmartCaptureSession.STATUS_FAILED
        session.warnings = [str(exc)]
        session.save(update_fields=["status", "warnings", "updated_at"])
    return session


def update_smart_capture_draft(session: ProjectAssistantSmartCaptureSession, payload: dict) -> ProjectAssistantSmartCaptureSession:
    session.structured_payload = {**(session.structured_payload or {}), **(payload or {})}
    result = SmartCaptureExtractor().normalize_result(session.capture_type, session.raw_extracted_text, session.structured_payload)
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
