from pathlib import Path

from django.conf import settings
from django.test import SimpleTestCase, override_settings
from django.urls import reverse


@override_settings(SECURE_SSL_REDIRECT=False)
class LegalDocumentTests(SimpleTestCase):
    def test_public_terms_are_current_and_link_privacy(self):
        response = self.client.get(reverse("terms-of-service"))

        self.assertEqual(response.status_code, 200)
        self.assertContains(response, "September 15, 2026")
        self.assertContains(response, "72 calendar hours")
        self.assertContains(response, "four business days")
        self.assertContains(response, "info@myhomebro.com")
        self.assertContains(response, reverse("privacy-policy"))

    def test_public_privacy_policy_is_current_and_describes_key_processors(self):
        response = self.client.get(reverse("privacy-policy"))

        self.assertEqual(response.status_code, 200)
        self.assertContains(response, "September 21, 2026")
        self.assertContains(response, "Stripe")
        self.assertContains(response, "Project Assistant")
        self.assertContains(response, "Privacy Request")
        self.assertContains(response, "info@myhomebro.com")

    def test_binding_pdf_and_embedded_plain_text_assets_exist(self):
        backend_dir = Path(settings.BASE_DIR)
        for slug in ("terms_of_service", "privacy_policy"):
            pdf = backend_dir / "static" / "legal" / f"{slug}.pdf"
            legacy_pdf = backend_dir / "static" / "legal" / f"Full {slug}.pdf"
            text = backend_dir.parent / "frontend" / "public" / "static" / "legal" / f"{slug}.txt"
            markdown = text.with_suffix(".md")
            self.assertTrue(pdf.is_file(), pdf)
            self.assertGreater(pdf.stat().st_size, 10_000)
            self.assertEqual(pdf.read_bytes(), legacy_pdf.read_bytes())
            self.assertTrue(text.is_file(), text)
            self.assertTrue(markdown.is_file(), markdown)
            self.assertEqual(text.read_text(encoding="utf-8"), markdown.read_text(encoding="utf-8"))
