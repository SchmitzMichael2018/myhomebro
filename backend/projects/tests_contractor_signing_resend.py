from unittest.mock import Mock, patch

from django.test import SimpleTestCase

from projects.services.agreements.contractor_signing import send_signature_request_to_homeowner


class ContractorSigningResendTests(SimpleTestCase):
    def _agreement(self):
        agreement = Mock()
        agreement.pk = 35
        agreement.id = 35
        agreement.homeowner.email = "customer@example.com"
        return agreement

    @patch("projects.services.agreements.contractor_signing.build_public_sign_url", return_value="https://example.test/sign")
    @patch("projects.services.agreements.contractor_signing.sms_link_to_parties")
    @patch("projects.services.agreements.contractor_signing.email_signing_invite")
    @patch("projects.services.agreements.contractor_signing.assert_agreement_ready_for_signature")
    @patch("projects.services.agreements.contractor_signing.assert_pricing_ready_for_agreement")
    def test_manual_resend_bypasses_sms_deduplication(
        self, _pricing, _readiness, _email, sms, _url
    ):
        agreement = self._agreement()

        result = send_signature_request_to_homeowner(agreement, force_send=True)

        self.assertTrue(result["ok"])
        sms.assert_called_once_with(
            agreement,
            link_url="https://example.test/sign",
            note="Please review and sign your agreement.",
            dedupe_key="",
        )

    @patch("projects.services.agreements.contractor_signing.build_public_sign_url", return_value="https://example.test/sign")
    @patch("projects.services.agreements.contractor_signing.sms_link_to_parties")
    @patch("projects.services.agreements.contractor_signing.email_signing_invite")
    @patch("projects.services.agreements.contractor_signing.assert_agreement_ready_for_signature")
    @patch("projects.services.agreements.contractor_signing.assert_pricing_ready_for_agreement")
    def test_first_send_keeps_sms_deduplication(
        self, _pricing, _readiness, _email, sms, _url
    ):
        agreement = self._agreement()

        send_signature_request_to_homeowner(agreement)

        self.assertEqual(
            sms.call_args.kwargs["dedupe_key"],
            "agreement_signature_request:35",
        )
