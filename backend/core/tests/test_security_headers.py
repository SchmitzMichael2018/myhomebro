from django.test import SimpleTestCase, override_settings


class ProductionSecurityHeaderTests(SimpleTestCase):
    @override_settings(
        SECURE_SSL_REDIRECT=True,
        SECURE_HSTS_SECONDS=300,
        SECURE_HSTS_INCLUDE_SUBDOMAINS=False,
        SECURE_HSTS_PRELOAD=False,
        X_FRAME_OPTIONS="DENY",
    )
    def test_secure_response_has_staged_hsts_and_denies_framing(self):
        response = self.client.get("/healthz", secure=True)

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response["Strict-Transport-Security"], "max-age=300")
        self.assertEqual(response["X-Frame-Options"], "DENY")

    @override_settings(
        SECURE_SSL_REDIRECT=True,
        SECURE_HSTS_SECONDS=300,
        X_FRAME_OPTIONS="DENY",
    )
    def test_plain_http_is_redirected_before_sensitive_content_is_served(self):
        response = self.client.get("/healthz")

        self.assertEqual(response.status_code, 301)
        self.assertTrue(response["Location"].startswith("https://"))
