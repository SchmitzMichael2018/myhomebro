from decimal import Decimal

from projects.services.measurement_calculations import (
    MeasurementCalculationError,
    calculate_measurement_session,
    parse_measurement,
)


MAX_SECTIONS = 24
MAX_DEDUCTIONS = 24
PROFILES = {"linear_measurement", "rectangle", "wall_with_deductions", "multi_section_area"}
SOURCES = {
    "field_verified_manual": ("manual_entry", "verified"),
    "approximate_manual": ("manual_entry", "estimated"),
    "plan_derived": ("existing_plan", "needs_verification"),
    "photo_estimated": ("photo_reference", "estimated"),
    "laser_manual": ("laser_manual_entry", "verified"),
}
DEDUCTION_TYPES = {"door", "window", "opening", "cabinet", "custom"}


def _text(value, maximum, field):
    value = str(value or "").strip()
    if not value or len(value) > maximum:
        raise MeasurementCalculationError(f"{field} is required and must be {maximum} characters or fewer.")
    return value


def _dimension(raw, key, label, dimension_type, source_method, verification_status):
    raw = _text(raw, 160, label)
    normalized, normalized_unit = parse_measurement(raw, dimension_type)
    if normalized <= 0:
        raise MeasurementCalculationError(f"{label} must be greater than zero.")
    if normalized > Decimal("1000000000"):
        raise MeasurementCalculationError(f"{label} exceeds the supported measurement range.")
    return {
        "client_key": key,
        "reading_group": "",
        "label": label,
        "dimension_type": dimension_type,
        "raw_value": raw,
        "normalized_value": str(normalized),
        "normalized_unit": normalized_unit,
        "display_unit": "feet_inches",
        "source_method": source_method,
        "verification_status": verification_status,
        "confidence": None,
        "tool_description": "",
        "notes": "",
        "selected_for_calculation": True,
        "selection_method": "manual_profile",
        "direction": "",
        "tolerance_profile": "general_construction",
    }


def build_manual_measurement(payload):
    if not isinstance(payload, dict):
        raise MeasurementCalculationError("Measurement payload must be an object.")
    profile = payload.get("profile")
    if profile not in PROFILES:
        raise MeasurementCalculationError("Choose a supported manual calculation type.")
    source_key = payload.get("source") or "approximate_manual"
    if source_key not in SOURCES:
        raise MeasurementCalculationError("Choose a supported source and verification state.")
    source_method, verification_status = SOURCES[source_key]
    entries = []
    adjustments = []

    if profile == "linear_measurement":
        entries.append(_dimension(payload.get("length"), "length", "Length", "length", source_method, verification_status))
    elif profile == "rectangle":
        entries.extend([
            _dimension(payload.get("length"), "length", "Length", "length", source_method, verification_status),
            _dimension(payload.get("width"), "width", "Width", "width", source_method, verification_status),
        ])
    elif profile == "wall_with_deductions":
        entries.extend([
            _dimension(payload.get("length"), "wall-length", "Wall length", "width", source_method, verification_status),
            _dimension(payload.get("height"), "wall-height", "Wall height", "height", source_method, verification_status),
        ])
        deductions = payload.get("deductions") or []
        if not isinstance(deductions, list) or len(deductions) > MAX_DEDUCTIONS:
            raise MeasurementCalculationError(f"Use no more than {MAX_DEDUCTIONS} deductions.")
        keys = set()
        for index, deduction in enumerate(deductions):
            if not isinstance(deduction, dict) or set(deduction) - {"deduction_key", "type", "label", "width", "height", "quantity"}:
                raise MeasurementCalculationError("Deduction fields are invalid.")
            key = _text(deduction.get("deduction_key"), 80, "Deduction key")
            if key in keys:
                raise MeasurementCalculationError("Deduction keys must be unique.")
            keys.add(key)
            if deduction.get("type") not in DEDUCTION_TYPES:
                raise MeasurementCalculationError("Deduction type is invalid.")
            try:
                quantity = int(deduction.get("quantity", 1))
            except (TypeError, ValueError):
                raise MeasurementCalculationError("Deduction quantity must be a whole number.") from None
            if quantity < 1 or quantity > 100:
                raise MeasurementCalculationError("Deduction quantity must be between 1 and 100.")
            width_key, height_key = f"{key}-width", f"{key}-height"
            label = _text(deduction.get("label") or deduction.get("type"), 160, "Deduction label")
            entries.extend([
                _dimension(deduction.get("width"), width_key, f"{label} width", "opening_width", source_method, verification_status),
                _dimension(deduction.get("height"), height_key, f"{label} height", "opening_height", source_method, verification_status),
            ])
            adjustments.append({
                "client_key": key, "label": label, "adjustment_type": "exclusion",
                "source_entry_keys": [width_key, height_key], "quantity": quantity,
                "notes": f"{deduction['type']} × {quantity}",
            })
    else:
        sections = payload.get("sections") or []
        if not isinstance(sections, list) or not sections or len(sections) > MAX_SECTIONS:
            raise MeasurementCalculationError(f"Provide between 1 and {MAX_SECTIONS} sections.")
        keys = set()
        for index, section in enumerate(sections):
            if not isinstance(section, dict) or set(section) - {"section_key", "label", "operation", "length", "width", "notes"}:
                raise MeasurementCalculationError("Section fields are invalid.")
            key = _text(section.get("section_key"), 80, "Section key")
            if key in keys:
                raise MeasurementCalculationError("Section keys must be unique.")
            keys.add(key)
            operation = section.get("operation")
            if operation not in {"add", "subtract"}:
                raise MeasurementCalculationError("Section operation must be add or subtract.")
            label = _text(section.get("label"), 160, "Section label")
            length_key, width_key = f"{key}-length", f"{key}-width"
            dimension_rows = [
                _dimension(section.get("length"), length_key, f"{label} length", "length", source_method, verification_status),
                _dimension(section.get("width"), width_key, f"{label} width", "width", source_method, verification_status),
            ]
            entries.extend(dimension_rows)
            if index > 0 or operation == "subtract":
                adjustments.append({
                    "client_key": key, "label": label,
                    "adjustment_type": "addition" if operation == "add" else "exclusion",
                    "source_entry_keys": [length_key, width_key], "quantity": 1,
                    "notes": str(section.get("notes") or "")[:1000],
                })
        if sections[0]["operation"] != "add":
            raise MeasurementCalculationError("The first section must add measured area.")

    calculations, warnings, adjustments = calculate_measurement_session(profile, entries, adjustments)
    return {
        "schema_version": "manual-measurement.v1",
        "profile": profile,
        "source": source_key,
        "entries": entries,
        "adjustments": adjustments,
        "calculations": calculations,
        "warnings": warnings,
        "takeoff_eligible": any(row["result_type"] in {"net_area", "gross_area", "total_linear_length"} for row in calculations),
    }
