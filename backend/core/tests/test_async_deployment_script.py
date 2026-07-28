from pathlib import Path

from django.conf import settings
from django.test import SimpleTestCase


class AsyncDeploymentScriptTests(SimpleTestCase):
    def test_gate_uses_capability_aware_pdf_mode(self):
        script = (
            Path(settings.BASE_DIR).parent / "scripts" / "check_async_readiness.sh"
        ).read_text(encoding="utf-8")
        self.assertIn("check_async_services --mode configuration", script)
        self.assertIn("check_async_services --mode pdf", script)
        self.assertNotIn("check_async_services --mode broker", script)
        self.assertNotIn("check_async_services --mode worker", script)
