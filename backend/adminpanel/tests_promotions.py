from datetime import timedelta
from decimal import Decimal

from django.contrib.auth import get_user_model
from django.test import TestCase
from django.utils import timezone
from rest_framework.test import APIClient

from payments.fees import calculate_platform_fee, compute_fee_summary
from projects.models import Contractor, PlatformFeePromotionAuditEvent, PlatformFeePromotionGrant


class PlatformFeePromotionTests(TestCase):
    def setUp(self):
        User = get_user_model()
        self.admin = User.objects.create_user(email="owner@example.com", password="test-pass", is_staff=True)
        self.contractor_user = User.objects.create_user(email="contractor@example.com", password="test-pass")
        self.contractor = Contractor.objects.create(user=self.contractor_user, business_name="Promotion Test Builder")
        self.regular_user = User.objects.create_user(email="customer@example.com", password="test-pass")
        self.client = APIClient()
        self.client.defaults.update({"wsgi.url_scheme": "https", "SERVER_PORT": "443", "HTTPS": "on"})

    def payload(self, **overrides):
        now = timezone.now()
        data = {
            "contractor_id": self.contractor.id,
            "code": "FOUNDING-CONTRACTOR",
            "waiver_percent": "100.00",
            "starts_at": (now - timedelta(minutes=5)).isoformat(),
            "ends_at": (now + timedelta(days=60)).isoformat(),
            "reason": "First contractor promotion",
        }
        data.update(overrides)
        return data

    def test_only_admin_can_create_and_control_waiver(self):
        self.client.force_authenticate(user=self.regular_user)
        denied = self.client.post("/api/projects/admin/fees/promotions/", self.payload(), format="json")
        self.assertEqual(denied.status_code, 403)

        self.client.force_authenticate(user=self.admin)
        created = self.client.post("/api/projects/admin/fees/promotions/", self.payload(), format="json")
        self.assertEqual(created.status_code, 201)
        self.assertTrue(created.data["effective_now"])
        grant = PlatformFeePromotionGrant.objects.get()
        self.assertEqual(grant.granted_by, self.admin)
        self.assertEqual(grant.code, "FOUNDING-CONTRACTOR")
        self.assertTrue(PlatformFeePromotionAuditEvent.objects.filter(grant=grant, action="created").exists())

        ended = self.client.patch(
            f"/api/projects/admin/fees/promotions/{grant.id}/",
            {"active": False},
            format="json",
        )
        self.assertEqual(ended.status_code, 200)
        self.assertFalse(ended.data["active"])
        self.assertTrue(PlatformFeePromotionAuditEvent.objects.filter(grant=grant, action="deactivated").exists())

    def test_overlapping_active_waivers_are_rejected(self):
        self.client.force_authenticate(user=self.admin)
        self.assertEqual(self.client.post("/api/projects/admin/fees/promotions/", self.payload(), format="json").status_code, 201)
        duplicate = self.client.post(
            "/api/projects/admin/fees/promotions/",
            self.payload(code="ANOTHER-WAIVER"),
            format="json",
        )
        self.assertEqual(duplicate.status_code, 400)
        self.assertIn("starts_at", duplicate.data)

    def test_active_100_percent_grant_zeroes_unified_and_legacy_platform_fee(self):
        PlatformFeePromotionGrant.objects.create(
            contractor=self.contractor,
            code="FOUNDING-CONTRACTOR",
            waiver_percent=Decimal("100.00"),
            starts_at=timezone.now() - timedelta(days=1),
            ends_at=timezone.now() + timedelta(days=30),
            granted_by=self.admin,
        )

        unified = calculate_platform_fee(
            amount_cents=100_000,
            contractor=self.contractor,
            project_id=None,
            context="test",
        )
        self.assertEqual(unified.platform_fee_cents, 0)
        self.assertEqual(unified.payout_cents, 100_000)
        self.assertEqual(unified.promotion_code, "FOUNDING-CONTRACTOR")
        self.assertGreater(unified.waived_fee_cents, 0)

        legacy = compute_fee_summary(
            project_amount=Decimal("1000.00"),
            contractor_created_at=timezone.now(),
            contractor=self.contractor,
            fee_payer="contractor",
        )
        self.assertEqual(legacy.platform_fee, Decimal("0.00"))
        self.assertEqual(legacy.contractor_payout, Decimal("1000.00"))
        self.assertEqual(legacy.promotion_code, "FOUNDING-CONTRACTOR")

    def test_expired_grant_does_not_change_platform_fee(self):
        PlatformFeePromotionGrant.objects.create(
            contractor=self.contractor,
            code="EXPIRED",
            starts_at=timezone.now() - timedelta(days=10),
            ends_at=timezone.now() - timedelta(days=1),
            granted_by=self.admin,
        )
        result = calculate_platform_fee(
            amount_cents=100_000,
            contractor=self.contractor,
            project_id=None,
            context="test",
        )
        self.assertGreater(result.platform_fee_cents, 0)
        self.assertEqual(result.promotion_code, "")

