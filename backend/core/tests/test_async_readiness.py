from io import StringIO
from unittest.mock import patch

from django.contrib.auth import get_user_model
from django.core.management import CommandError, call_command
from django.test import SimpleTestCase, TestCase, override_settings

from core.async_readiness import configuration_diagnostics, readiness_report
from core.checks import async_services_deploy_checks


class AsyncConfigurationTests(SimpleTestCase):
    @override_settings(
        DEPLOYMENT_ENVIRONMENT="production",
        PDF_ASYNC_ENABLED=True,
        CELERY_BROKER_URL="",
        REDIS_URL="",
        CELERY_RESULT_BACKEND=None,
    )
    def test_production_async_pdf_requires_broker(self):
        self.assertIn("missing", " ".join(configuration_diagnostics()["errors"]).lower())

    @override_settings(
        DEPLOYMENT_ENVIRONMENT="production",
        PDF_ASYNC_ENABLED=True,
        CELERY_BROKER_URL="redis://localhost:6379/0",
    )
    def test_production_rejects_localhost_broker(self):
        self.assertIn("localhost", " ".join(configuration_diagnostics()["errors"]).lower())

    @override_settings(
        DEPLOYMENT_ENVIRONMENT="production",
        PDF_ASYNC_ENABLED=True,
        CELERY_BROKER_URL="not-a-url",
    )
    def test_malformed_broker_is_reported(self):
        self.assertIn("malformed", " ".join(configuration_diagnostics()["errors"]).lower())

    @override_settings(
        DEPLOYMENT_ENVIRONMENT="production",
        PDF_ASYNC_ENABLED=True,
        CELERY_BROKER_URL="redis://queue.example.test:6379/0",
    )
    @patch("core.async_readiness.importlib.util.find_spec", return_value=None)
    def test_missing_redis_dependency_is_reported(self, _find_spec):
        self.assertIn("redis package", " ".join(configuration_diagnostics()["errors"]).lower())

    @override_settings(
        DEPLOYMENT_ENVIRONMENT="staging",
        PDF_ASYNC_ENABLED=False,
        PDF_SYNC_FALLBACK_ENABLED=True,
        CELERY_TASK_ALWAYS_EAGER=True,
        CELERY_BROKER_URL="",
        CELERY_RESULT_BACKEND=None,
    )
    def test_unsafe_non_development_modes_warn(self):
        warnings = " ".join(configuration_diagnostics()["warnings"]).lower()
        self.assertIn("eager", warnings)
        self.assertIn("fallback", warnings)

    @override_settings(
        DEPLOYMENT_ENVIRONMENT="development",
        PDF_ASYNC_ENABLED=False,
        CELERY_BROKER_URL="",
        CELERY_RESULT_BACKEND=None,
    )
    def test_async_disabled_development_configuration_is_safe(self):
        self.assertTrue(configuration_diagnostics()["ready"])

    @override_settings(
        DEPLOYMENT_ENVIRONMENT="production",
        PDF_ASYNC_ENABLED=True,
        CELERY_BROKER_URL="",
        CELERY_RESULT_BACKEND=None,
    )
    def test_django_check_emits_error(self):
        messages = async_services_deploy_checks(None)
        self.assertTrue(any(message.id.startswith("core.E") for message in messages))


class AsyncReadinessCommandTests(SimpleTestCase):
    @patch("core.management.commands.check_async_services.readiness_report")
    def test_configuration_mode_returns_nonzero_when_not_ready(self, report):
        report.return_value = {"ready": False}
        with self.assertRaises(CommandError):
            call_command("check_async_services", mode="configuration", stdout=StringIO())

    @patch("core.management.commands.check_async_services.readiness_report")
    def test_configuration_mode_passes_without_network_probe(self, report):
        report.return_value = {"ready": True}
        out = StringIO()
        call_command("check_async_services", mode="configuration", stdout=out)
        self.assertIn("PASS", out.getvalue())
        report.assert_called_once_with(
            connect_broker=False,
            check_worker=False,
            write_test=False,
        )


@override_settings(SECURE_SSL_REDIRECT=False)
class AsyncHealthViewTests(TestCase):
    def setUp(self):
        self.staff = get_user_model().objects.create_user(
            email="operations@example.com",
            password="test",
            is_staff=True,
        )

    def test_public_liveness_stays_minimal(self):
        response = self.client.get("/healthz")
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.content, b"ok")

    def test_readiness_detail_requires_staff(self):
        response = self.client.get("/admin/health/async-services/")
        self.assertEqual(response.status_code, 302)

    @patch("core.views_health.readiness_report")
    def test_staff_readiness_detail_is_sanitized(self, report):
        report.return_value = {
            "ready": False,
            "configuration": {
                "broker": {"configured": True, "host": "redis.example.test", "scheme": "rediss"},
            },
        }
        self.client.force_login(self.staff)
        response = self.client.get("/admin/health/async-services/")
        self.assertEqual(response.status_code, 503)
        self.assertNotContains(response, "password", status_code=503)
