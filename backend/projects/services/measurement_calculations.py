import re
from decimal import Decimal, InvalidOperation, ROUND_HALF_UP, getcontext


getcontext().prec = 28
CALCULATION_VERSION = "2"
VERIFICATION_RANK = {
    "confirmed": 0, "verified": 1, "needs_verification": 2, "estimated": 3,
}
TOLERANCE_INCHES = {
    "rough_room": Decimal("0.5"),
    "general_construction": Decimal("0.25"),
    "finish_carpentry": Decimal("0.125"),
    "cabinetry": Decimal("0.0625"),
    "countertop": Decimal("0.0625"),
}
NUMBER_WORDS = {
    "zero": 0, "one": 1, "two": 2, "three": 3, "four": 4, "five": 5,
    "six": 6, "seven": 7, "eight": 8, "nine": 9, "ten": 10,
    "eleven": 11, "twelve": 12, "thirteen": 13, "fourteen": 14,
    "fifteen": 15, "sixteen": 16, "seventeen": 17, "eighteen": 18,
    "nineteen": 19, "twenty": 20, "thirty": 30, "forty": 40,
    "fifty": 50, "sixty": 60, "seventy": 70, "eighty": 80, "ninety": 90,
}
FRACTION_WORDS = {
    "half": "1/2", "quarter": "1/4", "fourth": "1/4", "eighth": "1/8",
    "sixteenth": "1/16", "thirty-second": "1/32",
}


class MeasurementCalculationError(ValueError):
    pass


def _fraction(value):
    numerator, denominator = value.split("/", 1)
    denominator = Decimal(denominator)
    if denominator <= 0 or int(denominator) not in {2, 4, 8, 16, 32}:
        raise MeasurementCalculationError("Use a supported construction fraction.")
    result = Decimal(numerator) / denominator
    if result < 0 or result >= 1:
        raise MeasurementCalculationError("Fractional inches must be between zero and one inch.")
    return result


def parse_measurement(raw_value, dimension_type="length"):
    raw = str(raw_value or "").strip().lower()
    if not raw or raw.startswith("-"):
        raise MeasurementCalculationError("Enter a non-negative measurement.")
    raw = raw.replace("feet", "ft").replace("foot", "ft").replace("inches", "in").replace("inch", "in")
    raw = _replace_number_words(raw)
    raw = raw.replace("′", "'").replace("″", '"')
    if dimension_type == "angle":
        match = re.fullmatch(r"\s*(\d+(?:\.\d+)?)\s*(?:deg(?:rees?)?|°)?\s*", raw)
        if not match:
            raise MeasurementCalculationError("Enter a valid angle.")
        return Decimal(match.group(1)), "degrees"
    metric_match = re.fullmatch(r"\s*(\d+(?:\.\d+)?)\s*(m|cm|mm)\s*", raw)
    if metric_match:
        value = Decimal(metric_match.group(1))
        multiplier = {"m": Decimal("39.37007874015748031496062992"), "cm": Decimal("0.3937007874015748031496062992"), "mm": Decimal("0.03937007874015748031496062992")}
        return value * multiplier[metric_match.group(2)], "inches"
    fractional_feet = re.fullmatch(r"\s*(\d+)\s+(\d+/\d+)\s*(?:ft|')\s*", raw)
    if fractional_feet:
        return (Decimal(fractional_feet.group(1)) + _fraction(fractional_feet.group(2))) * 12, "inches"
    feet = Decimal("0")
    inches = Decimal("0")
    fraction = Decimal("0")
    feet_match = re.search(r"(\d+(?:\.\d+)?)\s*(?:ft|')", raw)
    if feet_match:
        feet = Decimal(feet_match.group(1))
    mixed_inch_match = re.search(r"(\d+(?:\.\d+)?)\s+(?=\d+/\d+\s*(?:in|\")?)", raw)
    inch_match = mixed_inch_match or re.search(r"(?<!/)\b(\d+(?:\.\d+)?)\s*(?:in|\")", raw)
    if inch_match:
        inches = Decimal(inch_match.group(1))
    fraction_match = re.search(r"(\d+/\d+)\s*(?:in|\")?", raw)
    if fraction_match:
        fraction = _fraction(fraction_match.group(1))
    if not feet_match and not inch_match and not fraction_match:
        decimal_match = re.fullmatch(r"(\d+(?:\.\d+)?)\s*(ft|in|lf|sq ft|cu ft)?", raw)
        if not decimal_match:
            raise MeasurementCalculationError("Enter feet, inches, or a supported fraction.")
        value = Decimal(decimal_match.group(1))
        unit = decimal_match.group(2) or "in"
        if unit in {"ft", "lf"}:
            return value * 12, "inches"
        if unit == "sq ft":
            return value * 144, "square_inches"
        if unit == "cu ft":
            return value * 1728, "cubic_inches"
        return value, "inches"
    total = feet * 12 + inches + fraction
    if total < 0:
        raise MeasurementCalculationError("Measurements cannot be negative.")
    return total, "inches"


def _replace_number_words(raw):
    """Normalize the bounded construction phrases supported by voice entry."""
    tokens = raw.replace("-", " ").split()
    output = []
    index = 0
    while index < len(tokens):
        if (
            tokens[index] in {"a", "one", "two", "three"}
            and index + 1 < len(tokens)
            and tokens[index + 1].rstrip("s") in FRACTION_WORDS
        ):
            numerator = 1 if tokens[index] == "a" else NUMBER_WORDS[tokens[index]]
            denominator = FRACTION_WORDS[tokens[index + 1].rstrip("s")].split("/")[1]
            output.append(f"{numerator}/{denominator}")
            index += 1
        elif tokens[index] in NUMBER_WORDS:
            total = NUMBER_WORDS[tokens[index]]
            while index + 1 < len(tokens) and tokens[index + 1] in NUMBER_WORDS:
                index += 1
                total += NUMBER_WORDS[tokens[index]]
            output.append(str(total))
        elif tokens[index] in FRACTION_WORDS:
            output.append(FRACTION_WORDS[tokens[index]])
        elif tokens[index] != "and":
            output.append(tokens[index])
        index += 1
    return " ".join(output)


def display_inches(value):
    value = Decimal(value)
    feet = int(value // 12)
    remaining = value - Decimal(feet * 12)
    whole = int(remaining)
    fraction = (remaining - whole).quantize(Decimal("0.03125"), rounding=ROUND_HALF_UP)
    if fraction == 1:
        whole += 1
        fraction = Decimal("0")
    fraction_text = ""
    if fraction:
        numerator = int(fraction * 32)
        denominator = 32
        while numerator % 2 == 0:
            numerator //= 2
            denominator //= 2
        fraction_text = f" {numerator}/{denominator}"
    return f"{feet} ft {whole}{fraction_text} in" if feet else f"{whole}{fraction_text} in"


def _status(entries):
    if not entries:
        return "needs_verification"
    return max(
        (entry.get("verification_status", "needs_verification") for entry in entries),
        key=lambda value: VERIFICATION_RANK.get(value, 3),
    )


def _result(result_type, label, value, unit, formula, entries, adjustments=None):
    display_divisor = {
        "square_inches": Decimal(144),
        "cubic_inches": Decimal(1728),
        "inches": Decimal(12),
    }[unit]
    display_unit = {
        "square_inches": "square_feet",
        "cubic_inches": "cubic_feet",
        "inches": "linear_feet",
    }[unit]
    display_value = (value / display_divisor).quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)
    return {
        "result_type": result_type,
        "label": label,
        "normalized_value": str(value),
        "normalized_unit": unit,
        "display_value": str(display_value),
        "display_unit": display_unit,
        "formula_key": formula,
        "calculation_version": CALCULATION_VERSION,
        "source_entry_keys": [entry["client_key"] for entry in entries],
        "adjustment_keys": [row["client_key"] for row in adjustments or []],
        "verification_status": _status(entries),
        "lineage": {
            "formula": formula,
            "inputs": {entry["client_key"]: str(entry["normalized_value"]) for entry in entries},
            "sources": {
                entry["client_key"]: entry.get("source_metadata", {})
                for entry in entries
                if entry.get("source_metadata")
            },
        },
    }


def calculate_measurement_session(profile, entries, adjustments=None):
    adjustments = adjustments or []
    selected = [row for row in entries if row.get("selected_for_calculation", True)]
    by_type = {}
    for row in selected:
        by_type.setdefault(row["dimension_type"], []).append(row)
    results = []
    warnings = []

    def one(kind):
        rows = by_type.get(kind, [])
        return rows[0] if rows else None

    requested_profile = profile
    profile = {
        "linear_measurement": "linear_run",
        "rectangle": "rectangular_room",
        "wall_with_deductions": "wall",
        "multi_section_area": "rectangular_room",
    }.get(profile, profile)
    if profile in {"rectangular_room", "wall", "opening", "rectangular_volume"}:
        keys = {
            "rectangular_room": ("length", "width"),
            "wall": ("width", "height"),
            "opening": ("opening_width", "opening_height"),
            "rectangular_volume": ("length", "width", "depth"),
        }[profile]
        source = [one(key) for key in keys]
        if all(source):
            values = [Decimal(row["normalized_value"]) for row in source]
            gross = values[0] * values[1]
            if profile == "opening":
                results.append(_result("opening_area", "Opening area", gross, "square_inches", "opening.rectangle.v1", source))
                results.append(_result("perimeter", "Opening perimeter", 2 * (values[0] + values[1]), "inches", "opening.perimeter.v1", source))
            elif profile == "rectangular_volume":
                results.append(_result("volume", "Volume", gross * values[2], "cubic_inches", "volume.rectangle.v1", source))
            else:
                result_type = "gross_area"
                results.append(_result(result_type, "Gross area", gross, "square_inches", f"{profile}.gross.v1", source))
                additions = exclusions = Decimal("0")
                for adjustment in adjustments:
                    adjustment_entries = [row for row in selected if row["client_key"] in adjustment["source_entry_keys"]]
                    calculated = Decimal("0")
                    if len(adjustment_entries) == 2:
                        quantity = Decimal(str(adjustment.get("quantity", 1)))
                        calculated = Decimal(adjustment_entries[0]["normalized_value"]) * Decimal(adjustment_entries[1]["normalized_value"]) * quantity
                    adjustment["calculated_value"] = str(calculated)
                    if adjustment["adjustment_type"] == "addition":
                        additions += calculated
                    elif adjustment["adjustment_type"] == "exclusion":
                        exclusions += calculated
                net = gross + additions - exclusions
                if net < 0:
                    raise MeasurementCalculationError("Deductions cannot exceed gross measured area.")
                if requested_profile == "multi_section_area":
                    results[0] = _result(
                        "gross_area", "Positive section subtotal", gross + additions,
                        "square_inches", "multi_section_area.positive.v1", source, adjustments,
                    )
                results.append(_result("excluded_area", "Excluded area", exclusions, "square_inches", "adjustments.excluded.v1", source, adjustments))
                results.append(_result("net_area", "Net area", net, "square_inches", "area.net.v1", source, adjustments))
                results.append(_result("perimeter", "Perimeter", 2 * (values[0] + values[1]), "inches", f"{profile}.perimeter.v1", source))
    elif profile == "linear_run":
        segments = by_type.get("perimeter_segment", []) or by_type.get("length", [])
        if segments:
            total = sum((Decimal(row["normalized_value"]) for row in segments), Decimal("0"))
            results.append(_result("total_linear_length", "Total linear length", total, "inches", "linear.sum.v1", segments))

    for group, rows in _reading_groups(entries).items():
        values = [Decimal(row["normalized_value"]) for row in rows]
        variance = max(values) - min(values)
        tolerance = TOLERANCE_INCHES.get(rows[0].get("tolerance_profile", "general_construction"), Decimal("0.25"))
        if variance > tolerance:
            warnings.append(f"{group} readings differ by {display_inches(variance)}. Recheck recommended.")
    if profile == "opening":
        width = one("opening_width")
        if width and not Decimal("18") <= Decimal(width["normalized_value"]) <= Decimal("96"):
            warnings.append("Opening width is outside the typical configured range. Confirm if intentional.")
    if profile == "wall":
        height = one("height")
        if height and not Decimal("72") <= Decimal(height["normalized_value"]) <= Decimal("240"):
            warnings.append("Wall height is outside the typical configured range. Confirm if intentional.")
    segments = by_type.get("perimeter_segment", [])
    directed = [row for row in segments if row.get("direction")]
    if directed and len(directed) == len(segments):
        totals = {
            direction: sum(
                (Decimal(row["normalized_value"]) for row in directed if row["direction"] == direction),
                Decimal("0"),
            )
            for direction in ("north", "east", "south", "west")
        }
        if totals["north"] != totals["south"] or totals["east"] != totals["west"]:
            warnings.append("Room outline does not close. Recheck the highlighted segments.")
    if any(Decimal(row["normalized_value"]) == 0 for row in entries):
        warnings.append("One or more dimensions are zero. Verify before use.")
    return results, warnings, adjustments


def _reading_groups(entries):
    grouped = {}
    for row in entries:
        if row.get("reading_group"):
            grouped.setdefault(row["reading_group"], []).append(row)
    return {key: rows for key, rows in grouped.items() if len(rows) > 1}
