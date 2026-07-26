from datetime import date, timedelta
from decimal import Decimal
from types import SimpleNamespace

from django.test import SimpleTestCase, override_settings

from projects.services.takeoff_calculations import (
    TakeoffCalculationError,
    calculate_takeoff_item,
)


def result(value="27590.4", unit="square_inches", result_type="net_area", verification="verified"):
    return SimpleNamespace(
        id=12, session_id=7, normalized_value=Decimal(value),
        normalized_unit=unit, result_type=result_type,
        verification_status=verification, revision=2,
    )


def material(**overrides):
    values = {
        "id": 4, "name": "Oak Flooring", "brand": "Example", "manufacturer": "",
        "supplier": "Local Supply", "supplier_sku": "OAK-1", "selling_unit": "box",
        "package_quantity": Decimal("1"), "coverage_quantity": Decimal("22.4"),
        "coverage_unit": "square_feet", "unit_price": Decimal("67.18"),
        "price_basis": "per_selling_unit", "waste_default": Decimal("10"),
        "markup_default": Decimal("0"), "price_source": "Manual quote",
        "price_effective_date": date.today(), "is_active": True,
    }
    values.update(overrides)
    return SimpleNamespace(**values)


class TakeoffCalculationTests(SimpleTestCase):
    def test_flooring_matches_explainable_package_contract(self):
        output = calculate_takeoff_item(
            profile="flooring", measurement_result=result(), material=material(),
            waste_percentage="10",
        )
        self.assertEqual(output["required_quantity"], Decimal("210.760"))
        self.assertEqual(output["theoretical_quantity"], Decimal("9.4089285714285714285714285714285714286"))
        self.assertEqual(output["purchase_quantity"], Decimal("10"))
        self.assertEqual(output["purchased_coverage"], Decimal("224.0"))
        self.assertEqual(output["excess_quantity"], Decimal("13.240"))
        self.assertEqual(output["subtotal"], Decimal("671.80"))

    def test_per_square_foot_and_linear_pricing(self):
        area = calculate_takeoff_item(
            profile="tile", measurement_result=result(),
            material=material(price_basis="per_square_foot", unit_price=Decimal("3.25")),
            waste_percentage=0,
        )
        self.assertEqual(area["subtotal"], Decimal("622.700"))
        linear = calculate_takeoff_item(
            profile="linear_material",
            measurement_result=result("1200", "inches", "total_linear_length"),
            material=material(
                name="Baseboard", selling_unit="linear_foot",
                coverage_quantity=Decimal("1"), coverage_unit="linear_feet",
                price_basis="per_linear_foot", unit_price=Decimal("2.40"),
            ),
            waste_percentage=10, rounding_policy="exact",
        )
        self.assertEqual(linear["required_quantity"], Decimal("110"))
        self.assertEqual(linear["subtotal"], Decimal("264.0"))

    def test_paint_coats_drywall_and_concrete_conversion(self):
        paint = calculate_takeoff_item(
            profile="paint", measurement_result=result("57600"),
            material=material(
                name="Paint", selling_unit="gallon", coverage_quantity=Decimal("400"),
                unit_price=Decimal("82"), coverage_unit="square_feet",
            ),
            coats=2, waste_percentage=0,
        )
        self.assertEqual(paint["purchase_quantity"], Decimal("2"))
        drywall = calculate_takeoff_item(
            profile="drywall", measurement_result=result("57600"),
            material=material(
                name="Drywall", selling_unit="sheet", coverage_quantity=Decimal("32"),
                unit_price=Decimal("15"), coverage_unit="square_feet",
            ),
            waste_percentage=10,
        )
        self.assertEqual(drywall["purchase_quantity"], Decimal("14"))
        concrete = calculate_takeoff_item(
            profile="concrete",
            measurement_result=result("46656", "cubic_inches", "volume"),
            material=material(
                name="Concrete", selling_unit="bag", coverage_quantity=Decimal("0.6"),
                unit_price=Decimal("7.25"), coverage_unit="cubic_feet",
            ),
            waste_percentage=5,
        )
        self.assertEqual(concrete["purchase_quantity"], Decimal("48"))

    @override_settings(TAKEOFF_PRICE_STALE_DAYS=90)
    def test_stale_and_provisional_warnings(self):
        output = calculate_takeoff_item(
            profile="flooring",
            measurement_result=result(verification="estimated"),
            material=material(price_effective_date=date.today() - timedelta(days=91)),
        )
        self.assertEqual(len(output["warnings"]), 2)

    def test_invalid_coverage_units_negative_values_and_custom_rules_rejected(self):
        for item in (
            material(coverage_quantity=Decimal("0")),
            material(coverage_unit="linear_feet"),
            material(unit_price=Decimal("-1")),
            material(price_basis="custom"),
        ):
            with self.subTest(item=item), self.assertRaises(TakeoffCalculationError):
                calculate_takeoff_item(
                    profile="flooring", measurement_result=result(), material=item,
                )
