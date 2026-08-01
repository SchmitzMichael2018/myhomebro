from django.test import SimpleTestCase, override_settings
from django.template.loader import get_template
from django.conf import settings


@override_settings(SECURE_SSL_REDIRECT=False)
class FrontendContentSecurityPolicyTests(SimpleTestCase):
    def test_spa_meta_policy_allows_only_documented_connect_resources(self):
        template = get_template("index.html")
        self.assertTrue(template.origin.name.endswith("myhomebro\\templates\\index.html"))
        with open(template.origin.name, encoding="utf-8") as template_file:
            html = template_file.read()
        self.assertIn("script-src 'self' https://js.stripe.com https://connect-js.stripe.com", html)
        self.assertIn("frame-src 'self' https://connect-js.stripe.com https://js.stripe.com", html)
        self.assertIn("img-src 'self' data: https://*.stripe.com", html)
        self.assertIn("'sha256-0hAheEzaMe6uXIKV4EehS9pu1am1lj/KnnzrOYqckXk='", html)
        self.assertNotIn("script-src 'self' https://*.stripe.com", html)
        self.assertNotIn("'unsafe-eval'", html)
        self.assertEqual(settings.SECURE_CROSS_ORIGIN_OPENER_POLICY, "unsafe-none")
