from unittest.mock import patch

from django.test import SimpleTestCase, override_settings

from accounts.views import PUBLIC_REGISTRATION_URL


@override_settings(SECURE_SSL_REDIRECT=False)
class PublicRegistrationQrTests(SimpleTestCase):
    @patch("qrcode.make")
    def test_qr_destination_is_fixed_and_cannot_be_overridden(self, make_qr):
        image = make_qr.return_value
        image.save.side_effect = lambda output: output.write(b"<svg>registration</svg>")

        response = self.client.get(
            "/api/accounts/public/registration-qr/?destination=https://attacker.example/register"
        )

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response["Content-Type"], "image/svg+xml")
        self.assertEqual(response.content, b"<svg>registration</svg>")
        self.assertEqual(make_qr.call_args.args[0], PUBLIC_REGISTRATION_URL)
        self.assertNotIn("attacker.example", str(make_qr.call_args))
