from io import BytesIO

from PIL import Image
from django.contrib.auth import get_user_model
from django.core.files.uploadedfile import SimpleUploadedFile
from django.test import TestCase, override_settings
from django.urls import reverse
from django.utils import timezone
from rest_framework.test import APIClient

from projects.models import (
    Capture,
    CaptureQrAsset,
    Contractor,
    ContractorOpportunity,
    ContractorPublicProfile,
    Homeowner,
    Notification,
    PublicContractorLead,
)


@override_settings(
    SECURE_SSL_REDIRECT=False,
    CAPTURE_FOUNDATION_ENABLED=True,
    CAPTURE_INBOX_ENABLED=True,
    CAPTURE_QR_ENABLED=True,
    CAPTURE_QR_PUBLIC_ENABLED=True,
    CAPTURE_QR_MIN_COMPLETION_SECONDS=0,
)
class CaptureQrTests(TestCase):
    def setUp(self):
        user_model = get_user_model()
        self.owner = user_model.objects.create_user(email="qr-owner@example.com", password="test")
        self.contractor = Contractor.objects.create(user=self.owner, business_name="QR Builders")
        self.profile = ContractorPublicProfile.objects.create(
            contractor=self.contractor,
            business_name_public="QR Builders Public",
            brand_primary_color="#123456",
        )
        self.other_owner = user_model.objects.create_user(email="qr-other@example.com", password="test")
        self.other_contractor = Contractor.objects.create(
            user=self.other_owner, business_name="Other Builders"
        )
        self.asset = CaptureQrAsset.objects.create(
            contractor=self.contractor,
            created_by=self.owner,
            profile=self.profile,
            label="Business Card",
            campaign_key="summer-card",
        )
        self.client = APIClient()

    def public_url(self, asset=None):
        return reverse("projects:public-capture-qr", args=[(asset or self.asset).token_key])

    def form_token(self):
        response = self.client.get(self.public_url())
        self.assertEqual(response.status_code, 200)
        return response.data["form_token"]

    def payload(self, **overrides):
        value = {
            "form_token": self.form_token(),
            "name": "Taylor Homeowner",
            "email": "taylor@example.com",
            "project_description": "Please repair the damaged kitchen drywall.",
        }
        value.update(overrides)
        return value

    def test_owner_can_create_list_update_and_manage_lifecycle(self):
        self.client.force_authenticate(self.owner)
        created = self.client.post(reverse("projects:capture-qr-assets"), {
            "label": "Truck QR", "asset_type": "truck", "campaign_key": "fleet",
        }, format="json")
        self.assertEqual(created.status_code, 201)
        asset_id = created.data["id"]
        self.assertNotIn(asset_id, created.data["public_url"])
        self.assertEqual(self.client.get(reverse("projects:capture-qr-assets")).status_code, 200)
        updated = self.client.patch(reverse("projects:capture-qr-asset", args=[asset_id]), {
            "label": "Updated Truck", "campaign_key": "fall-fleet",
        }, format="json")
        self.assertEqual(updated.data["label"], "Updated Truck")
        self.assertFalse(self.client.post(reverse("projects:capture-qr-action", args=[asset_id, "deactivate"])).data["active"])
        self.assertTrue(self.client.post(reverse("projects:capture-qr-action", args=[asset_id, "activate"])).data["active"])
        old_url = updated.data["public_url"]
        rotated = self.client.post(reverse("projects:capture-qr-action", args=[asset_id, "rotate"]))
        self.assertNotEqual(rotated.data["public_url"], old_url)
        revoked = self.client.post(reverse("projects:capture-qr-action", args=[asset_id, "revoke"]))
        self.assertIsNotNone(revoked.data["revoked_at"])

    def test_asset_access_is_contractor_scoped(self):
        self.client.force_authenticate(self.other_owner)
        response = self.client.get(reverse("projects:capture-qr-asset", args=[self.asset.id]))
        self.assertEqual(response.status_code, 404)

    def test_owner_can_generate_svg_qr(self):
        self.client.force_authenticate(self.owner)
        response = self.client.get(reverse("projects:capture-qr-image", args=[self.asset.id]))
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response["Content-Type"], "image/svg+xml")
        self.assertIn(b"<svg", response.content)
        self.assertIn("attachment", response["Content-Disposition"])

    @override_settings(CAPTURE_QR_ENABLED=False)
    def test_feature_disabled_hides_authenticated_and_public_endpoints(self):
        self.client.force_authenticate(self.owner)
        self.assertEqual(self.client.get(reverse("projects:capture-qr-assets")).status_code, 404)
        self.client.force_authenticate(None)
        response = self.client.get(self.public_url())
        self.assertEqual(response.status_code, 404)
        self.assertEqual(response["Cache-Control"], "no-store")

    def test_unavailable_tokens_are_generic(self):
        invalid = self.client.get(reverse("projects:public-capture-qr", args=["not-a-real-token"]))
        self.asset.active = False
        self.asset.save()
        inactive = self.client.get(self.public_url())
        self.assertEqual(invalid.status_code, 404)
        self.assertEqual(invalid.data, inactive.data)
        self.asset.active = True
        self.asset.expires_at = timezone.now()
        self.asset.save()
        self.assertEqual(self.client.get(self.public_url()).status_code, 404)

    def test_public_branding_contains_no_internal_id(self):
        response = self.client.get(self.public_url())
        self.assertEqual(response.data["branding"]["business_name"], "QR Builders Public")
        self.assertEqual(response.data["branding"]["primary_color"], "#123456")
        self.assertNotIn(str(self.asset.id), str(response.data))
        self.assertNotIn(self.owner.email, str(response.data))

    def test_submission_creates_saved_capture_lead_and_notification_only_once(self):
        payload = self.payload()
        with self.captureOnCommitCallbacks(execute=True):
            response = self.client.post(self.public_url(), payload, format="multipart")
        self.assertEqual(response.status_code, 201)
        capture = Capture.objects.get()
        self.assertEqual(capture.status, Capture.STATUS_SAVED)
        self.assertEqual(capture.source_category, "qr")
        self.assertEqual(capture.capture_method, Capture.METHOD_PUBLIC_FORM)
        self.assertEqual(capture.attribution_metadata["campaign"], "summer-card")
        lead = PublicContractorLead.objects.get()
        self.assertEqual(lead.origin_capture, capture)
        self.assertEqual(lead.source, PublicContractorLead.SOURCE_QR)
        self.assertEqual(Notification.objects.count(), 1)
        self.assertEqual(Homeowner.objects.count(), 0)
        self.assertEqual(ContractorOpportunity.objects.count(), 0)
        replay = self.client.post(self.public_url(), payload, format="multipart")
        self.assertEqual(replay.status_code, 200)
        self.assertEqual(Capture.objects.count(), 1)
        self.assertEqual(PublicContractorLead.objects.count(), 1)
        self.assertEqual(Notification.objects.count(), 1)

    def test_phone_only_and_email_only_are_valid_but_contact_is_required(self):
        phone_only = self.payload(email="", phone="555-0100")
        self.assertEqual(self.client.post(self.public_url(), phone_only, format="multipart").status_code, 201)
        email_only = self.payload(email="second@example.com", phone="")
        self.assertEqual(self.client.post(self.public_url(), email_only, format="multipart").status_code, 201)
        missing = self.payload(email="", phone="")
        self.assertEqual(self.client.post(self.public_url(), missing, format="multipart").status_code, 400)

    def test_conflicting_replay_and_honeypot_are_rejected(self):
        payload = self.payload()
        self.assertEqual(self.client.post(self.public_url(), payload, format="multipart").status_code, 201)
        payload["project_description"] = "A different project description."
        self.assertEqual(self.client.post(self.public_url(), payload, format="multipart").status_code, 409)
        spam = self.payload(website="https://spam.invalid")
        self.assertEqual(self.client.post(self.public_url(), spam, format="multipart").status_code, 400)

    def test_photo_is_signature_checked_and_sanitized(self):
        stream = BytesIO()
        Image.new("RGB", (10, 10), "red").save(stream, format="PNG")
        photo = SimpleUploadedFile("room.png", stream.getvalue(), content_type="image/png")
        response = self.client.post(self.public_url(), self.payload(photos=photo), format="multipart")
        self.assertEqual(response.status_code, 201)
        artifact = Capture.objects.get().artifacts.get()
        self.assertEqual(artifact.mime_type, "image/jpeg")
        self.assertTrue(artifact.file_sha256)
        self.assertTrue(artifact.sanitization_metadata["exif_stripped"])
        spoof = SimpleUploadedFile("bad.jpg", b"<script>alert(1)</script>", content_type="image/jpeg")
        self.assertEqual(
            self.client.post(self.public_url(), self.payload(photos=spoof), format="multipart").status_code,
            400,
        )

    def test_analytics_are_scoped_and_do_not_expose_ip(self):
        self.client.get(self.public_url())
        self.client.post(self.public_url(), self.payload(), format="multipart")
        self.client.force_authenticate(self.owner)
        response = self.client.get(reverse("projects:capture-qr-analytics", args=[self.asset.id]))
        self.assertEqual(response.status_code, 200)
        self.assertGreaterEqual(response.data["views"], 1)
        self.assertEqual(response.data["submissions"], 1)
        self.assertNotIn("ip", str(response.data).lower())
