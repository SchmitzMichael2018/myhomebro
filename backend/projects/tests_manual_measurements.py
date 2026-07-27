from django.test import SimpleTestCase

from projects.services.manual_measurements import build_manual_measurement
from projects.services.measurement_calculations import MeasurementCalculationError


class ManualMeasurementProfileTests(SimpleTestCase):
    def test_linear_and_rectangle_profiles(self):
        linear = build_manual_measurement({"profile": "linear_measurement", "source": "field_verified_manual", "length": "12 ft"})
        self.assertEqual(linear["calculations"][0]["display_value"], "12.00")
        self.assertEqual(linear["calculations"][0]["verification_status"], "verified")
        rectangle = build_manual_measurement({"profile": "rectangle", "source": "approximate_manual", "length": "12 ft", "width": "10 ft"})
        self.assertEqual(next(row for row in rectangle["calculations"] if row["result_type"] == "net_area")["display_value"], "120.00")
        self.assertEqual(rectangle["calculations"][0]["calculation_version"], "2")

    def test_wall_deductions_apply_quantity_and_preserve_gross_net(self):
        result = build_manual_measurement({
            "profile": "wall_with_deductions", "source": "field_verified_manual",
            "length": "12 ft", "height": "8 ft",
            "deductions": [{"deduction_key": "windows", "type": "window", "label": "Window", "width": "3 ft", "height": "4 ft", "quantity": 2}],
        })
        values = {row["result_type"]: row["display_value"] for row in result["calculations"]}
        self.assertEqual(values["gross_area"], "96.00")
        self.assertEqual(values["excluded_area"], "24.00")
        self.assertEqual(values["net_area"], "72.00")

    def test_deductions_cannot_exceed_gross(self):
        with self.assertRaises(MeasurementCalculationError):
            build_manual_measurement({
                "profile": "wall_with_deductions", "source": "approximate_manual",
                "length": "2 ft", "height": "2 ft",
                "deductions": [{"deduction_key": "door", "type": "door", "label": "Door", "width": "3 ft", "height": "7 ft", "quantity": 1}],
            })

    def test_overflow_is_rejected(self):
        with self.assertRaises(MeasurementCalculationError):
            build_manual_measurement({
                "profile": "linear_measurement",
                "source": "approximate_manual",
                "length": "1000000001 in",
            })

    def test_multiple_sections_add_and_subtract(self):
        result = build_manual_measurement({
            "profile": "multi_section_area", "source": "approximate_manual",
            "sections": [
                {"section_key": "main", "label": "Main", "operation": "add", "length": "10 ft", "width": "10 ft", "notes": ""},
                {"section_key": "alcove", "label": "Alcove", "operation": "add", "length": "2 ft", "width": "5 ft", "notes": ""},
                {"section_key": "island", "label": "Island", "operation": "subtract", "length": "2 ft", "width": "3 ft", "notes": ""},
            ],
        })
        net = next(row for row in result["calculations"] if row["result_type"] == "net_area")
        positive = next(row for row in result["calculations"] if row["result_type"] == "gross_area")
        self.assertEqual(positive["display_value"], "110.00")
        self.assertEqual(net["display_value"], "104.00")
        self.assertNotIn("waste", str(result).lower())
