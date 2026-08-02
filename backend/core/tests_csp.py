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
    def test_spa_meta_policy_allows_only_documented_connect_resources(self):
        template = get_template("index.html")
        self.assertTrue(template.origin.name.endswith("myhomebro\\templates\\index.html"))
        with open(template.origin.name, encoding="utf-8") as template_file:
            html = template_file.read()
        self.assertIn("script-src 'self' https://js.stripe.com https://connect-js.stripe.com", html)
        self.assertIn("frame-src 'self' blob: https://connect-js.stripe.com https://js.stripe.com", html)
        self.assertIn("img-src 'self' data: https://*.stripe.com", html)
        self.assertIn("style-src 'self' 'nonce-{{ csp_nonce }}' https://fonts.googleapis.com", html)
        self.assertIn("style-src-elem 'self' 'nonce-{{ csp_nonce }}' https://fonts.googleapis.com", html)
        self.assertIn("style-src-attr 'unsafe-inline'", html)
        self.assertIn('meta name="csp-nonce" content="{{ csp_nonce }}"', html)
        self.assertNotIn("script-src 'self' https://*.stripe.com", html)
        self.assertNotIn("'unsafe-eval'", html)
        self.assertNotIn("style-src 'self' 'unsafe-inline'", html)
        self.assertNotIn("*;", html)
        self.assertEqual(html.count('http-equiv="Content-Security-Policy"'), 1)
        self.assertIn("object-src 'none'", html)
        self.assertEqual(settings.SECURE_CROSS_ORIGIN_OPENER_POLICY, "unsafe-none")

    def test_both_spa_templates_keep_the_same_policy(self):
        root = Path(settings.BASE_DIR).parent
        copies = [root / "templates" / "index.html", Path(settings.BASE_DIR) / "templates" / "index.html"]
        policies = []
        for path in copies:
            html = path.read_text(encoding="utf-8")
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
