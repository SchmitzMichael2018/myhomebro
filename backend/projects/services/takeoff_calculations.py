from datetime import date
from decimal import Decimal, InvalidOperation, ROUND_CEILING, localcontext

from django.conf import settings


CALCULATION_VERSION = "1"
PROFILE_RESULT_TYPES = {
    "flooring": {"net_area", "gross_area"},
    "paint": {"net_area", "gross_area"},
    "tile": {"net_area", "gross_area", "opening_area"},
    "drywall": {"net_area", "gross_area"},
    "linear_material": {"total_linear_length", "perimeter"},
    "concrete": {"volume"},
}
PROFILE_DEFAULT_WASTE = {
    "flooring": Decimal("10"),
    "paint": Decimal("0"),
    "tile": Decimal("12"),
    "drywall": Decimal("10"),
    "linear_material": Decimal("10"),
    "concrete": Decimal("5"),
}
EXPECTED_COVERAGE_UNITS = {
    "flooring": "square_feet",
    "paint": "square_feet",
    "tile": "square_feet",
    "drywall": "square_feet",
    "linear_material": "linear_feet",
    "concrete": "cubic_feet",
}


class TakeoffCalculationError(ValueError):
    pass


def _decimal(value, label, *, allow_zero=False):
    try:
        result = Decimal(str(value))
    except (InvalidOperation, TypeError, ValueError) as exc:
        raise TakeoffCalculationError(f"{label} must be a number.") from exc
    if not result.is_finite() or result < 0 or (not allow_zero and result == 0):
        raise TakeoffCalculationError(f"{label} must be greater than zero.")
    if result.adjusted() > 18:
        raise TakeoffCalculationError(f"{label} is too large.")
    return result


def measurement_quantity(result):
    value = _decimal(result.normalized_value, "Measurement")
    divisors = {
        "square_inches": Decimal("144"),
        "inches": Decimal("12"),
        "cubic_inches": Decimal("1728"),
    }
    try:
        return value / divisors[result.normalized_unit]
    except KeyError as exc:
        raise TakeoffCalculationError("Measurement unit is not supported for takeoff.") from exc


def product_snapshot(material, waste_percentage, waste_source):
    return {
        "material_id": material.id,
        "name": material.name,
        "brand": material.brand,
        "manufacturer": material.manufacturer,
        "supplier": material.supplier,
        "supplier_sku": material.supplier_sku,
        "selling_unit": material.selling_unit,
        "package_quantity": str(material.package_quantity),
        "coverage_quantity": str(material.coverage_quantity or ""),
        "coverage_unit": material.coverage_unit,
        "unit_price": str(material.unit_price),
        "price_basis": material.price_basis,
        "waste_percentage": str(waste_percentage),
        "waste_source": waste_source,
        "price_source": material.price_source,
        "price_effective_date": material.price_effective_date.isoformat(),
        "calculation_version": CALCULATION_VERSION,
    }


def calculate_takeoff_item(
    *, profile, measurement_result, material, waste_percentage=None,
    waste_source=None, rounding_policy="ceil_to_package", tax_rate=0,
    markup_rate=None, coats=1,
):
    if profile not in PROFILE_RESULT_TYPES:
        raise TakeoffCalculationError("Takeoff profile is not supported.")
    if measurement_result.result_type not in PROFILE_RESULT_TYPES[profile]:
        raise TakeoffCalculationError("Measurement result is not compatible with this trade profile.")
    if not material.is_active:
        raise TakeoffCalculationError("Material is inactive.")
    coverage = _decimal(material.coverage_quantity, "Package coverage")
    price = _decimal(material.unit_price, "Unit price", allow_zero=True)
    if material.coverage_unit != EXPECTED_COVERAGE_UNITS[profile]:
        raise TakeoffCalculationError("Material coverage unit does not match the selected profile.")
    waste = (
        _decimal(waste_percentage, "Waste percentage", allow_zero=True)
        if waste_percentage is not None
        else _decimal(material.waste_default, "Waste percentage", allow_zero=True)
    )
    if waste > 100:
        raise TakeoffCalculationError("Waste percentage cannot exceed 100%.")
    waste_source = waste_source or ("item_override" if waste_percentage is not None else "material_default")
    tax_rate = _decimal(tax_rate, "Tax rate", allow_zero=True)
    markup_rate = _decimal(
        material.markup_default if markup_rate is None else markup_rate,
        "Markup rate",
        allow_zero=True,
    )
    coats_value = _decimal(coats, "Coats")
    measured = measurement_quantity(measurement_result)
    if profile == "paint":
        measured *= coats_value
    with localcontext() as context:
        context.prec = 38
        waste_quantity = measured * waste / Decimal("100")
        required = measured + waste_quantity
        direct_price_basis = material.price_basis in {
            "per_square_foot", "per_linear_foot", "per_cubic_foot",
            "per_cubic_yard", "per_gallon", "per_each",
        }
        theoretical = required if direct_price_basis else required / coverage
        if direct_price_basis:
            purchase = required
            purchased_coverage = required
        else:
            if rounding_policy == "ceil_to_package":
                purchase = theoretical.to_integral_value(rounding=ROUND_CEILING)
            elif rounding_policy == "round_to_whole":
                purchase = theoretical.quantize(Decimal("1"))
            elif rounding_policy == "exact":
                purchase = theoretical
            else:
                raise TakeoffCalculationError("Rounding policy is not supported.")
            purchased_coverage = purchase * coverage
        excess = purchased_coverage - required
        if material.price_basis == "per_selling_unit":
            subtotal = purchase * price
        elif direct_price_basis:
            subtotal = purchased_coverage * price
        else:
            raise TakeoffCalculationError("Custom price basis requires an approved custom rule.")
        tax = subtotal * tax_rate / Decimal("100")
        markup = subtotal * markup_rate / Decimal("100")
        final = subtotal + tax + markup
    warnings = []
    stale_days = (date.today() - material.price_effective_date).days
    if stale_days > getattr(settings, "TAKEOFF_PRICE_STALE_DAYS", 90):
        warnings.append("Price may be outdated. Verify before finalizing.")
    if measurement_result.verification_status not in {"verified", "confirmed"}:
        warnings.append("Needs field verification. This takeoff is provisional.")
    assumptions = {
        "profile": profile,
        "coats": str(coats_value) if profile == "paint" else None,
        "coverage_is_contractor_or_manufacturer_supplied": True,
        "does_not_include_labor": True,
    }
    return {
        "theoretical_quantity": theoretical,
        "waste_percentage": waste,
        "waste_source": waste_source,
        "waste_quantity": waste_quantity,
        "required_quantity": required,
        "purchase_quantity": purchase,
        "purchased_coverage": purchased_coverage,
        "excess_quantity": excess,
        "selling_unit": material.selling_unit,
        "package_coverage": coverage,
        "unit_price_snapshot": price,
        "subtotal": subtotal,
        "tax": tax,
        "markup": markup,
        "final_estimated_cost": final,
        "calculation_version": CALCULATION_VERSION,
        "rounding_policy": rounding_policy,
        "assumptions": assumptions,
        "warnings": warnings,
        "product_snapshot": product_snapshot(material, waste, waste_source),
        "lineage": {
            "measurement_session_id": measurement_result.session_id,
            "measurement_result_id": measurement_result.id,
            "measurement_result_revision": measurement_result.revision,
            "formula": "takeoff.coverage_and_package.v1",
            "measured_quantity": str(measured),
            "measurement_unit": EXPECTED_COVERAGE_UNITS[profile],
            "measurement_lineage": getattr(measurement_result, "lineage", {}),
        },
    }
