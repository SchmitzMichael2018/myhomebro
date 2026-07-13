import json
from io import StringIO
from decimal import Decimal
from pathlib import Path
from tempfile import TemporaryDirectory
from types import SimpleNamespace
from unittest.mock import patch

from django.contrib.auth import get_user_model
from django.core.files.uploadedfile import SimpleUploadedFile
from django.core.management import call_command
from django.test import TestCase, override_settings
from rest_framework.test import APIClient

from projects.models import (
    AIUsageLedger,
    Contractor,
    ContractorAsset,
    ExpenseRequest,
    ProjectAssistantSmartCaptureSession,
)
from projects.services.project_assistant_smart_capture import openai_schema


def receipt_payload(**patches):
    payload = {
        "merchant_name": "Tile Depot",
        "merchant_address": None,
        "purchase_date": "2026-07-09",
        "purchase_time": None,
        "receipt_number": "R-100",
        "subtotal": "250.00",
        "tax": "20.00",
        "total": "270.00",
        "currency": "USD",
        "payment_method_masked": "Visa 4111111111111111",
        "line_items": [{"description": "LVP", "quantity": "10", "unit_price": "25.00", "total": "250.00", "sku": "LVP-10"}],
        "suggested_category": "materials",
        "project_reference": None,
        "milestone_reference": None,
        "customer_reference": None,
        "notes": "Visible receipt",
        "warnings": [],
        "missing_fields": [],
        "field_confidence": {"merchant_name": "high_confidence", "total": "high_confidence"},
    }
    payload.update(patches)
    return payload


def walmart_live_shape_payload(**patches):
    payload = receipt_payload(
        merchant_name="Walmart",
        merchant_address="",
        purchase_date="",
        purchase_time="",
        receipt_number="12345",
        subtotal="14.82",
        tax="1.22",
        total="16.04",
        currency="",
        payment_method_masked="Visa 4111111111111111",
        line_items=[
            {"description": "Paint tray", "quantity": "", "unit_price": "6.97", "total": "6.97", "sku": "TRAY-1"},
            {"description": "Roller cover", "quantity": "0", "unit_price": "0", "total": "0", "sku": "ROLLER-ZERO"},
        ],
        suggested_category="other",
        missing_fields=[{"field": "purchase_date", "label": "Purchase Date"}, {"field": "purchase_date", "label": "Purchase Date"}],
        field_confidence={
            "merchant_name": "high_confidence",
            "purchase_date": "confirmed",
            "subtotal": "high_confidence",
            "tax": "high_confidence",
            "total": "high_confidence",
            "currency": "confirmed",
            "suggested_category": "not_detected",
            "payment_method_masked": "high_confidence",
        },
    )
    payload.update(patches)
    return payload


def label_payload(**patches):
    payload = {
        "asset_type": "equipment",
        "product_name": "DeWalt Hammer Drill",
        "manufacturer": "DeWalt",
        "brand": "DeWalt",
        "model_number": "DCD996",
        "serial_number": "SN-PA-12345",
        "sku": "TOOL-99",
        "barcode": None,
        "manufacture_date": None,
        "purchase_date": None,
        "warranty_period": None,
        "warranty_expiration": None,
        "voltage": "20V",
        "capacity": None,
        "size": None,
        "color_or_finish": None,
        "lot_or_batch_number": None,
        "notes": "Visible label",
        "warnings": [],
        "missing_fields": [],
        "field_confidence": {"serial_number": "high_confidence"},
    }
    payload.update(patches)
    return payload


class FakeResponses:
    def __init__(self, payload=None, exc=None):
        self.payload = payload or receipt_payload()
        self.exc = exc
        self.calls = 0
        self.last_kwargs = None

    def create(self, **kwargs):
        self.calls += 1
        self.last_kwargs = kwargs
        if self.exc:
            raise self.exc
        return SimpleNamespace(
            id=f"resp-{self.calls}",
            output_text=json.dumps(self.payload),
            usage=SimpleNamespace(input_tokens=111, output_tokens=44, total_tokens=155),
        )


class FakeOpenAIBadRequestError(Exception):
    status_code = 400
    request_id = "req_smart_capture_400"
    body = {
        "error": {
            "message": "Invalid image_url. API key sk-test-secret and data:image/jpeg;base64,AAAAABBBBBCCCCCDDDDD should not appear.",
            "type": "invalid_request_error",
            "code": "invalid_image",
            "param": "input[1].content[1].image_url",
        }
    }


def assert_strict_openai_schema(testcase, schema, path="schema"):
    schema_type = schema.get("type")
    is_object = schema_type == "object" or (isinstance(schema_type, list) and "object" in schema_type)
    if is_object:
        properties = schema.get("properties")
        testcase.assertIsInstance(properties, dict, f"{path}.properties must be declared")
        testcase.assertIs(schema.get("additionalProperties"), False, f"{path}.additionalProperties must be false")
        testcase.assertEqual(
            set(schema.get("required", [])),
            set(properties.keys()),
            f"{path}.required must exactly match properties",
        )
        for key, child in properties.items():
            assert_strict_openai_schema(testcase, child, f"{path}.properties.{key}")
    if schema.get("type") == "array" and isinstance(schema.get("items"), dict):
        assert_strict_openai_schema(testcase, schema["items"], f"{path}.items")


@override_settings(
    SECURE_SSL_REDIRECT=False,
    DEFAULT_FILE_STORAGE="django.core.files.storage.InMemoryStorage",
    SMART_CAPTURE_PROVIDER="openai",
    SMART_CAPTURE_OPENAI_ENABLED=True,
    OPENAI_API_KEY="sk-test-smart-capture",
    OPENAI_SMART_CAPTURE_MODEL="gpt-4.1-mini",
    SMART_CAPTURE_RECEIPT_PRICE="0.05",
    SMART_CAPTURE_EQUIPMENT_PRICE="0.05",
    SMART_CAPTURE_PRODUCT_LABEL_PRICE="0.05",
)
class ProjectAssistantSmartCaptureOpenAIProviderTests(TestCase):
    def setUp(self):
        user_model = get_user_model()
        self.user = user_model.objects.create_user(email="smart-openai@example.com", password="testpass123")
        self.contractor = Contractor.objects.create(user=self.user, business_name="Smart OpenAI Builders")
        self.client = APIClient()
        self.client.force_authenticate(self.user)

    def upload(self, capture_type="receipt", content_type="image/jpeg"):
        return SimpleUploadedFile("scan.jpg", b"not-real-image-but-preserved", content_type=content_type)

    def post_session(self, capture_type="receipt", fake=None, file_obj=None):
        fake = fake or FakeResponses(receipt_payload() if capture_type == "receipt" else label_payload())
        with patch("projects.services.project_assistant_smart_capture.require_openai_client", return_value=SimpleNamespace(responses=fake)):
            response = self.client.post(
                "/api/projects/project-assistant/smart-capture/sessions/",
                {"capture_type": capture_type, "file": file_obj or self.upload(capture_type)},
                format="multipart",
            )
        return response, fake

    def test_receipt_and_label_schemas_are_strict_openai_structured_outputs(self):
        for capture_type in [
            ProjectAssistantSmartCaptureSession.CAPTURE_RECEIPT,
            ProjectAssistantSmartCaptureSession.CAPTURE_EQUIPMENT_LABEL,
            ProjectAssistantSmartCaptureSession.CAPTURE_PRODUCT_LABEL,
        ]:
            schema = openai_schema(capture_type)["schema"]
            assert_strict_openai_schema(self, schema, capture_type)
            root_props = schema["properties"]
            self.assertIn("field_confidence", root_props)
            self.assertIn("field_confidence", schema["required"])
            confidence = root_props["field_confidence"]
            self.assertIs(confidence["additionalProperties"], False)
            self.assertEqual(set(confidence["required"]), set(confidence["properties"].keys()))

        receipt_schema = openai_schema(ProjectAssistantSmartCaptureSession.CAPTURE_RECEIPT)["schema"]
        line_item_schema = receipt_schema["properties"]["line_items"]["items"]
        self.assertEqual(set(line_item_schema["required"]), set(line_item_schema["properties"].keys()))
        self.assertIn("merchant_name", receipt_schema["properties"]["field_confidence"]["properties"])

        label_schema = openai_schema(ProjectAssistantSmartCaptureSession.CAPTURE_EQUIPMENT_LABEL)["schema"]
        self.assertIn("serial_number", label_schema["properties"]["field_confidence"]["properties"])
        self.assertNotIn("destination", label_schema["properties"])
        self.assertNotIn("destination", label_schema["required"])

    def test_responses_api_receives_current_strict_schema(self):
        response, fake = self.post_session("receipt")
        self.assertEqual(response.status_code, 201, response.data)
        schema = fake.last_kwargs["text"]["format"]["schema"]
        self.assertEqual(fake.last_kwargs["text"]["format"]["type"], "json_schema")
        self.assertEqual(fake.last_kwargs["text"]["format"]["name"], "smart_capture_receipt")
        self.assertEqual(fake.last_kwargs["text"]["format"]["strict"], True)
        assert_strict_openai_schema(self, schema, "responses_api_schema")
        self.assertIn("field_confidence", schema["properties"])
        self.assertIn("field_confidence", schema["required"])

    def test_openai_provider_receipt_response_normalizes_and_logs_usage(self):
        response, fake = self.post_session("receipt")
        self.assertEqual(response.status_code, 201, response.data)
        self.assertEqual(fake.calls, 1)
        self.assertEqual(response.data["structured_payload"]["merchant_name"], "Tile Depot")
        self.assertEqual(response.data["structured_payload"]["payment_method"], "Card ending 1111")
        self.assertEqual(response.data["extraction_provider"], "openai")
        self.assertEqual(ExpenseRequest.objects.count(), 0)
        usage = AIUsageLedger.objects.get()
        self.assertEqual(usage.feature, AIUsageLedger.FEATURE_SMART_CAPTURE_RECEIPT)
        self.assertEqual(usage.billable_amount, Decimal("0.0500"))
        self.assertEqual(usage.billing_status, AIUsageLedger.BILLING_UNBILLED)
        self.assertEqual(usage.input_units, 111)

    def test_openai_provider_equipment_and_product_labels_normalize_without_ownership_inference(self):
        equipment, _ = self.post_session("equipment_label", fake=FakeResponses(label_payload()))
        self.assertEqual(equipment.status_code, 201, equipment.data)
        self.assertEqual(equipment.data["structured_payload"]["manufacturer"], "DeWalt")
        self.assertIsNone(equipment.data["structured_payload"]["destination"])
        product, _ = self.post_session("product_label", fake=FakeResponses(label_payload(product_name="LVP Box", asset_type="product")))
        self.assertEqual(product.status_code, 201, product.data)
        self.assertEqual(product.data["structured_payload"]["product_name"], "LVP Box")
        self.assertEqual(ContractorAsset.objects.count(), 0)

    def test_null_and_missing_values_are_preserved_as_missing_review_items(self):
        response, _ = self.post_session("receipt", fake=FakeResponses(receipt_payload(merchant_name=None, total=None)))
        self.assertEqual(response.status_code, 201, response.data)
        self.assertEqual(response.data["status"], ProjectAssistantSmartCaptureSession.STATUS_NEEDS_INFORMATION)
        fields = {row["field"] for row in response.data["missing_fields"]}
        self.assertIn("merchant_name", fields)
        self.assertIn("total", fields)

    def test_live_walmart_shape_normalizes_blank_confidence_currency_and_payment_consistently(self):
        response, _ = self.post_session("receipt", fake=FakeResponses(walmart_live_shape_payload()))
        self.assertEqual(response.status_code, 201, response.data)
        payload = response.data["structured_payload"]
        confidence = response.data["field_confidence"]
        self.assertIsNone(payload["purchase_date"])
        self.assertEqual(confidence["purchase_date"], "not_detected")
        self.assertEqual([row["field"] for row in response.data["missing_fields"]].count("purchase_date"), 1)
        self.assertIsNone(payload["line_items"][0]["quantity"])
        self.assertEqual(payload["line_items"][1]["quantity"], "0.0000")
        self.assertEqual(payload["line_items"][1]["unit_price"], "0.00")
        self.assertEqual(payload["subtotal"], "14.82")
        self.assertEqual(payload["tax"], "1.22")
        self.assertEqual(payload["total"], "16.04")
        self.assertIsNone(payload["currency"])
        self.assertEqual(confidence["currency"], "not_detected")
        self.assertEqual(payload["suggested_category"], "other")
        self.assertEqual(confidence["suggested_category"], "not_detected")
        self.assertEqual(payload["payment_method"], "Card ending 1111")
        self.assertNotIn("payment_method_masked", payload)
        self.assertNotIn("4111111111111111", json.dumps(response.data, default=str))
        self.assertEqual(ExpenseRequest.objects.count(), 0)
        approve = self.client.post(
            f"/api/projects/project-assistant/smart-capture/sessions/{response.data['id']}/approve/",
            {},
            format="json",
        )
        self.assertEqual(approve.status_code, 200, approve.data)
        self.assertEqual(ExpenseRequest.objects.count(), 1)

    def test_openai_normalization_handles_whitespace_zero_malformed_values_and_missing_deduplication(self):
        response, _ = self.post_session(
            "receipt",
            fake=FakeResponses(
                receipt_payload(
                    merchant_name="   ",
                    purchase_date="not-a-date",
                    purchase_time="not-a-time",
                    subtotal="bad-money",
                    tax="0",
                    total="0",
                    currency="   ",
                    line_items=[
                        {"description": "   ", "quantity": "bad-qty", "unit_price": "0", "total": "", "sku": "   "}
                    ],
                    missing_fields=[
                        {"field": "merchant_name", "label": "Merchant Name"},
                        {"field": "merchant_name", "label": "Merchant Name"},
                    ],
                    field_confidence={
                        "merchant_name": "confirmed",
                        "purchase_date": "high_confidence",
                        "subtotal": "confirmed",
                        "tax": "confirmed",
                        "total": "confirmed",
                        "currency": "high_confidence",
                    },
                )
            ),
        )
        self.assertEqual(response.status_code, 201, response.data)
        payload = response.data["structured_payload"]
        confidence = response.data["field_confidence"]
        self.assertIsNone(payload["merchant_name"])
        self.assertIsNone(payload["purchase_date"])
        self.assertIsNone(payload["purchase_time"])
        self.assertIsNone(payload["subtotal"])
        self.assertEqual(payload["tax"], "0.00")
        self.assertEqual(payload["total"], "0.00")
        self.assertIsNone(payload["currency"])
        self.assertIsNone(payload["line_items"][0]["description"])
        self.assertIsNone(payload["line_items"][0]["quantity"])
        self.assertEqual(payload["line_items"][0]["unit_price"], "0.00")
        self.assertIsNone(payload["line_items"][0]["total"])
        self.assertIsNone(payload["line_items"][0]["sku"])
        self.assertEqual(confidence["merchant_name"], "not_detected")
        self.assertEqual(confidence["purchase_date"], "not_detected")
        self.assertEqual(confidence["subtotal"], "not_detected")
        fields = [row["field"] for row in response.data["missing_fields"]]
        self.assertEqual(fields.count("merchant_name"), 1)
        self.assertEqual(fields.count("purchase_date"), 1)
        warning_text = " ".join(response.data["warnings"])
        self.assertIn("not a valid number", warning_text)
        self.assertIn("not a valid date", warning_text)
        self.assertIn("not a valid time", warning_text)

    def test_malformed_json_and_invalid_schema_are_failed_and_not_billable(self):
        malformed = FakeResponses()
        malformed.payload = {}
        with patch("projects.services.project_assistant_smart_capture.require_openai_client", return_value=SimpleNamespace(responses=SimpleNamespace(create=lambda **kwargs: SimpleNamespace(id="bad-json", output_text="{", usage=SimpleNamespace(input_tokens=1, output_tokens=1))))):
            response = self.client.post(
                "/api/projects/project-assistant/smart-capture/sessions/",
                {"capture_type": "receipt", "file": self.upload()},
                format="multipart",
            )
        self.assertEqual(response.status_code, 201, response.data)
        self.assertEqual(response.data["status"], ProjectAssistantSmartCaptureSession.STATUS_FAILED)
        self.assertEqual(AIUsageLedger.objects.get().billable_amount, Decimal("0.0000"))

        response, _ = self.post_session("receipt", fake=FakeResponses(receipt_payload(line_items="not-a-list")))
        self.assertEqual(response.status_code, 201, response.data)
        self.assertEqual(response.data["status"], ProjectAssistantSmartCaptureSession.STATUS_FAILED)
        self.assertEqual(AIUsageLedger.objects.filter(success=False).count(), 2)

    def test_unexpected_fields_timeout_rate_limit_authentication_quota_and_invalid_model_fail_safely(self):
        response, _ = self.post_session("receipt", fake=FakeResponses({**receipt_payload(), "extra": "nope"}))
        self.assertEqual(response.data["status"], ProjectAssistantSmartCaptureSession.STATUS_FAILED)

        for exc in [
            TimeoutError("timed out"),
            RuntimeError("rate limit reached"),
            RuntimeError("invalid api key"),
            RuntimeError("insufficient_quota"),
            RuntimeError("model not found"),
            RuntimeError("network unavailable"),
        ]:
            response, _ = self.post_session("receipt", fake=FakeResponses(exc=exc))
            self.assertEqual(response.status_code, 201, response.data)
            self.assertEqual(response.data["status"], ProjectAssistantSmartCaptureSession.STATUS_FAILED)
        self.assertEqual(ExpenseRequest.objects.count(), 0)

    def test_bad_request_details_are_captured_without_exposing_secrets_to_api(self):
        response, _ = self.post_session("receipt", fake=FakeResponses(exc=FakeOpenAIBadRequestError()))
        self.assertEqual(response.status_code, 201, response.data)
        self.assertEqual(response.data["status"], ProjectAssistantSmartCaptureSession.STATUS_FAILED)
        warning_text = " ".join(response.data["warnings"])
        self.assertIn("temporarily unavailable", warning_text)
        self.assertNotIn("invalid_image", warning_text)
        self.assertNotIn("sk-test-secret", warning_text)
        self.assertNotIn("base64", warning_text)
        self.assertNotIn("provider_error_details", response.data["audit_metadata"])

        session = ProjectAssistantSmartCaptureSession.objects.get(pk=response.data["id"])
        details = session.audit_metadata["provider_error_details"]
        self.assertEqual(details["http_status"], 400)
        self.assertEqual(details["type"], "invalid_request_error")
        self.assertEqual(details["code"], "invalid_image")
        self.assertEqual(details["param"], "input[1].content[1].image_url")
        self.assertEqual(details["provider_request_id"], "req_smart_capture_400")
        self.assertNotIn("sk-test-secret", json.dumps(details))
        self.assertNotIn("AAAAABBBBB", json.dumps(details))

        usage = AIUsageLedger.objects.get(capture_session=session)
        self.assertFalse(usage.success)
        self.assertEqual(usage.provider_request_id, "req_smart_capture_400")
        self.assertEqual(usage.metadata["provider_error_details"]["http_status"], 400)

    def test_management_command_outputs_sanitized_bad_request_details(self):
        fake = FakeResponses(exc=FakeOpenAIBadRequestError())
        with TemporaryDirectory() as tmpdir:
            image_path = Path(tmpdir) / "receipt.jpg"
            image_path.write_bytes(b"not-real-image")
            stdout = StringIO()
            with patch("projects.services.project_assistant_smart_capture.require_openai_client", return_value=SimpleNamespace(responses=fake)):
                call_command(
                    "test_smart_capture_openai",
                    "--file",
                    str(image_path),
                    "--type",
                    "receipt",
                    "--contractor-id",
                    str(self.contractor.id),
                    stdout=stdout,
                )
        output = stdout.getvalue()
        payload = json.loads(output)
        self.assertEqual(payload["status"], ProjectAssistantSmartCaptureSession.STATUS_FAILED)
        self.assertEqual(payload["provider_error_details"]["http_status"], 400)
        self.assertEqual(payload["provider_error_details"]["type"], "invalid_request_error")
        self.assertEqual(payload["provider_error_details"]["code"], "invalid_image")
        self.assertEqual(payload["provider_error_details"]["param"], "input[1].content[1].image_url")
        self.assertEqual(payload["provider_error_details"]["provider_request_id"], "req_smart_capture_400")
        self.assertNotIn("sk-test-secret", output)
        self.assertNotIn("AAAAABBBBB", output)
        self.assertNotIn("data:image", output)

    @override_settings(OPENAI_API_KEY="", AI_OPENAI_API_KEY="")
    def test_missing_configuration_and_disabled_provider_preserve_session_for_manual_continuation(self):
        response, _ = self.post_session("receipt", file_obj=SimpleUploadedFile("missing-config.jpg", b"unique-missing-config", content_type="image/jpeg"))
        self.assertEqual(response.status_code, 201, response.data)
        self.assertEqual(response.data["status"], ProjectAssistantSmartCaptureSession.STATUS_FAILED)
        self.assertIn("configured", " ".join(response.data["warnings"]).lower())

    @override_settings(SMART_CAPTURE_OPENAI_ENABLED=False)
    def test_openai_disabled_preserves_session_for_retry_or_manual_continuation(self):
        response, _ = self.post_session("receipt")
        self.assertEqual(response.status_code, 201, response.data)
        self.assertEqual(response.data["status"], ProjectAssistantSmartCaptureSession.STATUS_FAILED)
        self.assertIn("disabled", " ".join(response.data["warnings"]).lower())

    def test_cache_reuse_avoids_second_provider_call_and_duplicate_usage_entry(self):
        response, fake = self.post_session("receipt")
        self.assertEqual(response.status_code, 201, response.data)
        second, second_fake = self.post_session("receipt")
        self.assertEqual(second.status_code, 201, second.data)
        self.assertEqual(fake.calls, 1)
        self.assertEqual(second_fake.calls, 0)
        self.assertEqual(AIUsageLedger.objects.count(), 1)
        self.assertIn("Reused", " ".join(second.data["warnings"]))

    @override_settings(SMART_CAPTURE_PROVIDER="deterministic")
    def test_deterministic_provider_is_not_billable(self):
        response = self.client.post(
            "/api/projects/project-assistant/smart-capture/sessions/",
            {"capture_type": "receipt", "file": SimpleUploadedFile("receipt.jpg", b"Merchant: Tile Depot\nTotal: 10.00", content_type="image/jpeg")},
            format="multipart",
        )
        self.assertEqual(response.status_code, 201, response.data)
        self.assertEqual(AIUsageLedger.objects.count(), 0)

    def test_approval_flow_remains_unchanged_after_openai_extraction(self):
        response, _ = self.post_session("receipt")
        self.assertEqual(ExpenseRequest.objects.count(), 0)
        approve = self.client.post(
            f"/api/projects/project-assistant/smart-capture/sessions/{response.data['id']}/approve/",
            {},
            format="json",
        )
        self.assertEqual(approve.status_code, 200, approve.data)
        self.assertEqual(ExpenseRequest.objects.count(), 1)
        self.assertEqual(ContractorAsset.objects.count(), 0)
        self.assertEqual(approve.data["audit_metadata"]["source_file_preserved"], True)

    def test_pdf_is_not_sent_to_openai_in_this_workflow(self):
        response, fake = self.post_session("receipt", file_obj=self.upload(content_type="application/pdf"))
        self.assertEqual(response.status_code, 201, response.data)
        self.assertEqual(response.data["status"], ProjectAssistantSmartCaptureSession.STATUS_FAILED)
        self.assertEqual(fake.calls, 0)
        self.assertIn("PDF", " ".join(response.data["warnings"]))
