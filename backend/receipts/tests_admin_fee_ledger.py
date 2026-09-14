from types import SimpleNamespace

from django.test import SimpleTestCase

from receipts.admin_fee_ledger import _expected_fee_cents_from_snapshot


class FeeLedgerSnapshotTests(SimpleTestCase):
    def test_full_waiver_uses_post_promotion_fee(self):
        receipt = SimpleNamespace(
            platform_fee_before_promotion_cents=300,
            waived_fee_cents=300,
            platform_fee_uncapped_cents=300,
            cap_remaining_cents=75000,
        )

        self.assertEqual(_expected_fee_cents_from_snapshot(receipt), 0)

    def test_partial_waiver_uses_post_promotion_fee(self):
        receipt = SimpleNamespace(
            platform_fee_before_promotion_cents=400,
            waived_fee_cents=100,
            platform_fee_uncapped_cents=400,
            cap_remaining_cents=75000,
        )

        self.assertEqual(_expected_fee_cents_from_snapshot(receipt), 300)

    def test_legacy_receipt_uses_cap_snapshot(self):
        receipt = SimpleNamespace(
            platform_fee_before_promotion_cents=None,
            waived_fee_cents=None,
            platform_fee_uncapped_cents=500,
            cap_remaining_cents=275,
        )

        self.assertEqual(_expected_fee_cents_from_snapshot(receipt), 275)
