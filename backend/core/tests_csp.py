from django.test import SimpleTestCase, override_settings
from django.template.loader import get_template
from django.test import RequestFactory
from pathlib import Path
import re
from unittest.mock import patch
from core.views_frontend import spa
from django.conf import settings


@override_settings(SECURE_SSL_REDIRECT=False)
class FrontendContentSecurityPolicyTests(SimpleTestCase):
    @staticmethod
    def _directives(html):
        match = re.search(r'<meta http-equiv="Content-Security-Policy" content="(.*?)"\s*/>', html, re.S)
        if not match:
            return {}
        return {
            parts[0]: parts[1:]
            for directive in match.group(1).split(";")
            if (parts := directive.split())
        }

    def test_spa_meta_policy_allows_only_documented_connect_resources(self):
        template = get_template("index.html")
        expected_template = Path(settings.BASE_DIR).parent / "templates" / "index.html"
        self.assertEqual(Path(template.origin.name).resolve(), expected_template.resolve())
        with open(template.origin.name, encoding="utf-8") as template_file:
            html = template_file.read()
        self.assertIn("script-src 'self' 'wasm-unsafe-eval' https://js.stripe.com https://connect-js.stripe.com", html)
        self.assertIn("frame-src 'self' blob: https://connect-js.stripe.com https://js.stripe.com", html)
        self.assertIn("img-src 'self' data: https://*.stripe.com", html)
        self.assertIn("style-src 'self' 'unsafe-inline' https://fonts.googleapis.com", html)
        self.assertIn("style-src-elem 'self' 'unsafe-inline' https://fonts.googleapis.com", html)
        self.assertIn("style-src-attr 'unsafe-inline'", html)
        self.assertIn('meta name="csp-nonce" content="{{ csp_nonce }}"', html)
        self.assertIn('style id="_goober" nonce="{{ csp_nonce }}"', html)
        self.assertNotIn("script-src 'self' https://*.stripe.com", html)
        self.assertNotIn("'unsafe-eval'", html)
        self.assertNotIn("'unsafe-inline'", self._directives(html)["script-src"])
        self.assertNotIn("*;", html)
        self.assertEqual(html.count('http-equiv="Content-Security-Policy"'), 1)
        self.assertIn("object-src 'none'", html)
        self.assertEqual(settings.SECURE_CROSS_ORIGIN_OPENER_POLICY, "unsafe-none")

    def test_turnstile_has_only_its_required_csp_permissions(self):
        template = get_template("index.html")
        html = Path(template.origin.name).read_text(encoding="utf-8")
        directives = self._directives(html)
        turnstile_origin = "https://challenges.cloudflare.com"

        self.assertIn(turnstile_origin, directives["script-src"])
        self.assertIn(turnstile_origin, directives["frame-src"])
        self.assertNotIn(turnstile_origin, directives["connect-src"])
        self.assertNotIn("https://*.cloudflare.com", directives["script-src"])
        self.assertNotIn("https:", directives["script-src"])
        self.assertNotIn("*", directives["script-src"])
        self.assertNotIn("https://untrusted.example", directives["script-src"])

    def test_turnstile_change_preserves_stripe_and_google_allowances(self):
        template = get_template("index.html")
        directives = self._directives(Path(template.origin.name).read_text(encoding="utf-8"))

        for origin in ("https://js.stripe.com", "https://connect-js.stripe.com", "https://maps.googleapis.com", "https://maps.gstatic.com"):
            self.assertIn(origin, directives["script-src"])
        for origin in ("https://connect-js.stripe.com", "https://js.stripe.com", "https://hooks.stripe.com"):
            self.assertIn(origin, directives["frame-src"])
        for origin in ("https://api.stripe.com", "https://maps.googleapis.com", "https://maps.gstatic.com", "https://places.googleapis.com"):
            self.assertIn(origin, directives["connect-src"])

    def test_coverage_map_allows_only_documented_additional_tile_and_worker_resources(self):
        template = get_template("index.html")
        directives = self._directives(Path(template.origin.name).read_text(encoding="utf-8"))

        tile_origin = "https://mapsresources-pa.googleapis.com"
        self.assertIn(tile_origin, directives["connect-src"])
        self.assertIn(tile_origin, directives["img-src"])
        self.assertIn("blob:", directives["worker-src"])
        self.assertIn("'wasm-unsafe-eval'", directives["script-src"])
        self.assertNotIn("'unsafe-eval'", directives["script-src"])
        self.assertNotIn("https:", directives["script-src"])
        self.assertNotIn("*", directives["script-src"])

    def test_both_spa_templates_keep_the_same_policy(self):
        root = Path(settings.BASE_DIR).parent
        copies = [root / "templates" / "index.html", Path(settings.BASE_DIR) / "templates" / "index.html"]
        policies = []
        for path in copies:
            html = path.read_text(encoding="utf-8")
            self.assertIn('style id="_goober" nonce="{{ csp_nonce }}"', html)
            match = re.search(r'<meta http-equiv="Content-Security-Policy" content="(.*?)"\s*/>', html, re.S)
            self.assertIsNotNone(match, path)
            self.assertEqual(html.count('http-equiv="Content-Security-Policy"'), 1)
            policies.append(" ".join(match.group(1).split()))
        self.assertEqual(policies[0], policies[1])

    def test_spa_uses_a_fresh_calendar_style_nonce_per_response(self):
        contexts = []
        with patch("core.views_frontend.render", side_effect=lambda request, template, context: contexts.append(context) or object()):
            request = RequestFactory().get("/")
            spa(request)
            spa(request)
        first_nonce = contexts[0]["csp_nonce"]
        second_nonce = contexts[1]["csp_nonce"]
        self.assertNotEqual(first_nonce, second_nonce)
        self.assertGreaterEqual(len(first_nonce), 24)
