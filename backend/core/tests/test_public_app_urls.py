from django.core.checks import Error
from django.core.exceptions import ImproperlyConfigured
from django.test import SimpleTestCase, override_settings

from core.checks import public_site_url_deploy_check
from core.public_app_urls import build_public_app_url, normalize_public_app_origin


class PublicAppUrlTests(SimpleTestCase):
    def test_trailing_slash_is_normalized_and_only_relative_paths_are_accepted(self):
        with override_settings(SITE_URL="https://www.myhomebro.com/"):
            self.assertEqual(build_public_app_url("/appointment-confirmation/token"),
                             "https://www.myhomebro.com/appointment-confirmation/token")
            for unsafe in ("appointment-confirmation/token", "//evil.example/x", "https://evil.example/x"):
                with self.subTest(unsafe=unsafe), self.assertRaises(ValueError):
                    build_public_app_url(unsafe)

    def test_production_check_rejects_unsafe_origins(self):
        invalid = (
            "", "http://www.myhomebro.com", "https://localhost", "https://127.0.0.1",
            "https://[::1]", "https://user:pass@www.myhomebro.com",
            "https://www.myhomebro.com?next=x", "https://www.myhomebro.com#x",
            "https://dev.local", "https://www.myhomebro.com:5173", "https://www.myhomebro.com/app",
        )
        for value in invalid:
            with self.subTest(value=value), override_settings(
                DEPLOYMENT_ENVIRONMENT="production", SITE_URL_CONFIGURED=True, SITE_URL=value,
            ):
                messages = public_site_url_deploy_check(None)
                self.assertTrue(any(isinstance(message, Error) and message.id == "core.E130" for message in messages))

    @override_settings(
        DEPLOYMENT_ENVIRONMENT="production", SITE_URL_CONFIGURED=True,
        SITE_URL="https://www.myhomebro.com/",
    )
    def test_production_check_accepts_canonical_origin(self):
        self.assertFalse(any(message.id == "core.E130" for message in public_site_url_deploy_check(None)))

    def test_non_local_http_is_rejected_but_local_development_is_allowed(self):
        self.assertEqual(normalize_public_app_origin("http://localhost:5173/"), "http://localhost:5173")
        with self.assertRaises(ImproperlyConfigured):
            normalize_public_app_origin("http://public.example.com")
