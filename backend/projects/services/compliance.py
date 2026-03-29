from __future__ import annotations

from datetime import date
from typing import Any

from django.utils import timezone

from projects.models import Agreement, Contractor
from projects.models_compliance import ContractorComplianceRecord, StateTradeLicenseRequirement


TRADE_ALIASES = {
    "general_contractor": {"general contractor", "general construction", "general", "remodel", "construction"},
    "electrical": {"electrical", "electrician"},
    "hvac": {"hvac", "heating", "cooling", "air conditioning"},
    "plumbing": {"plumbing", "plumber"},
    "roofing": {"roofing", "roofer", "roof replacement"},
    "painting": {"painting", "painter", "interior painting", "exterior painting"},
    "handyman": {"handyman", "general repair", "repair"},
}


def normalize_trade_key(value: Any) -> str:
    raw = str(value or "").strip().lower()
    if not raw:
        return ""
    raw = raw.replace("&", " and ")
    for key, aliases in TRADE_ALIASES.items():
        if raw == key or raw in aliases:
            return key
        if any(alias in raw for alias in aliases):
            return key
    return "_".join(part for part in raw.replace("/", " ").replace("-", " ").split() if part)


def derive_trade_keys_from_contractor(contractor: Contractor | None) -> list[str]:
    if contractor is None:
        return []
    keys = []
    for skill in contractor.skills.all():
        key = normalize_trade_key(getattr(skill, "name", ""))
        if key:
            keys.append(key)
    return list(dict.fromkeys(keys))


def derive_trade_key_from_agreement(agreement: Agreement | None) -> str:
    if agreement is None:
        return ""
    return normalize_trade_key(
        getattr(agreement, "project_subtype", "")
        or getattr(agreement, "project_type", "")
        or getattr(getattr(agreement, "selected_template", None), "project_subtype", "")
        or getattr(getattr(agreement, "selected_template", None), "project_type", "")
    )


def get_trade_license_requirement(state_code: str, trade_key: str) -> StateTradeLicenseRequirement | None:
    state = str(state_code or "").strip().upper()
    trade = normalize_trade_key(trade_key)
    if not state or not trade:
        return None
    return (
        StateTradeLicenseRequirement.objects.filter(state_code=state, trade_key=trade, active=True)
        .order_by("-last_reviewed_at", "-id")
        .first()
    )


def _record_status(expiration_date, preferred_status: str) -> str:
    if expiration_date and expiration_date < date.today():
        return ContractorComplianceRecord.Status.EXPIRED
    if preferred_status in {
        ContractorComplianceRecord.Status.PENDING_REVIEW,
        ContractorComplianceRecord.Status.VERIFIED,
    }:
        return preferred_status
    return ContractorComplianceRecord.Status.ON_FILE


def sync_legacy_contractor_compliance_records(contractor: Contractor | None) -> None:
    if contractor is None:
        return

    if getattr(contractor, "license_number", "") or getattr(contractor, "license_file", None):
        record, _created = ContractorComplianceRecord.objects.get_or_create(
            contractor=contractor,
            record_type=ContractorComplianceRecord.RecordType.LICENSE,
            source=ContractorComplianceRecord.Source.LEGACY_PROFILE,
            trade_key="",
            defaults={"trade_label": "General uploaded license"},
        )
        record.state_code = str(getattr(contractor, "state", "") or "").strip().upper()
        record.identifier = getattr(contractor, "license_number", "") or ""
        record.expiration_date = getattr(contractor, "license_expiration", None)
        if getattr(contractor, "license_file", None):
            record.file = contractor.license_file
        record.status = _record_status(record.expiration_date, record.status)
        record.trade_label = record.trade_label or "General uploaded license"
        record.save()

    if getattr(contractor, "insurance_file", None):
        record, _created = ContractorComplianceRecord.objects.get_or_create(
            contractor=contractor,
            record_type=ContractorComplianceRecord.RecordType.INSURANCE,
            source=ContractorComplianceRecord.Source.LEGACY_PROFILE,
            trade_key="",
            defaults={"trade_label": "Insurance certificate"},
        )
        record.state_code = str(getattr(contractor, "state", "") or "").strip().upper()
        record.status = _record_status(record.expiration_date, record.status)
        record.trade_label = record.trade_label or "Insurance certificate"
        record.file = contractor.insurance_file
        record.save()


def contractor_has_required_license(contractor: Contractor | None, state_code: str, trade_key: str) -> dict[str, Any]:
    sync_legacy_contractor_compliance_records(contractor)
    state = str(state_code or "").strip().upper()
    trade = normalize_trade_key(trade_key)
    qs = ContractorComplianceRecord.objects.none()
    if contractor is not None:
        qs = contractor.compliance_records.filter(
            record_type=ContractorComplianceRecord.RecordType.LICENSE
        )
    records = list(qs.order_by("-updated_at", "-id"))
    matching = [
        row
        for row in records
        if row.status != ContractorComplianceRecord.Status.EXPIRED
        and (not row.state_code or row.state_code == state)
        and (not row.trade_key or row.trade_key == trade)
    ]
    expired = [
        row
        for row in records
        if row.status == ContractorComplianceRecord.Status.EXPIRED
        and (not row.state_code or row.state_code == state)
        and (not row.trade_key or row.trade_key == trade)
    ]
    if matching:
        row = matching[0]
        return {
            "has_license": True,
            "status": row.status,
            "record_id": row.id,
        }
    if expired:
        return {"has_license": False, "status": ContractorComplianceRecord.Status.EXPIRED, "record_id": expired[0].id}
    return {"has_license": False, "status": "missing", "record_id": None}


def contractor_has_insurance_on_file(contractor: Contractor | None) -> dict[str, Any]:
    sync_legacy_contractor_compliance_records(contractor)
    qs = ContractorComplianceRecord.objects.none()
    if contractor is not None:
        qs = contractor.compliance_records.filter(
            record_type=ContractorComplianceRecord.RecordType.INSURANCE
        ).order_by("-updated_at", "-id")
    active = qs.exclude(status=ContractorComplianceRecord.Status.EXPIRED).first()
    expired = qs.filter(status=ContractorComplianceRecord.Status.EXPIRED).first()
    if active:
        return {"has_insurance": True, "status": active.status, "record_id": active.id}
    if expired:
        return {"has_insurance": False, "status": ContractorComplianceRecord.Status.EXPIRED, "record_id": expired.id}
    return {"has_insurance": False, "status": "missing", "record_id": None}


def get_compliance_warning_for_trade(state_code: str, trade_key: str, contractor: Contractor | None = None) -> dict[str, Any]:
    requirement = get_trade_license_requirement(state_code, trade_key)
    if requirement is None:
        return {
            "required": False,
            "insurance_required": False,
            "message": "",
            "issuing_authority_name": "",
            "official_lookup_url": "",
            "contractor_has_license_on_file": False,
            "contractor_license_status": "unknown",
            "contractor_has_insurance_on_file": False,
            "warning_level": "none",
            "source_type": "unknown",
        }

    license_status = contractor_has_required_license(contractor, state_code, trade_key)
    insurance_status = contractor_has_insurance_on_file(contractor)

    warning_level = "none"
    message = requirement.rule_notes or ""
    if requirement.license_required and not license_status["has_license"]:
        warning_level = "warning"
        message = (
            f"{requirement.trade_label or trade_key.title()} work in {requirement.state_name or requirement.state_code} "
            f"typically requires a license. Upload a license document."
        )
        if license_status["status"] == ContractorComplianceRecord.Status.EXPIRED:
            warning_level = "critical"
            message = (
                f"A license is typically required for this trade in {requirement.state_name or requirement.state_code}, "
                "and the license on file appears expired."
            )
    elif requirement.insurance_required and not insurance_status["has_insurance"]:
        warning_level = "warning"
        message = "Insurance is typically expected for this work. Upload an insurance certificate."
    elif requirement.license_required:
        warning_level = "info"
        message = (
            f"{requirement.trade_label or trade_key.title()} work in {requirement.state_name or requirement.state_code} "
            "typically requires a license. A document is on file."
        )

    return {
        "required": bool(requirement.license_required),
        "insurance_required": bool(requirement.insurance_required),
        "message": message,
        "issuing_authority_name": requirement.issuing_authority_name,
        "official_lookup_url": requirement.official_lookup_url,
        "contractor_has_license_on_file": bool(license_status["has_license"]),
        "contractor_license_status": license_status["status"],
        "contractor_has_insurance_on_file": bool(insurance_status["has_insurance"]),
        "warning_level": warning_level,
        "source_type": requirement.source_type,
        "state_code": requirement.state_code,
        "trade_key": requirement.trade_key,
        "rule_notes": requirement.rule_notes,
        "exemption_notes": requirement.exemption_notes,
    }


def get_profile_compliance_snapshot(contractor: Contractor | None) -> dict[str, Any]:
    sync_legacy_contractor_compliance_records(contractor)
    state_code = str(getattr(contractor, "state", "") or "").strip().upper() if contractor else ""
    trade_keys = derive_trade_keys_from_contractor(contractor)
    warnings = [get_compliance_warning_for_trade(state_code, trade_key, contractor) for trade_key in trade_keys]
    records = []
    if contractor is not None:
        for row in contractor.compliance_records.order_by("record_type", "trade_key", "-updated_at"):
            records.append(
                {
                    "id": row.id,
                    "record_type": row.record_type,
                    "trade_key": row.trade_key,
                    "trade_label": row.trade_label,
                    "state_code": row.state_code,
                    "identifier": row.identifier,
                    "expiration_date": row.expiration_date.isoformat() if row.expiration_date else None,
                    "status": row.status,
                    "file_url": row.file.url if getattr(row, "file", None) else None,
                    "source": row.source,
                }
            )
    return {
        "trade_requirements": warnings,
        "compliance_records": records,
        "insurance_status": contractor_has_insurance_on_file(contractor),
    }


def get_agreement_compliance_warning(agreement: Agreement | None) -> dict[str, Any]:
    if agreement is None:
        return {"warning_level": "none", "message": ""}
    trade_key = derive_trade_key_from_agreement(agreement)
    state_code = str(getattr(agreement, "project_address_state", "") or "").strip().upper()
    warning = get_compliance_warning_for_trade(state_code, trade_key, getattr(agreement, "contractor", None))
    warning["trade_key"] = trade_key
    warning["state_code"] = state_code
    return warning


def get_public_trust_indicators(contractor: Contractor | None, *, show_license_public: bool = True) -> list[str]:
    if contractor is None:
        return []
    items = []
    insurance_status = contractor_has_insurance_on_file(contractor)
    if show_license_public:
        license_status = contractor_has_required_license(contractor, getattr(contractor, "state", ""), "")
        if license_status["has_license"]:
            items.append("License on file")
    if insurance_status["has_insurance"]:
        items.append("Insurance on file")
    return items


def get_assignment_compliance_check(*, state_code: str, trade_key: str, contractor: Contractor | None) -> dict[str, Any]:
    warning = get_compliance_warning_for_trade(state_code, trade_key, contractor)
    warning["assignment_ready"] = not (
        warning["required"] and not warning["contractor_has_license_on_file"]
    )
    return warning
