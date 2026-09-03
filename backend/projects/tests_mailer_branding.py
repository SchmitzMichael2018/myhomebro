from django.test import SimpleTestCase, override_settings

from projects.services.mailer import _public_logo_url


class MailerBrandingTests(SimpleTestCase):
    @override_settings(
        FRONTEND_URL="https://www.myhomebro.com/",
        PUBLIC_LOGO_URL="https://example.invalid/old-logo.png",
    )
    def test_public_logo_uses_stable_frontend_asset(self):
        self.assertEqual(
            _public_logo_url(),
            "https://www.myhomebro.com/static/myhomebro-logo.png",
        )

    @override_settings(FRONTEND_URL="", PUBLIC_LOGO_URL="https://cdn.example.com/logo.png")
    def test_public_logo_keeps_configured_fallback_without_frontend_url(self):
        self.assertEqual(_public_logo_url(), "https://cdn.example.com/logo.png")
