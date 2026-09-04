from types import SimpleNamespace
from unittest.mock import patch

from django.test import SimpleTestCase

from projects.services.agreements.contractor_signing import send_signature_request_to_homeowner


class AgreementSignatureDeliveryTests(SimpleTestCase):
    def agreement(self):
        return SimpleNamespace(
            pk=35,
            id=35,
            homeowner=SimpleNamespace(email="customer@example.com"),
        )

    @patch("projects.services.agreements.contractor_signing.sms_link_to_parties", return_value=1)
    @patch("projects.services.agreements.contractor_signing.email_signing_invite", return_value=True)
    @patch("projects.services.agreements.contractor_signing.build_public_sign_url")
    @patch("projects.services.agreements.contractor_signing.assert_agreement_ready_for_signature")
    @patch("projects.services.agreements.contractor_signing.assert_pricing_ready_for_agreement")
    def test_resend_bypasses_dedupe_and_reports_delivery(self, _pricing, _ready, build_url, email, sms):
        build_url.side_effect = [
            "https://www.myhomebro.com/public-sign/first-token",
            "https://www.myhomebro.com/public-sign/second-token",
        ]
        agreement = self.agreement()

        first = send_signature_request_to_homeowner(agreement, force_send=True)
        second = send_signature_request_to_homeowner(agreement, force_send=True)

        self.assertEqual(first["delivery"], {"email_sent": True, "sms_sent": 1})
        self.assertEqual(second["delivery"], {"email_sent": True, "sms_sent": 1})
        first_key = sms.call_args_list[0].kwargs["dedupe_key"]
        second_key = sms.call_args_list[1].kwargs["dedupe_key"]
        self.assertEqual(first_key, "")
        self.assertEqual(second_key, "")
        self.assertEqual(email.call_count, 2)

    @patch("projects.services.agreements.contractor_signing.sms_link_to_parties", return_value=0)
    @patch("projects.services.agreements.contractor_signing.email_signing_invite", return_value=False)
    @patch(
        "projects.services.agreements.contractor_signing.build_public_sign_url",
        return_value="https://www.myhomebro.com/public-sign/token",
    )
    @patch("projects.services.agreements.contractor_signing.assert_agreement_ready_for_signature")
    @patch("projects.services.agreements.contractor_signing.assert_pricing_ready_for_agreement")
    def test_all_channel_failure_returns_actionable_error(self, _pricing, _ready, _url, _email, _sms):
        with self.assertRaisesRegex(ValueError, "could not be delivered by email or text"):
            send_signature_request_to_homeowner(self.agreement())
