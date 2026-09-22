import json
from xml.etree import ElementTree
from unittest.mock import patch

from django.test import TestCase, override_settings
from django.urls import reverse


@override_settings(
    SECURE_SSL_REDIRECT=False,
    STORAGES={
        "default": {"BACKEND": "django.core.files.storage.FileSystemStorage"},
        "staticfiles": {
            "BACKEND": "django.contrib.staticfiles.storage.StaticFilesStorage"
        },
    },
)
class SeoFoundationTests(TestCase):
    def test_homepage_has_complete_search_and_social_metadata(self):
        response = self.client.get(reverse("spa_index"))

        self.assertEqual(response.status_code, 200)
        self.assertContains(response, "MyHomeBro | Plan, Hire &amp; Manage Home Projects")
        self.assertContains(response, '<link rel="canonical" href="https://www.myhomebro.com/"')
        self.assertContains(response, 'property="og:image"')
        self.assertContains(response, 'name="twitter:card" content="summary_large_image"')
        self.assertContains(response, 'name="robots" content="index, follow"')
        self.assertNotContains(response, "MyHomeBro - Secure Escrow Payments")

    def test_faq_is_indexable_and_private_routes_default_to_noindex(self):
        faq = self.client.get("/faq/")
        private = self.client.get("/portal/private-token")

        self.assertContains(faq, "Frequently Asked Questions | MyHomeBro")
        self.assertContains(faq, 'href="https://www.myhomebro.com/faq"')
        self.assertContains(faq, 'content="index, follow"')
        self.assertContains(private, 'content="noindex, nofollow"')
        self.assertContains(
            private, 'href="https://www.myhomebro.com/portal/private-token"'
        )

    @patch("accounts.services.verification._send_sms")
    @patch("accounts.services.verification.send_verification_email")
    def test_turnstile_diagnostic_is_public_but_not_indexable(self, send_email, send_sms):
        for path, canonical in (
            ("/turnstile-diagnostic/", "https://www.myhomebro.com/turnstile-diagnostic"),
            ("/turnstile-diagnostic/production/", "https://www.myhomebro.com/turnstile-diagnostic/production"),
        ):
            response = self.client.get(path)
            self.assertEqual(response.status_code, 200)
            self.assertContains(response, 'content="noindex, nofollow"')
            self.assertContains(response, f'href="{canonical}"')

        sitemap = self.client.get(reverse("sitemap-xml")).content.decode()
        robots = self.client.get(reverse("robots-txt")).content.decode()
        self.assertNotIn("turnstile-diagnostic", sitemap)
        self.assertIn("Disallow: /turnstile-diagnostic/", robots)
        send_email.assert_not_called()
        send_sms.assert_not_called()

    def test_homepage_json_ld_is_truthful_and_valid(self):
        response = self.client.get("/")
        html = response.content.decode()
        marker = '<script type="application/ld+json"'
        payload = html.split(marker, 1)[1].split(">", 1)[1].split("</script>", 1)[0]
        data = json.loads(payload)

        self.assertEqual(data["@context"], "https://schema.org")
        self.assertEqual(
            [item["@type"] for item in data["@graph"]],
            ["Organization", "WebSite"],
        )
        self.assertEqual(data["@graph"][0]["url"], "https://www.myhomebro.com/")
        self.assertNotIn("aggregateRating", payload)

    @override_settings(GOOGLE_SITE_VERIFICATION="safe-test-token")
    def test_search_verification_is_configuration_driven(self):
        response = self.client.get("/")

        self.assertContains(
            response,
            'name="google-site-verification" content="safe-test-token"',
        )

    def test_robots_allows_public_content_and_blocks_operational_routes(self):
        response = self.client.get(reverse("robots-txt"))
        body = response.content.decode()

        self.assertEqual(response.status_code, 200)
        self.assertIn("Allow: /improvements/", body)
        self.assertIn("Disallow: /admin/", body)
        self.assertIn("Disallow: /api/", body)
        self.assertIn("Disallow: /app/", body)
        self.assertIn("Sitemap: https://www.myhomebro.com/sitemap.xml", body)

    def test_sitemap_is_valid_unique_and_public_only(self):
        response = self.client.get(reverse("sitemap-xml"))
        root = ElementTree.fromstring(response.content)
        urls = [node.text for node in root.iter("{http://www.sitemaps.org/schemas/sitemap/0.9}loc")]

        self.assertEqual(len(urls), len(set(urls)))
        self.assertIn("https://www.myhomebro.com/", urls)
        self.assertIn("https://www.myhomebro.com/faq", urls)
        self.assertIn("https://www.myhomebro.com/legal/privacy-policy/", urls)
        self.assertFalse(any("/app/" in url or "/portal/" in url for url in urls))
