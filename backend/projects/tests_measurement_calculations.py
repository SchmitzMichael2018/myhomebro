from decimal import Decimal

from django.test import SimpleTestCase

from projects.services.measurement_calculations import (
    MeasurementCalculationError,
    calculate_measurement_session,
    display_inches,
    parse_measurement,
)


class MeasurementCalculationTests(SimpleTestCase):
    def test_supported_us_customary_forms_preserve_exact_values(self):
        examples = {
            "12 ft 4 in": Decimal("148"),
            "12' 4\"": Decimal("148"),
            "12 feet 4 inches": Decimal("148"),
            "12.333 ft": Decimal("147.996"),
            "148 in": Decimal("148"),
            "4 3/8 in": Decimal("4.375"),
            "12 ft 4 3/8 in": Decimal("148.375"),
            "twelve feet four and three eighths inches": Decimal("148.375"),
            "12 1/2 ft": Decimal("150.0"),
        }
        for raw, expected in examples.items():
            with self.subTest(raw=raw):
                self.assertEqual(parse_measurement(raw)[0], expected)
        self.assertEqual(display_inches(Decimal("148.375")), "12 ft 4 3/8 in")

    def test_metric_forms_normalize_to_inches_without_binary_floats(self):
        self.assertEqual(parse_measurement("3.81 m")[0], Decimal("150.0000000000000000000000000"))
        self.assertEqual(parse_measurement("254 cm")[0], Decimal("100.0000000000000000000000000"))
        self.assertEqual(parse_measurement("25.4 mm")[0], Decimal("1.000000000000000000000000000"))

    def test_invalid_fraction_and_negative_values_are_rejected(self):
        for raw in ("-2 in", "4 1/3 in", "4 9/8 in"):
            with self.subTest(raw=raw), self.assertRaises(MeasurementCalculationError):
                parse_measurement(raw)

    def test_rectangle_calculation_is_decimal_safe_and_weakest_input_wins(self):
        entries = [
            {"client_key": "length", "dimension_type": "length", "normalized_value": "148.375", "verification_status": "verified"},
            {"client_key": "width", "dimension_type": "width", "normalized_value": "175", "verification_status": "estimated"},
        ]
        results, warnings, _ = calculate_measurement_session("rectangular_room", entries)
        gross = next(row for row in results if row["result_type"] == "gross_area")
        self.assertEqual(gross["normalized_value"], "25965.625")
        self.assertEqual(gross["verification_status"], "estimated")
        self.assertEqual(warnings, [])

    def test_repeat_tolerance_and_orthogonal_closure_are_advisory(self):
        entries = [
            {"client_key": "a", "dimension_type": "perimeter_segment", "normalized_value": "120", "verification_status": "verified", "reading_group": "Wall A", "direction": "north"},
            {"client_key": "b", "dimension_type": "perimeter_segment", "normalized_value": "121", "verification_status": "verified", "reading_group": "Wall A", "direction": "south"},
            {"client_key": "c", "dimension_type": "perimeter_segment", "normalized_value": "96", "verification_status": "verified", "direction": "east"},
            {"client_key": "d", "dimension_type": "perimeter_segment", "normalized_value": "95", "verification_status": "verified", "direction": "west"},
        ]
        _, warnings, _ = calculate_measurement_session("linear_run", entries)
        self.assertTrue(any("Recheck recommended" in warning for warning in warnings))
        self.assertTrue(any("does not close" in warning for warning in warnings))

    def test_plausibility_warning_does_not_block_unusual_opening(self):
        entries = [
            {"client_key": "w", "dimension_type": "opening_width", "normalized_value": "12", "verification_status": "verified"},
            {"client_key": "h", "dimension_type": "opening_height", "normalized_value": "80", "verification_status": "verified"},
        ]
        results, warnings, _ = calculate_measurement_session("opening", entries)
        self.assertEqual(len(results), 2)
        self.assertTrue(any("typical configured range" in warning for warning in warnings))
