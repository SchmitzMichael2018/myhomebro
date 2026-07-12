import json
from decimal import Decimal
from types import SimpleNamespace
from unittest.mock import patch

from django.contrib.auth import get_user_model
from django.core.files.uploadedfile import SimpleUploadedFile
from django.test import TestCase, override_settings
from rest_framework.test import APIClient

from projects.models import (
    AIUsageLedger,
    Contractor,
    ContractorAsset,
    ExpenseRequest,
    ProjectAssistantSmartCaptureSession,
)


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

    def create(self, **kwargs):
        self.calls += 1
        if self.exc:
            raise self.exc
        return SimpleNamespace(
            id=f"resp-{self.calls}",
            output_text=json.dumps(self.payload),
            usage=SimpleNamespace(input_tokens=111, output_tokens=44, total_tokens=155),
        )


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
        self.assertEqual(equipment.data["structured_payload"]["destination"], "")
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
